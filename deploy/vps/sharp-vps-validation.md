# Kiểm thử image Sharp trên VPS thật, chưa deploy

Image mới sửa lỗi workspace dependency: xem [nguyên nhân và cách kiểm thử lại staging](sharp-runtime-fix.md). Smoke Sharp đơn thuần chưa đủ; phải chạy dependency check và khởi động NestJS với database staging.

Thực hiện từ nhánh `experiment/sharp-x86-64-v1`. Image đã build bên ngoài VPS; không build libvips trên máy 2GB RAM. Chọn Docker archive qua SSH để không cần registry/token GHCR. `docker save/load` giữ image và tag; checksum SHA256 kiểm tra toàn bộ gói. Tag xuất chứa đủ image ID, không dùng `latest`, `local` hay `previous`. Sau khi load, lấy image ID tại VPS và chạy bằng ID đó với `pull_policy: never`. Docker Desktop dùng containerd và Docker Engine dùng classic store có thể biểu diễn ID khác nhau; checksum archive là kiểm tra nội dung truyền tải, không so sánh mù hai ID giữa engine.

Không sửa checkout production trên VPS, không gọi `deploy.sh`, không kết hợp các Compose thử nghiệm với `compose.yml`. Workflow `test-sharp-v1.yml` chỉ chạy thủ công trên nhánh khác main, không push image/deploy. Workflow main vẫn hoạt động như cũ: không push/merge main trong lúc kiểm thử. Nếu có người khác deploy đồng thời, cần thống nhất cửa sổ kiểm thử trước; các lệnh dưới đây không vô hiệu hóa Actions.

## 1. Máy tính Windows: xuất image đã build

PowerShell tại repository:

```powershell
Set-Location D:\KLTN\src
git branch --show-current
docker image inspect pingpong-api:sharp-v1-experiment --format '{{.Os}}/{{.Architecture}} {{.Id}}'
& ./deploy/vps/export-sharp-test.ps1
Get-Content ./.sharp-vps-transfer/image-tag.txt
Get-Content ./.sharp-vps-transfer/SHA256SUMS
```

Script chạy lại smoke test JPEG/PNG/WebP trên máy tính, rồi xuất image và các file Compose/hướng dẫn, không upload. Thư mục `.sharp-vps-transfer` được ignore. Script từ chối ghi đè gói đã có; giữ hoặc đổi tên gói cũ trước khi xuất lại. Không rebuild image chỉ để xuất. Smoke test local không thay cho test CPU VPS thật.

Thay `ubuntu@YOUR_VPS_IP` và cổng SSH theo VPS:

```powershell
$vpsTarget = 'ubuntu@YOUR_VPS_IP'
ssh -p 22 $vpsTarget 'mkdir -p ~/pingpong-sharp-validation && chmod 700 ~/pingpong-sharp-validation'
scp -P 22 ./.sharp-vps-transfer/* "${vpsTarget}:pingpong-sharp-validation/"
```

Đối chiếu fingerprint SSH với VPS đã biết. Lưu bản `SHA256SUMS` trên máy tính; checksum không thay thế xác thực SSH. Không gửi `.env` production hay thông tin tài khoản production.

## 2. VPS Ubuntu: ghi nhận trạng thái, kiểm tra tài nguyên

Đăng nhập SSH, dùng Bash. Các lệnh Docker giả định user có quyền Docker; nếu chưa có, dùng `sudo docker` nhất quán.

```bash
set -euo pipefail
cd ~/pingpong-sharp-validation
docker version
docker compose version
lscpu
free -h
swapon --show
df -h . /var/lib/docker
docker stats --no-stream
docker ps -a --filter label=com.docker.compose.project=pingpong-backend \
  --format '{{.ID}} {{.Names}} {{.Status}}' | tee production-before.txt
prod_db=$(docker ps -q --filter label=com.docker.compose.project=pingpong-backend \
  --filter label=com.docker.compose.service=db)
test -n "$prod_db"
docker inspect --format '{{.State.Health.Status}}' "$prod_db"
```

Phải thấy PostgreSQL production `healthy`. Nếu project/service production thực tế khác, điều chỉnh **hai filter** dựa trên `docker ps`, không đoán ID. Smoke container giới hạn 256MB. Staging DB + API có giới hạn tổng khoảng 640MB (migration chạy riêng trước API); đây là giới hạn, không phải lượng RAM được cấp sẵn. Chỉ tiếp tục staging nếu có RAM khả dụng khoảng 800MB và không có dấu hiệu OOM/swap liên tục. RAM/swap toàn host vẫn ảnh hưởng production. Chừa dung lượng cho archive, layers load và staging DB; không chạy prune để lấy chỗ.

## 3. VPS: xác minh archive và smoke test CPU thật

```bash
sha256sum --check --strict SHA256SUMS
image_tag=$(tr -d '\r\n' < image-tag.txt)
[[ "$image_tag" =~ ^pingpong-api:sharp-v1-[a-f0-9]{64}$ ]]
docker image load --input image.tar
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image_tag")" = linux/amd64
export SHARP_TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "$image_tag")
[[ "$SHARP_TEST_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
printf '%s\n' "$SHARP_TEST_IMAGE" > verified-image-id.txt
docker compose -f compose.sharp-test.yml config --quiet
set -o pipefail
docker compose -f compose.sharp-test.yml run --rm -T --no-deps image-check \
  2>&1 | tee sharp-real-cpu.log
docker run --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 256m "$SHARP_TEST_IMAGE" \
  node apps/api/tests/api-runtime-dependencies.cjs
```

Đây là Node chạy trực tiếp trên CPU VPS, không qua QEMU. Container không có network, env database, volume hay port. Phải exit 0 và có dòng kết quả thành công JPEG/PNG/WebP của smoke script; kiểm tra log không có lỗi CPU, SIMD hay thư viện thiếu. Nếu thất bại: **dừng ở đây**, giữ log; không chạy staging hay production. `docker load` chỉ nhập image mang tag thử nghiệm; không thay container đang chạy.

Kiểm tra lại PostgreSQL và ID container production:

```bash
docker inspect --format '{{.State.Health.Status}}' "$prod_db"
docker ps -a --filter label=com.docker.compose.project=pingpong-backend \
  --format '{{.ID}} {{.Names}} {{.Status}}' | tee production-after-smoke.txt
```

API production vốn restart có thể đổi trạng thái/restart count; ID PostgreSQL phải giữ nguyên nếu không có tác động từ deployment khác.

## 4. VPS: chỉ sau smoke thành công, tạo staging độc lập

Dùng đúng **image PostgreSQL 17 đang chạy**, nhưng container/database/credentials/volume/network hoàn toàn mới. Không mount data production, không copy tài khoản production. Không cần pull PostgreSQL mới:

```bash
export SHARP_TEST_IMAGE=$(cat verified-image-id.txt)
export STAGING_POSTGRES_IMAGE=$(docker inspect --format '{{.Image}}' "$prod_db")
docker run --rm --pull never --network none --entrypoint postgres \
  "$STAGING_POSTGRES_IMAGE" --version
```

Phải là PostgreSQL 17. Tạo secrets mới; không ghi đè credentials của staging đã tồn tại:

```bash
test ! -e .env.staging
umask 077
printf 'STAGING_DB_PASSWORD=%s\nSTAGING_JWT_SECRET=%s\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env.staging
staging=(docker compose --env-file .env.staging -f compose.sharp-staging.yml)
"${staging[@]}" config --quiet
"${staging[@]}" up -d --no-build --wait --wait-timeout 120 staging-db
"${staging[@]}" run --rm -T --no-deps staging-migrate
"${staging[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 staging-api
curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:3100/api/v1/health/ready
"${staging[@]}" ps --all
"${staging[@]}" exec -T staging-api node apps/api/tests/api-runtime-dependencies.cjs
"${staging[@]}" exec -T staging-api node apps/api/tests/api-runtime-health.cjs
docker stats --no-stream
```

Migration này chỉ kết nối `staging-db:5432/pingpong_staging`, URL cố định trong Compose với password mới; không đọc `.env` production. Network database staging `internal: true`, không nối network production; PostgreSQL không publish port. API dùng thêm bridge `staging-http` riêng để publish `127.0.0.1:3100`, không qua Nginx production. Bridge này cho phép API truy cập mạng bên ngoài; không cấu hình SMTP. Luồng gửi mã email không phải mục tiêu của staging này.

Kiểm tra HTTP validation/auth không cần tài khoản:

```bash
status=$(curl --silent --show-error --max-time 10 -o invalid-login.json -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'X-Auth-Client: android' \
  -d '{"email":"invalid","password":""}' http://127.0.0.1:3100/api/v1/auth/login)
test "$status" = 400
status=$(curl --silent --show-error --max-time 10 -o anonymous-me.json -w '%{http_code}' \
  http://127.0.0.1:3100/api/v1/users/me)
test "$status" = 401
docker inspect --format '{{.State.Health.Status}}' "$prod_db"
"${staging[@]}" logs --no-color --tail=100 staging-api
```

Đây mới là API readiness + validation/auth cơ bản. Trước production còn phải tạo fixtures/tài khoản **staging** và kiểm thử login/refresh, upload avatar JPEG/PNG/WebP, ảnh chat, quyền truy cập tệp giữa hai tài khoản, recording và WebSocket. Các integration script hiện có đọc `apps/api/.env` và chặn database ngoài localhost; **không sửa guard hoặc đưa `.env` production vào để chạy chúng trên VPS**. Smoke Sharp không chứng minh toàn bộ API đúng. Có thể mở SSH tunnel để kiểm thử HTTP bằng Postman trên máy tính:

```powershell
ssh -p 22 -N -L 3100:127.0.0.1:3100 $vpsTarget
# Trong Postman: http://localhost:3100/api/v1/health/ready
```

Dừng riêng staging sau kiểm thử, giữ volume staging để điều tra; không dùng `down -v`:

```bash
"${staging[@]}" stop staging-api staging-db
```

Không chạy `docker compose down` từ thư mục production, `docker system prune`, `docker volume prune`, hoặc `deploy.sh` trong bước này. Không thao tác Redis hiện có; Compose repository hiện không định nghĩa Redis.

## 5. Điều kiện và rollback trước khi đề xuất production

- Chưa tự động deploy. Phải có log CPU thật exit 0, staging API healthy, kiểm thử chức năng qua HTTP/WebSocket thành công, RAM ổn định, PostgreSQL production nguyên vẹn và backup database đã được xác minh trước migration production.
- Giữ archive + checksum + image ID đã test; không rebuild image sau khi test rồi coi là cùng artifact. Nếu sau này dùng GHCR, publish thủ công và pin `ghcr.io/<owner>/<image>@sha256:<registry-manifest-digest>`, không lấy local image ID làm registry digest.
- `deploy.sh` hiện build trước migration/thay API; test mô phỏng build fail/migration fail giữ API cũ. Nhưng lỗi sau khi thay API chưa tự rollback; :previous chỉ lưu image cũ, không đảm bảo healthy. API cũ đang lỗi Sharp nên **hiện chưa có rollback healthy được chứng minh**.
- Chuẩn bị image known-good riêng, chạy CPU smoke + staging với image rollback, lưu image ID. Migration mới phải tương thích image rollback; rollback image không hoàn tác schema. Không xóa/khôi phục volume tùy tiện để rollback.
- Workflow main vẫn build production Dockerfile cũ trên VPS. Vì vậy deploy archive rồi để workflow main chạy sẽ có thể quay lại image lỗi. Trước production cần thay đổi pipeline có review để dùng đúng artifact đã test, hoặc đưa Dockerfile được xác minh vào build bên ngoài VPS. Giữ Compose/Actions, nhưng đây là công việc tiếp theo; hiện không thay production pipeline.

Lệnh rollback **tham khảo cho giai đoạn production đã được phê duyệt**, không chạy trong buổi test này (tại checkout production, thay giá trị image ID đã xác minh):

```bash
export ROLLBACK_IMAGE=sha256:REPLACE_WITH_VERIFIED_GOOD_IMAGE_ID
docker compose -f deploy/vps/compose.yml -f deploy/vps/compose.rollback.yml \
  up -d --no-deps --no-build --pull never --wait --wait-timeout 120 api
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/api/v1/health/ready
```

Override rollback cần được đưa lên checkout production trong thay đổi đã phê duyệt; không có sẵn trên main thì chưa thể chạy. Lệnh chỉ thay API, không chạy migrate/up db. Đồng bộ với GitHub Actions trước thao tác manual để tránh deploy cạnh tranh; không tự chạy rollback nếu chưa có image healthy/schema tương thích.

Tham khảo Docker chính thức: [save](https://docs.docker.com/reference/cli/docker/image/save/), [load](https://docs.docker.com/reference/cli/docker/image/load/).

## Kết quả chuẩn bị local (2026-10-09)

- Export archive từ image đã có thành công, không rebuild; khoảng 94 MiB. Script kiểm tra `linux/amd64`, chạy smoke local thành công và xuất tag chứa đủ image ID.
- Compose smoke chạy bằng image ID, `pull_policy: never`: JPEG/PNG/WebP đạt, Node 24.21.0, Sharp 0.35.5, libvips 8.18.7.
- Compose staging qua `config --quiet`; chưa khởi động database/API staging trong bước chuẩn bị này.
- Chưa upload/chạy trên VPS thật; chưa chạy migration, thay API production, push hoặc merge.
