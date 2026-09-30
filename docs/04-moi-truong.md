# Môi trường phát triển

## Kết quả khảo sát 30/09/2026

| Công cụ | Quan sát |
| --- | --- |
| Node.js | v24.13.0 |
| npm | 11.6.2; dùng npm.cmd trong PowerShell nếu npm.ps1 bị chặn |
| Git | 2.52.0.windows.1 |
| Docker CLI | 29.1.2 |
| Docker Compose | v2.40.3-desktop.1 |
| Android SDK | Có adb.exe, thư mục platforms/build-tools và emulator.exe trong SDK mặc định; chưa xác minh phiên bản tương thích |
| java / adb | Không tìm thấy qua PATH tại lúc kiểm tra; có thể được cài ở nơi khác |
| Docker Engine | Không truy cập được từ shell trong lần chạy script kiểm tra |

Có CLI không đồng nghĩa Docker Engine đang chạy. Script `scripts/check-environment.ps1` kiểm tra thêm Engine và đường dẫn Android. Chưa chạy emulator, build APK hay kiểm tra tương thích SDK. Không cần Python để phát triển stack này.

Ghi nhận thay đổi ngoài workspace: khi gọi `python` để đọc DOCX, Python Install Manager tự cập nhật lên 26.2 và cài Python 3.14.7. Việc đọc tài liệu cũng đã thực hiện được bằng .NET/PowerShell, không cần thêm thư viện Python.

## Chuẩn bị theo thứ tự

1. Kiểm tra Docker Desktop hoạt động bằng script; nếu Engine chưa sẵn sàng thì mở Docker Desktop rồi chạy lại.
2. Xác minh JDK, Android SDK, emulator hoặc điện thoại có USB debugging theo phiên bản React Native được chọn. Không tự thay JAVA_HOME khi chưa xác định JDK phù hợp.
3. Khởi tạo NestJS API và React Web, sau đó React Native Android; kiểm tra một build tối thiểu trên từng nền tảng trước khi làm nghiệp vụ.
4. Chốt phiên bản dependencies trong package manifest, commit lockfile và ghi phiên bản Node. Không dùng tag `latest` cho hạ tầng triển khai chính thức.
5. Chuẩn bị PostgreSQL và Redis local; sau đó S3 và LiveKit khi đến mốc tệp/cuộc gọi. Chỉ bind dịch vụ dữ liệu local vào loopback, dùng volume bền vững.
6. Sao chép `.env.example` thành `.env` khi bắt đầu cấu hình backend. Điền bí mật local; file mẫu chỉ là hợp đồng dự kiến, chưa được ứng dụng tiêu thụ.

## Kết nối Android

`localhost` trên Android không phải máy phát triển. Emulator tiêu chuẩn thường cần địa chỉ host riêng; thiết bị thật cần IP LAN hoặc tunnel. Xác minh cách kết nối trên thiết bị thực tế, cấu hình CORS/origin và chính sách HTTP development riêng. Khi triển khai gọi video cần HTTPS và cấu hình mạng media/TURN được thử trên hai mạng khác nhau.

## Tài khoản/dịch vụ cần chuẩn bị

| Dịch vụ | Thời điểm | Thông tin cần có |
| --- | --- | --- |
| PostgreSQL/Redis local | Backend đầu tiên | Database, tài khoản, mật khẩu riêng cho local |
| S3 | Upload tệp | Region, bucket private, IAM tối thiểu, CORS |
| LiveKit | Cuộc gọi | URL, API key/secret ở server; quyết định self-host hay cloud |
| AI provider | AI văn bản | Khóa server, model được phép dùng, hạn mức chi phí |
| Speech-to-Text | Phụ đề | Credentials server, ngôn ngữ, phương án stream âm thanh |
| Push Android | Thông báo nền | Dự án và cấu hình push; thử trên thiết bị thật |
| VPS/domain/TLS | Demo từ xa | Máy chủ, DNS, HTTPS, cổng media, backup |

Chưa tạo tài khoản, mua dịch vụ hoặc triển khai cloud.

## Tài liệu cần đối chiếu lúc khởi tạo

- NestJS: https://docs.nestjs.com/first-steps
- React Native: https://reactnative.dev/docs/set-up-your-environment
- Socket.IO: https://socket.io/docs/v4/delivery-guarantees/
- LiveKit: https://docs.livekit.io/

Công cụ duyệt web không tải được các trang trong lần chuẩn bị này. Vì vậy chưa xác nhận yêu cầu phiên bản hiện hành; không xem danh sách công cụ đã cài là một bộ phiên bản đã được kiểm chứng tương thích.
