# Thử nghiệm Sharp trên CPU x86-64-v1

Nhánh: `experiment/sharp-x86-64-v1`. Không push, merge hay deploy tự động.
Dockerfile production, Compose production và workflow deploy vẫn dùng cấu hình cũ.
Không chuyển sang production trước khi build, smoke test và kiểm tra trên CPU VPS thật thành công.

## Cấu hình đã kiểm tra

| Thành phần          | Hiện tại / thử nghiệm                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Sharp               | Giữ `0.35.5`; yêu cầu libvips `>=8.18.7`, Node `>=20.9.0`                  |
| Node production     | Tag trôi `node:24-bookworm-slim`; log VPS dùng `24.21.0`                   |
| Node thử nghiệm     | Pin `node:24.21.0-bookworm-slim`, cùng base cho build và runtime           |
| Node CI hiện tại    | `24.13.0`; đều nằm trong engines của repository, cần đồng bộ khi promotion |
| libvips thử nghiệm  | Source `8.18.7`, kiểm tra SHA256 archive trước khi giải nén                |
| Build addon         | `node-gyp 12.4.0`, `node-addon-api 8.9.2`, GCC 12/C++17, một job           |
| Database trong repo | Compose có PostgreSQL 17, không có service Redis trong file này            |

Redis được mô tả đang chạy trên VPS nhưng chưa xác minh cấu hình thực tế; không thay đổi Redis.
NestJS không bundle addon: CommonJS dùng `require('sharp')`, phù hợp addon Node-API v9.

Avatar: metadata, từ chối nhiều trang, limit 16 triệu pixel, autorotate, crop 256x256, WebP quality 80.
Ảnh chat: metadata, JPEG/PNG/WebP một trang, autorotate, resize tối đa 2048, WebP quality 85.
Voice/location/file không cần codec ảnh. Không thay thư viện hoặc downgrade Sharp.

## Phương án

Build libvips và addon Sharp từ source với `-march=x86-64 -mtune=generic`.
Không dùng `apt install libvips-dev` làm libvips chính: bản Bookworm không đáp ứng
mức tối thiểu `8.18.7` của Sharp này. Apt chỉ cung cấp toolchain và các dependency codec.
Không dùng `-march=native`. Highway và ORC bị tắt; chỉ bật JPEG, PNG, WebP,
zlib, EXIF và lcms. C++ API/deprecated API được giữ để Sharp link đúng.
Các codec và thư viện hệ thống lấy từ Debian Bookworm amd64 (baseline x86-64),
không lấy binary libvips/Sharp x86-64-v2. Codec Debian có thể dùng runtime CPU
dispatch; đây không phải yêu cầu v2 cho toàn bộ thư viện.

`npm ci --ignore-scripts --omit=optional` rồi `npm explore sharp -- npm run build`
dùng `SHARP_FORCE_GLOBAL_LIBVIPS=1` và `pkg-config` trỏ `/opt/vips`.
Sau prune dev dependencies, các gói `@img/sharp-*` được loại khỏi image thử nghiệm.
Smoke test bắt buộc chứng minh addon được nạp từ `sharp/src/build/Release`,
không từ prebuilt hoặc Wasm. Manifest vẫn giữ Wasm cho cấu hình production/local hiện tại.

Multi-stage: libvips -> API/addon -> runtime. Source ảnh và npm dependencies có
layer riêng trước source NestJS. npm download cache dùng BuildKit cache mount.
Runtime chỉ nhận node_modules production, dist API, shared libvips và các gói codec
runtime được liệt kê tường minh; chạy `ldconfig`, user `node`, một luồng libvips.
Smoke test chạy trong stage runtime để phát hiện thiếu shared libraries.
`meson install --no-rebuild` tránh bước install tự chạy Ninja song song sau khi
đã compile một job; toàn bộ việc compile được thực hiện ở lệnh `-j 1` phía trước.

## Kiểm thử không deploy

Từ repository root, máy build Linux amd64 hoặc Docker Desktop Linux:

```bash
docker build --platform linux/amd64 --progress=plain \
  -f apps/api/Dockerfile.x86-64-v1 \
  -t pingpong-api:sharp-v1-experiment .
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 256m --cpus 1 \
  pingpong-api:sharp-v1-experiment \
  node apps/api/tests/sharp-runtime-smoke.cjs --source
```

Hoặc chạy smoke test bằng Compose độc lập (không kết hợp với Compose production):

```bash
export SHARP_TEST_IMAGE=$(docker image inspect --format '{{.Id}}' pingpong-api:sharp-v1-experiment)
docker compose -f deploy/vps/compose.sharp-test.yml run --rm --no-deps image-check
```

Test tạo JPEG/PNG/WebP, decode lại, metadata, autorotate JPEG EXIF, resize avatar
và ảnh chat, encode/decode WebP, từ chối bytes không phải ảnh. Không cần database,
Redis, network, secret hay volume. Không khởi động API hoặc chạy migration.

Kiểm tra thêm baseline CPU bằng QEMU user-mode `qemu64` (không có SSE4.2/AVX):

```bash
docker build --platform linux/amd64 --target cpu-v1-check --progress=plain \
  -f apps/api/Dockerfile.x86-64-v1 .
```

Target này thêm QEMU để test, không đưa QEMU vào image runtime.
Emulation là bằng chứng bổ sung, không thay kiểm thử trên CPU và kernel VPS thật.
Workflow `test-sharp-v1.yml` chỉ chạy thủ công ở nhánh khác main, không dùng SSH,
secret production, không push image và không gọi workflow deploy. GitHub chỉ thấy
workflow mới sau khi nhánh được push (không được thực hiện trong tác vụ này).

## Build trên VPS 1 vCPU / RAM 2GB

Mỗi compiler chỉ chạy một job: Meson `-j 1`, node-gyp `npm_config_jobs=1`,
`MAKEFLAGS=-j1`; V8 build giới hạn heap 512 MiB (không phải giới hạn tổng RAM).
Docker có thể chạy các stage độc lập song song; giới hạn này không giới hạn toàn
BuildKit. 2GB đang chứa OS/PostgreSQL/Redis/API nên vẫn có nguy cơ OOM, swap thrash,
giảm đáp ứng API, thậm chí OOM-kill container đang chạy dù deploy chưa recreate.
Hai `mem_limit: 1g` API/DB hiện có không chừa headroom nếu cả hai đạt giới hạn.

Ưu tiên build trên máy khác/GitHub runner, giữ flags baseline, chuyển image đã kiểm
tra sang VPS để chỉ chạy smoke test. Không mặc định build source trên VPS đang phục vụ.
Nếu buộc build tại VPS, cần kế hoạch bảo trì, kiểm tra `free -h`, `df -h`, swap,
giới hạn worker BuildKit (max-parallelism=1) và ngân sách RAM thực tế trước khi chạy.
Không tự tạo swap, dừng dịch vụ hay chỉnh giới hạn production trong thử nghiệm này.
Build lạnh có thể vượt timeout deploy hiện tại 30 phút; thời gian cần đo trên máy thật.
Swap chỉ giảm nguy cơ OOM, không đảm bảo thời gian build hoặc chất lượng phục vụ.

## Deploy hiện tại và rollback

`deploy.sh`: lock -> fast-forward SHA -> config -> tag image trước -> build ->
chờ DB -> migrate -> recreate API -> readiness. Với `set -e` và ERR trap,
build lỗi dừng trước mọi `up`/migration; migrate lỗi dừng trước recreate API.
Test giả lập (không gọi Docker thật):

```bash
bash -n deploy/vps/deploy.sh
bash deploy/vps/tests/deploy-failure.sh
```

Script test stubs git/docker/flock/curl và ép build/migrate thất bại; kiểm tra exit
code và chứng minh không stop/recreate API, không thao tác volumes. Giới hạn:
không kiểm tra OOM host, Docker daemon thật hoặc tương thích schema migration.

Rủi ro còn lại: tag `previous` bị ghi đè theo container đang chạy dù container không
healthy; không phải mọi `previous` đều rollback được. Build thành công nhưng readiness
sau recreate thất bại chưa tự rollback. Migrations đã chạy không tự đảo ngược và
code cũ phải tương thích schema mới. Không sửa quy trình production trong thử nghiệm.

Trước promotion, ghi lại image ID đã xác nhận healthy (`docker inspect --format
'{{.Image}}' <container-api>`), tạo tag riêng không ghi đè, smoke test image đó và
kiểm tra tương thích migration. Khi chưa có image healthy đã biết, không có rollback
đáng tin cậy; log cũ cho thấy container đã restart hàng trăm lần.

Chỉ sau khi người vận hành cho phép rollback, từ checkout production hiện tại:

```bash
export ROLLBACK_IMAGE=pingpong-api:known-good
docker image inspect "$ROLLBACK_IMAGE" >/dev/null
docker compose -f deploy/vps/compose.yml -f deploy/vps/compose.rollback.yml \
  up -d --no-deps --no-build --pull never --wait --wait-timeout 120 api
curl --fail http://127.0.0.1:3000/api/v1/health/ready
```

Lệnh chỉ thay API, dùng lại env/ports/chat_files hiện tại; không chạy migrate hay
đụng PostgreSQL/Redis. Không dùng `down -v`, prune volumes hoặc reset database.
Nếu schema không tương thích, dừng promotion; không tự rollback dữ liệu production.

## Kết quả local ngày 2026-10-09

- Build Linux amd64, libvips `8.18.7` và Sharp `0.35.5` từ source: thành công.
- Smoke test trong final runtime Node `24.21.0`, user `node`: thành công.
- Container read-only, network none, cap-drop ALL, 256 MiB / một CPU: thành công.
- Compose test độc lập: thành công, không gọi API/database/Redis.
- `ldd` addon: tìm đủ shared libraries, libvips nằm ở `/opt/vips/lib`.
- Target `cpu-v1-check` với QEMU `qemu64`: JPEG/PNG/WebP và pipeline avatar/chat đều qua.
- Build lại final runtime sau đó: toàn bộ layer chính lấy từ cache, hoàn tất khoảng 5,5 giây trên máy local.
- Test giả lập deploy: build lỗi exit 17, migrate lỗi exit 18; không thay API/volumes.
- Lint, API typecheck, format check và Bash syntax: thành công.

Chưa kiểm thử trên CPU VPS thật; chưa đo peak RSS khi build trên máy 2GB; chưa
load test ảnh 16 triệu pixel hoặc chạy integration HTTP với database staging.
Các smoke test nhỏ không chứng minh backend production chỉ cần 256 MiB RAM.
Workflow GitHub mới chưa chạy trên GitHub; chỉ được chuẩn bị và kiểm tra local.

## Nguồn chính thức

- [Sharp install/build source](https://sharp.pixelplumbing.com/install/)
- [Sharp 0.35.5: min libvips và build deps](https://github.com/lovell/sharp/blob/v0.35.5/package.json)
- [libvips build](https://www.libvips.org/install.html)
- [libvips 8.18.7 build options](https://github.com/libvips/libvips/blob/v8.18.7/meson_options.txt)

# Trạng thái tài liệu

Đây là báo cáo giai đoạn thử nghiệm. Luồng production hiện build trực tiếp trên VPS bằng Dockerfile x86-64-v1 theo yêu cầu; xem [README](README.md#cpu-vps-và-xử-lý-ảnh) để dùng cấu hình deploy hiện tại.
