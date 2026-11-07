# Trợ lý AI trong PingPong

Ba chức năng trên Web: tóm tắt tin đã chọn, gợi ý 2–3 câu trả lời, dịch một tin
sang tiếng Việt/Anh/Nhật/Hàn/Trung/Pháp. Không cần huấn luyện mô hình.

## Cấu hình

Chỉ trên API server, thêm `GEMINI_API_KEY` và `GEMINI_MODEL` vào `.env` rồi khởi động
lại API. Không thêm khóa vào biến `VITE_*` hoặc mã nguồn Web. Không có model mặc định:
chọn model tài khoản có quyền dùng và hỗ trợ Gemini Structured Outputs.
Khi thiếu một trong hai biến, tính năng báo chưa sẵn sàng; không sinh kết quả giả.

Provider dùng SDK chính thức `@google/genai` và Gemini Structured Outputs.
Không cần migration mới cho bản này. AI hoạt động đồng bộ; kết quả không lưu
vào bảng `ai_jobs` hay lịch sử tin nhắn, chỉ hiển thị trong phiên Web hiện tại.

## Sử dụng

- Chọn **Tóm tắt với AI** trên vùng chat. Mặc định chọn 20 tin văn bản gần nhất
  đã tải. Có thể chọn/bỏ chọn, lọc thời gian hoặc tải thêm tin cũ. Khoảng thời gian
  chỉ áp dụng cho những tin đã tải, không âm thầm lấy toàn bộ lịch sử.
- Menu **Thêm thao tác** của một tin văn bản → **Gợi ý trả lời với AI** hoặc
  **Dịch tin nhắn**. Gợi ý mặc định lấy tối đa 10 tin kết thúc tại tin đích; có thể
  bỏ bớt ngữ cảnh. Không đưa tin xảy ra sau tin đích vào yêu cầu gợi ý.
- Trước mỗi lượt, xem nội dung và đồng ý gửi các tin đã chọn tới Google Gemini.
- Chọn gợi ý sẽ thêm vào ô soạn thảo, giữ bản nháp đang có và gắn tin được trả lời.
  Người dùng kiểm tra/sửa rồi tự gửi; AI không có công cụ gửi tin.
- Bản dịch xuất hiện dưới tin gốc và có nút ẩn. Nếu tin gốc bị sửa/thu hồi,
  bản dịch cũ không tiếp tục được hiển thị.

## API và giới hạn

Các endpoint yêu cầu phiên đăng nhập hợp lệ:

- `GET /api/v1/ai/status` → `{ "enabled": true|false }`.
- `POST /api/v1/conversations/:id/ai` nhận `kind` (`summary`, `replies`, `translate`),
  `messageIds` (UUID), `sourceRevisions` tương ứng và các tùy chọn:
  `targetMessageId` cho replies; `tone` (concise/friendly/formal);
  `language` (vi/en/ja/ko/zh/fr). Trả `kind`, `messageIds`, `result`.
- Mỗi revision là SHA256 của `JSON.stringify([id, editedAt ?? null, body ?? ''])`,
  với editedAt ở dạng ISO như API trả về. Backend lấy nội dung chuẩn từ database;
  chỉ gửi khi revision còn khớp nội dung người dùng đã xem trước.
- Tối đa 50 tin văn bản và tổng 24.000 ký tự nội dung/tên người gửi; translation
  chỉ nhận một tin. Không đọc file, ảnh, audio hoặc vị trí.
- 20 lượt/người/giờ, một yêu cầu đang xử lý/người, tối đa hai yêu cầu chạy đồng thời
  trên mỗi process. Lượt được tính khi bắt đầu gọi provider, kể cả lỗi provider.
  Giới hạn hiện lưu trong bộ nhớ: khởi động lại sẽ đặt lại, nhiều API instance có
  hạn mức riêng. Trước khi mở rộng production, cần quota dùng chung và giới hạn
  chi phí ở tài khoản provider.
- Provider timeout 25 giây, Web chờ tối đa 35 giây; không tự retry yêu cầu phát sinh
  chi phí. Đầu ra bị từ chối, thiếu, sai JSON hoặc sai cấu trúc đều được xử lý lỗi.

## Quyền và dữ liệu

Backend kiểm tra thành viên hiện tại và từng khoảng thời gian tham gia nhóm như
lịch sử chat. Tin bị thu hồi/không thuộc hội thoại/không có quyền xem đều bị từ chối.
Kiểm tra lại quyền, tồn tại và phiên bản tin sau khi provider trả kết quả. Một nội dung
đã gửi tới provider trước khi bị thu hồi không thể được rút lại từ request đó.

Chỉ gửi tên hiển thị, nội dung, ID tin và thời gian; không gửi email, token phiên,
khóa API trong prompt. Các tin được đặt trong dữ liệu JSON không tin cậy, không
phải chỉ dẫn hệ thống. Không cấp công cụ cho mô hình. Dữ liệu được xử lý theo
chính sách của Gemini Developer API; đây không phải cam kết không lưu mọi loại log của provider.
Không ghi prompt, kết quả hay lỗi thô của provider vào log ứng dụng. Web hiển thị
kết quả dưới dạng văn bản, không dựng HTML do mô hình sinh ra.

## Kiểm thử

`npm run check` gồm `apps/api/tests/ai.test.cjs` và `apps/web/tests/ai-model.test.mjs`:
quyền truy cập, ranh giới thành viên, sửa/thu hồi tin, giới hạn, khóa đồng thời,
payload provider, lỗi/refusal/timeout và revision Web/backend.
Provider được giả lập trong test; không cần khóa, không gọi API trả phí.

Cần kiểm thử tích hợp với PostgreSQL và tài khoản Gemini thử nghiệm để đánh giá
chất lượng tiếng Việt, độ đúng của tóm tắt/dịch và chi phí thực tế trước khi mở rộng.
