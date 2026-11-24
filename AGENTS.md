## Quy tắc sử dụng Graphify

- Ưu tiên sử dụng Graphify khi phân tích, tìm kiếm, sửa lỗi hoặc phát triển chức năng trong dự án.
- Trước khi tìm kiếm diện rộng trong source code, sử dụng `graphify query` để xác định các module, service và thành phần liên quan.
- Sử dụng `graphify path` và `graphify explain` khi cần phân tích luồng xử lý hoặc quan hệ phụ thuộc.
- Kiểm tra lại source code thực tế trước khi chỉnh sửa, không chỉ dựa vào knowledge graph.
- Sau khi hoàn thành các thay đổi source code, chạy `graphify update .` để cập nhật knowledge graph.
- Không đưa file `.env`, mật khẩu, API key, token hoặc thông tin nhạy cảm vào knowledge graph.
- Nếu Graphify không cung cấp đủ thông tin, tiếp tục kiểm tra source code trực tiếp.