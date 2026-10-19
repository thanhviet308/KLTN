import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import * as api from './src/api';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<api.User>();
  const [conversation, setConversation] = useState<api.Conversation>();
  const expire = useCallback(() => {
    setConversation(undefined);
    setUser(undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void api
      .restore()
      .then(session => {
        if (active) setUser(session?.user);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <View
      style={[
        styles.app,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {booting ? (
        <Centered label="Đang khôi phục phiên…" />
      ) : !user ? (
        <Login onLogin={setUser} />
      ) : conversation ? (
        <Chat
          conversation={conversation}
          user={user}
          onBack={() => setConversation(undefined)}
          onExpired={expire}
        />
      ) : (
        <ConversationList
          user={user}
          onOpen={setConversation}
          onExpired={expire}
        />
      )}
    </View>
  );
}

function Centered({ label }: { label: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color="#4f46e5" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

function Login({ onLogin }: { onLogin: (user: api.User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      onLogin((await api.login(email.trim(), password)).user);
    } catch (next) {
      setError(api.errorMessage(next));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.loginPage}
    >
      <View style={styles.loginGlowLarge} />
      <View style={styles.loginGlowSmall} />
      <View style={styles.loginContent}>
        <View style={styles.brandMark}>
          <View style={styles.brandDotBack} />
          <View style={styles.brandDotFront} />
        </View>
        <Text style={styles.title}>PingPong</Text>
        <Text style={styles.subtitle}>Nhắn tin gần nhau hơn, mỗi ngày.</Text>
        <View style={styles.loginCard}>
          <View style={styles.loginHeadingRow}>
            <View>
              <Text style={styles.loginHeading}>Chào mừng trở lại</Text>
              <Text style={styles.loginCaption}>
                Đăng nhập để tiếp tục trò chuyện
              </Text>
            </View>
            <View style={styles.securePill}>
              <Text style={styles.securePillText}>BẢO MẬT</Text>
            </View>
          </View>
          <Text style={styles.fieldLabel}>EMAIL</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="ban@example.com"
            placeholderTextColor="#98a2b3"
            returnKeyType="next"
            style={styles.input}
            value={email}
          />
          <Text style={styles.fieldLabel}>MẬT KHẨU</Text>
          <TextInput
            accessibilityLabel="Mật khẩu"
            autoComplete="current-password"
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder="Nhập mật khẩu"
            placeholderTextColor="#98a2b3"
            returnKeyType="done"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !email.trim() || !password}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              (busy || !email.trim() || !password) && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryButtonText}>Đăng nhập →</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.securityNote}>
          Phiên đăng nhập được bảo vệ bởi Android Keystore
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function ConversationList({
  user,
  onOpen,
  onExpired,
}: {
  user: api.User;
  onOpen: (conversation: api.Conversation) => void;
  onExpired: () => void;
}) {
  const [items, setItems] = useState<api.Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const page = await api.authenticated<api.Page<api.Conversation>>(
          '/conversations?limit=50',
        );
        setItems(page.items);
        setError('');
      } catch (next) {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
        else setError(api.errorMessage(next));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onExpired],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      // Local credentials are cleared even when the server is unreachable.
    } finally {
      onExpired();
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {initials(user.displayName)}
            </Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>CHÀO BUỔI TỐT LÀNH</Text>
            <Text style={styles.profileName}>{user.displayName}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => void logout()}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>↗</Text>
        </Pressable>
      </View>
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={styles.sectionTitle}>Tin nhắn</Text>
          <Text style={styles.sectionCaption}>
            {items.length
              ? `${items.length} cuộc trò chuyện`
              : 'Luôn giữ kết nối'}
          </Text>
        </View>
        <View style={styles.onlinePill}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlinePillText}>Đang hoạt động</Text>
        </View>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <Centered label="Đang tải hội thoại…" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>✦</Text>
              <Text style={styles.emptyTitle}>Chưa có tin nhắn</Text>
              <Text style={styles.empty}>
                Cuộc trò chuyện mới sẽ xuất hiện tại đây.
              </Text>
            </View>
          }
          contentContainerStyle={styles.conversationList}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onOpen(item)}
              style={({ pressed }) => [
                styles.conversation,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {initials(conversationName(item))}
                </Text>
              </View>
              <View style={styles.conversationBody}>
                <View style={styles.rowBetween}>
                  <Text numberOfLines={1} style={styles.conversationName}>
                    {conversationName(item)}
                  </Text>
                  <Text style={styles.messageTime}>
                    {item.lastMessage
                      ? shortTime(item.lastMessage.createdAt)
                      : ''}
                  </Text>
                </View>
                <View style={styles.rowBetween}>
                  <Text numberOfLines={1} style={styles.preview}>
                    {item.lastMessage?.body ?? 'Bắt đầu trò chuyện ngay'}
                  </Text>
                  {!!item.unreadCount && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function conversationName(item: api.Conversation) {
  return item.type === 'direct'
    ? (item.peer?.displayName ?? 'Trò chuyện')
    : (item.title ?? 'Nhóm');
}

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function mergeMessages(current: api.Message[], incoming: api.Message[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    BigInt(left.sequence) < BigInt(right.sequence)
      ? -1
      : BigInt(left.sequence) > BigInt(right.sequence)
        ? 1
        : 0,
  );
}

function clientMessageId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    return (token === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function Chat({
  conversation,
  user,
  onBack,
  onExpired,
}: {
  conversation: api.Conversation;
  user: api.User;
  onBack: () => void;
  onExpired: () => void;
}) {
  const [messages, setMessages] = useState<api.Message[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const messagesRef = useRef<api.Message[]>([]);

  const accept = useCallback((incoming: api.Message[]) => {
    messagesRef.current = mergeMessages(messagesRef.current, incoming);
    setMessages(messagesRef.current);
  }, []);
  const fail = useCallback(
    (next: unknown) => {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    },
    [onExpired],
  );
  const sync = useCallback(async () => {
    try {
      const latest = messagesRef.current.at(-1)?.sequence;
      if (!latest) {
        const page = await api.authenticated<api.Page<api.Message>>(
          `/conversations/${conversation.id}/messages?direction=backward&limit=50`,
        );
        accept(page.items);
      } else {
        let cursor: string | null = latest;
        do {
          const page: api.Page<api.Message> = await api.authenticated(
            `/conversations/${conversation.id}/messages?direction=forward&limit=50&cursor=${cursor}`,
          );
          accept(page.items);
          cursor = page.nextCursor;
        } while (cursor);
      }
      setError('');
    } catch (next) {
      fail(next);
    } finally {
      setLoading(false);
    }
  }, [accept, conversation.id, fail]);

  useEffect(() => {
    let stopped = false;
    let refreshingToken = false;
    const socket = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
    });
    async function connect() {
      try {
        const token = await api.accessToken();
        if (!stopped) {
          socket.auth = { accessToken: token };
          socket.connect();
        }
      } catch (next) {
        fail(next);
      }
    }
    socket.on('connect', () => {
      socket
        .timeout(10000)
        .emit(
          'conversation:subscribe',
          { conversationId: conversation.id },
          (problem: Error | null, result?: { ok: boolean }) => {
            if (stopped) return;
            if (problem || !result?.ok) {
              setConnected(false);
              setError('Không thể đăng ký nhận tin realtime.');
              return;
            }
            setConnected(true);
            void sync();
          },
        );
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on(
      'connect_error',
      async (problem: Error & { data?: { code?: string } }) => {
        setConnected(false);
        const code = problem.data?.code ?? problem.message;
        const authenticationFailed = [
          'AUTH_REQUIRED',
          'INVALID_ACCESS_TOKEN',
          'SESSION_EXPIRED',
        ].includes(code);
        if (!authenticationFailed) {
          setError(
            'Không thể kết nối realtime; ứng dụng sẽ tiếp tục đồng bộ qua API.',
          );
          return;
        }
        if (refreshingToken || stopped) return;
        refreshingToken = true;
        try {
          await api.refresh();
          const token = await api.accessToken();
          if (!stopped) {
            socket.auth = { accessToken: token };
            socket.connect();
          }
        } catch (next) {
          fail(next);
        } finally {
          refreshingToken = false;
        }
      },
    );
    socket.on('message:created', (message: api.Message) => {
      if (message.conversationId === conversation.id) accept([message]);
    });
    for (const event of ['message:updated', 'message:deleted'])
      socket.on(event, (message: api.Message) => {
        if (message.conversationId === conversation.id) accept([message]);
      });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void sync();
        if (!socket.connected) void connect();
      }
    });
    void sync();
    void connect();
    return () => {
      stopped = true;
      subscription.remove();
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [accept, conversation.id, fail, sync]);

  useEffect(() => {
    const newest = messages.at(-1);
    if (!newest || newest.senderId === user.id || newest.deletedAt) return;
    void api
      .authenticated(`/conversations/${conversation.id}/messages/read`, {
        messageId: newest.id,
      })
      .catch(fail);
  }, [conversation.id, fail, messages, user.id]);

  async function send() {
    const text = body;
    if (sending || !text.trim()) return;
    setSending(true);
    setError('');
    try {
      const result = await api.authenticated<{ message: api.Message }>(
        `/conversations/${conversation.id}/messages`,
        { clientMessageId: clientMessageId(), type: 'text', body: text },
      );
      accept([result.message]);
      setBody('');
    } catch (next) {
      fail(next);
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <View style={styles.chatHeader}>
        <Pressable hitSlop={10} onPress={onBack} style={styles.backButton}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.chatAvatar}>
          <Text style={styles.chatAvatarText}>
            {initials(conversationName(conversation))}
          </Text>
        </View>
        <View style={styles.chatTitleBox}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {conversationName(conversation)}
          </Text>
          <View style={styles.connectionRow}>
            <View
              style={[styles.statusDot, connected && styles.statusDotOnline]}
            />
            <Text
              style={[styles.connection, connected && styles.connectionOnline]}
            >
              {connected ? 'Đang hoạt động' : 'Đang đồng bộ…'}
            </Text>
          </View>
        </View>
        <View style={styles.chatAction}>
          <Text style={styles.chatActionText}>•••</Text>
        </View>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <Centered label="Đang tải tin nhắn…" />
      ) : (
        <FlatList
          contentContainerStyle={styles.messageList}
          data={messages}
          keyExtractor={item => item.id}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyIcon}>👋</Text>
              <Text style={styles.emptyTitle}>Bắt đầu trò chuyện</Text>
              <Text style={styles.empty}>
                Hãy gửi một lời chào thật dễ thương.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.senderId === user.id;
            return (
              <View style={[styles.messageRow, mine && styles.messageRowMine]}>
                <View
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubblePeer,
                  ]}
                >
                  <Text
                    style={[styles.messageText, mine && styles.messageTextMine]}
                  >
                    {item.deletedAt ? 'Tin nhắn đã được thu hồi' : item.body}
                  </Text>
                  <Text
                    style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}
                  >
                    {shortTime(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Nội dung tin nhắn"
          multiline
          onChangeText={setBody}
          placeholder="Viết tin nhắn…"
          placeholderTextColor="#98a2b3"
          style={styles.composerInput}
          value={body}
        />
        <Pressable
          disabled={sending || !body.trim()}
          onPress={() => void send()}
          style={[
            styles.sendButton,
            (sending || !body.trim()) && styles.disabled,
          ]}
        >
          {sending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.sendText}>➤</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f5f7fb' },
  page: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  muted: { color: '#718096', fontSize: 14 },
  loginPage: {
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#eef2ff',
  },
  loginGlowLarge: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: '#dbe5ff',
    top: -190,
    right: -120,
  },
  loginGlowSmall: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: '#e1dcff',
    bottom: -140,
    left: -100,
  },
  loginContent: { paddingHorizontal: 24 },
  brandMark: {
    alignSelf: 'center',
    width: 68,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  brandDotBack: {
    position: 'absolute',
    left: 4,
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: '#5b5df0',
  },
  brandDotFront: {
    position: 'absolute',
    right: 4,
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: '#22c4c9',
    borderWidth: 5,
    borderColor: '#eef2ff',
  },
  title: {
    color: '#17203a',
    fontWeight: '900',
    fontSize: 35,
    letterSpacing: -1,
    textAlign: 'center',
  },
  subtitle: {
    color: '#667085',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 22,
  },
  loginCard: {
    backgroundColor: 'white',
    borderRadius: 28,
    padding: 22,
    gap: 10,
    shadowColor: '#344054',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  loginHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  loginHeading: { color: '#17203a', fontSize: 20, fontWeight: '800' },
  loginCaption: { color: '#718096', fontSize: 13, marginTop: 3 },
  securePill: {
    backgroundColor: '#e8fbf8',
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  securePillText: { color: '#16877f', fontSize: 9, fontWeight: '900' },
  fieldLabel: {
    color: '#667085',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 4,
    marginLeft: 3,
  },
  input: {
    backgroundColor: '#f8f9fc',
    borderColor: '#e1e6ef',
    borderWidth: 1,
    borderRadius: 16,
    color: '#17203a',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  error: {
    color: '#b42318',
    backgroundColor: '#fef3f2',
    padding: 11,
    marginHorizontal: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#5557e8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: 'white', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  securityNote: {
    color: '#7b849b',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#17203a',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileAvatar: {
    width: 45,
    height: 45,
    borderRadius: 16,
    backgroundColor: '#5557e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: { color: 'white', fontSize: 15, fontWeight: '900' },
  eyebrow: {
    color: '#aeb8d0',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  profileName: { color: 'white', fontWeight: '800', fontSize: 18 },
  headerTitle: { color: '#17203a', fontWeight: '800', fontSize: 18 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#26314f',
  },
  iconButtonText: { color: '#dce3f5', fontSize: 20, fontWeight: '700' },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: {
    color: '#17203a',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  sectionCaption: { color: '#8490a8', fontSize: 12, marginTop: 2 },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e8fbf8',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 99,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#17a398',
  },
  onlinePillText: { color: '#16877f', fontSize: 10, fontWeight: '800' },
  conversationList: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  emptyCard: {
    marginTop: 44,
    alignItems: 'center',
    padding: 30,
    backgroundColor: 'white',
    borderRadius: 24,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: { fontSize: 28, marginBottom: 9 },
  emptyTitle: { color: '#17203a', fontSize: 17, fontWeight: '800' },
  empty: { color: '#8490a8', textAlign: 'center', paddingTop: 5 },
  conversation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'white',
    borderRadius: 20,
    marginBottom: 9,
    shadowColor: '#344054',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 19,
    backgroundColor: '#e9eaff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#4f51d9', fontWeight: '900', fontSize: 17 },
  conversationBody: { flex: 1, gap: 4 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  conversationName: {
    color: '#17203a',
    fontWeight: '800',
    fontSize: 15,
    flex: 1,
  },
  messageTime: { color: '#a1aabc', fontSize: 10, marginLeft: 8 },
  preview: { color: '#7b849b', fontSize: 13, flex: 1, marginRight: 8 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#5557e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontWeight: '800', fontSize: 10 },
  chatHeader: {
    minHeight: 72,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    shadowColor: '#344054',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
  },
  backButton: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { color: '#4f51d9', fontSize: 38, lineHeight: 39 },
  chatAvatar: {
    width: 43,
    height: 43,
    borderRadius: 16,
    backgroundColor: '#e9eaff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  chatAvatarText: { color: '#4f51d9', fontSize: 14, fontWeight: '900' },
  chatTitleBox: { flex: 1 },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  statusDotOnline: { backgroundColor: '#17a398' },
  connection: { color: '#ad6800', fontSize: 11 },
  connectionOnline: { color: '#16877f' },
  chatAction: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#f2f4f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatActionText: { color: '#667085', fontWeight: '900', letterSpacing: 1 },
  messageList: { padding: 16, flexGrow: 1, justifyContent: 'flex-end' },
  messageRow: { alignItems: 'flex-start', marginVertical: 5 },
  messageRowMine: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 7,
  },
  bubblePeer: {
    backgroundColor: 'white',
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: '#e8ebf2',
  },
  bubbleMine: { backgroundColor: '#5557e8', borderBottomRightRadius: 6 },
  messageText: { color: '#17203a', fontSize: 15, lineHeight: 21 },
  messageTextMine: { color: 'white' },
  bubbleTime: {
    color: '#98a2b3',
    fontSize: 9,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  bubbleTimeMine: { color: '#d6d7ff' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: 'white',
  },
  composerInput: {
    flex: 1,
    maxHeight: 110,
    minHeight: 48,
    borderRadius: 19,
    backgroundColor: '#f2f4f8',
    color: '#17203a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: '#5557e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: 'white', fontSize: 19, fontWeight: '900' },
});

export default App;
