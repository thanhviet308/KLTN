#!/usr/bin/env bash
# Mock Git/Docker/sudo/curl; never connect to a VPS or database.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/checkout/.git" "$fixture/checkout/deploy/vps"
cp "$root/deploy/vps/deploy.sh" "$fixture/checkout/deploy/vps/deploy.sh"
cp "$root/deploy/vps/rollback.sh" "$fixture/checkout/deploy/vps/rollback.sh"
touch "$fixture/checkout/deploy/vps/.env" "$fixture/checkout/deploy/vps/postgres.env"
export expected_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export command_log="$fixture/commands.log" port_file="$fixture/port" stopped_file="$fixture/stopped"
cat > "$fixture/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  'branch --show-current') echo main ;;
  'rev-parse --git-dir') echo .git ;;
  'rev-parse HEAD') echo "$expected_sha" ;;
esac
STUB
cat > "$fixture/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$command_log"
case "$*" in
  *'ps --all -q api') echo blue-container ;;
  *'ps --all -q api-green') echo green-container ;;
  *'ps -q db') echo db-container ;;
  'inspect --format {{.State.Health.Status}} db-container') echo healthy ;;
  'image inspect --format {{.Id}} '*) printf 'sha256:%064d\n' 0 ;;
  *'build api'|*'build api-green') [[ "$failure_mode" != build ]] || exit 17 ;;
  'run --rm '*api-runtime-dependencies.cjs) [[ "$failure_mode" != dependency ]] || exit 19 ;;
  'run --rm '*sharp-runtime-smoke.cjs*) [[ "$failure_mode" != sharp ]] || exit 20 ;;
  *'migrate node apps/api/dist/modules/database/migrate.js --check') [[ "$failure_mode" != migrate ]] || exit 18 ;;
  *'up -d --no-deps --no-build --wait --wait-timeout 120 '* ) [[ "$failure_mode" != startup ]] || exit 21 ;;
  *'stop api'|*'stop api-green') touch "$stopped_file" ;;
esac
STUB
cat > "$fixture/bin/sudo" <<'STUB'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >> "$command_log"
case "$3" in
  status) cat "$port_file" ;;
  3000|3001)
    [[ "$failure_mode" != switch || "$3" != 3001 ]] || exit 24
    [[ "$failure_mode" != rollback-fail || "$3" != 3000 ]] || exit 26
    echo "$3" > "$port_file" ;;
  *) exit 1 ;;
esac
STUB
cat > "$fixture/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$command_log"
url=${!#}
if [[ "$url" == *':3001/'* && "$failure_mode" == candidate ]]; then exit 22; fi
if [[ "$url" == https:* && ( "$failure_mode" == proxy || "$failure_mode" == rollback-fail ) ]]; then exit 23; fi
if [[ "$url" == *':3001/'* && "$failure_mode" == post-stop && -e "$stopped_file" ]]; then exit 25; fi
if [[ "$*" == *'--dump-header'* ]]; then
  revision="$expected_sha"
  [[ "$failure_mode" != wrong-revision ]] || revision=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  printf 'HTTP/1.1 200 OK\r\nX-PingPong-Revision: %s\r\n\r\n' "$revision"
fi
STUB
cat > "$fixture/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$fixture/bin/flock" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$fixture/bin/awk" <<'STUB'
#!/usr/bin/env bash
echo 1048576
STUB
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
for failure_mode in build dependency sharp migrate startup candidate switch proxy wrong-revision post-stop rollback-fail none reverse; do
  export failure_mode
  : > "$command_log"
  rm -f -- "$stopped_file"
  echo 3000 > "$port_file"
  [[ "$failure_mode" != reverse ]] || echo 3001 > "$port_file"
  set +e
  (cd "$fixture/checkout" && bash deploy/vps/deploy.sh "$expected_sha") > "$fixture/output" 2>&1
  status=$?
  set -e
  case "$failure_mode" in
    build) expected=17 ;; dependency) expected=19 ;; sharp) expected=20 ;; migrate) expected=18 ;;
    startup) expected=21 ;; candidate) expected=22 ;; switch) expected=24 ;;
    proxy|rollback-fail) expected=23 ;; wrong-revision) expected=1 ;; post-stop) expected=25 ;; *) expected=0 ;;
  esac
  [[ "$status" == "$expected" ]] || { cat "$fixture/output"; exit 1; }
  ! grep -Eq 'docker .* (up .*db|down|rm|volume)' "$command_log"
  ! grep -Eq 'docker .*migrate$' "$command_log"
  if [[ "$failure_mode" == none ]]; then
    test "$(cat "$port_file")" = 3001
    grep -q 'stop api$' "$command_log"
    ! grep -q 'stop api-green$' "$command_log"
  elif [[ "$failure_mode" == reverse ]]; then
    test "$(cat "$port_file")" = 3000
    grep -q 'stop api-green$' "$command_log"
    ! grep -q 'stop api$' "$command_log"
  elif [[ "$failure_mode" == rollback-fail ]]; then
    test "$(cat "$port_file")" = 3001
    ! grep -q 'stop api-green$' "$command_log"
    grep -q 'CRITICAL: rollback failed' "$fixture/output"
  else
    test "$(cat "$port_file")" = 3000
    if [[ "$failure_mode" == post-stop ]]; then
      grep -q 'docker start blue-container' "$command_log"
    else
      ! grep -q 'stop api$' "$command_log"
    fi
    if [[ "$failure_mode" == build || "$failure_mode" == dependency || "$failure_mode" == sharp || "$failure_mode" == migrate ]]; then
      ! grep -q 'up -d' "$command_log"
      ! grep -Eq 'pingpong-switch-upstream (3000|3001)' "$command_log"
    fi
  fi
  echo "blue-green $failure_mode: exit=$status, traffic/container invariants OK"
done
export failure_mode=none
: > "$command_log"
echo 3001 > "$port_file"
(cd "$fixture/checkout" && bash deploy/vps/rollback.sh) > "$fixture/output" 2>&1
test "$(cat "$port_file")" = 3000
grep -q 'docker start blue-container' "$command_log"
grep -q 'stop api-green$' "$command_log"
! grep -Eq 'docker .* (build|up|run|down|volume)' "$command_log"
echo 'manual rollback: restarts retained Blue, switches traffic, no build or migration'
