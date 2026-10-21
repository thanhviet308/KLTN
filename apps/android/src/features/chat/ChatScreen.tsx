import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  errorCodes as documentErrorCodes,
  isErrorWithCode as isDocumentError,
  pick as pickDocument,
} from '@react-native-documents/picker';
import Geolocation from '@react-native-community/geolocation';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { launchImageLibrary } from 'react-native-image-picker';
import Sound from 'react-native-nitro-sound';
import { io } from 'socket.io-client';
import * as api from '../../api';
import { Avatar, Centered, InlineNotice } from '../../components/Common';
import { allPages, type Peer } from '../../presence';
import {
  clientMessageId,
  conversationName,
  mergeMessages,
  shortTime,
} from '../../utils';
import { styles } from '../../styles';
import { ConversationInfo } from './ConversationInfo';
import { MessageMedia } from './MessageMedia';

async function requestMicrophonePermission() {
  if (Platform.OS !== 'android') return true;
  return (
    (await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Cho phép ghi âm',
        message: 'PingPong cần micro để gửi tin nhắn thoại.',
        buttonPositive: 'Cho phép',
        buttonNegative: 'Không cho phép',
      },
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}

async function requestLocationPermission() {
  if (Platform.OS !== 'android') return true;
  return (
    (await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Cho phép dùng vị trí',
        message:
          'PingPong cần vị trí hiện tại để chia sẻ trong cuộc trò chuyện.',
        buttonPositive: 'Cho phép',
        buttonNegative: 'Không cho phép',
      },
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}

function currentPosition() {
  return new Promise<{ latitude: number; longitude: number }>(
    (resolve, reject) =>
      Geolocation.getCurrentPosition(
        position => resolve(position.coords),
        reject,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      ),
  );
}

export function Chat({
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
  const [older, setOlder] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [mediaPaths, setMediaPaths] = useState<Record<string, string>>({});
  const [mediaLoading, setMediaLoading] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [playingMessage, setPlayingMessage] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<api.Message>();
  const [editing, setEditing] = useState<api.Message>();
  const [reactionTarget, setReactionTarget] = useState<string>();
  const [reactions, setReactions] = useState<
    Record<string, { emoji: string; count: number; reacted: boolean }[]>
  >({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [members, setMembers] = useState<
    { id: string; user: Peer; role: 'owner' | 'admin' | 'member' }[]
  >([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [title, setTitle] = useState(conversationName(conversation));
  const messagesRef = useRef<api.Message[]>([]);
  const messageList = useRef<FlatList<api.Message>>(null);
  const hasPositionedList = useRef(false);
  const socketRef = useRef<ReturnType<typeof io> | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const typingAt = useRef(0);
  const mediaPathsRef = useRef<Record<string, string>>({});

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
        const page = await api.authenticated<
          api.Page<api.Message> & { highWatermark: string }
        >(
          `/conversations/${conversation.id}/messages?direction=backward&limit=50`,
        );
        accept(page.items);
        setOlder(page.nextCursor);
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

  const loadMembers = useCallback(async () => {
    try {
      setMembers(
        await allPages<{
          id: string;
          user: Peer;
          role: 'owner' | 'admin' | 'member';
        }>(`/conversations/${conversation.id}/members`),
      );
    } catch (next) {
      fail(next);
    }
  }, [conversation.id, fail]);

  async function loadOlderMessages() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.authenticated<api.Page<api.Message>>(
        `/conversations/${conversation.id}/messages?direction=backward&limit=50&cursor=${older}`,
      );
      accept(page.items);
      setOlder(page.nextCursor);
    } catch (next) {
      fail(next);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function loadReactions(messageId: string) {
    try {
      const result = await api.authenticated<{
        messageId: string;
        items: { emoji: string; count: number; reacted: boolean }[];
      }>(`/conversations/${conversation.id}/messages/${messageId}/reactions`);
      setReactions(previous => ({
        ...previous,
        [messageId]: result.items,
      }));
    } catch (next) {
      fail(next);
    }
  }

  function updateTyping(value: boolean) {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (
      socketRef.current?.connected &&
      (!value || Date.now() - typingAt.current > 3000)
    ) {
      socketRef.current.emit(
        'typing:update',
        { conversationId: conversation.id, typing: value },
        () => undefined,
      );
      typingAt.current = Date.now();
    }
    if (value)
      typingTimer.current = setTimeout(() => updateTyping(false), 3500);
  }

  useEffect(() => {
    let stopped = false;
    let refreshingToken = false;
    const socket = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
    });
    socketRef.current = socket;
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
    socket.on(
      'message:reactions',
      (event: { conversationId: string; messageId: string }) => {
        if (event.conversationId === conversation.id)
          void loadReactions(event.messageId);
      },
    );
    socket.on(
      'typing:update',
      (event: {
        conversationId: string;
        userId: string;
        typing: boolean;
        expiresAt: string;
      }) => {
        if (
          event.conversationId === conversation.id &&
          event.userId !== user.id
        )
          setTyping(previous => ({
            ...previous,
            [event.userId]: event.typing ? Date.parse(event.expiresAt) : 0,
          }));
      },
    );
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void sync();
        if (!socket.connected) void connect();
      }
    });
    void sync();
    void loadMembers();
    void connect();
    const typingExpiry = setInterval(() => {
      const now = Date.now();
      setTyping(previous =>
        Object.values(previous).some(expiry => expiry > 0 && expiry <= now)
          ? Object.fromEntries(
              Object.entries(previous).filter(([, expiry]) => expiry > now),
            )
          : previous,
      );
    }, 1000);
    return () => {
      stopped = true;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (socket.connected)
        socket.emit(
          'typing:update',
          { conversationId: conversation.id, typing: false },
          () => undefined,
        );
      clearInterval(typingExpiry);
      subscription.remove();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = undefined;
    };
  }, [accept, conversation.id, fail, loadMembers, sync, user.id]);

  useEffect(
    () => () => {
      Sound.stopRecorder().catch(() => undefined);
      Sound.stopPlayer().catch(() => undefined);
      Sound.removeRecordBackListener();
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      for (const path of Object.values(mediaPathsRef.current))
        ReactNativeBlobUtil.fs
          .unlink(path.replace(/^file:\/\//, ''))
          .catch(() => undefined);
    },
    [],
  );

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
    const text = body.trim();
    if (sending || !text.trim()) return;
    setSending(true);
    setError('');
    try {
      if (editing) {
        const result = await api.authenticated<{ message: api.Message }>(
          `/conversations/${conversation.id}/messages/${editing.id}`,
          { body: text, expectedEditedAt: editing.editedAt ?? null },
          'PATCH',
        );
        accept([result.message]);
        setEditing(undefined);
        setBody('');
        updateTyping(false);
        return;
      }
      const original = replyTo
        ? (messagesRef.current.find(item => item.id === replyTo.id) ?? replyTo)
        : undefined;
      const content = original
        ? `> ${memberName(original.senderId)}: ${messageLabel(original)
            .slice(0, 300)
            .replace(/\n/g, '\n> ')}\n\n${text}`
        : text;
      if (content.length > 10000) {
        setError('Tin nhắn sau khi trích dẫn vượt quá 10.000 ký tự.');
        return;
      }
      const result = await api.authenticated<{ message: api.Message }>(
        `/conversations/${conversation.id}/messages`,
        { clientMessageId: clientMessageId(), type: 'text', body: content },
      );
      accept([result.message]);
      setBody('');
      setReplyTo(undefined);
      updateTyping(false);
    } catch (next) {
      fail(next);
    } finally {
      setSending(false);
    }
  }

  async function sendFile(
    file: api.LocalUpload,
    type: 'image' | 'file' | 'voice',
  ) {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const result = await api.uploadChatFile(
        conversation.id,
        clientMessageId(),
        file,
        type,
      );
      accept([result.message]);
    } catch (next) {
      fail(next);
    } finally {
      setSending(false);
    }
  }

  async function chooseImage() {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      quality: 0.9,
    });
    if (result.didCancel) return;
    if (result.errorCode) throw new Error(result.errorMessage);
    const image = result.assets?.[0];
    if (!image?.uri) throw new Error('Không thể đọc ảnh đã chọn.');
    await sendFile(
      {
        uri: image.uri,
        name: image.fileName ?? `image-${Date.now()}.jpg`,
        mimeType: image.type ?? 'image/jpeg',
      },
      'image',
    );
  }

  async function chooseFile() {
    try {
      const [file] = await pickDocument({ mode: 'import' });
      if (file.size !== null && file.size > 100 * 1024 * 1024) {
        setError('Tệp vượt quá giới hạn 100 MB.');
        return;
      }
      await sendFile(
        {
          uri: file.uri,
          name: file.name ?? `file-${Date.now()}`,
          mimeType: file.type ?? 'application/octet-stream',
        },
        'file',
      );
    } catch (next) {
      if (
        isDocumentError(next) &&
        next.code === documentErrorCodes.OPERATION_CANCELED
      )
        return;
      throw next;
    }
  }

  async function shareLocation() {
    if (!(await requestLocationPermission())) {
      setError('Bạn cần cho phép truy cập vị trí để chia sẻ vị trí hiện tại.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const location = await currentPosition();
      Alert.alert(
        'Chia sẻ vị trí hiện tại?',
        `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
        [
          { text: 'Hủy', style: 'cancel' },
          {
            text: 'Chia sẻ',
            onPress: () =>
              void api
                .authenticated<{ message: api.Message }>(
                  `/conversations/${conversation.id}/messages`,
                  {
                    clientMessageId: clientMessageId(),
                    type: 'location',
                    location,
                  },
                )
                .then(result => accept([result.message]))
                .catch(fail),
          },
        ],
      );
    } catch {
      setError('Không thể lấy vị trí hiện tại. Hãy bật định vị và thử lại.');
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    if (!(await requestMicrophonePermission())) {
      setError('Bạn cần cho phép dùng micro để gửi tin nhắn thoại.');
      return;
    }
    await Sound.stopPlayer().catch(() => undefined);
    Sound.removePlayBackListener();
    Sound.removePlaybackEndListener();
    setPlayingMessage(undefined);
    Sound.addRecordBackListener(event => setRecordingMs(event.currentPosition));
    await Sound.startRecorder();
    setRecordingMs(0);
    setRecording(true);
  }

  async function finishRecording(sendRecording: boolean) {
    if (!recording) return;
    setRecording(false);
    Sound.removeRecordBackListener();
    try {
      const path = await Sound.stopRecorder();
      if (!sendRecording) {
        await ReactNativeBlobUtil.fs
          .unlink(path.replace(/^file:\/\//, ''))
          .catch(() => undefined);
        return;
      }
      if (recordingMs < 500) {
        setError('Tin nhắn thoại quá ngắn. Hãy ghi âm lâu hơn một chút.');
        return;
      }
      await sendFile(
        {
          uri: path,
          name: `voice-${Date.now()}.m4a`,
          mimeType: 'audio/mp4',
        },
        'voice',
      );
    } catch (next) {
      fail(next);
    } finally {
      setRecordingMs(0);
    }
  }

  function showMediaMenu() {
    if (sending || recording) return;
    Alert.alert('Gửi nội dung', undefined, [
      {
        text: 'Ảnh từ thư viện',
        onPress: () => void chooseImage().catch(fail),
      },
      {
        text: 'Tệp đính kèm',
        onPress: () => void chooseFile().catch(fail),
      },
      { text: 'Vị trí hiện tại', onPress: () => void shareLocation() },
      {
        text: 'Tin nhắn thoại',
        onPress: () => void startRecording().catch(fail),
      },
      { text: 'Đóng', style: 'cancel' },
    ]);
  }

  async function downloadMedia(message: api.Message) {
    if (mediaPathsRef.current[message.id] || mediaLoading[message.id]) return;
    setMediaLoading(previous => ({ ...previous, [message.id]: true }));
    try {
      const path = await api.downloadChatFile(
        conversation.id,
        message.id,
        message.content?.fileName,
      );
      mediaPathsRef.current = { ...mediaPathsRef.current, [message.id]: path };
      setMediaPaths(mediaPathsRef.current);
    } catch (next) {
      fail(next);
    } finally {
      setMediaLoading(previous => ({ ...previous, [message.id]: false }));
    }
  }

  async function openMedia(message: api.Message) {
    const path = mediaPathsRef.current[message.id];
    if (!path) {
      await downloadMedia(message);
      return;
    }
    try {
      if (Platform.OS === 'android')
        await ReactNativeBlobUtil.android.actionViewIntent(
          path,
          message.content?.mimeType ?? 'application/octet-stream',
        );
      else await ReactNativeBlobUtil.ios.openDocument(path);
    } catch {
      setError('Thiết bị chưa có ứng dụng phù hợp để mở tệp này.');
    }
  }

  async function playVoice(message: api.Message) {
    const path = mediaPathsRef.current[message.id];
    if (!path) {
      await downloadMedia(message);
      return;
    }
    if (playingMessage === message.id) {
      await Sound.stopPlayer();
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      setPlayingMessage(undefined);
      return;
    }
    await Sound.stopPlayer().catch(() => undefined);
    Sound.removePlayBackListener();
    Sound.removePlaybackEndListener();
    Sound.addPlaybackEndListener(() => {
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      setPlayingMessage(undefined);
    });
    await Sound.startPlayer(path);
    setPlayingMessage(message.id);
  }

  function memberName(id: string) {
    if (id === user.id) return 'Bạn';
    return (
      members.find(member => member.user.id === id)?.user.displayName ??
      conversation.peer?.displayName ??
      'Thành viên'
    );
  }

  function messageLabel(message: api.Message) {
    if (message.deletedAt) return 'Tin nhắn đã được thu hồi';
    if (message.body) return message.body;
    if (message.type === 'location') return '📍 Vị trí được chia sẻ';
    if (message.type === 'voice') return '🎤 Tin nhắn thoại';
    if (message.type === 'image') return '🖼 Ảnh';
    return `📎 ${message.content?.fileName ?? 'Tệp đính kèm'}`;
  }

  function showActions(message: api.Message) {
    if (message.deletedAt) return;
    const mine = message.senderId === user.id;
    Alert.alert('Thao tác tin nhắn', messageLabel(message).slice(0, 120), [
      mine && message.type === 'text'
        ? {
            text: 'Chỉnh sửa',
            onPress: () => {
              setEditing(message);
              setReplyTo(undefined);
              setBody(message.body ?? '');
            },
          }
        : {
            text: 'Trả lời',
            onPress: () => {
              setReplyTo(message);
              setEditing(undefined);
            },
          },
      mine
        ? {
            text: 'Thu hồi',
            style: 'destructive',
            onPress: () =>
              Alert.alert(
                'Thu hồi tin nhắn?',
                'Nội dung sẽ không còn hiển thị với các thành viên.',
                [
                  { text: 'Hủy', style: 'cancel' },
                  {
                    text: 'Thu hồi',
                    style: 'destructive',
                    onPress: () =>
                      void api
                        .authenticated<{ message: api.Message }>(
                          `/conversations/${conversation.id}/messages/${message.id}`,
                          undefined,
                          'DELETE',
                        )
                        .then(result => accept([result.message]))
                        .catch(fail),
                  },
                ],
              ),
          }
        : {
            text: 'Cảm xúc',
            onPress: () => {
              setReactionTarget(message.id);
              void loadReactions(message.id);
            },
          },
      { text: 'Đóng', style: 'cancel' },
    ]);
  }

  async function react(messageId: string, emoji: string) {
    try {
      const existing = reactions[messageId]?.find(item => item.reacted);
      const result = await api.authenticated<{
        messageId: string;
        items: { emoji: string; count: number; reacted: boolean }[];
      }>(
        `/conversations/${conversation.id}/messages/${messageId}/reaction`,
        existing?.emoji === emoji ? undefined : { emoji },
        existing?.emoji === emoji ? 'DELETE' : 'PUT',
      );
      setReactions(previous => ({ ...previous, [messageId]: result.items }));
      setReactionTarget(undefined);
    } catch (next) {
      fail(next);
    }
  }

  if (infoOpen)
    return (
      <ConversationInfo
        conversation={conversation}
        currentTitle={title}
        members={members}
        onClose={() => setInfoOpen(false)}
        onExpired={onExpired}
        onLeave={onBack}
        onMembers={setMembers}
        onTitle={setTitle}
        user={user}
      />
    );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.page}
    >
      <View style={styles.chatHeader}>
        <Pressable
          accessibilityLabel="Quay lại danh sách tin nhắn"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Avatar
          peer={{
            id: conversation.peer?.id ?? conversation.id,
            displayName: title,
            avatarUrl: conversation.peer?.avatarUrl,
          }}
          size={42}
        />
        <View style={styles.chatTitleBox}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {title}
          </Text>
          <View style={styles.connectionRow}>
            <View
              style={[styles.statusDot, connected && styles.statusDotOnline]}
            />
            <Text
              style={[styles.connection, connected && styles.connectionOnline]}
            >
              {connected ? 'Đã kết nối' : 'Đang kết nối lại…'}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="Thông tin cuộc trò chuyện"
          accessibilityRole="button"
          onPress={() => setInfoOpen(true)}
          style={styles.infoButton}
        >
          <Text style={styles.infoButtonText}>i</Text>
        </Pressable>
      </View>
      {!!error && (
        <View style={styles.chatNotice}>
          <InlineNotice message={error} onRetry={() => void sync()} />
        </View>
      )}
      {loading ? (
        <Centered label="Đang tải tin nhắn…" />
      ) : (
        <FlatList
          ref={messageList}
          contentContainerStyle={styles.messageList}
          data={messages}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => item.id}
          ListHeaderComponent={
            older ? (
              <Pressable
                disabled={loadingOlder}
                onPress={() => void loadOlderMessages()}
                style={styles.loadOlder}
              >
                {loadingOlder ? (
                  <ActivityIndicator color="#087f72" size="small" />
                ) : (
                  <Text style={styles.loadOlderText}>Xem tin nhắn cũ</Text>
                )}
              </Pressable>
            ) : undefined
          }
          onContentSizeChange={() => {
            if (!loadingOlder)
              messageList.current?.scrollToEnd({
                animated: hasPositionedList.current,
              });
            hasPositionedList.current = true;
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <View style={styles.emptySymbol}>
                <Text style={styles.emptySymbolText}>P</Text>
              </View>
              <Text style={styles.emptyTitle}>Bắt đầu trò chuyện</Text>
              <Text style={styles.empty}>
                Gửi một lời chào để bắt đầu kết nối.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.senderId === user.id;
            return (
              <View style={[styles.messageRow, mine && styles.messageRowMine]}>
                {!mine && conversation.type === 'group' && (
                  <Text style={styles.messageSender}>
                    {memberName(item.senderId)}
                  </Text>
                )}
                <Pressable
                  accessibilityHint="Nhấn giữ để xem thao tác"
                  accessibilityRole="button"
                  delayLongPress={350}
                  onLongPress={() => showActions(item)}
                  onPress={() => {
                    if (!item.deletedAt) {
                      setReactionTarget(
                        reactionTarget === item.id ? undefined : item.id,
                      );
                      if (reactionTarget !== item.id)
                        void loadReactions(item.id);
                    }
                  }}
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubblePeer,
                  ]}
                >
                  <MessageMedia
                    loading={!!mediaLoading[item.id]}
                    localPath={mediaPaths[item.id]}
                    message={item}
                    mine={mine}
                    onLoad={() => void downloadMedia(item)}
                    onOpen={() => void openMedia(item)}
                    onPlay={() => void playVoice(item).catch(fail)}
                    playing={playingMessage === item.id}
                  />
                  {(item.type === 'text' || !!item.deletedAt) && (
                    <Text
                      style={[
                        styles.messageText,
                        mine && styles.messageTextMine,
                        !!item.deletedAt && styles.deletedMessage,
                      ]}
                    >
                      {messageLabel(item)}
                    </Text>
                  )}
                  <View style={styles.messageTimeRow}>
                    {!!item.editedAt && !item.deletedAt && (
                      <Text
                        style={[
                          styles.editedLabel,
                          mine && styles.bubbleTimeMine,
                        ]}
                      >
                        đã sửa
                      </Text>
                    )}
                    <Text
                      style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}
                    >
                      {shortTime(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
                {!!reactions[item.id]?.length && (
                  <View
                    style={[
                      styles.reactionSummary,
                      mine && styles.reactionSummaryMine,
                    ]}
                  >
                    {reactions[item.id].map(reaction => (
                      <Pressable
                        key={reaction.emoji}
                        onPress={() => void react(item.id, reaction.emoji)}
                        style={[
                          styles.reactionChip,
                          reaction.reacted && styles.reactionChipActive,
                        ]}
                      >
                        <Text style={styles.reactionChipText}>
                          {reaction.emoji} {reaction.count}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {reactionTarget === item.id && (
                  <View
                    style={[
                      styles.reactionPicker,
                      mine && styles.reactionPickerMine,
                    ]}
                  >
                    {['👍', '❤️', '😂', '😮', '😢', '😡'].map(emoji => (
                      <Pressable
                        key={emoji}
                        accessibilityLabel={`Bày tỏ ${emoji}`}
                        onPress={() => void react(item.id, emoji)}
                        style={styles.reactionOption}
                      >
                        <Text style={styles.reactionEmoji}>{emoji}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
      <Text style={styles.typingNote}>
        {Object.entries(typing)
          .filter(([, expiry]) => expiry > Date.now())
          .map(([id]) => memberName(id))
          .join(', ')}
        {Object.values(typing).some(expiry => expiry > Date.now())
          ? ' đang nhập…'
          : ' '}
      </Text>
      {(replyTo || editing) && (
        <View style={styles.composerContext}>
          <View style={styles.composerContextText}>
            <Text style={styles.composerContextTitle}>
              {editing
                ? 'Chỉnh sửa tin nhắn'
                : `Trả lời ${memberName(replyTo!.senderId)}`}
            </Text>
            <Text numberOfLines={1} style={styles.composerContextPreview}>
              {messageLabel(editing ?? replyTo!)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Hủy thao tác"
            onPress={() => {
              setReplyTo(undefined);
              setEditing(undefined);
              setBody('');
            }}
            style={styles.contextClose}
          >
            <Text style={styles.contextCloseText}>×</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.composerShell}>
        {recording ? (
          <View style={styles.recordingBar}>
            <View style={styles.recordingPulse} />
            <View style={styles.recordingTextBox}>
              <Text style={styles.recordingTitle}>Đang ghi âm</Text>
              <Text style={styles.recordingTime}>
                {Math.floor(recordingMs / 60000)
                  .toString()
                  .padStart(2, '0')}
                :
                {Math.floor((recordingMs % 60000) / 1000)
                  .toString()
                  .padStart(2, '0')}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Hủy ghi âm"
              onPress={() => void finishRecording(false)}
              style={styles.recordingCancel}
            >
              <Text style={styles.recordingCancelText}>Hủy</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Dừng và gửi ghi âm"
              onPress={() => void finishRecording(true)}
              style={styles.recordingSend}
            >
              <Text style={styles.recordingSendText}>Gửi</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.composer}>
            {!editing && (
              <Pressable
                accessibilityLabel="Gửi ảnh, tệp, vị trí hoặc ghi âm"
                accessibilityRole="button"
                disabled={sending}
                onPress={showMediaMenu}
                style={styles.attachButton}
              >
                <Text style={styles.attachButtonText}>＋</Text>
              </Pressable>
            )}
            <TextInput
              accessibilityLabel="Nội dung tin nhắn"
              editable={!sending}
              maxLength={10000}
              multiline
              onChangeText={value => {
                setBody(value);
                setError('');
                updateTyping(!!value.trim());
              }}
              onBlur={() => updateTyping(false)}
              placeholder={editing ? 'Sửa tin nhắn…' : 'Viết tin nhắn…'}
              placeholderTextColor="#7c8e98"
              style={styles.composerInput}
              textAlignVertical="center"
              value={body}
            />
            <Pressable
              accessibilityLabel="Gửi tin nhắn"
              accessibilityRole="button"
              accessibilityState={{
                busy: sending,
                disabled: sending || !body.trim(),
              }}
              disabled={sending || !body.trim()}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.sendButton,
                pressed && styles.pressed,
                (sending || !body.trim()) && styles.sendButtonDisabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.sendText}>➤</Text>
              )}
            </Pressable>
          </View>
        )}
        {body.length > 9000 && (
          <Text style={styles.characterCount}>
            {body.length.toLocaleString('vi-VN')}/10.000
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
