# Sửa runtime workspace dependency và kiểm thử lại staging

## Nguyên nhân đã tái hiện

`apps/api/package.json` đã khai báo `@nestjs/typeorm: 11.0.0` trong dependencies. Root sử dụng npm workspaces, và lockfile đặt package tại `apps/api/node_modules/@nestjs/typeorm` (không đánh dấu dev). Build stage sau npm ci/prune resolve và require package thành công tại `/app/apps/api/node_modules/@nestjs/typeorm/index.js`. Runtime cũ chỉ COPY `/app/node_modules`; không COPY `/app/apps/api/node_modules`. Node chạy `/app/apps/api/dist/main.js` do đó không thấy package. Đây là lỗi đóng gói Docker, không phải thiếu khai báo dependency hay lỗi Sharp.

Sửa COPY cả hai cây dependency sau prune, giữ đúng đường dẫn workspace; không di chuyển riêng một package, không npm install vào container. Package manifests/lockfile không cần sửa thêm cho lỗi này. Giữ nguyên Sharp 0.35.5, libvips 8.18.7 build source, flags `-march=x86-64 -mtune=generic`, tắt Highway/ORC. Docker layer libvips/Sharp source vẫn được cache.

`api-runtime-dependencies.cjs` dùng createRequire từ dist/main.js để resolve và load **tất cả** dependency production của API. Ngoại lệ duy nhất là `@img/sharp-wasm32`: fallback này cố ý bị loại khỏi image native từ trước, không được API sử dụng, không phù hợp CPU VPS. Sharp native đã có test xử lý ảnh riêng. Build sẽ fail nếu bất kỳ dependency runtime cần thiết nào không resolve/load.

`api-runtime-health.cjs` chạy trong container staging đã khởi động bằng CMD thực tế `node apps/api/dist/main.js`: liveness/readiness 200 + `{status: 'ok'}`, request anonymous /users/me 401, login invalid 400. Script chặn NODE_ENV ngoài test và database ngoài `staging-db/pingpong_staging`; không nhận URL production. Workflow thử nghiệm thêm PostgreSQL 17 riêng, chạy migration, khởi động NestJS và các HTTP test này. Workflow production không thay đổi.

Kiểm thử HTTP từ host phát hiện thêm network internal-only không publish cổng loopback trên Docker Engine 29. Compose staging thêm bridge `staging-http` riêng cho API; database/migration giữ network internal. API staging vẫn chỉ bind localhost:3100, không dùng Nginx/network/database production. Bridge API có egress; không cấu hình SMTP production.

## Máy tính: image và archive mới

```powershell
Set-Location D:\KLTN\src
docker build --platform linux/amd64 --target runtime -f apps/api/Dockerfile.x86-64-v1 -t pingpong-api:sharp-v1-experiment .
& ./deploy/vps/export-sharp-test.ps1 -OutputName .sharp-vps-transfer-runtime-fix
```

Gói mới không ghi đè `.sharp-vps-transfer` cũ. Nếu gói `runtime-fix` đã được chuẩn bị trong phiên này, dùng ngay, không xuất đè hoặc rebuild trước khi gửi. Script chạy cả Sharp smoke và dependency check trước export. Không build trên VPS.

Chuyển gói qua SSH (thay host/port):

```powershell
$vpsTarget = 'ubuntu@YOUR_VPS_IP'
ssh -p 22 $vpsTarget 'mkdir -p ~/pingpong-sharp-validation-runtime-fix && chmod 700 ~/pingpong-sharp-validation-runtime-fix'
scp -P 22 ./.sharp-vps-transfer-runtime-fix/* "${vpsTarget}:pingpong-sharp-validation-runtime-fix/"
```

## VPS: load, CPU smoke và require check

Kiểm tra tài nguyên, production DB healthy và ID trước/sau theo `sharp-vps-validation.md`. Sau đó:

```bash
set -euo pipefail
cd ~/pingpong-sharp-validation-runtime-fix
sha256sum --check --strict SHA256SUMS
image_tag=$(tr -d '\r\n' < image-tag.txt)
[[ "$image_tag" =~ ^pingpong-api:sharp-v1-[a-f0-9]{64}$ ]]
docker load --input image.tar
export SHARP_TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "$image_tag")
[[ "$SHARP_TEST_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
printf '%s\n' "$SHARP_TEST_IMAGE" > verified-image-id.txt
docker compose -f compose.sharp-test.yml run --rm -T --no-deps image-check
docker run --rm --pull never --network none --read-only --memory 256m \
  --cap-drop ALL --security-opt no-new-privileges "$SHARP_TEST_IMAGE" \
  node apps/api/tests/api-runtime-dependencies.cjs
docker run --rm --pull never --network none "$SHARP_TEST_IMAGE" node -e \
  "const {createRequire}=require('node:module'); const r=createRequire('/app/apps/api/dist/main.js'); console.log(r.resolve('@nestjs/typeorm')); console.log(typeof r('@nestjs/typeorm').TypeOrmModule);"
```

Phải thấy workspace path và `function`, toàn bộ dependency check thành công. Image mới phải chạy lại Sharp trên CPU thật dù image trước đã đạt.

## VPS: dùng lại staging độc lập, không production

Đây là Compose project **pingpong-sharp-staging** có sẵn từ lần test trước. Dùng lại credentials staging cũ vì PostgreSQL đã initialized; không tạo password mới cho volume cũ. Đường dẫn dưới đây giả định lần trước bạn dùng `~/pingpong-sharp-validation/.env.staging` và project name mặc định trong hướng dẫn. Nếu thực tế khác, trỏ đúng env/project staging; không lấy env production.

```bash
test -f ../pingpong-sharp-validation/.env.staging
cp ../pingpong-sharp-validation/.env.staging .env.staging
chmod 600 .env.staging
staging_db=$(docker ps -aq --filter label=com.docker.compose.project=pingpong-sharp-staging \
  --filter label=com.docker.compose.service=staging-db)
test -n "$staging_db"
export STAGING_POSTGRES_IMAGE=$(docker inspect --format '{{.Image}}' "$staging_db")
staging=(docker compose -p pingpong-sharp-staging --env-file .env.staging -f compose.sharp-staging.yml)
"${staging[@]}" config --quiet
"${staging[@]}" up -d --no-build --wait --wait-timeout 120 staging-db
"${staging[@]}" run --rm -T --no-deps staging-migrate
"${staging[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 staging-api
"${staging[@]}" exec -T staging-api node apps/api/tests/api-runtime-dependencies.cjs
"${staging[@]}" exec -T staging-api node apps/api/tests/api-runtime-health.cjs
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/v1/health/ready
"${staging[@]}" ps --all
"${staging[@]}" logs --no-color --tail=100 staging-api
```

Migration chỉ dùng database staging. `--no-deps` trên API không thay DB/migrate container. Khi xong có thể `"${staging[@]}" stop staging-api staging-db`; giữ nguyên volumes. Không chạy deploy.sh, không thay API production, không dùng prune/down -v. Nếu muốn staging mới hoàn toàn thay vì dùng lại, làm bước 4 trong `sharp-vps-validation.md` với project name khác, secrets mới và không chiếm cổng 3100 của staging đang chạy.

Tham khảo cơ chế [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/). Luồng production hiện build source trực tiếp trên VPS theo yêu cầu, không chuyển archive qua Actions: xem [README](README.md#cpu-vps-và-xử-lý-ảnh). Các lệnh archive trong tài liệu này chỉ kiểm thử staging riêng.

## Kết quả kiểm thử local ngày 2026-10-09

- Image cũ: `@nestjs/typeorm` MODULE_NOT_FOUND trong runtime; build stage cũ require thành công từ workspace node_modules. Lockfile và manifests đã khai báo dependency production đúng.
- Image mới: tất cả 19 dependency production cần thiết resolve/load; Sharp native JPEG/PNG/WebP thành công. Không thay đổi manifests/lockfile thêm cho lỗi đóng gói này.
- QEMU qemu64 của image sau sửa: JPEG/PNG/WebP đạt; không đưa QEMU vào runtime.
- PostgreSQL 17 staging local trong project `pingpong-sharp-runtime-local-20261009`: chạy thành công 10 migration, API CMD thực tế khởi động healthy, /health/live và /health/ready 200, /users/me anonymous 401, login invalid 400. Container staging đã dừng, volumes giữ nguyên.
- Chạy lại migration trên cùng volume staging: `TypeORM migrations are up to date`. Sau sửa network, curl từ host tới localhost:3100 trả `{status: 'ok'}`; API và DB đều healthy. Không xóa volume.
- Image runtime local: `sha256:484bc2887305840d693a347ee257987faae4a719b53c16af7640ec95b23f6b56`. Không dùng local ID này làm registry manifest digest. Gói `runtime-fix` có SHA256SUMS, gói cũ được giữ nguyên.
- Image trước được người dùng xác nhận Sharp smoke trên CPU VPS thật; image mới cần test lại trên VPS theo các lệnh trên. Không truy cập hoặc deploy VPS trong tác vụ này.
