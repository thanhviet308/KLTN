#!/usr/bin/env bash
set -euo pipefail

expected_commit=${1:?Pass the GitHub commit SHA to deploy}
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
export GIT_TERMINAL_PROMPT=0

for tool in git docker flock curl; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
[[ -f deploy/vps/.env ]] || { echo 'Create deploy/vps/.env on the VPS first' >&2; exit 1; }
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

compose=(docker compose -f deploy/vps/compose.yml)
"${compose[@]}" config --quiet
running_container=$("${compose[@]}" ps -q api)
if [[ -n "$running_container" ]]; then
  running_image=$(docker inspect --format '{{.Image}}' "$running_container")
  docker image tag "$running_image" pingpong-api:previous
elif docker image inspect pingpong-api:local >/dev/null 2>&1; then
  docker image tag pingpong-api:local pingpong-api:previous
fi
"${compose[@]}" build api
"${compose[@]}" --profile tools run --rm migrate
"${compose[@]}" up -d --wait --wait-timeout 120 --force-recreate api
curl --fail --silent --show-error --retry 5 --retry-delay 3 --retry-all-errors \
  --connect-timeout 5 --max-time 15 http://127.0.0.1:3000/api/v1/health/ready
printf '\nBackend deployment completed: %s\n' "$expected_commit"
