# Backend và PostgreSQL trên cùng VPS

Compose chạy PostgreSQL 17, migration và NestJS. API kết nối bằng hostname `db`
trong mạng Docker. PostgreSQL không publish cổng 5432; API chỉ publish
`127.0.0.1:3000` để Nginx trên VPS chuyển tiếp HTTPS và WebSocket.
Backend và database mỗi service giới hạn 1 GiB RAM; cần dành thêm RAM cho hệ điều hành,
Nginx và build image. Đây là giới hạn ban đầu, cần điều chỉnh theo tải thực tế.

## Thiết lập mới

Chạy từ thư mục gốc repository trên VPS, cần Docker Engine và Compose >= 2.30:

```bash
cp deploy/vps/.env.example deploy/vps/.env
cp deploy/vps/postgres.env.example deploy/vps/postgres.env
chmod 600 deploy/vps/.env deploy/vps/postgres.env
openssl rand -hex 32
```

Tạo ba secret riêng: mật khẩu admin database, mật khẩu ứng dụng và JWT.
Điền `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` trong `postgres.env`; mật khẩu ứng dụng
phải khớp cả `DATABASE_URL` và `DATABASE_DIRECT_URL` trong `.env`.
Điền `JWT_ACCESS_SECRET`, SMTP và `WEB_ORIGIN` là URL frontend HTTPS thực tế.
Không commit hai file secret. PostgreSQL cấp ứng dụng quyền sở hữu database để chạy
migration, nhưng tài khoản ứng dụng không có quyền superuser hoặc tạo role/database.

```bash
docker compose -f deploy/vps/compose.yml config --quiet
docker compose -f deploy/vps/compose.yml up -d --build api
docker compose -f deploy/vps/compose.yml ps -a
curl --fail http://127.0.0.1:3000/api/v1/health/ready
```

Compose đợi database healthy, chạy migration thành công rồi mới chạy API.
Nếu migration lỗi, đọc `docker compose -f deploy/vps/compose.yml logs migrate`.
Nginx dùng cấu hình `nginx.conf` hiện có, thay domain và cấu hình chứng chỉ HTTPS.

Volume `postgres_data` giữ dữ liệu khi recreate container. Init script chỉ chạy
khi volume trống: sửa mật khẩu trong file env không tự đổi mật khẩu database đã có.
Không dùng `docker compose down -v` với dữ liệu cần giữ. Không đổi major version
PostgreSQL trực tiếp trên volume cũ; phải có kế hoạch nâng cấp và backup.

## Chuyển dữ liệu từ database cloud

Compose tạo database mới; không tự chuyển dữ liệu cloud. Giữ database nguồn đến khi
đã xác minh dữ liệu và bản backup. Dùng `pg_dump` có major version không thấp hơn
database nguồn; kiểm tra khả năng restore vào PostgreSQL 17 nếu nguồn mới hơn.

1. Dừng API đang ghi vào nguồn và giữ chế độ bảo trì trong suốt chuyển đổi.
2. Dump database nguồn dạng custom (`pg_dump -Fc`), dùng kết nối trực tiếp.
3. Tạo database đích và restore trước khi chạy migration/API.

```bash
docker compose -f deploy/vps/compose.yml up -d --wait db
# source.dump là bản dump đã tải an toàn về VPS.
docker compose -f deploy/vps/compose.yml exec -T db sh -c \
  'pg_restore --exit-on-error --no-owner --no-acl -U "$APP_DB_USER" -d "$POSTGRES_DB"' < source.dump
docker compose -f deploy/vps/compose.yml build api
docker compose -f deploy/vps/compose.yml run --rm -T migrate
docker compose -f deploy/vps/compose.yml up -d --no-deps api
```

Restore chỉ vào database đích trống. Extension/role riêng của nhà cung cấp cloud có
thể cần xử lý trước khi restore; khi lỗi, không chạy API trên dữ liệu restore dở.
Kiểm tra số lượng tài khoản, bạn bè, hội thoại, tin nhắn và luồng đăng nhập/gửi tin
trước khi kết thúc bảo trì. Nếu quay về nguồn sau khi đã ghi vào đích, phải đối soát
các thay đổi mới để tránh mất dữ liệu.

## Backup và vận hành

```bash
mkdir -p deploy/vps/backups
chmod 700 deploy/vps/backups
umask 077
docker compose -f deploy/vps/compose.yml exec -T db sh -c \
  'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "deploy/vps/backups/pingpong-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Chỉ công nhận backup khi lệnh dump thành công. Sao chép backup ra ngoài VPS,
thiết lập lịch và retention, định kỳ restore thử vào database riêng.
Theo dõi dung lượng ổ đĩa, RAM, CPU và log; restart policy không thay thế backup.
Một VPS lỗi sẽ ảnh hưởng cả API và database. SSL database không bật trong cấu hình
này: kết nối chỉ đi trong mạng Docker cùng host, không dùng URL này qua Internet.

`deploy.sh <commit-sha>` đã được cập nhật: chờ database, chạy migration rồi recreate
API. Migration thay đổi schema vẫn phải tương thích với API cũ trong lúc deploy,
hoặc cần cửa sổ bảo trì.

## Tệp trong đoạn chat

API lưu ảnh/tệp/bản ghi âm vào volume `chat_files` tại `/app/storage/chat`;
PostgreSQL lưu metadata và quyền truy cập. Volume được khởi tạo với quyền của user
`node` từ Docker image. Không dùng `docker compose down -v` khi muốn giữ dữ liệu.
Nginx phải áp dụng cấu hình mới `client_max_body_size 10m` để nhận tệp tối đa 10 MB.
JSON API vẫn giới hạn 1 MB; upload dùng body nhị phân và có giới hạn riêng.

Backup phải gồm cả database và tệp. Dừng ghi vào API trong lúc tạo cặp backup
để metadata và tệp nhất quán. Ví dụ khi API đang ở chế độ bảo trì:

```bash
umask 077
docker compose -f deploy/vps/compose.yml exec -T api \
  tar -C /app/storage/chat -czf - . \
  > "deploy/vps/backups/chat-files-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
```

Theo dõi dung lượng volume và backup bên ngoài VPS. Tệp thu hồi bị chặn tải lại
nhưng chưa được xóa khỏi đĩa; quota 512 MB/tài khoản vẫn tính các tệp này.
Hướng dẫn test và API: [chat-media.md](../../apps/api/tests/chat-media.md).

### CPU VPS và xử lý ảnh

`sharp` và `@img/sharp-wasm32` được khóa cùng phiên bản. Sharp có thể thử
WebAssembly khi native không chạy được, nhưng Wasm cũng cần CPU hỗ trợ SIMD.
VPS báo cả `require v2 microarchitecture` và `Wasm SIMD unsupported` không dùng
được phương án fallback này. Thử nghiệm build source và kiểm thử độc lập nằm ở
[sharp-x86-64-v1.md](sharp-x86-64-v1.md). Compose API và migration hiện dùng
`Dockerfile.x86-64-v1`, target `runtime`, platform `linux/amd64`.

GitHub Actions build image trên runner, kiểm tra dependency/Sharp và khởi động
NestJS với PostgreSQL staging riêng trước khi xuất archive. Job deploy chuyển
archive qua SSH có xác minh host, kiểm tra SHA256 trước khi load, rồi gọi
`deploy.sh <commit-sha> pingpong-api:release-<commit-sha>`. VPS không build source
trong luồng tự động. Script pin image ID local và kiểm tra dependency/JPEG/PNG/WebP
trên CPU VPS trước khi chạy migration production hoặc thay API. Nếu build/test
trên runner, checksum hoặc smoke VPS thất bại thì không thay container API.

`deploy.sh <commit-sha>` không có tham số image vẫn là luồng manual build source
trên VPS; chỉ dùng khi đã cân nhắc RAM/thời gian build. Các lệnh Compose build
trong phần thiết lập manual cũng build source. Không dùng Dockerfile cũ cho VPS v1.
Sau deploy tự động, lệnh Compose thao tác API/migration cần export `BACKEND_IMAGE`
bằng image ID đang chạy để tránh quay lại tag local cũ:

```bash
api_id=$(docker compose -f deploy/vps/compose.yml ps -q api)
export BACKEND_IMAGE=$(docker inspect --format '{{.Image}}' "$api_id")
docker compose -f deploy/vps/compose.yml ps
```

Rollback dùng [compose.rollback.yml](compose.rollback.yml) với image known-good
đã kiểm thử và schema tương thích; `pingpong-api:previous` chưa đảm bảo healthy.
Không tự rollback migration hoặc xóa volume. Workflow không tự rollback khi API
mới không qua readiness; kiểm tra diagnostics và chọn image đã xác minh.

Kiểm thử luồng ảnh với bản WebAssembly trên máy local:

```powershell
npm run build --workspace=@chat/api
node -r ./apps/api/tests/sharp-wasm-preload.cjs apps/api/tests/profile.integration.cjs
node -r ./apps/api/tests/sharp-wasm-preload.cjs apps/api/tests/chat-media.integration.cjs
```

## Kiểm thử Sharp trên CPU VPS thật

Xem [quy trình chuyển archive, smoke test và staging độc lập](sharp-vps-validation.md). Không chạy deployment production trong bước xác minh này.

Lỗi runtime `Cannot find module '@nestjs/typeorm'`: xem [sửa COPY npm workspace dependencies và kiểm thử NestJS staging](sharp-runtime-fix.md).
