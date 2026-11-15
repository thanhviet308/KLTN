const EMBEDDED_BROWSER_UA =
  /\b(FBAN|FBAV|FB_IAB|Messenger|Instagram|Zalo|Line|MicroMessenger)\b/i;

export const DEFAULT_MAP_LOCATION = {
  latitude: 10.7769,
  longitude: 106.7009,
};

/**
 * Detects restricted in-app WebViews (such as Messenger) that often suppress or stall
 * browser geolocation permission prompts.
 */
export function isEmbeddedInAppBrowser(userAgent: string): boolean {
  return EMBEDDED_BROWSER_UA.test(userAgent);
}

/**
 * Returns browser geolocation timeout and JS watchdog thresholds.
 * Standard web browsers allow extra watchdog time so users can respond to the permission prompt.
 */
export function getGeolocationAttemptOptions(
  embedded: boolean,
  highAccuracy: boolean,
): {
  timeoutMs: number;
  maximumAgeMs: number;
  watchdogMs: number;
  enableHighAccuracy: boolean;
} {
  const timeoutMs = highAccuracy
    ? embedded
      ? 6500
      : 12000
    : embedded
      ? 6000
      : 10000;
  // Standard browsers wait on user permission before starting native timeout;
  // give ample margin before JS watchdog cancels a pending prompt.
  const watchdogMs = embedded ? timeoutMs + 2000 : timeoutMs + 15000;
  return {
    timeoutMs,
    maximumAgeMs: highAccuracy ? 60000 : 300000,
    watchdogMs,
    enableHighAccuracy: highAccuracy,
  };
}

/**
 * Maps browser geolocation failure states into actionable Vietnamese guidance.
 */
export function formatGeolocationError(options: {
  code?: number;
  embedded: boolean;
  secureContext?: boolean;
  permissionState?: PermissionState;
  policyAllowed?: boolean;
  browserMessage?: string;
}): string {
  if (options.secureContext === false) {
    return 'Chia sẻ vị trí tự động cần HTTPS, nhưng bạn vẫn có thể tự chọn điểm trên bản đồ.';
  }
  if (options.policyAllowed === false) {
    return 'Trang đang bị chính sách nhúng hoặc máy chủ chặn vị trí, nên trình duyệt không hiện yêu cầu cấp quyền. Hãy mở website trực tiếp trong một tab riêng; nếu vẫn lỗi, cần kiểm tra cấu hình quyền vị trí của website.';
  }
  if (options.code === 1) {
    if (
      /system denied|denied by (?:the )?(?:system|os)/i.test(
        options.browserMessage ?? '',
      ) ||
      options.permissionState === 'granted'
    ) {
      return 'Website đã được phép hoặc trình duyệt báo hệ điều hành từ chối vị trí, nên không hiện yêu cầu cấp quyền mới. Trên Windows, vào Cài đặt → Quyền riêng tư & bảo mật → Vị trí, bật Dịch vụ vị trí và cho phép ứng dụng máy tính truy cập vị trí, rồi kiểm tra lại.';
    }
    if (options.permissionState === 'denied' && !options.embedded) {
      return 'Trình duyệt báo quyền vị trí đang bị chặn nên sẽ không hỏi lại khi bấm Thử lại. Bấm biểu tượng bên trái thanh địa chỉ → Quyền của trang web → Vị trí, đổi sang Hỏi hoặc Cho phép rồi tải lại trang. Nếu quyền bị khóa, kiểm tra cài đặt vị trí của trình duyệt hoặc Windows.';
    }
    return options.embedded
      ? 'Trình duyệt trong ứng dụng đang chặn quyền vị trí. Bạn có thể bấm ⋯ → Mở bằng trình duyệt ngoài, hoặc tự chọn điểm trên bản đồ.'
      : 'Trình duyệt hoặc hệ điều hành đang chặn vị trí. Bấm biểu tượng bên trái địa chỉ trang web → Quyền của trang web → Vị trí → Cho phép. Trên Windows, kiểm tra Cài đặt → Quyền riêng tư & bảo mật → Vị trí và bật Dịch vụ vị trí cùng quyền truy cập cho ứng dụng máy tính. Sau đó kiểm tra lại, hoặc chọn trực tiếp trên bản đồ.';
  }
  if (options.permissionState === 'prompt' && !options.embedded) {
    return 'Quyền vị trí vẫn đang chờ bạn quyết định. Trình duyệt có thể thu gọn yêu cầu vào biểu tượng vị trí ở bên phải thanh địa chỉ. Bấm biểu tượng đó để xem yêu cầu, hoặc mở quyền của trang web bằng biểu tượng bên trái địa chỉ.';
  }
  return options.embedded
    ? 'Không nhận được tín hiệu GPS từ trình duyệt trong ứng dụng. Bạn có thể mở bằng trình duyệt ngoài hoặc chọn trực tiếp trên bản đồ.'
    : 'Không lấy được vị trí tự động (máy bàn hoặc thiết bị chưa bật Dịch vụ vị trí). Bạn có thể chọn trực tiếp vị trí trên bản đồ.';
}
