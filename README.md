# Hệ thống chat và gọi video realtime đa nền tảng tích hợp AI

Bộ chuẩn bị triển khai đồ án của Nguyễn Thành Việt, dựa trên `1150080163_NguyenThanhViet_CNPM2_DC_Repair.docx`.

## Trạng thái

Ngày khảo sát: 30/09/2026. Thư mục nguồn ban đầu trống. Hiện có tài liệu thiết kế sơ bộ, kế hoạch và script kiểm tra môi trường; **chưa có ứng dụng chạy được**. Các thiết kế dưới đây là đề xuất triển khai, không phải tính năng đã hoàn thành hay quyết định đã được giảng viên duyệt.

## Bắt đầu

1. Đọc [phạm vi và rà soát đề cương](docs/01-pham-vi.md).
2. Xem [kiến trúc và dữ liệu](docs/02-kien-truc.md), [hợp đồng API/realtime](docs/03-api-realtime.md).
3. Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-environment.ps1` để kiểm tra công cụ.
4. Làm theo [chuẩn bị môi trường](docs/04-moi-truong.md).
5. Triển khai theo [backlog và nghiệm thu](docs/05-ke-hoach.md).

## Cấu trúc dự kiến

```text
apps/api/          NestJS REST API + Socket.IO
apps/web/          React web, gồm màn hình quản trị
apps/mobile/       React Native Android
packages/contracts/ DTO và kiểu sự kiện dùng chung
infra/             Cấu hình dịch vụ local và triển khai
docs/              Phân tích, thiết kế, kế hoạch
scripts/           Công cụ hỗ trợ
```

Chưa sinh package manifest hoặc cài dependencies: cần khởi tạo các ứng dụng bằng bộ công cụ tương thích và chốt phiên bản cùng lockfile khi triển khai. Không lưu khóa dịch vụ vào Git.
