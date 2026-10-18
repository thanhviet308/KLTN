#!/usr/bin/env bash
# Cold-standby rollback. Do not migrate, build, recreate API or touch DB volumes.
set -euo pipefail
cd -- "$(dirname -- "$0")/../.."
exec 9>"$(git rev-parse --git-dir)/pingpong-deploy.lock"
flock -n 9 || { echo 'Another deployment/rollback is running' >&2; exit 1; }
compose=(docker compose --profile blue-green -f deploy/vps/compose.yml)
health_url=${DEPLOY_HEALTH_URL:-https://pingpongapi.id.vn/api/v1/health/ready}
[[ "$health_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/v1/health/ready$ ]] || { echo 'Invalid proxy health URL' >&2; exit 1; }
revision_health() {
  local url=$1 expected=$2 label=$3 attempts=${4:-10}
  local headers attempt status=1
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
  return "$status"
}
read_local_revision() {
  local port=$1 label=$2 headers revision
  headers=$(curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-all-errors \
    --connect-timeout 3 --max-time 5 --dump-header - --output /dev/null \
    "http://127.0.0.1:$port/api/v1/health/ready") || return $?
  revision=$(printf '%s\n' "$headers" | tr -d '\r' \
    | grep -iE '^X-PingPong-Revision: [0-9a-f]{40}$' \
    | sed -E 's/^[^:]+: //' || true)
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || {
    echo "$label returned no unique full X-PingPong-Revision" >&2
    return 1
  }
  printf '%s\n' "$revision"
}
current=$(sudo -n /usr/local/sbin/pingpong-switch-upstream status)
case "$current" in
  3000) active=api; standby=api-green; target=3001 ;;
  3001) active=api-green; standby=api; target=3000 ;;
  *) echo 'Invalid active upstream' >&2; exit 1 ;;
esac
current_revision=$(read_local_revision "$current" 'Current API readiness')
container=$("${compose[@]}" ps --all -q "$standby")
[[ -n "$container" ]] || { echo 'No standby version available' >&2; exit 1; }
docker start "$container"
target_revision=$(read_local_revision "$target" 'Standby API readiness')
sudo -n /usr/local/sbin/pingpong-switch-upstream "$target"
if ! revision_health "$health_url" "$target_revision" 'Rollback proxy readiness'; then
  if ! sudo -n /usr/local/sbin/pingpong-switch-upstream "$current" \
    || ! revision_health "$health_url" "$current_revision" 'Original proxy recovery'; then
    echo 'CRITICAL: rollback target failed and original revision could not be restored; both APIs were left running' >&2
    exit 1
  fi
  echo 'Rollback target failed proxy health; original traffic restored' >&2
  exit 1
fi
"${compose[@]}" stop "$active"
echo "Rolled back to $standby on port $target; schema and volumes unchanged"
