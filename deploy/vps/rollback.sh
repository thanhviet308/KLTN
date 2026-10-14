#!/usr/bin/env bash
# Cold-standby rollback. Do not migrate, build, recreate API or touch DB volumes.
set -euo pipefail
cd -- "$(dirname -- "$0")/../.."
exec 9>"$(git rev-parse --git-dir)/pingpong-deploy.lock"
flock -n 9 || { echo 'Another deployment/rollback is running' >&2; exit 1; }
compose=(docker compose --profile blue-green -f deploy/vps/compose.yml)
health_url=${DEPLOY_HEALTH_URL:-https://pingpongapi.id.vn/api/v1/health/ready}
[[ "$health_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/v1/health/ready$ ]] || { echo 'Invalid proxy health URL' >&2; exit 1; }
current=$(sudo -n /usr/local/sbin/pingpong-switch-upstream status)
case "$current" in
  3000) active=api; standby=api-green; target=3001 ;;
  3001) active=api-green; standby=api; target=3000 ;;
  *) echo 'Invalid active upstream' >&2; exit 1 ;;
esac
container=$("${compose[@]}" ps --all -q "$standby")
[[ -n "$container" ]] || { echo 'No standby version available' >&2; exit 1; }
docker start "$container"
curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-all-errors \
  --connect-timeout 3 --max-time 5 "http://127.0.0.1:$target/api/v1/health/ready"
sudo -n /usr/local/sbin/pingpong-switch-upstream "$target"
if ! curl --fail --silent --show-error --retry 3 --retry-delay 1 --retry-all-errors \
  --connect-timeout 5 --max-time 10 "$health_url"; then
  sudo -n /usr/local/sbin/pingpong-switch-upstream "$current"
  echo 'Rollback target failed proxy health; original traffic restored' >&2
  exit 1
fi
"${compose[@]}" stop "$active"
echo "Rolled back to $standby on port $target; schema and volumes unchanged"
