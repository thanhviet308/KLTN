import { BACKEND_ORIGIN } from './config';
import { clearHistoryCache } from './chat-history-cache';

// Local development uses Vite's proxy so HttpOnly session cookies stay same-site.
export const API_ORIGIN = import.meta.env.DEV ? '' : BACKEND_ORIGIN;

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role: string;
  status: string;
  createdAt: string;
}

interface Session {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

let token: string | undefined;
let expiresAt = 0;
let pendingRefresh: Promise<Session> | undefined;
let sessionGeneration = 0;
let sessionUserId: string | undefined;
let nextRequestAt = 0;
let requestTimer: ReturnType<typeof setTimeout> | undefined;
const requestQueue: {
  priority: number;
  run: () => void;
}[] = [];

// Pace starts across JSON, receipts, reactions and files together. Foreground
// actions can pass queued background work, so sending never waits behind history.
function drainRequests() {
  if (requestTimer || !requestQueue.length) return;
  const delay = Math.max(0, nextRequestAt - Date.now());
  requestTimer = setTimeout(() => {
    requestTimer = undefined;
    const priority = Math.min(...requestQueue.map((item) => item.priority));
    const index = requestQueue.findIndex((item) => item.priority === priority);
    const [item] = requestQueue.splice(index, 1);
    nextRequestAt = Date.now() + 250;
    item.run();
    drainRequests();
  }, delay);
}
function scheduledRequest(path: string, run: () => Promise<Response>) {
  const generation = sessionGeneration;
  return new Promise<Response>((resolve, reject) => {
    requestQueue.push({
      priority: /\/(?:reactions|receipts|read|delivered)(?:\?|$)/.test(path)
        ? 2
        : /\/messages\?|\/file$/.test(path)
          ? 1
          : 0,
      run: () => {
        if (generation !== sessionGeneration) {
          reject(new ApiError(0, 'SESSION_CHANGED'));
          return;
        }
        run().then((response) => {
          if (response.status === 429) {
            const seconds = Number(response.headers.get('Retry-After'));
            const retryAt = Date.parse(
              response.headers.get('Retry-After') ?? '',
            );
            const delay =
              Number.isFinite(seconds) && seconds > 0
                ? seconds * 1000
                : Number.isFinite(retryAt)
                  ? retryAt - Date.now()
                  : 5000;
            nextRequestAt = Math.max(
              nextRequestAt,
              Date.now() + Math.max(1000, delay),
            );
            if (requestTimer) clearTimeout(requestTimer);
            requestTimer = undefined;
            drainRequests();
          }
          resolve(response);
        }, reject);
      },
    });
    drainRequests();
  });
}

const fileCache = new Map<string, Blob>();
const pendingFiles = new Map<string, Promise<Blob>>();
let fileCacheBytes = 0;
const FILE_CACHE_LIMIT = 50 * 1024 * 1024;

async function request<T>(
  path: string,
  body?: unknown,
  bearer?: string,
  method?: string,
  timeoutMs = 15000,
): Promise<T> {
  let response: Response;
  try {
    response = await scheduledRequest(path, () =>
      fetch(`${API_ORIGIN}/api/v1${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Client': 'web',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      error.code ?? (response.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN'),
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function remember(session: Session) {
  if (sessionUserId && sessionUserId !== session.user.id) clearSession();
  sessionUserId = session.user.id;
  token = session.accessToken;
  expiresAt = Date.now() + session.expiresIn * 1000;
  return session;
}

export function refresh() {
  if (!pendingRefresh) {
    // HttpOnly cookies are shared by tabs. Serialize rotations until Set-Cookie
    // has been applied, so another tab never submits the consumed refresh token.
    const rotate = () => request<Session>('/auth/refresh', {});
    const coordinatedRotation = async () => {
      return typeof navigator !== 'undefined' && navigator.locks
        ? await navigator.locks.request('pingpong-session-refresh', rotate)
        : await rotate();
    };
    pendingRefresh = coordinatedRotation()
      .then(remember)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) clearSession();
        throw error;
      })
      .finally(() => {
        pendingRefresh = undefined;
      });
  }
  return pendingRefresh;
}

export async function me(): Promise<User> {
  return (await authenticated<{ user: User }>('/users/me')).user;
}
export async function accessToken() {
  if (!token || Date.now() >= expiresAt - 30000) await refresh();
  return token!;
}

export async function authenticated<T>(
  path: string,
  body?: unknown,
  method?: string,
  timeoutMs = 15000,
): Promise<T> {
  if (!token || Date.now() >= expiresAt - 30000) await refresh();
  const attemptedToken = token;
  try {
    return await request<T>(path, body, attemptedToken, method, timeoutMs);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    // A parallel request may already have renewed the token while this one
    // was in flight. Retry with that token instead of rotating again.
    if (token === attemptedToken) await refresh();
    return request<T>(path, body, token, method, timeoutMs);
  }
}

async function binaryRequest(path: string, file?: Blob): Promise<Response> {
  const attempt = (bearer: string) =>
    scheduledRequest(path, () =>
      fetch(`${API_ORIGIN}/api/v1${path}`, {
        method: file ? 'POST' : 'GET',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-Auth-Client': 'web',
          ...(file ? { 'Content-Type': 'application/octet-stream' } : {}),
        },
        body: file,
        signal: AbortSignal.timeout(60000),
      }),
    );
  try {
    const attemptedToken = await accessToken();
    let response: Response;
    let transientRetryUsed = false;
    try {
      response = await attempt(attemptedToken);
    } catch {
      // Uploads are idempotent by clientMessageId. A local development proxy
      // can briefly retain a stale upstream socket after a reload/restart.
      await new Promise((resolve) => setTimeout(resolve, 250));
      transientRetryUsed = true;
      response = await attempt(await accessToken());
    }
    if (response.status === 401) {
      if (token === attemptedToken) await refresh();
      response = await attempt(await accessToken());
    }
    if (response.status >= 500 && !transientRetryUsed) {
      // Retry one transient server/proxy failure automatically. The upload URL
      // retains the same clientMessageId, preventing a duplicate message when
      // the first request reached the API but its response was interrupted.
      await new Promise((resolve) => setTimeout(resolve, 250));
      response = await attempt(await accessToken());
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        error.code ?? (response.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN'),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'NETWORK_ERROR');
  }
}

export async function uploadChatFile<T>(
  conversationId: string,
  clientMessageId: string,
  file: File,
  type: 'image' | 'file' | 'voice',
) {
  const query = new URLSearchParams({
    clientMessageId,
    fileName: file.name,
    type,
    mimeType: file.type || 'application/octet-stream',
  });
  return (
    await binaryRequest(
      `/conversations/${conversationId}/messages/upload?${query}`,
      file,
    )
  ).json() as Promise<T>;
}

export async function chatFile(conversationId: string, messageId: string) {
  const key = `${conversationId}:${messageId}`;
  const cached = fileCache.get(key);
  if (cached) {
    fileCache.delete(key);
    fileCache.set(key, cached);
    return cached;
  }
  const pending = pendingFiles.get(key);
  if (pending) return pending;
  const generation = sessionGeneration;
  const request = binaryRequest(
    `/conversations/${conversationId}/messages/${messageId}/file`,
  )
    .then((response) => response.blob())
    .then((blob) => {
      if (generation !== sessionGeneration)
        throw new ApiError(0, 'SESSION_CHANGED');
      if (blob.size <= FILE_CACHE_LIMIT) {
        while (
          fileCacheBytes + blob.size > FILE_CACHE_LIMIT &&
          fileCache.size
        ) {
          const oldest = fileCache.keys().next().value!;
          fileCacheBytes -= fileCache.get(oldest)!.size;
          fileCache.delete(oldest);
        }
        fileCache.set(key, blob);
        fileCacheBytes += blob.size;
      }
      return blob;
    })
    .finally(() => {
      if (pendingFiles.get(key) === request) pendingFiles.delete(key);
    });
  pendingFiles.set(key, request);
  return request;
}

export const register = (body: {
  email: string;
  password: string;
  displayName: string;
  confirmPassword: string;
  verificationToken: string;
}) => request('/auth/register', body);
export const requestRegistrationCode = (email: string) =>
  request<{
    challengeId: string;
    expiresAt: string;
    resendAfterSeconds: number;
  }>('/auth/register/request-code', { email });
export const verifyRegistrationCode = (challengeId: string, code: string) =>
  request<{ verificationToken: string; expiresAt: string }>(
    '/auth/register/verify-code',
    { challengeId, code },
  );

export const requestPasswordReset = (email: string) =>
  request<{
    challengeId: string;
    expiresAt: string;
    resendAfterSeconds: number;
  }>('/auth/password-reset/request-code', { email });

export const resetPassword = (input: {
  challengeId: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}) => request<void>('/auth/password-reset/confirm', input);
export const login = async (email: string, password: string) =>
  remember(
    await request<Session>('/auth/login', {
      email,
      password,
      deviceName: 'Trình duyệt web',
    }),
  );
export async function logout() {
  try {
    await request('/auth/logout', {});
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  clearSession();
}
export function clearSession() {
  sessionGeneration++;
  sessionUserId = undefined;
  fileCache.clear();
  pendingFiles.clear();
  fileCacheBytes = 0;
  clearHistoryCache();
  token = undefined;
  expiresAt = 0;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      FILE_TOO_LARGE: 'Tệp vượt quá giới hạn 10 MB.',
      EMPTY_FILE: 'Không thể gửi tệp rỗng.',
      INVALID_IMAGE:
        'Ảnh không hợp lệ. Chọn ảnh PNG, JPEG hoặc WebP tĩnh, tối đa 16 triệu pixel.',
      INVALID_AUDIO: 'Bản ghi âm không hợp lệ hoặc định dạng chưa được hỗ trợ.',
      INVALID_LOCATION: 'Vị trí chưa hợp lệ. Hãy lấy lại vị trí và gửi lại.',
      UPLOAD_BUSY: 'Máy chủ đang xử lý tệp khác. Hãy thử gửi lại sau vài giây.',
      UPLOAD_TIMEOUT: 'Tải tệp quá lâu. Kiểm tra kết nối và gửi lại.',
      STORAGE_QUOTA_EXCEEDED: 'Tài khoản đã đạt giới hạn lưu trữ tệp 512 MB.',
      ATTACHMENT_NOT_FOUND:
        'Tệp không còn khả dụng hoặc bạn không có quyền tải.',
      AVATAR_INVALID: 'Chọn ảnh PNG, JPEG hoặc WebP tĩnh, tối đa 512 KB.',
      CURRENT_PASSWORD_INVALID: 'Mật khẩu hiện tại chưa đúng.',
      EMAIL_ALREADY_REGISTERED:
        'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng Quên mật khẩu.',
      AI_NOT_CONFIGURED: 'Trợ lý AI hiện chưa sẵn sàng. Vui lòng thử lại sau.',
      AI_SOURCE_UNAVAILABLE:
        'Một số tin đã bị thu hồi hoặc không còn quyền truy cập. Hãy chọn lại nội dung.',
      AI_SOURCE_CHANGED:
        'Tin nguồn đã thay đổi. Hãy kiểm tra và tạo lại kết quả.',
      AI_INPUT_INVALID: 'Hãy chọn lại tin nhắn và các tùy chọn AI.',
      AI_INPUT_EMPTY: 'Chưa có nội dung văn bản để xử lý.',
      AI_INPUT_TOO_LARGE: 'Nội dung quá dài. Hãy chọn ít tin nhắn hơn.',
      AI_BUSY: 'AI đang xử lý yêu cầu khác. Vui lòng thử lại sau.',
      AI_QUOTA_EXCEEDED:
        'Bạn đã dùng hết 20 lượt AI trong giờ này. Vui lòng thử lại sau.',
      AI_PROVIDER_LIMIT:
        'Dịch vụ AI đang đạt giới hạn sử dụng. Vui lòng thử lại sau.',
      AI_UNAVAILABLE: 'Chưa thể kết nối dịch vụ AI. Vui lòng thử lại sau.',
      AI_TIMEOUT: 'AI xử lý quá lâu. Hãy thử lại với ít tin nhắn hơn.',
      AI_INVALID_OUTPUT: 'AI trả kết quả chưa hợp lệ. Vui lòng thử lại.',
      AI_INCOMPLETE:
        'AI chưa hoàn tất kết quả. Hãy chọn ít nội dung hơn và thử lại.',
      AI_REFUSED:
        'AI không thể xử lý nội dung này. Hãy thử chọn nội dung khác.',
      PASSWORD_UNCHANGED: 'Mật khẩu mới cần khác mật khẩu hiện tại.',
      PASSWORD_STATE_CONFLICT: 'Tài khoản vừa thay đổi. Vui lòng thử lại.',
      MESSAGE_SEND_FORBIDDEN:
        'Bạn không còn quyền gửi tin nhắn trong cuộc trò chuyện này.',
      MESSAGE_IDEMPOTENCY_CONFLICT:
        'Nội dung gửi lại không khớp với tin nhắn ban đầu.',
      MESSAGE_NOT_FOUND:
        'Tin nhắn không còn tồn tại hoặc bạn không có quyền xem.',
      MESSAGE_SEQUENCE_EXHAUSTED:
        'Cuộc trò chuyện đã đạt giới hạn lưu tin nhắn.',
      FRIENDSHIP_REQUIRED:
        'Bạn cần kết bạn với người này trước khi tạo hội thoại hoặc mời vào nhóm.',
      MESSAGING_PERMISSION_REQUIRED:
        'Hai người cần kết bạn hoặc chấp nhận tin nhắn chờ trước khi trò chuyện.',
      SELF_MESSAGE_REQUEST: 'Bạn không thể gửi tin nhắn chờ cho chính mình.',
      MESSAGE_REQUEST_PENDING: 'Bạn đã gửi một tin nhắn chờ cho người này.',
      MESSAGE_REQUEST_RECEIVED:
        'Người này đã gửi tin nhắn chờ cho bạn. Hãy mở mục Tin nhắn chờ để phản hồi.',
      MESSAGE_REQUEST_ACCEPTED: 'Hai người đã có thể nhắn tin với nhau.',
      MESSAGE_REQUEST_NOT_FOUND: 'Tin nhắn chờ không còn tồn tại.',
      MESSAGE_REQUEST_STATE_CONFLICT: 'Tin nhắn chờ đã được xử lý.',
      MESSAGE_REQUEST_FORBIDDEN: 'Bạn không có quyền xử lý tin nhắn chờ này.',
      CONVERSATION_NOT_FOUND:
        'Hội thoại không còn tồn tại hoặc bạn không còn quyền truy cập.',
      CONVERSATION_FORBIDDEN:
        'Quyền của bạn trong nhóm đã thay đổi. Hãy tải lại hội thoại.',
      DIRECT_CONVERSATION_IMMUTABLE:
        'Không thể thay đổi thành viên hoặc tên của trò chuyện riêng.',
      CONVERSATION_INPUT_INVALID:
        'Thông tin hội thoại chưa hợp lệ. Kiểm tra tên nhóm và thành viên.',
      IDEMPOTENCY_CONFLICT:
        'Yêu cầu tạo nhóm đã thay đổi. Hãy kiểm tra thông tin và tạo lại.',
      GROUP_MEMBER_LIMIT: 'Nhóm đã đủ giới hạn 50 thành viên.',
      OWNER_TRANSFER_REQUIRED: 'Hãy chuyển quyền chủ nhóm trước khi rời nhóm.',
      CALL_ALREADY_OPEN:
        'Hội thoại đang có một cuộc gọi khác. Hãy tiếp tục hoặc kết thúc cuộc gọi đó.',
      SELF_CONVERSATION: 'Bạn không thể tạo trò chuyện riêng với chính mình.',
      ALREADY_FRIENDS: 'Hai bạn đã là bạn bè.',
      INCOMING_REQUEST_EXISTS:
        'Người này đã gửi lời mời cho bạn. Hãy mở mục Lời mời để phản hồi.',
      USER_UNAVAILABLE: 'Người dùng này hiện không khả dụng.',
      FRIEND_REQUEST_NOT_FOUND:
        'Lời mời không còn tồn tại. Hãy tải lại danh sách.',
      FRIEND_REQUEST_STATE_CONFLICT:
        'Lời mời đã được xử lý. Hãy tải lại danh sách.',
      FRIENDSHIP_STATE_CONFLICT:
        'Quan hệ bạn bè đã thay đổi. Hãy tải lại danh sách.',
      FRIEND_REQUEST_FORBIDDEN:
        'Bạn không thể thực hiện thao tác này với lời mời.',
    };
    if (messages[error.code]) return messages[error.code];
    if (error.code === 'AUTH_BUSY')
      return 'Máy chủ đang bận xử lý đăng nhập. Vui lòng thử lại sau vài giây.';
  }
  if (!(error instanceof ApiError)) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  if (error.code === 'MAIL_NOT_CONFIGURED')
    return 'Chức năng gửi email chưa được cấu hình. Vui lòng thử lại sau.';
  if (error.code === 'MAIL_DELIVERY_FAILED')
    return 'Chưa gửi được email. Vui lòng chờ một phút rồi thử lại.';
  if (error.code === 'INVALID_VERIFICATION_CODE')
    return 'Mã không đúng, đã hết hạn hoặc đã dùng. Kiểm tra lại hoặc yêu cầu mã mới.';
  if (error.code === 'INVALID_PASSWORD_RESET_CODE')
    return 'Mã đặt lại mật khẩu không đúng, đã hết hạn hoặc đã dùng. Kiểm tra lại hoặc gửi mã mới.';
  if (error.code === 'EMAIL_VERIFICATION_REQUIRED')
    return 'Xác minh email đã hết hạn. Vui lòng bắt đầu lại.';
  if (error.code === 'PASSWORD_CONFIRMATION_MISMATCH')
    return 'Hai mật khẩu chưa khớp nhau.';
  if (error.status === 0)
    return 'Không thể kết nối máy chủ. Kiểm tra kết nối và thử lại.';
  if (error.status === 429)
    return 'Bạn đã thử quá nhiều lần. Vui lòng chờ một lát rồi thử lại.';
  if (error.status >= 500)
    return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.';
  if (error.status === 409)
    return 'Email này đã được sử dụng. Hãy đăng nhập hoặc dùng email khác.';
  if (error.status === 401) return 'Email hoặc mật khẩu không đúng.';
  if (error.status === 403)
    return 'Không thể truy cập tài khoản. Vui lòng liên hệ người quản trị.';
  return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.';
}
