# PingPong Android

Ứng dụng React Native Android dùng chung API và Socket.IO với Web. Bản đầu hỗ trợ:

- đăng nhập và khôi phục phiên bằng refresh token lưu trong Android Keystore;
- danh sách hội thoại, unread count và preview tin mới nhất;
- lịch sử tin nhắn, gửi text, reconnect WebSocket và đồng bộ bù theo sequence;
- ACK đọc tin mới nhất khi đang mở hội thoại;
- đăng xuất và thu hồi refresh token.

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

Debug mặc định gọi backend local từ Android Emulator qua
`http://10.0.2.2:3000`. Thiết bị thật không dùng được địa chỉ này; đổi
`API_ORIGIN` trong `src/api.ts` sang IP LAN HTTPS/tunnel phù hợp trước khi test.
Bản release gọi `https://pingpongapi.id.vn` và không cho cleartext HTTP.

## Kiểm tra

```powershell
npm.cmd run typecheck --workspace=@chat/android
npm.cmd run lint --workspace=@chat/android
npm.cmd test --workspace=@chat/android -- --runInBand
```

Release hiện vẫn dùng debug keystore do template mặc định. Không phát hành APK
production trước khi cấu hình signing key riêng ngoài repository.
