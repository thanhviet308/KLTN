# Hợp đồng API và realtime sơ bộ

Đây là thiết kế để triển khai, chưa phải API đang hoạt động. REST dùng tiền tố `/api/v1`; phân trang bằng cursor. Lỗi thống nhất `{ code, message, requestId, details? }`, không trả stack trace hoặc bí mật.

| Nhóm | Endpoint dự kiến |
| --- | --- |
| Auth | POST /auth/register, /auth/login, /auth/refresh, /auth/logout |
| Users | GET/PATCH /users/me; GET /users?query=... |
| Friends | POST /friend-requests; PATCH /friend-requests/:id; GET /friends; DELETE /friends/:userId |
| Conversations | GET/POST /conversations; GET/PATCH /conversations/:id; POST/DELETE /conversations/:id/members[/:userId] |
| Messages | GET /conversations/:id/messages?cursor=...; POST /conversations/:id/messages |
| Files | POST /attachments/upload-url; POST /attachments/:id/complete; GET /attachments/:id/download-url |
| Calls | POST /conversations/:id/calls; POST /calls/:id/accept, /reject, /leave, /end, /token; GET /calls |
| AI | POST /ai/chat; POST /conversations/:id/ai/summary, /reply-suggestions; GET /ai/jobs/:id |
| Admin | GET /admin/users; PATCH /admin/users/:id/status; GET /admin/conversations, /admin/reports, /admin/stats; PATCH /admin/reports/:id |
| Reports | POST /reports |
| Health | GET /health/live; GET /health/ready |

## Socket.IO

Xác thực lúc handshake và kiểm tra trạng thái tài khoản/quyền ở mỗi tác vụ nhạy cảm. Server tự thêm socket vào room dựa trên membership; không nhận tên room tùy ý từ client.

| Chiều | Sự kiện | Nội dung |
| --- | --- | --- |
| Client → server | message:send | conversationId, clientMessageId, body hoặc attachmentIds |
| Server → client | message:created | messageId, clientMessageId, conversationId, sequence, senderId, createdAt, nội dung |
| Client → server | message:delivered / message:read | conversationId, messageId; server xác minh người nhận |
| Server → client | message:receipt | messageId, userId, deliveredAt/readAt |
| Hai chiều | typing:update | conversationId, isTyping; TTL ngắn, không lưu DB |
| Server → client | presence:update | userId, status, lastSeenAt, chỉ gửi cho đối tượng được phép |
| Server → client | call:incoming / call:updated | callId, conversationId, trạng thái, người gọi |
| Server → client | notification:created | notificationId, type, payload tối thiểu |
| Server → client | ai:completed / ai:failed | jobId, trạng thái; chỉ gửi cho chủ tác vụ |

ACK gửi tin: `{ ok: true, messageId, sequence, createdAt }` hoặc `{ ok: false, code, message }`. HTTP và socket dùng chung service/idempotency. `sent` nghĩa đã lưu; `delivered` nghĩa có ACK từ ứng dụng người nhận; `read` nghĩa client xác nhận đọc. Không coi việc broadcast thành công là delivered.

## Cuộc gọi

`ringing → active → ended`, hoặc `ringing → rejected/missed/cancelled`. Với nhóm, trạng thái từng người tách khỏi trạng thái phòng; một người từ chối không hủy cả phòng. Server kiểm tra chuyển trạng thái và timeout, chống accept/end lặp. Token media chỉ cấp cho thành viên đủ quyền, có thời hạn ngắn. Webhook được xác minh và xử lý idempotent; đối soát để hoàn tất lịch sử khi client mất kết nối.
