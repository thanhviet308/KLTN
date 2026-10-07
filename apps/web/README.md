# Giao diện tài khoản Halo

Mục Đoạn chat dùng bố cục hai cột: danh sách trò chuyện bên trái và nội dung bên phải.
Nhấn Nhắn mới rồi chọn một người bạn để mở trò chuyện riêng ngay.
Tạo nhóm là hành động phụ; quản lý thành viên nằm trong nút Thông tin.
Trên điện thoại, danh sách và nội dung được hiển thị lần lượt, có nút Quay lại.
Các API theo doc 12: danh sách có phân trang, tạo trò chuyện riêng từ bạn bè,
tạo nhóm với 1–49 người bạn, xem thành viên, đổi tên, thêm/xóa thành viên,
cấp/gỡ quản trị, chuyển chủ nhóm và rời nhóm. Các thao tác quản lý hiện theo vai trò
owner/admin/member; hành động xóa, chuyển quyền và rời nhóm cần xác nhận.
Tạo nhóm giữ cùng clientRequestId khi thử lại cùng nội dung trong biểu mẫu.
Danh sách thành viên và danh sách chọn bạn tải đủ các trang.
Theo doc 13–14, đoạn chat hỗ trợ gửi tin văn bản, lịch sử theo sequence,
tải tin cũ, nhận tin realtime, đang nhập, xác nhận nhận/đọc và xem receipt.
Enter để gửi, Shift + Enter để xuống dòng. Tin gửi lỗi giữ nội dung và có nút Gửi lại
với cùng clientMessageId. Bản nháp giữ trong bộ nhớ khi chuyển hội thoại, mất khi tải lại trang.
Socket subscribe trước đồng bộ bù; REST đồng bộ định kỳ 15 giây để phục hồi sự kiện bị lỡ.
Sequence được so sánh bằng BigInt, nội dung tin được render dạng text.
Chỉ ACK đọc khi tin nằm trong vùng đang xem và cửa sổ đang được lấy nét.
Trạng thái nhận/đọc được lấy lại cho 10 tin gửi gần nhất và khi mở chi tiết trạng thái.

Sau đăng nhập, Halo có các mục Bạn bè, Lời mời nhận, Lời mời đã gửi,
Tìm bạn (theo tên hiển thị) và Tài khoản (sửa tên hiển thị).
Danh sách hỗ trợ Xem thêm theo cursor của API. Có gửi, chấp nhận, từ chối,
thu hồi lời mời và xác nhận trước khi hủy kết bạn.
Các thao tác dùng access token trong bộ nhớ, gia hạn phiên và thử lại một lần khi nhận 401.
Nút Tải lại cập nhật thay đổi từ người khác; backend hiện chưa có sự kiện realtime cho bạn bè.

React + TypeScript + Vite. Chạy từ thư mục gốc:

```powershell
npm.cmd install
npm.cmd run dev:web
```

Mở **http://localhost:5173**. Backend cần `WEB_ORIGIN=http://localhost:5173`.
Vite chuyển tiếp `/api` và WebSocket `/socket.io` đến `https://pingpongapi.id.vn`;
trình duyệt gửi Origin thật để backend xác thực client web. Restart Vite sau khi cập nhật cấu hình proxy.

Giao diện gồm đăng ký nhiều bước (email → xác minh mã → tên/mật khẩu/xác nhận mật khẩu), đăng nhập và thông tin tài khoản từ `/users/me`. Cần cấu hình SMTP trong `apps/api/.env` để nhận mã email thật; xem [doc 10](../../docs/10-dang-ky-xac-minh-email.md).
Đăng ký thành công chuyển về đăng nhập và giữ email. Không lưu mật khẩu hay token trong localStorage.
Access token chỉ tồn tại trong bộ nhớ; refresh token nằm trong cookie HttpOnly do backend quản lý.
Ứng dụng khôi phục phiên khi tải trang, kiểm tra phiên mỗi phút và khi cửa sổ được lấy nét,
gia hạn trước khi access token hết hạn và thử lại một lần khi `/users/me` trả 401.
Lỗi kết nối giữ nguyên biểu mẫu hoặc tài khoản để người dùng thử lại; đăng xuất chỉ hoàn tất sau phản hồi backend.

Build: `npm.cmd run build --workspace=@chat/web`.
Domain BE được đặt chung tại `src/config.ts`: `https://pingpongapi.id.vn`.
Bản production gọi trực tiếp domain này cho REST và Socket.IO; đặt `WEB_ORIGIN` đúng địa chỉ HTTPS của web và `NODE_ENV=production` trên API.
Refresh cookie hiện dùng SameSite=Strict, nên FE production phải cùng site với API (ví dụ `app.pingpongapi.id.vn`). Nếu FE ở site khác, cần proxy cùng origin cho REST/socket hoặc thiết kế lại cookie/CSRF trước khi sử dụng.
Reverse proxy `/socket.io` cần hỗ trợ WebSocket upgrade. Backend realtime hiện chạy một instance theo doc 14.

Kiểm tra thực tế với API/DB đang chạy: đăng ký email mới, email trùng, mật khẩu dưới 6 ký tự,
đăng nhập đúng/sai, tải lại trang, hết phiên, mất kết nối, đăng xuất rồi tải lại,
điều hướng bằng bàn phím và màn hình 375px.
