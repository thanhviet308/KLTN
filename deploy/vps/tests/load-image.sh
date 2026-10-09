#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin"
export load_log="$fixture/load.log"
cat > "$fixture/bin/docker" <<'STUB'
#!/usr/bin/env bash
[[ "$1 $2 $3" == 'image load --input' ]]
test -s "$4"
echo loaded >> "$load_log"
STUB
chmod +x "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
printf 'fixture image archive' > "$fixture/image.tar"
checksum=$(sha256sum "$fixture/image.tar" | cut -d ' ' -f 1)
# Match the quoting used for the remote SSH command in GitHub Actions.
printf -v load_command 'bash -c %q -- %q' "$(cat "$root/deploy/vps/load-image.sh")" "$checksum"
bash -c "$load_command" < "$fixture/image.tar"
test "$(cat "$load_log")" = loaded
rm -f -- "$load_log"
if printf 'tampered archive' | bash -c "$load_command" > "$fixture/output" 2>&1; then
  echo 'Bad checksum unexpectedly accepted' >&2; exit 1
fi
test ! -e "$load_log"
echo 'Archive loader: valid checksum loads; corrupt archive never reaches Docker'
