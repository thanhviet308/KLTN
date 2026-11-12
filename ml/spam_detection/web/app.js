const percent = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const number = (value) => new Intl.NumberFormat('vi-VN').format(value);

function metricCard(label, value) {
  return `<article class="metric-card"><span>${label}</span><strong>${percent(value)}</strong><div class="progress"><i style="width:${value * 100}%"></i></div></article>`;
}

function render(data) {
  const maxSplit = Math.max(...data.splits.map((item) => item.total));
  const matrix = data.confusion_matrix;
  document.querySelector('#dashboard').innerHTML = `
    <section class="hero">
      <div><span class="eyebrow">PHÁT HIỆN SPAM/LỪA ĐẢO</span><h1>Kết quả khảo sát mô hình ML</h1><p>So sánh 5 thuật toán trên ${number(data.source_rows)} tin nhắn sau khi làm sạch. Mô hình được chọn hoàn toàn bằng ${data.selection_metric}, trước khi đánh giá trên tập Test.</p></div>
      <div class="winner"><span>Mô hình tốt nhất</span><strong>${data.best_model}</strong><small>F1 Validation ${percent(data.models[0].f1)}</small></div>
    </section>
    <section class="metrics" aria-label="Chỉ số mô hình trên tập Test">
      ${metricCard('Accuracy', data.test_metrics.accuracy)}
      ${metricCard('Precision', data.test_metrics.precision)}
      ${metricCard('Recall', data.test_metrics.recall)}
      ${metricCard('F1-score', data.test_metrics.f1)}
      ${metricCard('ROC-AUC', data.test_metrics.roc_auc)}
    </section>
    <section class="main-grid">
      <article class="panel split-panel"><header><div><span class="eyebrow">DỮ LIỆU</span><h2>Train / Validation / Test</h2></div><div class="legend"><span><i class="normal"></i>Bình thường</span><span><i class="spam"></i>Spam</span></div></header>
        <div class="split-chart" role="img" aria-label="Biểu đồ phân chia dữ liệu">
          ${data.splits.map((item) => `<div class="split-column"><div class="bar-area"><div class="stacked-bar" style="height:${(item.total / maxSplit) * 100}%"><i class="normal" style="flex:${item.normal}"></i><i class="spam" style="flex:${item.spam}"></i></div></div><strong>${number(item.total)}</strong><span>${item.name}</span></div>`).join('')}
        </div>
        <div class="table-scroll"><table><thead><tr><th>Tập</th><th>Tổng</th><th>Bình thường</th><th>Spam</th><th>Tỷ lệ spam</th></tr></thead><tbody>${data.splits.map((item) => `<tr><th>${item.name}</th><td>${number(item.total)}</td><td>${number(item.normal)}</td><td>${number(item.spam)}</td><td>${percent(item.spam_rate)}</td></tr>`).join('')}</tbody></table></div>
      </article>
      <article class="panel confusion-panel"><header><div><span class="eyebrow">TẬP TEST</span><h2>Confusion matrix</h2></div></header><div class="matrix" role="img" aria-label="${matrix[0][0]} bình thường đúng, ${matrix[0][1]} cảnh báo nhầm, ${matrix[1][0]} spam bỏ sót, ${matrix[1][1]} spam đúng"><div class="tn"><strong>${matrix[0][0]}</strong><span>Bình thường đúng</span></div><div class="fp"><strong>${matrix[0][1]}</strong><span>Cảnh báo nhầm</span></div><div class="fn"><strong>${matrix[1][0]}</strong><span>Spam bỏ sót</span></div><div class="tp"><strong>${matrix[1][1]}</strong><span>Spam đúng</span></div></div><p>Nhận diện đúng ${number(matrix[0][0] + matrix[1][1])}/${number(matrix.flat().reduce((sum, value) => sum + value, 0))} tin nhắn.</p></article>
    </section>
    <article class="panel model-panel"><header><div><span class="eyebrow">VALIDATION</span><h2>So sánh 5 mô hình</h2></div><span class="subtle">Sắp xếp theo F1-score</span></header>
      <div class="model-bars">${data.models.map((item, index) => `<div class="model-row"><span>${item.model}</span><div class="track"><i class="${index === 0 ? 'best' : ''}" style="width:${item.f1 * 100}%"></i></div><strong>${percent(item.f1)}</strong></div>`).join('')}</div>
      <div class="table-scroll" tabindex="0"><table><thead><tr><th>Mô hình</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th></tr></thead><tbody>${data.models.map((item, index) => `<tr class="${index === 0 ? 'selected' : ''}"><th>${item.model}${index === 0 ? '<b class="badge">Tốt nhất</b>' : ''}</th><td>${percent(item.accuracy)}</td><td>${percent(item.precision)}</td><td>${percent(item.recall)}</td><td><strong>${percent(item.f1)}</strong></td><td>${percent(item.roc_auc)}</td></tr>`).join('')}</tbody></table></div>
    </article>
    <p class="method">Dữ liệu được chia có phân tầng: 70% Train, 15% Validation và 15% Test. ${data.best_model} được huấn luyện lại bằng Train + Validation trước khi đánh giá cuối trên Test.</p>`;
}

fetch('data/dashboard_data.json')
  .then((response) => {
    if (!response.ok) throw new Error('Không tải được dữ liệu dashboard');
    return response.json();
  })
  .then(render)
  .catch((error) => {
    document.querySelector('#dashboard').innerHTML =
      `<div class="error"><strong>Không thể mở dashboard.</strong><span>${error.message}. Hãy chạy lại src/train.py.</span></div>`;
  });
