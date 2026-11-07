#!/usr/bin/env bash
# Run ONLY in a disposable root container with nginx/bash/flock/curl installed.
set -euo pipefail
[[ "$EUID" == 0 && -f /.dockerenv ]] || { echo 'Disposable Docker container required' >&2; exit 1; }
cp /fixtures/nginx-upstream.conf /etc/nginx/conf.d/pingpong-upstream.conf
cat > /etc/nginx/nginx.conf <<'CONF'
worker_processes 1;
pid /tmp/nginx.pid;
error_log /tmp/nginx-error.log;
events { worker_connections 64; }
http {
    access_log off;
    include /etc/nginx/conf.d/pingpong-upstream.conf;
    include /fixtures/nginx.conf;
    server { listen 127.0.0.1:3000; location / { return 200 'blue'; } }
    server { listen 127.0.0.1:3001; location / { return 200 'green'; } }
}
CONF
# Exercise actual nginx reload while replacing only systemd in this container.
cat > /usr/bin/systemctl <<'SYSTEMD'
#!/bin/sh
if test -f /tmp/fail-reload-once; then
    rm -f /tmp/fail-reload-once
    exit 1
fi
exec /usr/sbin/nginx -s reload
SYSTEMD
chmod 755 /usr/bin/systemctl
nginx -t
nginx
helper=(bash /fixtures/switch-upstream.sh)
check_route() {
  expected=$1
  for attempt in $(seq 1 30); do
    value=$(curl --fail --silent -H 'Host: pingpongapi.id.vn' -H 'Connection: close' http://127.0.0.1/api/v1/health/ready)
    [[ "$value" != "$expected" ]] || return 0
    sleep 0.1
  done
  echo "Wrong proxy response: $value (expected $expected)" >&2
  return 1
}
test "$("${helper[@]}" status)" = 3000
check_route blue
"${helper[@]}" 3001
test "$("${helper[@]}" status)" = 3001
check_route green
touch /tmp/fail-reload-once
if "${helper[@]}" 3000; then echo 'Failed reload accepted' >&2; exit 1; fi
test "$("${helper[@]}" status)" = 3001
check_route green
"${helper[@]}" 3000
check_route blue
if "${helper[@]}" 9999; then echo 'Unexpected port accepted' >&2; exit 1; fi
echo 'Actual Nginx: Blue -> Green -> Blue and failed-reload restoration OK'

# A browser must be able to distinguish throttling from a network/CORS error.
rate_status=200
for attempt in $(seq 1 100); do
  rate_status=$(curl --silent --show-error -o /tmp/rate-body -D /tmp/rate-headers \
    -w '%{http_code}' -H 'Host: pingpongapi.id.vn' \
    -H 'Origin: https://www.pingpong.id.vn' \
    http://127.0.0.1/api/v1/health/ready)
  [[ "$rate_status" != 429 ]] || break
done
[[ "$rate_status" == 429 ]] || { echo 'Rate limit was not exercised' >&2; exit 1; }
grep -qi '^Access-Control-Allow-Origin: https://www.pingpong.id.vn' /tmp/rate-headers
grep -qi '^Access-Control-Allow-Credentials: true' /tmp/rate-headers
grep -qi '^Retry-After: 5' /tmp/rate-headers
grep -q 'RATE_LIMITED' /tmp/rate-body
# Preflights must not share the exhausted actual-request bucket.
test "$(curl --silent --show-error -o /dev/null -w '%{http_code}' -X OPTIONS \
  -H 'Host: pingpongapi.id.vn' http://127.0.0.1/api/v1/health/ready)" = 200
echo 'Nginx rate-limit CORS, retry headers and preflight exemption OK'
