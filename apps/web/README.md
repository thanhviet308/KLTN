# Giao diện tài khoản Halo

React + TypeScript + Vite. Chạy từ thư mục gốc:

```powershell
npm.cmd install
npm.cmd run dev:api
# Trong terminal thứ hai:
npm.cmd run dev:web
```

Mở **http://localhost:5173**. Backend cần `WEB_ORIGIN=http://localhost:5173`.
Vite chuyển tiếp `/api` đến `http://127.0.0.1:3000`; trình duyệt gửi Origin thật để backend xác thực client web.

Giao diện gồm đăng ký nhiều bước (email → xác minh mã → tên/mật khẩu/xác nhận mật khẩu), đăng nhập và thông tin tài khoản từ `/users/me`. Cần cấu hình SMTP trong `apps/api/.env` để nhận mã email thật; xem [doc 10](../../docs/10-dang-ky-xac-minh-email.md).
Đăng ký thành công chuyển về đăng nhập và giữ email. Không lưu mật khẩu hay token trong localStorage.
Access token chỉ tồn tại trong bộ nhớ; refresh token nằm trong cookie HttpOnly do backend quản lý.
Ứng dụng khôi phục phiên khi tải trang, kiểm tra phiên mỗi phút và khi cửa sổ được lấy nét,
gia hạn trước khi access token hết hạn và thử lại một lần khi `/users/me` trả 401.
Lỗi kết nối giữ nguyên biểu mẫu hoặc tài khoản để người dùng thử lại; đăng xuất chỉ hoàn tất sau phản hồi backend.

Build: `npm.cmd run build --workspace=@chat/web`.
Khi triển khai, phục vụ `dist` và reverse proxy `/api` đến backend trên cùng origin,
đặt `WEB_ORIGIN` đúng địa chỉ HTTPS của web và `NODE_ENV=production` trên API.

Kiểm tra thực tế với API/DB đang chạy: đăng ký email mới, email trùng, mật khẩu dưới 6 ký tự,
đăng nhập đúng/sai, tải lại trang, hết phiên, mất kết nối, đăng xuất rồi tải lại,
điều hướng bằng bàn phím và màn hình 375px.
