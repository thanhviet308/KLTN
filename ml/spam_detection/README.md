# Phát hiện tin nhắn spam/lừa đảo

Module này huấn luyện và so sánh 5 mô hình phân loại văn bản trên dữ liệu CSV:

1. Complement Naive Bayes
2. Logistic Regression
3. Linear SVM
4. SGD Classifier
5. Random Forest

## Cấu trúc

- `data/full_dataset.csv`: dữ liệu đầu vào (`message`, `label`)
- `src/train.py`: chia Train/Validation/Test, huấn luyện và đánh giá
- `src/predict.py`: dự đoán tin nhắn mới bằng mô hình tốt nhất
- `artifacts/`: mô hình và metadata sau huấn luyện
- `reports/`: bảng kết quả và biểu đồ

## Huấn luyện

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe src\train.py
```

Dữ liệu được chia có phân tầng theo nhãn với tỷ lệ 70% Train, 15% Validation và 15% Test. Mô hình được chọn theo F1-score trên Validation, sau đó huấn luyện lại bằng Train + Validation và đánh giá đúng một lần trên Test.

## Dự đoán

```powershell
.\.venv\Scripts\python.exe src\predict.py "Chúc mừng bạn nhận thưởng, bấm link để xác nhận"
```

Kết quả trả về JSON gồm nhãn dự đoán, tên nhãn, điểm rủi ro và tên mô hình.

## Dashboard web độc lập

Dashboard chạy riêng tại cổng `8501`, không nằm trong ứng dụng PingPong:

```powershell
.\.venv\Scripts\python.exe serve.py
```

Trình duyệt sẽ tự mở `http://127.0.0.1:8501`. Sau mỗi lần huấn luyện lại bằng `src/train.py`, dữ liệu của dashboard cũng được cập nhật.

## Chạy tích hợp với PingPong

Giữ dịch vụ ML chạy ở terminal riêng:

```powershell
cd D:\KLTN\src\ml\spam_detection
.\.venv\Scripts\python.exe serve.py --no-browser
```

Sau đó chạy API và web như bình thường ở hai terminal khác:

```powershell
cd D:\KLTN\src
npm run dev:api
```

```powershell
cd D:\KLTN\src
npm run dev:web
```

Trong môi trường development, API mặc định gọi `http://127.0.0.1:8501/api/predict`. Có thể đổi địa chỉ bằng biến `SPAM_DETECTION_URL`. Tin nhắn văn bản đáng ngờ sẽ có cảnh báo ở phía người nhận. Nếu dịch vụ ML không khả dụng, tin nhắn vẫn được gửi nhưng không có kết quả phân loại.
