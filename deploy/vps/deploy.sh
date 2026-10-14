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

# Serialize manual and automated deployment in this checkout.
lock_file="$(git rev-parse --git-dir)/pingpong-deploy.lock"
exec 9>"$lock_file"
flock -n 9 || { echo 'Another deployment is already running' >&2; exit 1; }
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
for tool in sudo; do command -v "$tool" >/dev/null || exit 1; done
active_port=$(sudo -n /usr/local/sbin/pingpong-switch-upstream status)
case "$active_port" in
  3000) active=api; candidate=api-green; candidate_port=3001 ;;
  3001) active=api-green; candidate=api; candidate_port=3000 ;;
  *) echo 'Invalid active upstream' >&2; exit 1 ;;
esac
active_container=$("${compose[@]}" ps --all -q "$active")
[[ -n "$active_container" ]] || { echo 'Start the initial Blue API before enabling blue-green deploy' >&2; exit 1; }
curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "http://127.0.0.1:$active_port/api/v1/health/ready"
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
    if curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-all-errors --connect-timeout 3 --max-time 5 "http://127.0.0.1:$active_port/api/v1/health/ready" \
      && sudo -n /usr/local/sbin/pingpong-switch-upstream "$active_port"; then
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
  headers=$(curl --fail --silent --show-error --retry 3 --retry-delay 1 --retry-all-errors \
    --connect-timeout 5 --max-time 10 --dump-header - --output /dev/null "$health_url") || return $?
  printf '%s\n' "$headers" | tr -d '\r' | grep -iFx "X-PingPong-Revision: $expected_commit" >/dev/null
}
printf '\nActive: %s. Building candidate: %s\n' "$active" "$candidate"
"${compose[@]}" build "$candidate"
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
# Read-only pending-migration check. Never auto-change schema while Blue is live.
"${compose[@]}" run --rm -T --no-deps migrate node apps/api/dist/modules/database/migrate.js --check </dev/null
candidate_started=true
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 "$candidate"
curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "http://127.0.0.1:$candidate_port/api/v1/health/ready"
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
printf '\nBlue-green deployment completed: %s on %s; %s retained as cold standby\n' "$expected_commit" "$candidate" "$active"
