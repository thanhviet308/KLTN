export function extractMediaErrorInfo(failure: unknown): {
  name: string;
  message: string;
} {
  if (!failure || typeof failure !== 'object') {
    return { name: '', message: '' };
  }
  const record = failure as { name?: unknown; message?: unknown };
  return {
    name: typeof record.name === 'string' ? record.name : '',
    message: typeof record.message === 'string' ? record.message : '',
  };
}

export function isOverconstrainedMediaError(failure: unknown): boolean {
  const { name, message } = extractMediaErrorInfo(failure);
  const combined = `${name} ${message}`.toLowerCase();
  return (
    name === 'OverconstrainedError' ||
    name === 'ConstraintNotSatisfiedError' ||
    combined.includes('overconstrained')
  );
}

export function formatCallMediaError({
  failure,
  missingDevices = [],
  callType,
  mediaSupported,
  secureContext,
  userAgent,
  embedded = false,
}: {
  failure?: unknown;
  missingDevices?: ('microphone' | 'camera')[];
  callType: 'audio' | 'video';
  mediaSupported: boolean;
  secureContext: boolean;
  userAgent: string;
  embedded?: boolean;
}): string {
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const { name, message } = extractMediaErrorInfo(failure);
  const detail = `${name} ${message}`.toLowerCase();

  if (!mediaSupported) {
    if (!secureContext) {
      return 'Trình duyệt yêu cầu kết nối HTTPS để bật micro và camera.';
    }
    if (embedded || isIos) {
      return 'Trình duyệt trong ứng dụng này chưa hỗ trợ mở micro/camera. Hãy mở website trực tiếp bằng Safari (iPhone) hoặc Chrome rồi thử lại.';
    }
    return 'Trình duyệt hiện tại chưa hỗ trợ truy cập micro hoặc camera.';
  }

  let cause = '';
  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    detail.includes('notallowed') ||
    detail.includes('permission') ||
    detail.includes('denied')
  ) {
    if (embedded) {
      cause =
        'Trình duyệt trong ứng dụng đang chặn quyền micro/camera. Hãy bấm ⋯ → Mở bằng Safari hoặc Chrome rồi cấp quyền.';
    } else if (isIos) {
      cause =
        'iPhone/Safari đang chặn micro hoặc camera. Chạm biểu tượng trang web trên thanh địa chỉ → Cho phép Micro & Camera (hoặc kiểm tra Cài đặt → Safari).';
    } else if (isAndroid) {
      cause =
        'Trình duyệt chưa được cấp quyền dùng micro/camera. Chạm biểu tượng khóa bên trái thanh địa chỉ → Quyền → Cho phép Micro & Camera.';
    } else {
      cause =
        'Trình duyệt chưa được cấp quyền dùng micro hoặc camera. Kiểm tra biểu tượng cài đặt bên trái thanh địa chỉ.';
    }
  } else if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    detail.includes('not found') ||
    detail.includes('notfound')
  ) {
    cause =
      callType === 'video'
        ? 'Không tìm thấy micro hoặc camera phù hợp trên thiết bị.'
        : 'Không tìm thấy micro phù hợp trên thiết bị.';
  } else if (
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    detail.includes('notreadable') ||
    detail.includes('could not start') ||
    detail.includes('in use')
  ) {
    cause =
      'Micro hoặc camera đang được ứng dụng hoặc tab khác sử dụng. Hãy tắt ứng dụng đó rồi bật lại.';
  } else if (isOverconstrainedMediaError(failure)) {
    cause = 'Thiết bị không hỗ trợ cấu hình camera mặc định.';
  }

  if (missingDevices.length) {
    const label = missingDevices
      .map((item) => (item === 'microphone' ? 'microphone' : 'camera'))
      .join(' và ');
    const base = `Đã vào cuộc gọi nhưng không mở được ${label}.`;
    return cause
      ? `${base} ${cause}`
      : `${base} Bạn vẫn có thể xem và nghe người kia.`;
  }

  return (
    cause ||
    'Không thể bật microphone hoặc camera. Vui lòng kiểm tra quyền thiết bị và thử lại.'
  );
}
