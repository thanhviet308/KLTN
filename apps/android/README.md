# PingPong Android

Ứng dụng React Native Android dùng chung API và Socket.IO với Web. Bản đầu hỗ trợ:

- đăng nhập và khôi phục phiên bằng refresh token lưu trong Android Keystore;
- danh sách hội thoại, unread count và preview tin mới nhất;
- lịch sử tin nhắn, gửi text, reconnect WebSocket và đồng bộ bù theo sequence;
- ACK đọc tin mới nhất khi đang mở hội thoại;
- đăng xuất và thu hồi refresh token.
- gọi thoại/video 1–1 với Web hoặc Android qua LiveKit, nhận/từ chối/kết thúc;
- bật/tắt micro và camera, chuyển loa trong/ngoài, xem lịch sử cuộc gọi trong chat.

## Gọi thoại và video

Trong hội thoại cá nhân, chọn **Gọi** hoặc **Video**. Android hỏi quyền micro,
và hỏi thêm camera cho cuộc gọi video, trước khi tạo hoặc nhận cuộc gọi.
Cuộc gọi đến xuất hiện ở mọi màn hình sau đăng nhập, kèm rung báo.
Nếu mất mạng, SDK tự kết nối lại; sau khi ngắt hẳn, dùng **Kết nối lại**
hoặc **Kết thúc**. Khi quay lại ứng dụng, trạng thái được đối chiếu với máy chủ.

Backend cần cấu hình `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
cùng project mà Web đang sử dụng. Ứng dụng lấy token ngắn hạn từ backend;
không đưa API secret vào ứng dụng. Tích hợp native theo
[hướng dẫn LiveKit React Native](https://docs.livekit.io/transport/sdk-platforms/react-native/).

Phạm vi hiện tại là cuộc gọi khi ứng dụng đang mở. Đánh thức ứng dụng khi đã
bị đóng và nhận cuộc gọi lúc khóa màn hình cần push notification và tích hợp
dịch vụ cuộc gọi Android ở bước tiếp theo; chưa cam kết duy trì cuộc gọi khi
Android đưa ứng dụng xuống nền.

### Kiểm thử trên thiết bị

Dùng hai tài khoản đã kết bạn, một trên Web và một trên Android:

1. Gọi thoại hai chiều; nhận, từ chối, hủy khi đang đổ chuông và kết thúc từ mỗi bên.
2. Gọi video hai chiều; kiểm tra hình/tiếng, bật/tắt mic/camera và đổi loa.
3. Từ chối quyền mic/camera: máy nhận chưa chấp nhận cuộc gọi; cấp lại quyền rồi thử lại.
4. Nhận cuộc gọi khi đang ở màn hình bạn bè/tài khoản; kiểm tra tên người gọi.
5. Tắt mạng rồi bật lại; kiểm tra nhãn kết nối lại và không xuất hiện cuộc gọi trùng.
6. Cúp từ Web trong lúc Android đang kết nối: Android phải dừng mic/camera.
7. Kiểm tra thẻ lịch sử cuộc gọi nhỡ/từ chối/kết thúc và thời lượng trong chat.

## Chạy debug

Project dùng React Native 0.87.1, Node 24 và JDK 21 đi kèm Android Studio. Trên
Windows, đặt biến cho terminal hiện tại rồi chạy emulator hoặc kết nối thiết bị:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
npm.cmd run start --workspace=@chat/android
npm.cmd run android --workspace=@chat/android
```

Cả bản debug và release mặc định gọi backend production tại
`https://pingpongapi.id.vn`. Nếu cần kiểm thử với backend local trên Android
Emulator, tạm đổi `API_ORIGIN` trong `src/api.ts` thành
`http://10.0.2.2:3000`; thiết bị thật phải dùng IP LAN HTTPS/tunnel phù hợp.

## Kiểm tra

```powershell
npm.cmd run typecheck --workspace=@chat/android
npm.cmd run lint --workspace=@chat/android
npm.cmd test --workspace=@chat/android -- --runInBand
```

Release hiện vẫn dùng debug keystore do template mặc định. Không phát hành APK
production trước khi cấu hình signing key riêng ngoài repository.
