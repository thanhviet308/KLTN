#!/usr/bin/env bash
set -Eeuo pipefail

expected_commit=${1:?Pass the GitHub commit SHA to deploy}
[[ "$#" == 1 ]] || { echo 'Usage: deploy.sh <commit-sha>' >&2; exit 1; }
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
# Always build locally; ignore any inherited image override.
export BACKEND_IMAGE=pingpong-api:local
export GIT_TERMINAL_PROMPT=0

for tool in git docker flock curl; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
[[ "$(git branch --show-current)" == main ]] || { echo 'VPS checkout must be on main' >&2; exit 1; }

# Serialize manual and automated deployments in this checkout. GitHub Actions
# concurrency does not cover a deployment started directly on the VPS, so wait
# for the current owner instead of failing a healthy queued deployment at once.
lock_file="$(git rev-parse --git-dir)/pingpong-deploy.lock"
exec 9>"$lock_file"
echo 'Waiting up to 15 minutes for any running deployment to finish'
flock -w 900 9 || {
  echo 'Timed out waiting for another deployment; inspect the running process before retrying' >&2
  exit 1
}
[[ -z "$(git status --porcelain)" ]] || { echo 'VPS checkout has local changes; deployment stopped' >&2; exit 1; }

# Fast-forward to the checked commit, even if another push arrives during build.
git fetch origin main
git merge-base --is-ancestor "$expected_commit" origin/main || {
  echo 'Commit is not part of origin/main' >&2; exit 1;
}
git merge --ff-only "$expected_commit"
[[ "$(git rev-parse HEAD)" == "$expected_commit" ]] || {
  echo 'VPS already has a different/newer commit; refusing stale deployment' >&2; exit 1;
}

printf 'VPS checkout updated to %s\n' "$expected_commit"
[[ -f deploy/vps/.env ]] || { echo 'Code updated, but deployment stopped: create deploy/vps/.env using .env.example' >&2; exit 1; }
[[ -f deploy/vps/postgres.env ]] || { echo 'Code updated, but deployment stopped: create deploy/vps/postgres.env using postgres.env.example and configure matching database URLs in .env' >&2; exit 1; }

compose=(docker compose --profile blue-green -f deploy/vps/compose.yml)
health_url=${DEPLOY_HEALTH_URL:-https://pingpongapi.id.vn/api/v1/health/ready}
[[ "$health_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/v1/health/ready$ ]] || { echo 'Invalid proxy health URL' >&2; exit 1; }
revision_health() {
  local url=$1 expected=$2 label=$3 attempts=${4:-10}
  local headers attempt status=1
  [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo "$label: invalid expected revision" >&2; return 1; }
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if headers=$(curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
      --dump-header - --output /dev/null "$url"); then
      if printf '%s\n' "$headers" | tr -d '\r' | grep -iFx "X-PingPong-Revision: $expected" >/dev/null; then
        return 0
      fi
      status=1
    else
      status=$?
    fi
    echo "$label attempt $attempt/$attempts: revision $expected not confirmed" >&2
    [[ "$attempt" == "$attempts" ]] || sleep 1
  done
  echo "$label failed: expected X-PingPong-Revision: $expected" >&2
  return "$status"
}
read_local_revision() {
  local port=$1 label=$2 headers revision
  headers=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
    --dump-header - --output /dev/null "http://127.0.0.1:$port/api/v1/health/ready") || return $?
  revision=$(printf '%s\n' "$headers" | tr -d '\r' \
    | grep -iE '^X-PingPong-Revision: [0-9a-f]{40}$' \
    | sed -E 's/^[^:]+: //' || true)
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || {
    echo "$label returned no unique full X-PingPong-Revision" >&2
    return 1
  }
  printf '%s\n' "$revision"
}
for tool in sudo; do command -v "$tool" >/dev/null || exit 1; done
active_port=$(sudo -n /usr/local/sbin/pingpong-switch-upstream status)
case "$active_port" in
  3000) active=api; candidate=api-green; candidate_port=3001 ;;
  3001) active=api-green; candidate=api; candidate_port=3000 ;;
  *) echo 'Invalid active upstream' >&2; exit 1 ;;
esac
active_container=$("${compose[@]}" ps --all -q "$active")
[[ -n "$active_container" ]] || { echo 'Start the initial Blue API before enabling blue-green deploy' >&2; exit 1; }
active_revision=$(read_local_revision "$active_port" 'Active API readiness')
db_container=$("${compose[@]}" ps -q db)
[[ -n "$db_container" && "$(docker inspect --format '{{.State.Health.Status}}' "$db_container")" == healthy ]] || { echo 'Existing database must be healthy' >&2; exit 1; }
# Avoid starting a build with no memory headroom on the small VPS.
available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
[[ "$available_kb" -ge 524288 ]] || { echo 'Less than 512 MiB RAM available; deployment stopped' >&2; exit 1; }
export BACKEND_IMAGE="pingpong-api:release-$expected_commit"
export DEPLOYMENT_REVISION="$expected_commit"
"${compose[@]}" config --quiet
candidate_started=false
switched=false
old_stopped=false
failure() {
  status=$1
  trap - ERR INT TERM HUP
  echo "Blue-green deployment failed (exit $status)" >&2
  "${compose[@]}" logs --no-color --tail=60 "$candidate" >&2 || true
  safe_to_stop=true
  if [[ "$switched" == true ]]; then
    safe_to_stop=false
    if [[ "$old_stopped" == true ]]; then docker start "$active_container" >/dev/null || true; fi
    if revision_health "http://127.0.0.1:$active_port/api/v1/health/ready" "$active_revision" 'Previous API recovery' 12 \
      && sudo -n /usr/local/sbin/pingpong-switch-upstream "$active_port" \
      && revision_health "$health_url" "$active_revision" 'Rollback proxy readiness'; then
      safe_to_stop=true
      echo "Traffic restored to $active" >&2
    else
      echo 'CRITICAL: rollback failed; candidate kept running for investigation' >&2
    fi
  fi
  if [[ "$candidate_started" == true && "$safe_to_stop" == true ]]; then "${compose[@]}" stop "$candidate" >&2 || true; fi
  exit "$status"
}
trap 'failure "$?"' ERR
trap 'failure 130' INT
trap 'failure 143' TERM
trap 'failure 129' HUP
proxy_health() {
  # Reload returns before all new workers accept traffic. This also retries a
  # stale HTTP 200 carrying the previous slot's revision.
  revision_health "$health_url" "$expected_commit" 'Proxy readiness'
}
printf '\nActive: %s. Building candidate: %s\n' "$active" "$candidate"
# Prefer the image CI already built and pushed; fall back to a local build so a
# registry outage or private package never blocks a deploy.
build_locally=true
if [[ -n "${DEPLOY_IMAGE_REPO:-}" ]]; then
  [[ "$DEPLOY_IMAGE_REPO" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._/-]+$ ]] || { echo 'Invalid DEPLOY_IMAGE_REPO' >&2; exit 1; }
  registry_image="$DEPLOY_IMAGE_REPO:release-$expected_commit"
  if docker pull --quiet "$registry_image" > /dev/null; then
    docker tag "$registry_image" "$BACKEND_IMAGE"
    build_locally=false
    echo "Using prebuilt image $registry_image"
  else
    echo "Could not pull $registry_image; building locally" >&2
  fi
fi
[[ "$build_locally" == false ]] || "${compose[@]}" build "$candidate"
# Pin the artifact used by all following candidate and migration commands.
BACKEND_IMAGE=$(docker image inspect --format '{{.Id}}' "$BACKEND_IMAGE")
export BACKEND_IMAGE
[[ "$BACKEND_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Invalid built image ID' >&2; exit 1; }
for script in api-runtime-dependencies.cjs sharp-runtime-smoke.cjs; do
  args=()
  [[ "$script" != sharp-runtime-smoke.cjs ]] || args=(--source)
  docker run --rm --pull never --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --memory 256m --cpus 1 "$BACKEND_IMAGE" \
    node "apps/api/tests/$script" "${args[@]}"
done
# Only migrations explicitly reviewed as backwards-compatible may run while
# Blue is serving traffic. Future pending migrations fail closed until added.
reviewed_migrations=(CallMessages1791763200000 PasswordReset1793577600000 MessageEncryption1793664000000 MessageRequests1793750400000 SpamDetection1793836800000 CaroGames1793923200000 MoreChatGames1794009600000 ExpandArcadeGames1794096000000 UserNotes1794182400000)
migration_args=()
for migration in "${reviewed_migrations[@]}"; do
  migration_args+=("--allow=$migration")
done
"${compose[@]}" run --rm -T --no-deps migrate \
  node apps/api/dist/modules/database/migrate.js "${migration_args[@]}" </dev/null
# Verify the reviewed step left no pending migration before Green can start.
"${compose[@]}" run --rm -T --no-deps migrate \
  node apps/api/dist/modules/database/migrate.js --check </dev/null
echo 'Database migration completed. It will not be rolled back automatically if the API deployment later fails.'
candidate_started=true
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 "$candidate"
revision_health "http://127.0.0.1:$candidate_port/api/v1/health/ready" "$expected_commit" 'Candidate readiness' 1
# Mark first: signals/errors during reload must also trigger restoration.
switched=true
sudo -n /usr/local/sbin/pingpong-switch-upstream "$candidate_port"
proxy_health
# No shared Socket.IO adapter: old sockets must reconnect to the new active API.
old_stopped=true
"${compose[@]}" stop "$active"
for check in 1 2 3; do
  curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "http://127.0.0.1:$candidate_port/api/v1/health/ready"
  proxy_health
  [[ "$check" == 3 ]] || sleep 2
done
# Best-effort cleanup; never fail a successful deploy. Docker refuses to remove
# images still used by any container, so active and standby images stay safe.
for repo in pingpong-api ${DEPLOY_IMAGE_REPO:+"$DEPLOY_IMAGE_REPO"}; do
  docker image ls "$repo" --format '{{.Tag}}' | grep -E '^release-[0-9a-f]{40}$' \
    | tail -n +4 | while read -r tag; do docker image rm "$repo:$tag" > /dev/null 2>&1 || true; done || true
done
docker builder prune --force --filter until=168h > /dev/null 2>&1 || true
printf '\nBlue-green deployment completed: %s on %s; %s retained as cold standby\n' "$expected_commit" "$candidate" "$active"
