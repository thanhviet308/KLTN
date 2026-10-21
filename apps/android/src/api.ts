import * as Keychain from 'react-native-keychain';
import ReactNativeBlobUtil from 'react-native-blob-util';

export const API_ORIGIN = 'https://pingpongapi.id.vn';

const API = `${API_ORIGIN}/api/v1`;
const KEYCHAIN_SERVICE = 'com.pingpong.android.refresh-token';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: string;
  status?: string;
  createdAt?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  unreadCount: number;
  lastMessageSequence: string;
  membership: {
    role: 'owner' | 'admin' | 'member';
    lastReadSequence: string | null;
  };
  peer: { id: string; displayName: string; avatarUrl?: string | null } | null;
  lastMessage: {
    id: string;
    senderId: string;
    senderName: string;
    sequence: string;
    body: string | null;
    createdAt: string;
    deletedAt: string | null;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  sequence: string;
  type: 'text' | 'image' | 'file' | 'voice' | 'location';
  body: string | null;
  content?: {
    attachmentId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    latitude?: number;
    longitude?: number;
  } | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

let access: string | undefined;
let expiresAt = 0;
let currentUser: User | undefined;
let pendingRefresh: Promise<Session> | undefined;

async function storedRefreshToken() {
  const credentials = await Keychain.getGenericPassword({
    service: KEYCHAIN_SERVICE,
  });
  return credentials ? credentials.password : undefined;
}

async function storeRefreshToken(refreshToken: string) {
  await Keychain.setGenericPassword('refresh', refreshToken, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function clearLocalSession() {
  access = undefined;
  expiresAt = 0;
  currentUser = undefined;
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
}

function remember(session: Session) {
  access = session.accessToken;
  expiresAt = Date.now() + session.expiresIn * 1000;
  currentUser = session.user;
  return session;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  bearer?: string,
): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      signal: abort.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Auth-Client': 'android',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new ApiError(response.status, body.code ?? 'UNKNOWN');
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

export function requestRegistrationCode(email: string) {
  return request<{ challengeId: string; resendAfterSeconds: number }>(
    '/auth/register/request-code',
    {
      method: 'POST',
      body: JSON.stringify({ email }),
    },
  );
}

export function verifyRegistrationCode(challengeId: string, code: string) {
  return request<{ verificationToken: string }>('/auth/register/verify-code', {
    method: 'POST',
    body: JSON.stringify({ challengeId, code }),
  });
}

export function register(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName: string;
  verificationToken: string;
}) {
  return request<{ user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

async function acceptSession(session: Session) {
  try {
    await storeRefreshToken(session.refreshToken);
  } catch {
    await request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
    throw new ApiError(0, 'SECURE_STORAGE_FAILED');
  }
  return remember(session);
}

export async function login(email: string, password: string) {
  const session = await request<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, deviceName: 'PingPong Android' }),
  });
  return acceptSession(session);
}

export function refresh() {
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const refreshToken = await storedRefreshToken();
      if (!refreshToken) throw new ApiError(401, 'SESSION_REQUIRED');
      try {
        const session = await request<Session>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
        return await acceptSession(session);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          await clearLocalSession();
        throw error;
      }
    })().finally(() => {
      pendingRefresh = undefined;
    });
  }
  return pendingRefresh;
}

export async function restore() {
  try {
    return await refresh();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return undefined;
    throw error;
  }
}

export async function accessToken() {
  if (!access || Date.now() >= expiresAt - 30000) await refresh();
  return access!;
}

export async function authenticated<T>(
  path: string,
  body?: unknown,
  method?: string,
) {
  const attempted = await accessToken();
  try {
    return await request<T>(
      path,
      {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      attempted,
    );
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (access === attempted) await refresh();
    return request<T>(
      path,
      {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      access,
    );
  }
}

export async function me() {
  const result = await authenticated<{ user: User }>('/users/me');
  currentUser = result.user;
  return result.user;
}

export function rememberUser(user: User) {
  currentUser = user;
}

export function avatarUrl(path?: string | null) {
  return path ? `${API_ORIGIN}/api/v1${path}` : undefined;
}

export interface LocalUpload {
  uri: string;
  name: string;
  mimeType: string;
}

function queryString(values: Record<string, string>) {
  return Object.entries(values)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

async function uploadAttempt<T>(
  path: string,
  bearer: string,
  file: LocalUpload,
) {
  const response = await ReactNativeBlobUtil.config({ timeout: 60000 }).fetch(
    'POST',
    `${API}${path}`,
    {
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
      'Content-Type': file.mimeType || 'application/octet-stream',
      'X-Auth-Client': 'android',
    },
    ReactNativeBlobUtil.wrap(file.uri),
  );
  const status = response.info().status;
  if (status < 200 || status >= 300) {
    const problem = await Promise.resolve(response.json()).catch(() => ({}));
    throw new ApiError(status, problem?.code ?? 'UNKNOWN');
  }
  return (await Promise.resolve(response.json())) as T;
}

export async function uploadChatFile(
  conversationId: string,
  id: string,
  file: LocalUpload,
  type: 'image' | 'file' | 'voice',
) {
  const query = queryString({
    clientMessageId: id,
    fileName: file.name,
    type,
    mimeType: file.mimeType || 'application/octet-stream',
  });
  const path = `/conversations/${conversationId}/messages/upload?${query}`;
  const attempted = await accessToken();
  try {
    return await uploadAttempt<{ message: Message }>(path, attempted, file);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (access === attempted) await refresh();
    return uploadAttempt<{ message: Message }>(path, access!, file);
  }
}

async function downloadAttempt(
  path: string,
  bearer: string,
  extension?: string,
) {
  const response = await ReactNativeBlobUtil.config({
    fileCache: true,
    ...(extension ? { appendExt: extension.replace(/^\./, '') } : {}),
    timeout: 60000,
  }).fetch('GET', `${API}${path}`, {
    Authorization: `Bearer ${bearer}`,
    'X-Auth-Client': 'android',
  });
  const status = response.info().status;
  if (status < 200 || status >= 300) {
    const problem = await Promise.resolve(response.json()).catch(() => ({}));
    throw new ApiError(status, problem?.code ?? 'UNKNOWN');
  }
  return response.path();
}

export async function downloadChatFile(
  conversationId: string,
  messageId: string,
  fileName?: string,
) {
  const path = `/conversations/${conversationId}/messages/${messageId}/file`;
  const extension = fileName?.match(/\.([a-z0-9]{1,10})$/i)?.[1];
  const attempted = await accessToken();
  try {
    return await downloadAttempt(path, attempted, extension);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (access === attempted) await refresh();
    return downloadAttempt(path, access!, extension);
  }
}

export async function logout() {
  const refreshToken = await storedRefreshToken();
  try {
    if (refreshToken)
      await request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
  } finally {
    await clearLocalSession();
  }
}

export function user() {
  return currentUser;
}

export function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'Có lỗi xảy ra. Vui lòng thử lại.';
  if (error.code === 'NETWORK_ERROR')
    return 'Không thể kết nối máy chủ. Kiểm tra mạng và thử lại.';
  if (error.code === 'SECURE_STORAGE_FAILED')
    return 'Không thể lưu phiên an toàn trên thiết bị.';
  const messages: Record<string, string> = {
    EMAIL_ALREADY_EXISTS: 'Email này đã được sử dụng.',
    EMAIL_VERIFICATION_REQUIRED: 'Email cần được xác minh trước khi đăng ký.',
    INVALID_VERIFICATION_CODE: 'Mã xác minh chưa đúng hoặc đã hết hạn.',
    FRIEND_REQUEST_ALREADY_EXISTS: 'Lời mời kết bạn đã tồn tại.',
    FRIENDSHIP_ALREADY_EXISTS: 'Hai bạn đã là bạn bè.',
    FRIENDSHIP_REQUIRED: 'Bạn cần kết bạn trước khi nhắn tin.',
    MESSAGE_EDIT_CONFLICT: 'Tin nhắn đã thay đổi. Hãy tải lại và thử lại.',
    MESSAGE_SEND_FORBIDDEN: 'Hiện không thể gửi tin nhắn vào cuộc trò chuyện.',
  };
  if (messages[error.code]) return messages[error.code];
  if (error.status === 401)
    return 'Phiên hoặc thông tin đăng nhập không hợp lệ.';
  if (error.status === 429)
    return 'Bạn thao tác quá nhanh. Vui lòng chờ một lát.';
  if (error.status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại.';
  return 'Yêu cầu chưa hợp lệ. Vui lòng kiểm tra lại.';
}
