import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import { acquireChatSocket } from '../../realtime';
import { Avatar, Centered, InlineNotice } from '../../components/Common';
import { NavIcon, UiGlyph } from '../../components/Icons';
import {
  allPages,
  presenceBadge,
  presenceLabel,
  type PersonRow,
  type Peer,
  type Presence,
} from '../../presence';
import {
  clientMessageId,
  conversationName,
  shortTime,
  threadPreviewText,
  unwrapReplyPreviewBody,
} from '../../utils';
import { styles } from '../../styles';

type MessageRequestRow = {
  id: string;
  user: Peer;
  body?: string;
  createdAt?: string;
  direction?: 'incoming' | 'outgoing';
};

type SearchMessageHit = Pick<
  api.Message,
  'id' | 'conversationId' | 'senderId' | 'body' | 'createdAt' | 'sequence'
>;

export interface FriendNote {
  user: Peer;
  body: string;
  musicTitle: string | null;
  musicArtist: string | null;
  musicUrl: string | null;
  musicPreviewUrl: string | null;
  updatedAt: string;
  expiresAt: string;
}

interface MusicCatalogTrack {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string | null;
  trackUrl: string | null;
}

const DEFAULT_TRENDING_TRACKS: MusicCatalogTrack[] = [
  {
    id: '1723659102',
    title: 'Ahhhhhh',
    artist: 'The Milkers',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1860957407',
    title: 'Anh Vẫn Ở Đây',
    artist: 'Quang Đăng Trần, Viam',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1638255334',
    title: 'Waiting For You',
    artist: 'MONO, Onionn',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1728886495',
    title: 'Không Thể Say',
    artist: 'HIEUTHUHAI',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1712281414',
    title: 'Từng Quen',
    artist: 'Wren Evans, itsnk',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1819021990',
    title: 'nếu lúc đó',
    artist: 'tlinh, 2pillz',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1637038497',
    title: 'Có Em',
    artist: 'Madihu, Low G.',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
  {
    id: '1492254775',
    title: 'Lạ Lùng',
    artist: 'Vũ.',
    artworkUrl: null,
    previewUrl: null,
    trackUrl: null,
  },
];

export function ConversationList({
  active = true,
  user,
  onOpen,
  onPreload,
  onExpired,
  onUnreadCount,
  presence,
}: {
  active?: boolean;
  user?: api.User;
  onOpen: (conversation: api.Conversation, messageId?: string) => void;
  onPreload: (conversation: api.Conversation) => void;
  onExpired: () => void;
  onUnreadCount?: (count: number) => void;
  presence: Record<string, Presence>;
}) {
  const currentUser = user ??
    api.user() ?? {
      id: 'me',
      email: '',
      displayName: 'Bạn',
    };
  const [items, setItems] = useState<api.Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [friends, setFriends] = useState<Peer[]>([]);
  const [notes, setNotes] = useState<FriendNote[]>([]);
  const [requests, setRequests] = useState<MessageRequestRow[]>([]);
  const [requestBusyId, setRequestBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchedMessages, setSearchedMessages] = useState<SearchMessageHit[]>(
    [],
  );
  const [searchedUsers, setSearchedUsers] = useState<Peer[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [category, setCategory] = useState<
    'all' | 'unread' | 'group' | 'requests'
  >('all');
  const [composing, setComposing] = useState(false);
  const [conversationType, setConversationType] = useState<'direct' | 'group'>(
    'direct',
  );
  const [friendFilter, setFriendFilter] = useState('');
  const [composeOtherUsers, setComposeOtherUsers] = useState<Peer[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // 24h Note Composer state
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [noteMusicTitle, setNoteMusicTitle] = useState('');
  const [noteMusicArtist, setNoteMusicArtist] = useState('');
  const [notePickingMusic, setNotePickingMusic] = useState(false);
  const [noteMusicQuery, setNoteMusicQuery] = useState('');
  const [noteTracks, setNoteTracks] = useState<MusicCatalogTrack[]>(
    DEFAULT_TRENDING_TRACKS,
  );
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');

  const load = useCallback(
    async (mode: boolean | 'silent' = false) => {
      if (mode === true) setRefreshing(true);
      else if (mode === false) setLoading(true);
      try {
        const [page, friendRows, reqPage, notesRes] = await Promise.all([
          api.authenticated<api.Page<api.Conversation>>(
            '/conversations?limit=30',
          ),
          allPages<PersonRow>('/friends').catch(() => [] as PersonRow[]),
          api
            .authenticated<api.Page<MessageRequestRow>>(
              '/message-requests?direction=all&limit=30',
            )
            .catch(
              () =>
                ({
                  items: [],
                  nextCursor: null,
                }) as api.Page<MessageRequestRow>,
            ),
          api
            .authenticated<{ items: FriendNote[] }>('/notes')
            .catch(() => ({ items: [] as FriendNote[] })),
        ]);
        const sorted = [...page.items].sort((a, b) => {
          const ta = Date.parse(
            a.updatedAt ?? a.lastMessage?.createdAt ?? a.createdAt ?? '',
          );
          const tb = Date.parse(
            b.updatedAt ?? b.lastMessage?.createdAt ?? b.createdAt ?? '',
          );
          return (
            (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
          );
        });
        setItems(sorted);
        setNextCursor(page.nextCursor);
        onUnreadCount?.(
          sorted
            .filter(
              item =>
                !(
                  item.messageRequest?.direction === 'incoming' &&
                  item.messageRequest.status === 'pending'
                ),
            )
            .reduce((sum, item) => sum + (item.unreadCount || 0), 0),
        );
        setFriends(friendRows.map(row => row.user));
        setRequests(reqPage.items);
        setNotes(notesRes.items ?? []);
        setError('');
      } catch (next) {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
        else setError(api.errorMessage(next));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onExpired, onUnreadCount],
  );

  const hasLoadedRef = React.useRef(false);
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void load(false);
      return;
    }
    if (active) {
      void load('silent');
    }
  }, [active, load]);

  useEffect(() => {
    if (!active || !composing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setComposing(false);
      return true;
    });
    return () => sub.remove();
  }, [active, composing]);

  const activeRef = React.useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const socket = acquireChatSocket(onExpired);
    const offCreated = socket.on('message:created', (message: api.Message) => {
      let found = false;
      setItems(prev => {
        const idx = prev.findIndex(item => item.id === message.conversationId);
        if (idx < 0) return prev;
        found = true;
        const target = prev[idx]!;
        const isIncoming = message.senderId !== currentUser.id;
        const updated: api.Conversation = {
          ...target,
          lastMessageSequence: message.sequence,
          updatedAt: message.createdAt,
          unreadCount:
            isIncoming && activeRef.current
              ? (target.unreadCount || 0) + 1
              : target.unreadCount,
          lastMessage: {
            id: message.id,
            senderId: message.senderId,
            sequence: message.sequence,
            type: message.type,
            body: message.body,
            content: message.content,
            createdAt: message.createdAt,
            deletedAt: message.deletedAt,
          },
        };
        const next = [updated, ...prev.filter((_, i) => i !== idx)];
        onUnreadCount?.(
          next
            .filter(
              item =>
                !(
                  item.messageRequest?.direction === 'incoming' &&
                  item.messageRequest.status === 'pending'
                ),
            )
            .reduce((sum, item) => sum + (item.unreadCount || 0), 0),
        );
        return next;
      });
      if (!found) {
        void load('silent');
      }
    });
    const offCleared = socket.on('conversation:history-cleared', () => {
      void load('silent');
    });
    const offFriends = socket.on('friends:updated', () => {
      void load('silent');
    });
    return () => {
      offCreated();
      offCleared();
      offFriends();
      socket.release();
    };
  }, [currentUser.id, load, onExpired, onUnreadCount]);

  useEffect(() => {
    if (!active || !items.length) return;
    for (const item of items.slice(0, 3)) onPreload(item);
    const nextBatch = items.slice(3, 6);
    if (!nextBatch.length) return;
    const timer = setTimeout(() => {
      for (const item of nextBatch) onPreload(item);
    }, 300);
    return () => clearTimeout(timer);
  }, [active, items, onPreload]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.authenticated<api.Page<api.Conversation>>(
        `/conversations?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems(prev => [
        ...prev,
        ...page.items.filter(item => !prev.some(old => old.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setSearchedMessages([]);
      setSearchedUsers([]);
      setSearchingMessages(false);
      return;
    }
    let cancelled = false;
    setSearchingMessages(true);
    const timer = setTimeout(() => {
      const msgPromise = api
        .authenticated<{ items: SearchMessageHit[] }>(
          `/messages/search?query=${encodeURIComponent(term)}&limit=10`,
        )
        .then(res => {
          if (!cancelled) setSearchedMessages(res.items);
        })
        .catch(() => {
          if (!cancelled) setSearchedMessages([]);
        });
      const userPromise =
        term.length >= 2
          ? api
              .authenticated<{ items: (PersonRow | Peer)[] }>(
                `/users?query=${encodeURIComponent(term)}&limit=8`,
              )
              .then(res => {
                if (!cancelled) {
                  setSearchedUsers(
                    res.items.map(item => ('user' in item ? item.user : item)),
                  );
                }
              })
              .catch(() => {
                if (!cancelled) setSearchedUsers([]);
              })
          : Promise.resolve();
      void Promise.all([msgPromise, userPromise]).finally(() => {
        if (!cancelled) setSearchingMessages(false);
      });
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const term = friendFilter.trim();
    if (!composing || conversationType !== 'direct' || term.length < 2) {
      setComposeOtherUsers([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .authenticated<{ items: (PersonRow | Peer)[] }>(
          `/users?query=${encodeURIComponent(term)}&limit=8`,
        )
        .then(res => {
          if (cancelled) return;
          const mapped = res.items
            .map(item => ('user' in item ? item.user : item))
            .filter(
              u => u.id !== currentUser.id && !friends.some(f => f.id === u.id),
            );
          setComposeOtherUsers(mapped);
        })
        .catch(() => {
          if (!cancelled) setComposeOtherUsers([]);
        });
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [composing, conversationType, friendFilter, friends, currentUser.id]);

  useEffect(() => {
    if (!notePickingMusic) return;
    const q = noteMusicQuery.trim();
    if (!q) {
      setNoteTracks(DEFAULT_TRENDING_TRACKS);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .authenticated<{ items: MusicCatalogTrack[] }>(
          `/notes/music/search?q=${encodeURIComponent(q)}`,
        )
        .then(res => {
          if (!cancelled && res.items.length > 0) {
            setNoteTracks(res.items);
          }
        })
        .catch(() => {
          if (!cancelled) {
            const lower = q.toLowerCase();
            setNoteTracks(
              DEFAULT_TRENDING_TRACKS.filter(
                t =>
                  t.title.toLowerCase().includes(lower) ||
                  t.artist.toLowerCase().includes(lower),
              ),
            );
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [notePickingMusic, noteMusicQuery]);

  const normalizedQuery = query.trim().toLocaleLowerCase('vi');

  const visibleItems = items.filter(item => {
    const isIncomingPending =
      item.messageRequest?.direction === 'incoming' &&
      item.messageRequest.status === 'pending';
    if (category === 'requests') return isIncomingPending;
    if (isIncomingPending) return false;
    const matchesQuery =
      !normalizedQuery ||
      conversationName(item)
        .toLocaleLowerCase('vi')
        .includes(normalizedQuery) ||
      (unwrapReplyPreviewBody(item.lastMessage?.body) ?? '')
        .toLocaleLowerCase('vi')
        .includes(normalizedQuery);
    const matchesCategory =
      category === 'all' ||
      (category === 'unread' && item.unreadCount > 0) ||
      (category === 'group' && item.type === 'group');
    return matchesQuery && matchesCategory;
  });

  const matchingFriends = normalizedQuery
    ? friends.filter(
        friend =>
          friend.displayName
            .toLocaleLowerCase('vi')
            .includes(normalizedQuery) &&
          !visibleItems.some(
            conv => conv.type === 'direct' && conv.peer?.id === friend.id,
          ),
      )
    : [];

  const matchingNonFriends = normalizedQuery
    ? searchedUsers.filter(
        u =>
          u.id !== currentUser.id &&
          !friends.some(f => f.id === u.id) &&
          !visibleItems.some(
            conv => conv.type === 'direct' && conv.peer?.id === u.id,
          ),
      )
    : [];

  const visibleRequests = requests.filter(
    req =>
      req.direction !== 'outgoing' &&
      (!normalizedQuery ||
        req.user.displayName
          .toLocaleLowerCase('vi')
          .includes(normalizedQuery) ||
        (req.body ?? '').toLocaleLowerCase('vi').includes(normalizedQuery)),
  );

  const incomingRequestsCount =
    items.filter(
      item =>
        item.messageRequest?.direction === 'incoming' &&
        item.messageRequest.status === 'pending',
    ).length || requests.filter(req => req.direction !== 'outgoing').length;

  // Sort active friends strip: friends with notes first, then online, then most recent lastActiveAt
  const myNote = notes.find(n => n.user.id === currentUser.id);
  const friendNotes = notes.filter(n => n.user.id !== currentUser.id);
  const remainingFriends = friends
    .filter(peer => !friendNotes.some(n => n.user.id === peer.id))
    .sort((a, b) => {
      const aOnline = presence[a.id]?.online ? 1 : 0;
      const bOnline = presence[b.id]?.online ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      const aLast = presence[a.id]?.lastActiveAt
        ? Date.parse(presence[a.id].lastActiveAt ?? '')
        : 0;
      const bLast = presence[b.id]?.lastActiveAt
        ? Date.parse(presence[b.id].lastActiveAt ?? '')
        : 0;
      if (aLast !== bLast) return bLast - aLast;
      return a.displayName.localeCompare(b.displayName, 'vi');
    });

  const stripPeers: { peer: Peer; note?: FriendNote }[] = [
    ...friendNotes.map(n => ({ peer: n.user, note: n })),
    ...remainingFriends.map(peer => ({ peer, note: undefined })),
  ];

  function openNoteModal() {
    setNoteBody(myNote?.body ?? '');
    setNoteMusicTitle(myNote?.musicTitle ?? '');
    setNoteMusicArtist(myNote?.musicArtist ?? '');
    setNotePickingMusic(false);
    setNoteError('');
    setNoteModalOpen(true);
  }

  async function saveMyNote() {
    if (!noteBody.trim()) {
      setNoteError('Hãy viết một ghi chú ngắn.');
      return;
    }
    setNoteSaving(true);
    setNoteError('');
    try {
      const res = await api.authenticated<{ note: FriendNote }>(
        '/notes/me',
        {
          body: noteBody.trim(),
          ...(noteMusicTitle.trim()
            ? {
                musicTitle: noteMusicTitle.trim(),
                musicArtist: noteMusicArtist.trim() || undefined,
              }
            : {}),
        },
        'PUT',
      );
      setNotes(prev => [
        res.note,
        ...prev.filter(item => item.user.id !== currentUser.id),
      ]);
      setNoteModalOpen(false);
    } catch (next) {
      setNoteError(api.errorMessage(next));
    } finally {
      setNoteSaving(false);
    }
  }

  async function deleteMyNote() {
    setNoteSaving(true);
    setNoteError('');
    try {
      await api.authenticated('/notes/me', undefined, 'DELETE');
      setNotes(prev => prev.filter(item => item.user.id !== currentUser.id));
      setNoteModalOpen(false);
    } catch (next) {
      setNoteError(api.errorMessage(next));
    } finally {
      setNoteSaving(false);
    }
  }

  async function openDirectWithPeer(peerId: string) {
    const existing = items.find(
      item => item.type === 'direct' && item.peer?.id === peerId,
    );
    if (existing) {
      setComposing(false);
      onOpen(existing);
      return;
    }
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>('/conversations', { type: 'direct', recipientId: peerId });
      setComposing(false);
      onOpen(result.conversation);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    }
  }

  async function openConversationById(
    conversationId: string,
    messageId?: string,
  ) {
    const existing = items.find(item => item.id === conversationId);
    if (existing) {
      onOpen(existing, messageId);
      return;
    }
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>(`/conversations/${conversationId}`);
      onOpen(result.conversation, messageId);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    }
  }

  async function handleRequestAction(
    req: MessageRequestRow,
    action: 'accept' | 'reject' | 'cancel',
  ) {
    if (requestBusyId) return;
    setRequestBusyId(req.id);
    setError('');
    try {
      await api.authenticated(
        `/message-requests/${req.id}`,
        { action },
        'PATCH',
      );
      await load(true);
      if (action === 'accept') {
        setCategory('all');
        await openDirectWithPeer(req.user.id);
      }
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setRequestBusyId('');
    }
  }

  async function openComposer() {
    setConversationType(category === 'group' ? 'group' : 'direct');
    setFriendFilter('');
    setSelected([]);
    setGroupTitle('');
    setComposing(true);
    setError('');
    if (!friends.length) {
      setCreateBusy(true);
      try {
        const rows = await allPages<PersonRow>('/friends');
        setFriends(rows.map(row => row.user));
      } catch (next) {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
        else setError(api.errorMessage(next));
      } finally {
        setCreateBusy(false);
      }
    }
  }

  const chosenPeers = selected
    .map(id => friends.find(peer => peer.id === id))
    .filter((peer): peer is Peer => !!peer);

  const autoGroupName = chosenPeers.length
    ? [currentUser.displayName, ...chosenPeers.map(p => p.displayName)]
        .filter(Boolean)
        .join(', ')
        .slice(0, 90)
    : '';

  async function createGroupConversation() {
    if (!selected.length) {
      setError('Chọn ít nhất một người bạn.');
      return;
    }
    const finalTitle = groupTitle.trim() || autoGroupName || 'Nhóm mới';
    setCreateBusy(true);
    setError('');
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>('/conversations', {
        type: 'group',
        title: finalTitle,
        memberIds: selected,
        clientRequestId: clientMessageId(),
      });
      setComposing(false);
      setSelected([]);
      setGroupTitle('');
      await load();
      onOpen(result.conversation);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setCreateBusy(false);
    }
  }

  const filteredComposeFriends = friends.filter(peer =>
    peer.displayName
      .toLocaleLowerCase('vi')
      .includes(friendFilter.trim().toLocaleLowerCase('vi')),
  );

  if (composing)
    return (
      <ScrollView
        contentContainerStyle={styles.composeConversation}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.composeModeTabs}>
          {(
            [
              ['direct', 'Nhắn tin riêng', 'chats'],
              ['group', 'Tạo nhóm mới', 'people'],
            ] as const
          ).map(([key, label, icon]) => {
            const active = conversationType === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setConversationType(key);
                  setSelected([]);
                }}
                style={[
                  styles.composeModeTab,
                  active && styles.composeModeTabActive,
                ]}
              >
                <NavIcon
                  name={icon}
                  color={active ? '#b75020' : '#7c6958'}
                  size={16}
                />
                <Text
                  style={[
                    styles.composeModeTabText,
                    active && styles.composeModeTabTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.composeIntroBlock}>
          <View style={styles.composeIconBox}>
            {conversationType === 'direct' ? (
              <UiGlyph name="compose" color="#b75020" size={20} />
            ) : (
              <NavIcon name="people" color="#b75020" size={20} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.composeIntroTitle}>
              {conversationType === 'direct'
                ? 'Bắt đầu cuộc trò chuyện'
                : 'Tạo nhóm trò chuyện'}
            </Text>
            <Text style={styles.composeIntroDesc}>
              {conversationType === 'direct'
                ? 'Chọn bạn bè hoặc tìm người dùng trên PingPong để nhắn tin ngay.'
                : 'Chọn thành viên để tạo nhóm ngay — tên nhóm có thể đặt riêng hoặc tự động theo tên thành viên.'}
            </Text>
          </View>
        </View>

        {conversationType === 'group' && (
          <View style={{ marginBottom: 12 }}>
            <View style={styles.pickerHeading}>
              <Text style={styles.fieldLabel}>
                Tên nhóm{' '}
                <Text style={{ fontWeight: '400', color: '#846f5d' }}>
                  (không bắt buộc)
                </Text>
              </Text>
              <Text style={styles.pickerCount}>
                {groupTitle.trim().length}/200
              </Text>
            </View>
            <TextInput
              maxLength={200}
              onChangeText={setGroupTitle}
              placeholder={
                autoGroupName
                  ? `Mặc định: ${autoGroupName}`
                  : 'Ví dụ: Nhóm đồ án, Hội bạn thân…'
              }
              placeholderTextColor="#846f5d"
              style={styles.input}
              value={groupTitle}
            />
          </View>
        )}

        <View style={[styles.searchBarCompact, { marginBottom: 12 }]}>
          <View style={{ marginRight: 8 }}>
            <UiGlyph name="search" color="#846f5d" size={16} />
          </View>
          <TextInput
            accessibilityLabel="Tìm người nhận"
            onChangeText={setFriendFilter}
            placeholder={
              conversationType === 'direct'
                ? 'Tìm bạn bè hoặc người dùng trên PingPong…'
                : 'Tìm bạn bè để thêm vào nhóm…'
            }
            placeholderTextColor="#846f5d"
            style={styles.searchInput}
            value={friendFilter}
          />
        </View>

        {conversationType === 'group' && chosenPeers.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.composeChosenStrip}
          >
            {chosenPeers.map(peer => (
              <Pressable
                key={peer.id}
                onPress={() =>
                  setSelected(prev => prev.filter(id => id !== peer.id))
                }
                style={styles.composeChosenChip}
              >
                <Avatar peer={peer} size={22} />
                <Text numberOfLines={1} style={styles.composeChosenChipText}>
                  {peer.displayName}
                </Text>
                <Text style={{ color: '#846f5d', fontSize: 13 }}>×</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={[styles.pickerHeading, { marginBottom: 6 }]}>
          <Text style={styles.composeListLabel}>
            {conversationType === 'direct'
              ? `Bạn bè (${filteredComposeFriends.length})`
              : 'Danh sách bạn bè'}
          </Text>
          {conversationType === 'group' && (
            <Text style={styles.pickerCount}>Đã chọn {selected.length}/49</Text>
          )}
        </View>

        {createBusy && !friends.length ? (
          <ActivityIndicator color="#b75020" style={styles.inlineLoader} />
        ) : (
          <View style={styles.composePickerBox}>
            {filteredComposeFriends.map(friend => {
              const checked = selected.includes(friend.id);
              return conversationType === 'direct' ? (
                <Pressable
                  key={friend.id}
                  onPress={() => void openDirectWithPeer(friend.id)}
                  style={styles.friendPickerRow}
                >
                  <Avatar peer={friend} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{friend.displayName}</Text>
                    <Text style={styles.personPresence}>
                      Bạn bè · Nhấn để nhắn tin
                    </Text>
                  </View>
                  <Text style={styles.composePeerArrow}>Nhắn tin →</Text>
                </Pressable>
              ) : (
                <Pressable
                  key={friend.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() =>
                    setSelected(previous => {
                      if (checked)
                        return previous.filter(value => value !== friend.id);
                      return [...previous, friend.id].slice(0, 49);
                    })
                  }
                  style={[
                    styles.friendPickerRow,
                    checked && styles.friendPickerRowSelected,
                  ]}
                >
                  <Avatar peer={friend} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{friend.displayName}</Text>
                    <Text style={styles.personPresence}>
                      {checked ? 'Đã chọn vào nhóm' : 'Nhấn để thêm vào nhóm'}
                    </Text>
                  </View>
                  <View
                    style={[styles.checkbox, checked && styles.checkboxChecked]}
                  >
                    <Text style={styles.checkboxText}>
                      {checked ? '✓' : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {conversationType === 'direct' && composeOtherUsers.length > 0 && (
              <>
                <Text style={styles.searchSectionTitle}>
                  MỌI NGƯỜI TRÊN PINGPONG
                </Text>
                {composeOtherUsers.map(peer => (
                  <Pressable
                    key={peer.id}
                    onPress={() => void openDirectWithPeer(peer.id)}
                    style={styles.friendPickerRow}
                  >
                    <Avatar peer={peer} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName}>{peer.displayName}</Text>
                      <Text style={styles.personPresence}>
                        Chưa kết bạn · Nhấn để nhắn tin
                      </Text>
                    </View>
                    <Text style={styles.composePeerArrow}>Nhắn tin →</Text>
                  </Pressable>
                ))}
              </>
            )}
            {!filteredComposeFriends.length && !composeOtherUsers.length && (
              <View style={styles.emptyInline}>
                <Text style={styles.empty}>
                  {friends.length
                    ? 'Không tìm thấy người phù hợp. Hãy thử từ khóa khác.'
                    : 'Nhập ít nhất 2 ký tự ở ô tìm kiếm để tìm người dùng và nhắn tin.'}
                </Text>
              </View>
            )}
          </View>
        )}

        {!!error && (
          <View style={{ marginTop: 10 }}>
            <InlineNotice message={error} />
          </View>
        )}

        <View style={styles.composeFooterRow}>
          <Pressable
            onPress={() => {
              setComposing(false);
              setError('');
            }}
            style={styles.smallSecondary}
          >
            <Text style={styles.smallSecondaryText}>Hủy</Text>
          </Pressable>
          {conversationType === 'group' && (
            <Pressable
              disabled={createBusy || !selected.length}
              onPress={() => void createGroupConversation()}
              style={[
                styles.smallPrimary,
                (createBusy || !selected.length) && styles.disabled,
              ]}
            >
              {createBusy ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.smallPrimaryText}>
                  {selected.length > 0
                    ? `Tạo nhóm (${selected.length})`
                    : 'Tạo nhóm'}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    );

  return (
    <View style={styles.threadCardInner}>
      <View style={[styles.sectionHeadingRow, styles.threadHeadingRow]}>
        <Text style={styles.sectionTitle}>Đoạn chat</Text>
        <Pressable
          accessibilityLabel="Tin nhắn mới hoặc tạo nhóm"
          accessibilityRole="button"
          onPress={() => void openComposer()}
          style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}
        >
          <UiGlyph name="compose" color="#ffffff" size={18} />
        </Pressable>
      </View>

      <View style={styles.conversationTools}>
        <View style={styles.searchBarCompact}>
          <View style={{ marginRight: 8 }}>
            <UiGlyph name="search" color="#897e73" size={16} />
          </View>
          <TextInput
            accessibilityLabel="Tìm cuộc trò chuyện, bạn bè và tin nhắn"
            onChangeText={setQuery}
            placeholder="Tìm bạn bè, nhóm và tin nhắn…"
            placeholderTextColor="#897e73"
            style={styles.searchInput}
            value={query}
          />
          {!!query && (
            <Pressable
              accessibilityLabel="Xóa từ khóa tìm kiếm"
              onPress={() => setQuery('')}
              style={{ paddingHorizontal: 6, paddingVertical: 4 }}
            >
              <Text style={{ color: '#8c7662', fontSize: 18 }}>×</Text>
            </Pressable>
          )}
        </View>

        {!normalizedQuery && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.notesList}
          >
            <Pressable
              accessibilityLabel={
                myNote ? `Sửa ghi chú: ${myNote.body}` : 'Tạo ghi chú mới'
              }
              accessibilityRole="button"
              onPress={openNoteModal}
              style={[styles.notePerson, styles.notePersonMine]}
            >
              <View style={styles.noteBubbleWrap}>
                <View
                  style={[
                    styles.noteBubble,
                    !myNote && styles.noteBubblePlaceholder,
                  ]}
                >
                  <Text
                    numberOfLines={myNote ? 2 : 1}
                    style={styles.noteBubbleText}
                  >
                    {myNote?.body ?? 'Ghi chú…'}
                  </Text>
                  {!!myNote?.musicTitle && (
                    <Text numberOfLines={1} style={styles.noteBubbleMusic}>
                      ♫ {myNote.musicTitle}
                    </Text>
                  )}
                </View>
                <View style={styles.noteBubblePointer} />
              </View>
              <View style={styles.presenceAvatar}>
                <Avatar peer={currentUser} size={38} circular />
                <View style={styles.noteAddBadge}>
                  <UiGlyph name="plus" color="#ffffff" size={10} />
                </View>
              </View>
              <Text numberOfLines={1} style={styles.activeFriendName}>
                Tin của bạn
              </Text>
            </Pressable>

            {stripPeers.slice(0, 15).map(({ peer: friend, note }) => {
              const badge = presenceBadge(presence[friend.id]);
              const isOnline = !!presence[friend.id]?.online;
              return (
                <Pressable
                  key={friend.id}
                  accessibilityLabel={`Nhắn tin với ${friend.displayName}`}
                  accessibilityRole="button"
                  onPress={() => void openDirectWithPeer(friend.id)}
                  style={styles.notePerson}
                >
                  {note ? (
                    <View style={styles.noteBubbleWrap}>
                      <View style={styles.noteBubble}>
                        <Text numberOfLines={2} style={styles.noteBubbleText}>
                          {note.body}
                        </Text>
                        {!!note.musicTitle && (
                          <Text
                            numberOfLines={1}
                            style={styles.noteBubbleMusic}
                          >
                            ♫ {note.musicTitle}
                          </Text>
                        )}
                      </View>
                      <View style={styles.noteBubblePointer} />
                    </View>
                  ) : (
                    <View style={styles.noteBubbleSpacer} />
                  )}
                  <View style={styles.presenceAvatar}>
                    <Avatar peer={friend} size={38} circular />
                    {isOnline ? (
                      <View style={styles.presenceDot} />
                    ) : badge ? (
                      <View style={styles.presenceLastActivePill}>
                        <Text
                          numberOfLines={1}
                          style={styles.presenceLastActiveText}
                        >
                          {badge}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.activeFriendName}>
                    {friend.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.chipRow}>
          {(
            [
              ['all', 'Tất cả'],
              ['unread', 'Chưa đọc'],
              ['group', 'Nhóm'],
              ['requests', 'Chờ'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setCategory(key)}
              style={[styles.chip, category === key && styles.chipActive]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.chipText,
                  category === key && styles.chipTextActive,
                ]}
              >
                {label}
              </Text>
              {key === 'requests' && incomingRequestsCount > 0 && (
                <View style={styles.chipBadge}>
                  <Text style={styles.chipBadgeText}>
                    {incomingRequestsCount > 99 ? '99+' : incomingRequestsCount}
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {!!error && (
        <View style={styles.listNotice}>
          <InlineNotice message={error} onRetry={() => void load()} />
        </View>
      )}

      {loading ? (
        <Centered label="Đang tải đoạn chat…" />
      ) : category === 'requests' &&
        !visibleItems.length &&
        visibleRequests.length > 0 ? (
        <FlatList
          data={visibleRequests}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.conversationList}
          refreshControl={
            <RefreshControl
              colors={['#b75020']}
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor="#b75020"
            />
          }
          renderItem={({ item }) => (
            <View style={styles.requestCard}>
              <View style={styles.requestHeader}>
                <Avatar peer={item.user} size={44} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.conversationName}>
                    {item.user.displayName}
                  </Text>
                  <Text style={styles.personPresence}>
                    {item.direction === 'outgoing'
                      ? 'Bạn đã gửi tin nhắn chờ'
                      : 'Đã gửi tin nhắn chờ cho bạn'}
                  </Text>
                </View>
              </View>
              {!!item.body && (
                <Text style={styles.requestPreview}>{item.body}</Text>
              )}
              <View style={styles.requestActions}>
                <Pressable
                  disabled={!!requestBusyId}
                  onPress={() => void openDirectWithPeer(item.user.id)}
                  style={styles.smallSecondary}
                >
                  <Text style={styles.smallSecondaryText}>Mở đoạn chat</Text>
                </Pressable>
                {item.direction !== 'outgoing' && (
                  <Pressable
                    disabled={!!requestBusyId}
                    onPress={() => void handleRequestAction(item, 'accept')}
                    style={styles.smallPrimary}
                  >
                    <Text style={styles.smallPrimaryText}>Chấp nhận</Text>
                  </Pressable>
                )}
                <Pressable
                  disabled={!!requestBusyId}
                  onPress={() =>
                    void handleRequestAction(
                      item,
                      item.direction === 'outgoing' ? 'cancel' : 'reject',
                    )
                  }
                  style={styles.smallSecondary}
                >
                  <Text style={styles.smallSecondaryText}>
                    {item.direction === 'outgoing' ? 'Thu hồi' : 'Từ chối'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              colors={['#b75020']}
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor="#b75020"
            />
          }
          ListFooterComponent={
            <>
              {normalizedQuery && matchingFriends.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.searchSectionTitle}>BẠN BÈ</Text>
                  {matchingFriends.slice(0, 6).map(friend => (
                    <Pressable
                      key={friend.id}
                      onPress={() => void openDirectWithPeer(friend.id)}
                      style={styles.conversation}
                    >
                      <View style={styles.presenceAvatar}>
                        <Avatar peer={friend} size={46} circular />
                        {presence[friend.id]?.online && (
                          <View style={styles.presenceDot} />
                        )}
                      </View>
                      <View style={styles.conversationBody}>
                        <Text numberOfLines={1} style={styles.conversationName}>
                          {friend.displayName}
                        </Text>
                        <Text style={styles.preview}>
                          {presenceLabel(presence[friend.id]) ||
                            'Nhấn để bắt đầu trò chuyện'}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
              {normalizedQuery && matchingNonFriends.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.searchSectionTitle}>
                    MỌI NGƯỜI TRÊN PINGPONG
                  </Text>
                  {matchingNonFriends.slice(0, 6).map(peer => (
                    <Pressable
                      key={peer.id}
                      onPress={() => {
                        setQuery('');
                        void openDirectWithPeer(peer.id);
                      }}
                      style={styles.conversation}
                    >
                      <Avatar peer={peer} size={46} circular />
                      <View style={styles.conversationBody}>
                        <Text numberOfLines={1} style={styles.conversationName}>
                          {peer.displayName}
                        </Text>
                        <Text style={styles.preview}>
                          Chưa kết bạn · Nhấn để nhắn tin
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
              {normalizedQuery &&
                (searchingMessages || searchedMessages.length > 0) && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.searchSectionTitle}>
                      TIN NHẮN PHÙ HỢP
                    </Text>
                    {searchingMessages && !searchedMessages.length && (
                      <ActivityIndicator
                        color="#b75020"
                        style={{ marginVertical: 10 }}
                      />
                    )}
                    {searchedMessages.map(hit => {
                      const conv = items.find(c => c.id === hit.conversationId);
                      const convTitle = conv
                        ? conversationName(conv)
                        : 'Cuộc trò chuyện';
                      return (
                        <Pressable
                          key={hit.id}
                          onPress={() =>
                            void openConversationById(
                              hit.conversationId,
                              hit.id,
                            )
                          }
                          style={styles.conversation}
                        >
                          <Avatar
                            peer={{
                              id: conv?.peer?.id ?? hit.conversationId,
                              displayName: convTitle,
                              avatarUrl: conv?.peer?.avatarUrl,
                            }}
                            size={44}
                            circular={!!conv?.peer?.avatarUrl}
                          />
                          <View style={styles.conversationBody}>
                            <View style={styles.rowBetween}>
                              <Text
                                numberOfLines={1}
                                style={styles.conversationName}
                              >
                                {convTitle}
                              </Text>
                              <Text style={styles.messageTime}>
                                {shortTime(hit.createdAt)}
                              </Text>
                            </View>
                            <Text numberOfLines={2} style={styles.preview}>
                              {hit.body}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              {nextCursor && !normalizedQuery && (
                <Pressable
                  disabled={loadingMore}
                  onPress={() => void loadMore()}
                  style={[styles.loadOlder, { marginTop: 12 }]}
                >
                  {loadingMore ? (
                    <ActivityIndicator color="#b75020" size="small" />
                  ) : (
                    <Text style={styles.loadOlderText}>Xem thêm</Text>
                  )}
                </Pressable>
              )}
            </>
          }
          ListEmptyComponent={
            matchingFriends.length > 0 ||
            matchingNonFriends.length > 0 ||
            searchedMessages.length > 0 ||
            searchingMessages ? undefined : (
              <View style={styles.emptyInline}>
                <Text style={styles.empty}>
                  {category === 'requests'
                    ? normalizedQuery
                      ? 'Không tìm thấy tin nhắn chờ phù hợp.'
                      : 'Chưa có tin nhắn chờ nào từ người lạ.'
                    : normalizedQuery
                      ? 'Không tìm thấy cuộc trò chuyện, bạn bè hay tin nhắn phù hợp.'
                      : category === 'unread'
                        ? 'Bạn đã đọc hết tin nhắn.'
                        : category === 'group'
                          ? 'Chưa có cuộc trò chuyện nhóm.'
                          : 'Chưa có đoạn chat. Chọn nút soạn tin để bắt đầu.'}
                </Text>
              </View>
            )
          }
          contentContainerStyle={styles.conversationList}
          renderItem={({ item }) => {
            const title = conversationName(item);
            const peerPresence = item.peer ? presence[item.peer.id] : undefined;
            const badge = item.peer ? presenceBadge(peerPresence) : '';
            return (
              <Pressable
                accessibilityHint="Mở cuộc trò chuyện"
                accessibilityLabel={`${title}${
                  item.unreadCount
                    ? `, ${item.unreadCount} tin nhắn chưa đọc`
                    : ''
                }`}
                accessibilityRole="button"
                onPressIn={() => onPreload(item)}
                onPress={() => onOpen(item)}
                style={({ pressed }) => [
                  styles.conversation,
                  styles.threadRow,
                  pressed && styles.conversationPressed,
                ]}
              >
                <View style={styles.presenceAvatar}>
                  <Avatar
                    peer={{
                      id: item.peer?.id ?? item.id,
                      displayName: title,
                      avatarUrl: item.peer?.avatarUrl,
                    }}
                    size={42}
                  />
                  {peerPresence?.online ? (
                    <View style={styles.presenceDot} />
                  ) : badge ? (
                    <View style={styles.presenceLastActivePill}>
                      <Text
                        numberOfLines={1}
                        style={styles.presenceLastActiveText}
                      >
                        {badge}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.conversationBody, styles.threadRowBody]}>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.conversationName,
                      !!item.unreadCount && styles.threadNameUnread,
                    ]}
                  >
                    {title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.preview,
                      !!item.unreadCount && styles.previewUnread,
                    ]}
                  >
                    {threadPreviewText(item, currentUser.id)}
                  </Text>
                </View>
                {!!item.unreadCount && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {item.unreadCount > 99 ? '99+' : item.unreadCount}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      <Modal
        animationType="fade"
        transparent
        visible={noteModalOpen}
        onRequestClose={() => setNoteModalOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setNoteModalOpen(false)}
        >
          <Pressable style={styles.noteComposerModal} onPress={() => {}}>
            {notePickingMusic ? (
              <View style={{ padding: 16 }}>
                <View style={styles.noteMusicSearchRow}>
                  <View style={[styles.searchBarCompact, { flex: 1 }]}>
                    <View style={{ marginRight: 8 }}>
                      <UiGlyph name="search" color="#7c828d" size={16} />
                    </View>
                    <TextInput
                      autoFocus
                      onChangeText={setNoteMusicQuery}
                      placeholder="Tìm kiếm nhạc"
                      placeholderTextColor="#888e99"
                      style={styles.searchInput}
                      value={noteMusicQuery}
                    />
                  </View>
                  <Pressable
                    onPress={() => setNotePickingMusic(false)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text
                      style={{
                        color: '#b75020',
                        fontSize: 15,
                        fontWeight: '700',
                      }}
                    >
                      Hủy
                    </Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 320, marginTop: 10 }}>
                  {noteTracks.map(track => (
                    <Pressable
                      key={track.id}
                      onPress={() => {
                        setNoteMusicTitle(track.title);
                        setNoteMusicArtist(track.artist);
                        setNotePickingMusic(false);
                      }}
                      style={styles.noteTrackRow}
                    >
                      <View style={styles.noteTrackArt}>
                        <UiGlyph name="music" color="#a44b35" size={18} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.conversationName}>
                          {track.title}
                        </Text>
                        <Text numberOfLines={1} style={styles.personPresence}>
                          {track.artist}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <View style={{ padding: 20 }}>
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={styles.noteKicker}>GHI CHÚ 24 GIỜ</Text>
                    <Text style={styles.noteComposerTitle}>
                      Bạn đang nghĩ gì?
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setNoteModalOpen(false)}
                    style={styles.noteCloseBtn}
                  >
                    <UiGlyph name="close" color="#5d493f" size={16} />
                  </Pressable>
                </View>

                <Text style={styles.fieldLabel}>Nội dung</Text>
                <View style={{ position: 'relative' }}>
                  <TextInput
                    maxLength={80}
                    multiline
                    onChangeText={setNoteBody}
                    placeholder="Chia sẻ một điều ngắn gọn…"
                    placeholderTextColor="#8c7662"
                    style={styles.noteTextarea}
                    value={noteBody}
                  />
                  <Text style={styles.noteCharCounter}>
                    {noteBody.length}/80
                  </Text>
                </View>

                {noteMusicTitle ? (
                  <View style={styles.noteSelectedSongCard}>
                    <View style={styles.noteTrackArt}>
                      <UiGlyph name="music" color="#a44b35" size={18} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.conversationName}>
                        {noteMusicTitle}
                      </Text>
                      <Text numberOfLines={1} style={styles.personPresence}>
                        {noteMusicArtist || 'Bài hát đính kèm'}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setNotePickingMusic(true)}
                      style={styles.smallSecondary}
                    >
                      <Text style={styles.smallSecondaryText}>Đổi bài</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setNoteMusicTitle('');
                        setNoteMusicArtist('');
                      }}
                      style={styles.noteCloseBtn}
                    >
                      <UiGlyph name="close" color="#7c3b29" size={14} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setNotePickingMusic(true)}
                    style={styles.noteMusicToggleBtn}
                  >
                    <UiGlyph name="music" color="#a44b35" size={18} />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: '#533f35',
                          fontSize: 13.5,
                          fontWeight: '700',
                        }}
                      >
                        Thêm bài hát
                      </Text>
                      <Text style={{ color: '#75645b', fontSize: 11.5 }}>
                        Tìm kiếm và đính kèm bài hát yêu thích
                      </Text>
                    </View>
                  </Pressable>
                )}

                {!!noteError && (
                  <Text style={styles.fieldError}>{noteError}</Text>
                )}

                <View style={styles.noteFooterActions}>
                  {myNote && (
                    <Pressable
                      disabled={noteSaving}
                      onPress={() => void deleteMyNote()}
                      style={styles.noteDeleteBtn}
                    >
                      <UiGlyph name="trash" color="#a2342f" size={15} />
                      <Text style={styles.noteDeleteBtnText}>Xóa</Text>
                    </Pressable>
                  )}
                  <Pressable
                    disabled={noteSaving || !noteBody.trim()}
                    onPress={() => void saveMyNote()}
                    style={[
                      styles.noteSaveBtn,
                      (noteSaving || !noteBody.trim()) && styles.disabled,
                    ]}
                  >
                    <Text style={styles.noteSaveBtnText}>
                      {noteSaving ? 'Đang lưu…' : 'Chia sẻ ghi chú'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
