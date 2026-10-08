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

async function request<T>(
  path: string,
  body?: unknown,
  bearer?: string,
  method?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Client': 'web',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.code ?? 'UNKNOWN');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function remember(session: Session) {
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
): Promise<T> {
  if (!token || Date.now() >= expiresAt - 30000) await refresh();
  const attemptedToken = token;
  try {
    return await request<T>(path, body, attemptedToken, method);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    // A parallel request may already have renewed the token while this one
    // was in flight. Retry with that token instead of rotating again.
    if (token === attemptedToken) await refresh();
    return request<T>(path, body, token, method);
  }
}

async function binaryRequest(path: string, file?: Blob): Promise<Response> {
  const attempt = (bearer: string) =>
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
    });
  try {
    const attemptedToken = await accessToken();
    let response = await attempt(attemptedToken);
    if (response.status === 401) {
      if (token === attemptedToken) await refresh();
      response = await attempt(await accessToken());
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.code ?? 'UNKNOWN');
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
  return (
    await binaryRequest(
      `/conversations/${conversationId}/messages/${messageId}/file`,
    )
  ).blob();
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
  if (error.status === 401)
    return 'Email hoặc mật khẩu chưa đúng, hoặc phiên đã hết hạn.';
  if (error.status === 403)
    return 'Không thể truy cập tài khoản. Vui lòng liên hệ người quản trị.';
  return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.';
}
