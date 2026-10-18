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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.loginPage}
    >
      <View style={styles.brandMark}>
        <Text style={styles.brandLetter}>P</Text>
      </View>
      <Text style={styles.title}>PingPong</Text>
      <Text style={styles.subtitle}>Đăng nhập để tiếp tục trò chuyện</Text>
      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder="Email"
        style={styles.input}
        value={email}
      />
      <TextInput
        accessibilityLabel="Mật khẩu"
        autoComplete="current-password"
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
        placeholder="Mật khẩu"
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
          busy && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryButtonText}>Đăng nhập</Text>
        )}
      </Pressable>
      <Text style={styles.securityNote}>
        Refresh token được bảo vệ bởi Android Keystore.
      </Text>
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
        <View>
          <Text style={styles.eyebrow}>Xin chào</Text>
          <Text style={styles.headerTitle}>{user.displayName}</Text>
        </View>
        <Pressable onPress={() => void logout()}>
          <Text style={styles.link}>Đăng xuất</Text>
        </Pressable>
      </View>
      <Text style={styles.sectionTitle}>Đoạn chat</Text>
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
            <Text style={styles.empty}>Bạn chưa có cuộc trò chuyện nào.</Text>
          }
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
                  {conversationName(item).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.conversationBody}>
                <View style={styles.rowBetween}>
                  <Text numberOfLines={1} style={styles.conversationName}>
                    {conversationName(item)}
                  </Text>
                  {!!item.unreadCount && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
                <Text numberOfLines={1} style={styles.preview}>
                  {item.lastMessage?.body ?? 'Chưa có tin nhắn'}
                </Text>
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
        <Pressable onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.chatTitleBox}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {conversationName(conversation)}
          </Text>
          <Text
            style={[styles.connection, connected && styles.connectionOnline]}
          >
            {connected ? 'Realtime đã kết nối' : 'Đang đồng bộ…'}
          </Text>
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
            <Text style={styles.empty}>Hãy gửi tin nhắn đầu tiên.</Text>
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
          placeholder="Nhập tin nhắn…"
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
            <Text style={styles.sendText}>Gửi</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f7f8fc' },
  page: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  muted: { color: '#667085', fontSize: 14 },
  loginPage: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  brandMark: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4f46e5',
  },
  brandLetter: { color: 'white', fontWeight: '800', fontSize: 30 },
  title: {
    color: '#101828',
    fontWeight: '800',
    fontSize: 32,
    textAlign: 'center',
  },
  subtitle: { color: '#667085', textAlign: 'center', marginBottom: 14 },
  input: {
    backgroundColor: 'white',
    borderColor: '#d0d5dd',
    borderWidth: 1,
    borderRadius: 14,
    color: '#101828',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  error: {
    color: '#b42318',
    backgroundColor: '#fef3f2',
    padding: 10,
    marginHorizontal: 16,
    borderRadius: 10,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: 'white', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  securityNote: {
    color: '#98a2b3',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: { color: '#667085', fontSize: 12 },
  headerTitle: { color: '#101828', fontWeight: '700', fontSize: 20 },
  link: { color: '#4f46e5', fontWeight: '700' },
  sectionTitle: {
    color: '#101828',
    fontSize: 24,
    fontWeight: '800',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  empty: { color: '#667085', textAlign: 'center', padding: 28 },
  conversation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
    backgroundColor: 'white',
    borderBottomColor: '#eaecf0',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#4338ca', fontWeight: '800', fontSize: 18 },
  conversationBody: { flex: 1, gap: 4 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  conversationName: {
    color: '#101828',
    fontWeight: '700',
    fontSize: 16,
    flex: 1,
  },
  preview: { color: '#667085', fontSize: 14 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontWeight: '700', fontSize: 12 },
  chatHeader: {
    minHeight: 66,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: '#eaecf0',
    borderBottomWidth: 1,
    backgroundColor: 'white',
  },
  back: { color: '#4f46e5', fontSize: 38, width: 38, lineHeight: 40 },
  chatTitleBox: { flex: 1 },
  connection: { color: '#b54708', fontSize: 12 },
  connectionOnline: { color: '#027a48' },
  messageList: { padding: 14, flexGrow: 1, justifyContent: 'flex-end' },
  messageRow: { alignItems: 'flex-start', marginVertical: 4 },
  messageRowMine: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubblePeer: { backgroundColor: 'white', borderBottomLeftRadius: 5 },
  bubbleMine: { backgroundColor: '#4f46e5', borderBottomRightRadius: 5 },
  messageText: { color: '#101828', fontSize: 16, lineHeight: 22 },
  messageTextMine: { color: 'white' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopColor: '#eaecf0',
    borderTopWidth: 1,
    backgroundColor: 'white',
  },
  composerInput: {
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: '#f2f4f7',
    color: '#101828',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendButton: {
    minWidth: 58,
    height: 44,
    borderRadius: 15,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: 'white', fontWeight: '800' },
});

export default App;
