# Hệ thống chat và gọi video realtime đa nền tảng tích hợp AI

Ứng dụng giao tiếp trực tuyến trên Web và Android, hướng đến việc kết hợp nhắn tin, gọi thoại, gọi video và các tiện ích AI trong cùng một hệ thống. Phần mềm được xây dựng trong khuôn khổ đồ án tốt nghiệp của sinh viên Nguyễn Thành Việt.

> Dự án đang trong giai đoạn phát triển. Các chức năng dưới đây là phạm vi dự kiến xây dựng.

## Chạy backend hiện tại

Backend đã có kết nối PostgreSQL bằng `pg`, kiểm tra cấu hình và health endpoints. Chưa triển khai bảng nghiệp vụ, auth hoặc chat.

1. Chạy PostgreSQL; tạo database `realtime_chat` và tài khoản riêng `realtime_chat_app` có quyền trên database đó.
2. Sao chép `apps/api/.env.example` thành `apps/api/.env`, điền mật khẩu thực vào `DATABASE_URL` (URL-encode ký tự đặc biệt). Không commit `.env`.
3. Chạy các lệnh từ gốc repository:

```powershell
npm.cmd ci
npm.cmd run dev:api
```

Local hiện tại đã được cấu hình tại `127.0.0.1:5432`, database `realtime_chat`. Backend dùng tài khoản riêng không có quyền superuser; database `mydatabase` được giữ nguyên.

- Liveness: `GET http://127.0.0.1:3000/api/v1/health/live`.
- Readiness: `GET http://127.0.0.1:3000/api/v1/health/ready` kiểm tra DB thật; trả 503 nếu DB không đáp ứng.
- Kiểm tra code: `npm.cmd run check`.

Pool tối đa 10 connection mỗi process, có timeout và được đóng khi shutdown. Startup dừng nếu không kết nối được database. Cách quản lý pool theo [tài liệu node-postgres](https://node-postgres.com/apis/pool).

## Mục tiêu

Hệ thống hướng đến nhu cầu trao đổi thông tin cá nhân, học tập và làm việc nhóm. Người dùng có thể trò chuyện và thực hiện cuộc gọi trên nhiều thiết bị, đồng thời sử dụng AI để hỗ trợ tổng hợp nội dung và phản hồi trong quá trình giao tiếp.

## Chức năng dự kiến

### Tài khoản và kết nối

- Đăng ký, đăng nhập, đăng xuất và quản lý thông tin cá nhân.
- Tìm kiếm người dùng, gửi và nhận lời mời kết bạn.
- Quản lý danh sách bạn bè và trạng thái hoạt động.

### Nhắn tin realtime

- Trò chuyện cá nhân và trò chuyện nhóm.
- Gửi, nhận tin nhắn văn bản, hình ảnh và tệp tin.
- Hiển thị trạng thái tin nhắn và xem lịch sử trò chuyện.
- Nhận thông báo và đồng bộ dữ liệu giữa Web và Android.

### Gọi thoại và video

- Gọi thoại, gọi video cá nhân và nhóm.
- Nhận, từ chối và kết thúc cuộc gọi.
- Xem lịch sử cuộc gọi.

### Hỗ trợ bằng AI

- Chatbot hỗ trợ người dùng trong hệ thống.
- Tóm tắt nội dung cuộc trò chuyện.
- Gợi ý nội dung phản hồi tin nhắn.
- Nghiên cứu tích hợp phụ đề trực tiếp và tóm tắt nội dung cuộc gọi.

### Quản trị hệ thống

- Quản lý tài khoản, khóa và mở khóa người dùng.
- Quản lý nhóm trò chuyện và xử lý báo cáo vi phạm.
- Theo dõi thống kê người dùng, tin nhắn và cuộc gọi.

## Công nghệ dự kiến

| Thành phần                        | Công nghệ                   |
| --------------------------------- | --------------------------- |
| Ứng dụng Web                      | React, TypeScript           |
| Ứng dụng Android                  | React Native, TypeScript    |
| Backend                           | NestJS, TypeScript          |
| Nhắn tin realtime                 | Socket.IO                   |
| Gọi thoại và video                | WebRTC, LiveKit             |
| Cơ sở dữ liệu                     | PostgreSQL                  |
| Bộ nhớ đệm và trạng thái tạm thời | Redis                       |
| Lưu trữ hình ảnh và tệp tin       | AWS S3                      |
| AI hội thoại                      | OpenAI API                  |
| Nhận dạng giọng nói               | Google Cloud Speech-to-Text |

## Thông tin đồ án

- **Tên đề tài:** Xây dựng hệ thống chat và gọi video realtime đa nền tảng tích hợp AI.
- **Sinh viên thực hiện:** Nguyễn Thành Việt.
- **Mã số sinh viên:** 1150080163.
- **Lớp:** 11_ĐH_CNPM2.
- **Giảng viên hướng dẫn:** ThS. Trần Thị Hồng Tường.
- **Đơn vị:** Khoa Công nghệ thông tin — Trường Đại học Tài nguyên và Môi trường TP. Hồ Chí Minh.
