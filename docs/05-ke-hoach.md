# Backlog, kiểm thử và hồ sơ báo cáo

## Mốc triển khai theo phụ thuộc

Các khoảng thời gian dưới đây lấy từ đề cương. Đây là kế hoạch tham chiếu, không phải tiến độ đã đạt; cần cập nhật sau khi xác nhận có mã nguồn ở nơi khác hay không.

| Mốc | Thời gian đề cương | Đầu ra / điều kiện hoàn thành |
| --- | --- | --- |
| P0: nền tảng | 21–25/09 | API/Web/Android build tối thiểu; DB migration; đăng ký/đăng nhập/đăng xuất; kiểm thử quyền |
| P1: kết nối | 28/09–02/10 | Tìm người dùng, lời mời kết bạn, hội thoại 1-1/nhóm, kiểm soát membership |
| P2: chat | 05–09/10 | Lưu và gửi tin realtime; retry không trùng; reconnect bù tin; trạng thái đọc/online |
| P3: Web | 12–16/10 | Luồng tài khoản và chat Web hoàn chỉnh, xử lý lỗi và mất mạng |
| P4: Android | 19–23/10 | APK chạy trên thiết bị; chat hai chiều với Web |
| P5: tệp/thông báo | 26–30/10 | Upload có quyền, thông báo nền, đồng bộ nhiều thiết bị |
| P6: gọi | 02–13/11 | Gọi thoại/video 1-1 và nhóm; từ chối, timeout, mất mạng, lịch sử; thử khác mạng |
| P7: AI | 16–20/11 | Chatbot, tóm tắt, gợi ý; quota, timeout, lỗi provider; phụ đề cần lịch riêng |
| P8: admin/QA | 23–27/11 | Khóa tài khoản, xử lý báo cáo, thống kê, kiểm thử xuyên suốt |
| P9: nộp | 30/11–04/12 | Demo triển khai, số liệu thật, báo cáo, APK, hướng dẫn và backup/restore |

Nếu chỉ có workspace trống này, bắt đầu P0 ngay; chưa cam kết bù lịch bằng cách bỏ các chức năng bắt buộc. Tạo một luồng dọc Web ↔ API ↔ Android sớm để phát hiện lỗi liên nền tảng trước mốc P4.

## Checklist công việc đầu tiên

- [ ] Chốt các điểm chưa thống nhất trong `01-pham-vi.md`.
- [ ] Khởi tạo ứng dụng, workspace và lockfile; cấu hình format/lint/build.
- [ ] Tạo DB schema/migration cho users, sessions, conversations, members, messages.
- [ ] Tạo API health, cấu hình env validation và logging đã lọc bí mật.
- [ ] Hoàn thành auth và kiểm thử hai user + một admin.
- [ ] Làm demo gửi tin giữa hai client với reload/reconnect.
- [ ] Ghi lại lệnh chạy và kết quả build thực tế vào README.

## Ma trận nghiệm thu tối thiểu

| Tình huống | Kết quả cần chứng minh |
| --- | --- |
| Đăng ký trùng email; sai mật khẩu; refresh bị thu hồi | Lỗi phù hợp, không lộ mật khẩu/token |
| User ngoài nhóm gọi REST/socket/token media | Bị từ chối, không nhận nội dung |
| Retry cùng clientMessageId, ACK bị mất | Một bản ghi tin nhắn, trả cùng ID |
| Mất mạng rồi reconnect | Đồng bộ đủ tin đúng thứ tự, không trùng |
| Một user đăng nhập hai thiết bị | Presence và trạng thái đọc hợp lý |
| Thành viên bị xóa hoặc tài khoản bị khóa | Mất quyền truy cập đang hoạt động và lần truy cập mới |
| Upload giả loại tệp, quá kích thước; URL hết hạn | Bị từ chối, không công khai bucket |
| Web ↔ Android gọi ở hai mạng | Kết nối âm thanh/video; ghi rõ cấu hình mạng và thiết bị |
| Gọi nhóm, từ chối, timeout, tắt app | Trạng thái phòng/người tham gia và lịch sử đúng |
| AI timeout, quá hạn mức, nội dung chèn chỉ dẫn | Lỗi rõ ràng, không vượt quyền hoặc lộ dữ liệu nhóm khác |
| Admin xử lý báo cáo | Đúng vai trò, có audit log |
| Backup và restore DB | Khôi phục được trên môi trường thử nghiệm |

Kiểm thử unit cho logic trạng thái/quyền, integration cho DB và idempotency, E2E cho luồng chính. Dùng công cụ tải hỗ trợ giao thức Socket.IO; không xem benchmark HTTP là benchmark realtime.

## Số liệu cần thu

Ghi môi trường, commit, số client, số phòng, số người/phòng, cỡ payload, mạng và số lần lặp. Đo p50/p95/p99 và tỷ lệ lỗi cho gửi tin đến ACK, gửi tin đến người nhận, thời gian vào cuộc gọi, độ trễ AI; ghi CPU/RAM/băng thông khi tải tăng. Đồng bộ đồng hồ nếu đo qua thiết bị, hoặc dùng phép đo round-trip và giải thích giới hạn. Ngưỡng đạt cần thống nhất trước thử nghiệm; không điền số liệu giả vào báo cáo.

## Hồ sơ cần tích lũy

- Chương 1: cơ sở lý thuyết và nguồn tham khảo được kiểm chứng.
- Chương 2: yêu cầu, use case, activity diagram, kiến trúc, ERD, wireframe, hợp đồng API.
- Chương 3: cài đặt, ảnh màn hình thật, test case, kết quả đo, đánh giá hạn chế.
- Phụ lục: lệnh chạy, cấu hình mẫu không có bí mật, dữ liệu seed thử nghiệm, APK, hướng dẫn demo và phục hồi.

Kịch bản demo: hai tài khoản Web/Android → kết bạn → nhắn tin/ảnh → mất mạng và đồng bộ → gọi → AI tóm tắt → admin xử lý báo cáo. Chỉ đánh dấu hoàn thành khi có bằng chứng chạy thực tế.
