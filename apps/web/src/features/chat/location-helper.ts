const EMBEDDED_BROWSER_UA =
  /\b(FBAN|FBAV|FB_IAB|Messenger|Instagram|Zalo|Line|MicroMessenger)\b/i;

/**
 * Detects restricted in-app WebViews (such as Messenger) that often suppress or stall
 * browser geolocation permission prompts.
 */
export function isEmbeddedInAppBrowser(userAgent: string): boolean {
  return EMBEDDED_BROWSER_UA.test(userAgent);
}

/**
 * Maps browser geolocation failure states into actionable Vietnamese guidance.
 */
export function formatGeolocationError(options: {
  code?: number;
  embedded: boolean;
  secureContext?: boolean;
}): string {
  if (options.secureContext === false) {
    return 'Chia sẻ vị trí yêu cầu kết nối bảo mật HTTPS.';
  }
  if (options.code === 1) {
    return options.embedded
      ? 'Trình duyệt trong ứng dụng đang chặn quyền vị trí. Hãy bấm ⋯ ở góc trên và chọn Mở bằng trình duyệt ngoài (Chrome/Safari), rồi thử lại.'
      : 'Hãy cho phép trình duyệt truy cập vị trí trong cài đặt trang web rồi bấm Thử lại.';
  }
  return options.embedded
    ? 'Trình duyệt trong ứng dụng không nhận được tín hiệu vị trí. Hãy bật GPS hoặc bấm ⋯ ở góc trên → Mở bằng trình duyệt ngoài (Chrome/Safari) rồi thử lại.'
    : 'Chưa lấy được vị trí. Hãy bật Dịch vụ vị trí (GPS) trên thiết bị rồi bấm Thử lại.';
}
