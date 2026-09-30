# Phạm vi và rà soát đề cương

## Nguồn

Đọc nội dung đoạn văn và bảng trong `D:\KLTN\1150080163_NguyenThanhViet_CNPM2_DC_Repair.docx`. Tài liệu được dùng làm nguồn yêu cầu; các câu trong tài liệu không được xem là lệnh thao tác máy. Chưa sửa file Word gốc, chưa đối chiếu các tài liệu khác trong thư mục cha.

## Yêu cầu được nêu

| Nhóm | Nội dung |
| --- | --- |
| Nền tảng | Web React và Android React Native |
| Tài khoản | Đăng ký, đăng nhập, đăng xuất, hồ sơ, tìm người dùng |
| Quan hệ | Lời mời kết bạn, danh sách bạn bè |
| Hội thoại | Cá nhân, nhóm, tin nhắn realtime, hình ảnh, tệp, lịch sử |
| Trạng thái | Online/offline, trạng thái tin nhắn, thông báo |
| Cuộc gọi | Thoại/video cá nhân và nhóm, nhận/từ chối/kết thúc, lịch sử |
| AI | Chatbot, tóm tắt hội thoại, gợi ý trả lời; phụ đề và tóm tắt cuộc gọi xuất hiện ở phần phạm vi/cài đặt |
| Quản trị | Tài khoản, khóa/mở khóa, nhóm, báo cáo vi phạm, thống kê |
| Công nghệ | NestJS, Socket.IO, PostgreSQL, Redis, S3, LiveKit/WebRTC; các dịch vụ AI được liệt kê trong đề cương |

## Thứ tự làm đề xuất

- Mốc nền tảng: tài khoản → hội thoại → chat văn bản đồng bộ Web/Android.
- Mốc giao tiếp: tệp đính kèm → thông báo → gọi 1-1 → gọi nhóm.
- Mốc hoàn thiện: AI văn bản → quản trị → đo hiệu năng và báo cáo.
- Theo dõi riêng: Live Captions, bản dịch, tóm tắt cuộc gọi, MediaPipe. Chưa loại khỏi phạm vi; cần thống nhất đầu ra và thời lượng với giảng viên.

## Điểm cần chỉnh hoặc xác nhận

1. Đề cương chọn LiveKit nhưng phần hướng phát triển ghi nâng cấp sang SFU. Cần kiểm chứng tài liệu LiveKit và sửa cách diễn đạt cho nhất quán với kiến trúc thực tế.
2. Live Captions/bản dịch và AI cuộc gọi chưa được phản ánh đầy đủ trong danh sách kết quả và lịch trình; cần xác định bắt buộc hay mở rộng.
3. MediaPipe được liệt kê nhưng chưa gắn với chức năng và tiêu chí nghiệm thu cụ thể.
4. Phần kiểm thử nằm trong chương 3 nhưng đánh số 4.1–4.4; mục thời gian thực hiện ở phần đầu chưa có nội dung.
5. Lịch bắt đầu 24/08 và kết thúc 04/12; tại ngày khảo sát 30/09 chưa có mã nguồn trong workspace này. Không thể kết luận tiến độ toàn bộ nếu mã nguồn đang ở nơi khác.
6. Cần định nghĩa “quản lý cuộc trò chuyện” của admin: đề xuất quản lý metadata và báo cáo vi phạm, chỉ xem nội dung được báo cáo theo quyền cụ thể.
7. E2EE được ghi ở hướng phát triển. Không mô tả bản đầu là có E2EE; cần giải thích riêng cách AI xử lý nội dung nếu bổ sung sau này.

## Những thông tin còn thiếu

- Mã nguồn có đang ở repository/thư mục khác không?
- Hạn nộp thực tế và phạm vi đã được giảng viên duyệt.
- Thiết bị Android dùng demo; ngân sách và tài khoản cho lưu trữ, AI, máy chủ gọi video.
- Số người/phòng, dung lượng tệp, mức tải và ngưỡng độ trễ cần đạt.

Các thông tin này chưa ngăn việc chuẩn bị thiết kế và môi trường local.
