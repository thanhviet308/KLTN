# Hệ thống chat và gọi video realtime đa nền tảng tích hợp AI

Ứng dụng giao tiếp trực tuyến trên Web và Android, hướng đến việc kết hợp nhắn tin, gọi thoại, gọi video và các tiện ích AI trong cùng một hệ thống. Phần mềm được xây dựng trong khuôn khổ đồ án tốt nghiệp của sinh viên Nguyễn Thành Việt.

> Dự án đang trong giai đoạn phát triển. Các chức năng dưới đây là phạm vi dự kiến xây dựng.

## Chạy backend hiện tại

Backend dùng NestJS + TypeORM + PostgreSQL. Đã có entity và migration cho toàn bộ mô hình dữ liệu trong doc 02: tài khoản, bạn bè, chat, tệp, cuộc gọi, thông báo, AI, báo cáo và audit; chưa triển khai API nghiệp vụ.

1. Chạy PostgreSQL; tạo database `realtime_chat` và tài khoản riêng `realtime_chat_app` có quyền trên database đó.
2. Sao chép `apps/api/.env.example` thành `apps/api/.env`, điền mật khẩu thực vào `DATABASE_URL` (URL-encode ký tự đặc biệt). Không commit `.env`.
3. Chạy các lệnh từ gốc repository:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run dev:api
```

Local đã được tạo lại tại `127.0.0.1:5432`, database `realtime_chat`, dùng tài khoản riêng `realtime_chat_app` không có quyền superuser. Mật khẩu được sinh ngẫu nhiên và chỉ lưu trong `.env`.

- Liveness: `GET http://127.0.0.1:3000/api/v1/health/live`.
- Readiness: `GET http://127.0.0.1:3000/api/v1/health/ready` kiểm tra DB thật; trả 503 nếu DB không đáp ứng.
- Kiểm tra code: `npm.cmd run check`.
- Xem trạng thái migration: `npm.cmd run db:show`.

`db:migrate` chạy migration TypeORM cho 17 bảng nghiệp vụ (15 bảng trong doc 02 và 2 bảng lịch sử hỗ trợ); `typeorm_migrations` theo dõi phiên bản và `typeorm_metadata` lưu thông tin generated columns, tổng cộng 19 bảng. Entity nằm trong `apps/api/src/modules/database/entities`, migration trong `apps/api/src/modules/database/migrations`. Migration chạy trong transaction, có advisory lock chống chạy đồng thời. Không còn runner SQL hoặc bảng `schema_migrations` cũ.

TypeORM quản lý entity, relation, repository và connection pool. `pg` là driver PostgreSQL mà TypeORM sử dụng. Luôn dùng `synchronize: false`, `dropSchema: false`, `migrationsRun: false`; thay đổi schema qua migration được review, chạy riêng trước API theo [hướng dẫn TypeORM](https://typeorm.io/docs/migrations/why/).

Xem [thiết kế database và quy trình migration](docs/08-thiet-ke-database-typeorm.md) cho quan hệ, ràng buộc, quyền truy cập và các giới hạn hiện tại.

Pool tối đa 10 connection mỗi process, có timeout và được TypeORM đóng khi shutdown. Startup dừng nếu không kết nối được database; readiness trả 503 khi database không đáp ứng.

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
