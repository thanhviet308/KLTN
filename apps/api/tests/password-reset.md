# Quên mật khẩu trên Web

Từ trang đăng nhập, chọn **Quên mật khẩu?** → nhập email → nhập mã 6 chữ số,
mật khẩu mới và xác nhận → đăng nhập bằng mật khẩu mới.

## Chuẩn bị

- Dùng cấu hình SMTP hiện có cho xác minh đăng ký; không cần biến môi trường mới.
- Chạy migration `PasswordReset1793577600000` trước khi đưa bản API mới vào sử dụng.
  Migration chỉ thêm bảng `password_resets`, tương thích với bản API cũ.
- Local: `npm run db:migrate`.
- VPS blue-green: thực hiện quy trình migration được review ở `deploy/vps/blue-green.md`;
  thêm `PasswordReset1793577600000` vào danh sách cho phép nếu dùng `--allow`.
  Không tự chạy migration trên production khi chỉ build/deploy API.

## API

Cả hai endpoint là public nhưng vẫn kiểm tra `X-Auth-Client` và Origin giống đăng ký.
Web gửi `X-Auth-Client: web` và Origin phải khớp `WEB_ORIGIN`.

- `POST /api/v1/auth/password-reset/request-code`: `{ "email": "ban@example.com" }`.
  Trả 200 với `challengeId`, `expiresAt`, `resendAfterSeconds: 60` cho cả tài khoản
  tồn tại và không tồn tại. Chỉ gửi email cho tài khoản đang hoạt động.
- `POST /api/v1/auth/password-reset/confirm`: `challengeId`, `code`, `newPassword`,
  `confirmPassword`. Mật khẩu 8–128 ký tự, hai giá trị phải khớp. Thành công trả 204,
  xóa refresh cookie của trình duyệt và thu hồi mọi session của tài khoản.
- `INVALID_PASSWORD_RESET_CODE`: lỗi 400 dùng chung cho mã sai/hết hạn/đã dùng,
  tài khoản không hợp lệ, hoặc mật khẩu/email đã thay đổi kể từ khi yêu cầu mã.

Mã dùng một lần, hết hạn sau 10 phút, tối đa 5 lần nhập sai, chờ 60 giây giữa
các lần gửi, tối đa 5 email/giờ/địa chỉ. Giới hạn IP hiện có cũng áp dụng.
Gửi lại mã làm mất hiệu lực mã trước. Chỉ lưu HMAC của mã; phân biệt mục đích
với mã đăng ký. Mã đăng ký không thể dùng để đặt lại mật khẩu.

SMTP chạy sau khi tạo challenge để thời gian chờ email không tiết lộ tài khoản.
Chỉ đánh dấu mã dùng được sau khi SMTP chấp nhận. Nếu gửi lỗi hoặc API khởi động
lại trước khi gửi xong, người dùng có thể yêu cầu mã mới sau 60 giây; delivery
không dùng hàng đợi bền vững. Log chỉ có mã lỗi, không có email, OTP hay mật khẩu.
Sau khi đổi mật khẩu, gửi thêm email thông báo không chứa mật khẩu mới.

## Xác minh

`npm run check` bao gồm kiểm thử `password-reset.test.cjs` cho mã dùng một lần,
5 lần nhập sai, hết hạn, gửi lại, giới hạn gửi, tài khoản bị khóa/không tồn tại,
đổi thông tin giữa chừng, thu hồi phiên và hai yêu cầu xác nhận đồng thời.
Các kiểm thử service dùng repository giả; cần kiểm thử tích hợp với PostgreSQL/SMTP
ở môi trường thử nghiệm trước khi đưa lên production.

Kiểm tra thủ công bằng tài khoản thử nghiệm:

1. Yêu cầu mã, kiểm tra email đúng thương hiệu/nội dung; nhập mã và đổi mật khẩu.
2. Mật khẩu cũ không đăng nhập được; mật khẩu mới đăng nhập được.
3. Phiên trên trình duyệt khác bị thu hồi; refresh/access token cũ bị từ chối.
4. Gửi lại mã, xác nhận mã cũ bị từ chối; kiểm tra giới hạn đếm ngược trên Web.
5. Nhập sai 5 lần rồi thử mã đúng: phải yêu cầu mã mới.
6. Thử email không tồn tại/bị khóa: cùng phản hồi, không tiết lộ trạng thái tài khoản.
7. Kiểm tra trường bắt buộc, xác nhận không khớp, nút hiện/ẩn mật khẩu và quay lại đăng nhập.
