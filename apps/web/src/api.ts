export interface User {
  id: string;
  email: string;
  displayName: string;
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
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
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
    pendingRefresh = request<Session>('/auth/refresh', {})
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
  if (!token || Date.now() >= expiresAt - 30000) await refresh();
  try {
    return (await request<{ user: User }>('/users/me', undefined, token)).user;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refresh();
    return (await request<{ user: User }>('/users/me', undefined, token)).user;
  }
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
  token = undefined;
  expiresAt = 0;
}

export function errorMessage(error: unknown) {
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
