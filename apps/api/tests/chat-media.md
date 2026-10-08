# Test tin nhắn ảnh, tệp, thoại và vị trí

Chạy migration và khởi động API/web local:

```powershell
npm run db:migrate
npm run dev:api
# Terminal khác
npm run dev:web
```

Đăng nhập hai tài khoản đã kết bạn bằng hai trình duyệt khác nhau:

1. Trong đoạn chat, chọn **Ảnh / Tệp**. Gửi PNG/JPEG/WebP và một tệp thông thường; xác nhận người nhận xem được ảnh, tải được tệp đúng nội dung. Thử tệp trên 10 MB để xác nhận bị từ chối.
2. Chọn **Ghi âm**, cấp quyền micro, nói vài giây rồi chọn **Dừng và gửi bản ghi âm**. Phát bản ghi ở tài khoản còn lại. Thử hủy ghi âm và chuyển cuộc trò chuyện khi đang ghi; micro phải tắt và không tự gửi.
3. Chọn **Chia sẻ vị trí hiện tại**, cấp quyền vị trí, kiểm tra tọa độ và liên kết mở bản đồ. Đây là vị trí tại thời điểm gửi, không phải theo dõi vị trí liên tục.
4. Thu hồi tin nhắn tệp, kiểm tra người nhận không thể tải lại tệp. Nội dung đã tải xuống thiết bị trước khi thu hồi không thể bị xóa từ xa.
5. Chuyển cuộc trò chuyện rồi quay lại, tải lại trang, kiểm tra các tin nhắn vẫn hiển thị trong lịch sử. Kiểm tra dòng xem trước và cập nhật realtime ở tài khoản còn lại.

Kiểm thử HTTP tự động (chỉ cho PostgreSQL localhost, tạo rồi dọn dữ liệu test):

```powershell
npm run build --workspace=@chat/api
node apps/api/tests/chat-media.integration.cjs
```

Kiểm thử bao gồm validation, tọa độ, tệp giả ảnh/âm thanh, tên tệp không hợp lệ, giới hạn kích thước, tải tệp có xác thực, người ngoài cuộc trò chuyện, thu hồi và gửi đồng thời cùng `clientMessageId`. Fixture âm thanh chỉ kiểm tra nhận diện container; việc ghi/phát âm thanh thật cần kiểm tra bằng trình duyệt như trên.

API:

- `POST /api/v1/conversations/:id/messages`: tin nhắn text hoặc `{clientMessageId, type: "location", location: {latitude, longitude}}`.
- `POST /api/v1/conversations/:id/messages/upload?clientMessageId=...&type=image|file|voice&fileName=...&mimeType=...`: body nhị phân `application/octet-stream`. Một tệp cho mỗi tin nhắn; giữ nguyên `clientMessageId` khi gửi lại.
- `GET /api/v1/conversations/:id/messages/:messageId/file`: Bearer token, kiểm tra quyền thành viên và khoảng lịch sử được phép xem. Không có URL tệp công khai.

Mỗi tệp tối đa 10 MB, mỗi tài khoản tối đa 512 MB tệp được lưu và 30 yêu cầu upload/phút; một tiến trình xử lý tối đa hai upload cùng lúc. Ảnh tĩnh PNG/JPEG/WebP được chuyển sang WebP, giới hạn 16 triệu pixel và cạnh dài tối đa 2048 pixel. Các tệp thông thường trả về dạng tải xuống `application/octet-stream`; chưa có quét virus. Bản ghi âm sử dụng container MediaRecorder WebM/Ogg/MP4, tối đa 60 giây ở giao diện.

File lưu dưới `CHAT_FILES_DIR`, mặc định `storage/chat` tương đối với thư mục chạy API. Metadata lưu trong PostgreSQL. Docker VPS dùng volume `chat_files`; cần backup cả database và volume. Tin nhắn thu hồi vẫn giữ tệp để bảo toàn dữ liệu; chỉ chặn truy cập mới. Không có tác vụ retention/xóa tệp định kỳ; tệp tạm hoặc tệp chưa có metadata do tiến trình chết đột ngột cần đối soát trước khi dọn.
