# Blue-Green Deployment với GitHub Actions

## Luồng hiện tại

`api` là Blue ở localhost:3000; `api-green` là Green ở localhost:3001.
Tên màu là slot cố định; slot active đổi luân phiên theo upstream Nginx.
PostgreSQL và volume chat_files được dùng chung, giữ nguyên tên project/volume.
Hai slot API giới hạn 512 MiB mỗi slot; database giữ giới hạn cũ 1 GiB.

Push main → Actions checks → SSH → VPS build Dockerfile x86-64-v1 bằng cache →
kiểm tra dependency/Sharp → kiểm tra không có migration chờ xử lý → chạy slot
inactive → readiness trực tiếp → nginx -t và reload upstream → health qua HTTPS
→ dừng slot cũ → kiểm tra lại health. Slot cũ được giữ làm cold standby.

Health qua Nginx phải trả `X-PingPong-Revision` đúng commit candidate, không chỉ
HTTP 200. Nhờ vậy response của Blue hoặc proxy trỏ sai không được coi là switch
thành công. Trước khi build, slot active cũng phải trả một full Git SHA; candidate
phải trả đúng SHA mới ngay trên localhost trước khi switch. Khi rollback, script
chỉ dừng candidate sau khi HTTPS trả đúng SHA của slot cũ. Header được validate
bằng full Git SHA.

Nginx reload giữ kết nối cũ. Chat hiện chưa dùng Socket.IO adapter chia sẻ:
không giữ hai bản phục vụ WebSocket lâu sau switch, vì message/presence nằm trong
từng tiến trình. Dừng bản cũ để client reconnect và sync dữ liệu trên bản mới.
Web đã có cơ chế reconnect/sync. Phải kiểm thử thêm Android; không cam kết
WebSocket hoàn toàn không gián đoạn. Bản mới chạy song song trước switch nhưng
chưa nhận traffic người dùng. Xem [Nginx reload](https://nginx.org/en/docs/control.html)
và [Socket.IO multiple nodes](https://socket.io/docs/v4/using-multiple-nodes/).

## Cài đặt một lần trên VPS (chưa tự thực hiện)

Thực hiện tại checkout production trên VPS sau khi commit mới đã có trên máy.
Giữ cấu hình TLS/Certbot hiện tại. Không ghi đè toàn bộ site bằng template HTTP.
Đảm bảo API Blue đang healthy trước khi bật luồng mới:

```bash
# Gắn revision cho lần bootstrap cuối trước khi Blue-Green quản lý hai slot.
export DEPLOYMENT_REVISION=$(git rev-parse HEAD)
docker compose -f deploy/vps/compose.yml up -d --build --no-deps --force-recreate api
curl --fail --dump-header - --output /dev/null http://127.0.0.1:3000/api/v1/health/ready
sudo install -o root -g root -m 0755 deploy/vps/switch-upstream.sh /usr/local/sbin/pingpong-switch-upstream
# Chỉ tạo upstream lần đầu. Không ghi đè nếu đã chạy Blue-Green trước đó.
if ! sudo test -e /etc/nginx/conf.d/pingpong-upstream.conf; then
  sudo install -o root -g root -m 0644 deploy/vps/nginx-upstream.conf /etc/nginx/conf.d/pingpong-upstream.conf
fi
```

Trong site Nginx đang dùng cho API (ví dụ `/etc/nginx/sites-available/pingpong-api`),
đổi cả location REST và Socket.IO từ `proxy_pass http://127.0.0.1:3000;` thành
`proxy_pass http://pingpong_api;`. Template `nginx.conf` trong repo đã đổi.
Giữ nguyên server_name, chứng chỉ, listen 443 và các rule còn lại. Backup file site
trước khi chỉnh; `sudo nginx -t` phải thành công rồi mới reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://pingpongapi.id.vn/api/v1/health/ready
```

Thay domain theo môi trường thực tế. GitHub Actions variable `VPS_HEALTH_URL`
phải trỏ URL HTTPS của API qua chính Nginx này, đường dẫn `/api/v1/health/ready`.
Mặc định là URL trên. Không dùng readiness localhost làm proxy health URL.

Cấp deploy user quyền chạy helper cố định, không cấp sudo toàn bộ. Thay `ubuntu`
bằng đúng `VPS_USER` trong GitHub secrets, sau đó kiểm tra bằng visudo:

```bash
DEPLOY_USER=ubuntu
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/pingpong-switch-upstream status, /usr/local/sbin/pingpong-switch-upstream 3000, /usr/local/sbin/pingpong-switch-upstream 3001\n' "$DEPLOY_USER" | sudo tee /etc/sudoers.d/pingpong-blue-green >/dev/null
sudo chmod 0440 /etc/sudoers.d/pingpong-blue-green
sudo visudo -cf /etc/sudoers.d/pingpong-blue-green
sudo -n /usr/local/sbin/pingpong-switch-upstream status
```

Helper phải root-owned, không writable bởi deploy user. Nếu sửa helper trong
repository, review và install lại bản mới trên VPS; workflow không tự nâng quyền
hay tự sửa cấu hình Nginx. Chưa cài helper thì deployment fail trước khi build,
không thay API. Root helper chỉ sửa một file upstream, kiểm tra Nginx và reload;
lỗi syntax/reload thì khôi phục file cũ.

Nếu VPS đang chạy Green (upstream:3001), giữ nguyên file upstream hiện tại.
Nếu cài mới hoàn toàn, khởi tạo database/migration/Blue theo README trước; lần
bootstrap đầu tiên chưa phải Blue-Green. Không đổi tên project `pingpong-backend`
hoặc PostgreSQL/chat volumes. Không chạy `down -v` hay prune.

## Migration và rollback schema

Deployment gọi `migrate.js --check`: chỉ đọc danh sách pending migrations với
advisory lock, không áp dụng migration. Nếu có migration mới, deployment dừng
trước khi chạy candidate hay switch traffic. Review migration theo expand/contract
để bản cũ và mới cùng dùng được schema; backup/restore-test trước khi áp dụng.

Khi đã review, trong cửa sổ bảo trì hoặc khi chắc chắn tương thích, chạy migration
riêng với image mới đã được build (thay SHA thực tế), rồi chạy lại workflow:

```bash
export BACKEND_IMAGE=pingpong-api:release-REPLACE_WITH_COMMIT_SHA
docker compose -f deploy/vps/compose.yml run --rm -T --no-deps migrate
```

Đây là lệnh **ghi schema production**, không chạy như một bước thử nghiệm. Không
cho phép migration phá vỡ bản đang phục vụ chỉ vì health candidate đạt. Rollback
API không rollback schema hoặc hoàn tác các ghi dữ liệu đã phát sinh.

## Rollback

Lỗi build, smoke, migration-check hoặc candidate readiness: giữ traffic và slot
active cũ. Lỗi switch/proxy health hoặc health trong ba vòng kiểm tra sau switch:
restart container cũ nếu đã dừng, đợi ready, chuyển upstream về cổng cũ rồi dừng
candidate, nhưng chỉ sau khi HTTPS trả đúng revision cũ. Nếu phục hồi cũ,
switch-back hoặc xác minh revision thất bại, giữ candidate chạy và báo CRITICAL
để tránh tự dừng backend duy nhất còn có thể phục vụ.

Ngoài cửa sổ kiểm tra này, rollback thủ công tại checkout VPS:

```bash
export DEPLOY_HEALTH_URL=https://pingpongapi.id.vn/api/v1/health/ready
bash deploy/vps/rollback.sh
```

Script dùng cùng lock với deploy, restart đúng container standby giữ nguyên image,
đọc revision qua readiness localhost, chuyển Nginx rồi đợi HTTPS trả đúng revision
đó. Nếu phải quay lại upstream ban đầu, HTTPS cũng phải xác nhận revision ban đầu.
Không build, recreate database hoặc migration.
Lần deploy tiếp theo có thể ghi đè slot inactive; chỉ giữ một phiên bản rollback.
Không chạy rollback image ngẫu nhiên nếu schema đã không còn tương thích.

## Vận hành và kiểm thử

VPS 1 vCPU/2GB RAM có thể thiếu RAM lúc build + hai API. Script chặn build nếu
MemAvailable dưới 512 MiB; guard này không đảm bảo không OOM. Đo `free -h`,
`docker stats --no-stream`, swap và disk trước lần đầu. Cache libvips/Sharp giúp
các lần sau; không tự dừng DB/Redis hoặc đổi swap để đủ tài nguyên.

Sau deploy, slot active có thể là api-green. Không dùng `compose up api` để cập
nhật tùy ý; dùng workflow/deploy.sh. Xem trạng thái bằng:

```bash
sudo -n /usr/local/sbin/pingpong-switch-upstream status
docker compose --profile blue-green -f deploy/vps/compose.yml ps --all
```

Kiểm thử staging cần bao gồm hai phiên bản schema-compatible, gửi/nhận tin nhắn,
refresh token, upload/download ảnh/voice/location, reconnect WebSocket, xác nhận
DB và chat volumes giữ nguyên. Tests mock trong `tests/deploy-failure.sh` kiểm tra
thứ tự lệnh và các nhánh rollback; chúng không chứng minh tốc độ/RAM trên VPS thật.

Kiểm thử local trên Windows sau khi build image candidate và pull PostgreSQL 17:

```powershell
docker build --platform linux/amd64 --target runtime -f apps/api/Dockerfile.x86-64-v1 -t pingpong-api:blue-green-validation .
docker pull postgres:17-bookworm
./deploy/vps/tests/staging-blue-green.ps1 -OldImage YOUR_PREVIOUS_WORKING_IMAGE
```

Script tạo project/DB/secrets mới, dùng cổng 13100/13101, không đọc env production.
Nó kiểm tra schema/extensions không đổi khi migration --check, áp dụng migration
chỉ vào DB staging, chạy hai phiên bản và xác minh Green vẫn healthy sau khi Blue
dừng. Container dừng khi hoàn tất; volume staging được giữ để điều tra, không tự xóa.

## Kết quả local (2026-10-13)

- Typecheck, build NestJS, lint, Docker runtime dependency/Sharp JPEG/PNG/WebP đạt.
- Các nhánh deploy lỗi build/dependency/Sharp/migration/startup/readiness/switch,
  proxy health/revision, reload trễ, lỗi sau dừng Blue và rollback fail giữ đúng
  traffic/container theo mock.
- Hai chiều switch và rollback thủ công qua mock đạt.
- Nginx thật trong container: Blue → Green → Blue, reload lỗi khôi phục upstream đạt.
- PostgreSQL 17 staging mới: --check báo 10 pending và giữ nguyên `0|plpgsql`;
  áp dụng 10 migration riêng staging rồi --check báo 0. Image cũ và mới cùng healthy,
  health/auth/validation HTTP đạt; Green tiếp tục healthy sau dừng Blue.
- Chưa cài helper, thay Nginx hay deploy lên VPS; chưa kiểm chứng RAM, HTTPS thực tế,
  WebSocket/mobile hoặc tốc độ trên VPS 1 vCPU/2GB.
