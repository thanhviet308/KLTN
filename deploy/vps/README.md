# Backend và SQL Server trên VPS

Compose chạy API và migration. SQL Server 2022 chạy trong container riêng trên VPS. Sao chép `deploy/vps/.env.example` sang `deploy/vps/.env` rồi cấu hình tài khoản SQL Server và các secret ứng dụng. Từ container API, kết nối đến `host.docker.internal:14330/pingpong`. DATABASE_URL và DATABASE_DIRECT_URL phải trỏ cùng database.

## Chuyển dữ liệu hiện có

Tạo schema trong một database SQL Server trống bằng migration foundation trước khi nhập dữ liệu. Giữ khóa mã hóa tin nhắn hiện tại. Trong cửa sổ bảo trì, dừng các luồng ghi, chuyển phần dữ liệu cuối và đối chiếu số bản ghi, khóa và quan hệ trước khi chuyển API. Bản sao chỉ chứa bảng và dữ liệu thiếu các ràng buộc cần cho ứng dụng.

Sau khi chuyển hệ quản trị, cả hai slot blue-green phải dùng cùng database. Script deploy kiểm tra migration và readiness trước khi chuyển Nginx. Nếu đã có ghi mới vào SQL Server, cần đối soát dữ liệu trước khi quay về phiên bản ghi PostgreSQL.

## Tệp trong đoạn chat

API lưu ảnh/tệp/bản ghi âm vào volume `chat_files` tại `/app/storage/chat`;
SQL Server lưu metadata và quyền truy cập. Volume được khởi tạo với quyền của user
`node` từ Docker image. Không dùng `docker compose down -v` khi muốn giữ dữ liệu.
Nginx phải áp dụng cấu hình mới `client_max_body_size 10m` để nhận tệp tối đa 10 MB.
JSON API vẫn giới hạn 1 MB; upload dùng body nhị phân và có giới hạn riêng.

Backup phải gồm cả database và tệp. Dừng ghi vào API trong lúc tạo cặp backup
để metadata và tệp nhất quán. Ví dụ khi API đang ở chế độ bảo trì:

```bash
umask 077
active_port=$(sudo -n /usr/local/sbin/pingpong-switch-upstream status)
if [ "$active_port" = 3000 ]; then active_service=api; else active_service=api-green; fi
docker compose -f deploy/vps/compose.yml exec -T "$active_service" \
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
được phương án fallback này. Compose API và migration hiện dùng
`Dockerfile.x86-64-v1`, target `runtime`, platform `linux/amd64`.

GitHub Actions chạy checks rồi gửi deploy script nhỏ qua SSH có xác minh host.
VPS fetch đúng commit main và gọi `deploy.sh <commit-sha>` để build image candidate
bằng Docker Compose ngay trên VPS. Không có job build image, upload/download artifact
hoặc chuyển Docker archive trong workflow production. Job deploy giới hạn 60 phút
để có thời gian build source lần đầu; đây không phải cam kết build sẽ xong trong 60 phút.

Giữ Docker layer cache để các lần sau tái sử dụng libvips/Sharp source đã build.
Meson và node-gyp dùng một job; VPS 1 vCPU/2GB RAM vẫn cần RAM cho SQL Server,
Redis và OS, có thể chậm hoặc OOM nếu thiếu headroom. Không tự dừng database hoặc
đổi swap/volumes để build. Dockerfile có kiểm tra dependency/Sharp trong runtime;
deploy script kiểm tra lại trên CPU VPS trước migration/thay API. Build hoặc smoke
thất bại thì không đổi traffic; migration check chỉ đọc schema. Readiness candidate
đạt mới chuyển Nginx; lỗi sau switch trong cửa sổ kiểm tra sẽ phục hồi slot cũ.

Workflow test-sharp-v1.yml vẫn là kiểm thử độc lập, không deploy production.
Sau deploy tự động, lệnh Compose thao tác API/migration cần export `BACKEND_IMAGE`
bằng image ID đang chạy để tránh quay lại tag local cũ:

```bash
active_port=$(sudo -n /usr/local/sbin/pingpong-switch-upstream status)
if [ "$active_port" = 3000 ]; then active_service=api; else active_service=api-green; fi
api_id=$(docker compose --profile blue-green -f deploy/vps/compose.yml ps -q "$active_service")
export BACKEND_IMAGE=$(docker inspect --format '{{.Image}}' "$api_id")
docker compose --profile blue-green -f deploy/vps/compose.yml ps
```

Rollback Blue-Green dùng `bash deploy/vps/rollback.sh`, restart đúng container
standby, đọc full revision từ readiness localhost và chỉ dừng slot hiện tại sau
khi HTTPS qua Nginx trả đúng revision đó; schema phải tương thích. Không tự
rollback migration hoặc xóa volume. `compose.rollback.yml` chỉ dành cho phục hồi
image Blue thủ công trong bootstrap cũ, không phải cách rollback Blue-Green.

Kiểm thử luồng ảnh với bản WebAssembly trên máy local:

```powershell
npm run build --workspace=@chat/api
node -r ./apps/api/tests/sharp-wasm-preload.cjs apps/api/tests/profile.integration.cjs
node -r ./apps/api/tests/sharp-wasm-preload.cjs apps/api/tests/chat-media.integration.cjs
```

## Kiểm thử Sharp trên CPU VPS thật

Kiểm tra image đã build mà không kết nối database:

```bash
docker run --rm --network none --read-only pingpong-api:local node apps/api/tests/api-runtime-dependencies.cjs
docker run --rm --network none --read-only pingpong-api:local node apps/api/tests/sharp-runtime-smoke.cjs --source
```

Smoke Sharp kiểm tra JPEG/PNG/WebP; dependency check resolve từ `dist/main.js`,
gồm package được npm cài trong `apps/api/node_modules`. Dockerfile phải giữ cả
root và workspace node_modules trong runtime để NestJS khởi động đúng.

Kiểm thử migration và API startup với SQL Server staging độc lập dùng
`compose.sharp-staging.yml` và workflow thủ công `test-sharp-v1.yml`.
Không dùng env hoặc volume production cho staging. `api-runtime-health.cjs`
chỉ chạy khi NODE_ENV=test và database là staging-db/pingpong_staging.

### Cập nhật xử lý HTTP 429

Frontend điều tiết request chung (tối đa 4 lượt bắt đầu/giây/tab), ưu tiên
thao tác người dùng và ảnh trước reactions/receipts. Ảnh tải cùng lúc dùng
chung request và được lưu trong bộ nhớ phiên tối đa 50 MiB; đăng xuất hoặc
đổi tài khoản sẽ xóa cache. Nhiều tab hoặc người dùng chung IP vẫn có thể
chạm giới hạn của Nginx, khi đó client chờ theo `Retry-After`.

`deploy.sh` không tự cài lại cấu hình Nginx trên máy chủ. Khi nâng cấp một VPS
đã cấu hình HTTPS bằng Certbot, đối chiếu `nginx.conf` và ghép thay đổi vào
cấu hình đang dùng: map `pingpong_request_key`, map `pingpong_cors_origin`,
`error_page 429` và location `@rate_limited`. Các map/zone nằm trong khối
`http`; error handler phải có trong server HTTPS phục vụ API. Giữ nguyên
chứng chỉ và các thiết lập TLS đang có. Danh sách origin phải khớp `WEB_ORIGIN`.
Không ghi đè toàn bộ site HTTPS bằng file mẫu HTTP trong repository.

Kiểm tra rồi reload: `sudo nginx -t && sudo systemctl reload nginx`.
CI kiểm tra cú pháp/cơ chế giới hạn, CORS cho 429 và miễn giới hạn preflight
bằng `tests/nginx-switch.integration.sh` trong container dùng riêng cho test.
