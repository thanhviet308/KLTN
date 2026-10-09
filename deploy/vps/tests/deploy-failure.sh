#!/usr/bin/env bash
# Execute deploy.sh against command stubs, never a VPS or real Docker daemon.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/checkout/.git" "$fixture/checkout/deploy/vps"
cp "$root/deploy/vps/deploy.sh" "$fixture/checkout/deploy/vps/deploy.sh"
touch "$fixture/checkout/deploy/vps/.env" "$fixture/checkout/deploy/vps/postgres.env"
export expected_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export command_log="$fixture/commands.log"
cat > "$fixture/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  'branch --show-current') echo main ;;
  'rev-parse --git-dir') echo .git ;;
  'rev-parse HEAD') echo "$expected_sha" ;;
esac
exit 0
STUB
cat > "$fixture/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$command_log"
case "$*" in
  'compose -f deploy/vps/compose.yml ps -q api') echo running-api ;;
  'inspect --format {{.Image}} running-api') echo sha256:known-running-image ;;
  'compose -f deploy/vps/compose.yml build api')
    [[ "$failure_mode" != build ]] || exit 17 ;;
  'compose -f deploy/vps/compose.yml run --rm -T migrate')
    [[ "$failure_mode" != migrate ]] || exit 18 ;;
esac
exit 0
STUB
cat > "$fixture/bin/flock" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$fixture/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo curl >> "$command_log"
exit 0
STUB
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
for failure_mode in build migrate; do
  export failure_mode
  : > "$command_log"
  set +e
  (cd "$fixture/checkout" && bash deploy/vps/deploy.sh "$expected_sha") > "$fixture/output" 2>&1
  status=$?
  set -e
  expected_status=17
  [[ "$failure_mode" != migrate ]] || expected_status=18
  [[ "$status" == "$expected_status" ]] || { cat "$fixture/output"; exit 1; }
  if grep -Eq 'docker .* (up .*api|down|stop|rm|volume)|^curl$' "$command_log"; then
    cat "$command_log"
    echo 'Failure path unexpectedly replaced/stopped the API or touched volumes' >&2
    exit 1
  fi
  if [[ "$failure_mode" == build ]] && grep -Eq 'docker .* (up|run) ' "$command_log"; then
    echo 'Build failure unexpectedly started a service/migration' >&2
    exit 1
  fi
  echo "$failure_mode failure: exit=$status; existing API and volumes untouched"
done
