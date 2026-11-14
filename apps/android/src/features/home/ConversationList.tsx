import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import {
  Avatar,
  Centered,
  InlineNotice,
  ScreenIntro,
} from '../../components/Common';
import {
  allPages,
  type PersonRow,
  type Peer,
  type Presence,
} from '../../presence';
import { clientMessageId, conversationName, shortTime } from '../../utils';
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

export function ConversationList({
  onOpen,
  onExpired,
  presence,
}: {
  onOpen: (conversation: api.Conversation) => void;
  onExpired: () => void;
  presence: Record<string, Presence>;
}) {
  const [items, setItems] = useState<api.Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [friends, setFriends] = useState<Peer[]>([]);
  const [requests, setRequests] = useState<MessageRequestRow[]>([]);
  const [requestBusyId, setRequestBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchedMessages, setSearchedMessages] = useState<SearchMessageHit[]>(
    [],
  );
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [category, setCategory] = useState<
    'all' | 'unread' | 'group' | 'requests'
  >('all');
  const [composing, setComposing] = useState(false);
  const [conversationType, setConversationType] = useState<'direct' | 'group'>(
    'direct',
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const [page, friendRows, reqPage] = await Promise.all([
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
        ]);
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setFriends(friendRows.map(row => row.user));
        setRequests(reqPage.items);
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
      setSearchingMessages(false);
      return;
    }
    let cancelled = false;
    setSearchingMessages(true);
    const timer = setTimeout(() => {
      void api
        .authenticated<{ items: SearchMessageHit[] }>(
          `/messages/search?query=${encodeURIComponent(term)}&limit=10`,
        )
        .then(res => {
          if (!cancelled) setSearchedMessages(res.items);
        })
        .catch(() => {
          if (!cancelled) setSearchedMessages([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingMessages(false);
        });
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const normalizedQuery = query.trim().toLocaleLowerCase('vi');

  const visibleItems = items.filter(item => {
    const matchesQuery =
      !normalizedQuery ||
      conversationName(item)
        .toLocaleLowerCase('vi')
        .includes(normalizedQuery) ||
      (item.lastMessage?.body ?? '')
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

  const visibleRequests = requests.filter(
    req =>
      !normalizedQuery ||
      req.user.displayName.toLocaleLowerCase('vi').includes(normalizedQuery) ||
      (req.body ?? '').toLocaleLowerCase('vi').includes(normalizedQuery),
  );

  const incomingRequestsCount = requests.filter(
    req => req.direction !== 'outgoing',
  ).length;

  const sortedFriends = [...friends].sort((a, b) => {
    const aOnline = presence[a.id]?.online ? 1 : 0;
    const bOnline = presence[b.id]?.online ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    return a.displayName.localeCompare(b.displayName, 'vi');
  });

  async function openDirectWithPeer(peerId: string) {
    const existing = items.find(
      item => item.type === 'direct' && item.peer?.id === peerId,
    );
    if (existing) {
      onOpen(existing);
      return;
    }
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>('/conversations', { type: 'direct', recipientId: peerId });
      onOpen(result.conversation);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    }
  }

  async function openConversationById(conversationId: string) {
    const existing = items.find(item => item.id === conversationId);
    if (existing) {
      onOpen(existing);
      return;
    }
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>(`/conversations/${conversationId}`);
      onOpen(result.conversation);
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

  async function createConversation() {
    if (!selected.length) {
      setError('Chọn ít nhất một người bạn.');
      return;
    }
    if (conversationType === 'group' && !groupTitle.trim()) {
      setError('Nhập tên nhóm trước khi tạo.');
      return;
    }
    setCreateBusy(true);
    setError('');
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>(
        '/conversations',
        conversationType === 'direct'
          ? { type: 'direct', recipientId: selected[0] }
          : {
              type: 'group',
              title: groupTitle.trim(),
              memberIds: selected,
              clientRequestId: clientMessageId(),
            },
      );
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

  if (composing)
    return (
      <ScrollView
        contentContainerStyle={styles.composeConversation}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => {
            setComposing(false);
            setError('');
          }}
          style={styles.backLink}
        >
          <Text style={styles.backLinkText}>‹ Quay lại đoạn chat</Text>
        </Pressable>
        <ScreenIntro
          title="Tin nhắn mới"
          caption="Chọn một người bạn hoặc tạo nhóm"
        />
        <View style={styles.segmentedControl}>
          {(
            [
              ['direct', 'Trò chuyện riêng'],
              ['group', 'Nhóm'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => {
                setConversationType(key);
                setSelected(previous =>
                  key === 'direct' ? previous.slice(0, 1) : previous,
                );
              }}
              style={[
                styles.segmentButton,
                conversationType === key && styles.segmentButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  conversationType === key && styles.segmentTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {conversationType === 'group' && (
          <>
            <Text style={styles.fieldLabel}>Tên nhóm</Text>
            <TextInput
              maxLength={200}
              onChangeText={setGroupTitle}
              placeholder="Ví dụ: Nhóm dự án"
              placeholderTextColor="#8c7662"
              style={styles.input}
              value={groupTitle}
            />
          </>
        )}
        <View style={styles.pickerHeading}>
          <Text style={styles.fieldLabel}>Chọn bạn bè</Text>
          <Text style={styles.pickerCount}>{selected.length} đã chọn</Text>
        </View>
        {createBusy && !friends.length ? (
          <ActivityIndicator color="#b75020" style={styles.inlineLoader} />
        ) : friends.length ? (
          friends.map(friend => {
            const checked = selected.includes(friend.id);
            return (
              <Pressable
                key={friend.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() =>
                  setSelected(previous => {
                    if (checked)
                      return previous.filter(value => value !== friend.id);
                    return conversationType === 'direct'
                      ? [friend.id]
                      : [...previous, friend.id].slice(0, 49);
                  })
                }
                style={styles.friendPickerRow}
              >
                <Avatar peer={friend} />
                <Text style={styles.personName}>{friend.displayName}</Text>
                <View
                  style={[styles.checkbox, checked && styles.checkboxChecked]}
                >
                  <Text style={styles.checkboxText}>{checked ? '✓' : ''}</Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyTitle}>Chưa có bạn bè</Text>
            <Text style={styles.empty}>
              Kết bạn trước khi bắt đầu một cuộc trò chuyện.
            </Text>
          </View>
        )}
        {!!error && <InlineNotice message={error} />}
        <Pressable
          disabled={createBusy || !selected.length}
          onPress={() => void createConversation()}
          style={[
            styles.primaryButton,
            (createBusy || !selected.length) && styles.disabled,
          ]}
        >
          {createBusy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {conversationType === 'group' ? 'Tạo nhóm' : 'Bắt đầu nhắn tin'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    );

  return (
    <View style={styles.page}>
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={styles.sectionTitle}>Đoạn chat</Text>
          <Text style={styles.sectionCaption}>
            {items.length
              ? `${items.length} cuộc trò chuyện`
              : 'Các cuộc trò chuyện của bạn'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Tạo cuộc trò chuyện mới"
          accessibilityRole="button"
          onPress={() => void openComposer()}
          style={styles.newChat}
        >
          <Text style={styles.newChatText}>＋</Text>
        </Pressable>
      </View>
      <View style={styles.conversationTools}>
        <View style={styles.searchBarCompact}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            accessibilityLabel="Tìm cuộc trò chuyện, bạn bè và tin nhắn"
            onChangeText={setQuery}
            placeholder="Tìm bạn bè, nhóm và tin nhắn…"
            placeholderTextColor="#8c7662"
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
        <Centered label="Đang tải hội thoại…" />
      ) : category === 'requests' ? (
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
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <View style={styles.emptySymbol}>
                <Text style={styles.emptySymbolText}>✉</Text>
              </View>
              <Text style={styles.emptyTitle}>Chưa có tin nhắn chờ</Text>
              <Text style={styles.empty}>
                Tin nhắn từ người chưa kết bạn sẽ hiển thị tại đây.
              </Text>
            </View>
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
          ListHeaderComponent={
            <>
              {!normalizedQuery && sortedFriends.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.activeFriendsStrip}
                >
                  {sortedFriends.slice(0, 15).map(friend => (
                    <Pressable
                      key={friend.id}
                      accessibilityLabel={`Nhắn tin với ${friend.displayName}`}
                      accessibilityRole="button"
                      onPress={() => void openDirectWithPeer(friend.id)}
                      style={styles.activeFriendItem}
                    >
                      <View style={styles.presenceAvatar}>
                        <Avatar peer={friend} size={46} />
                        {presence[friend.id]?.online && (
                          <View style={styles.presenceDot} />
                        )}
                      </View>
                      <Text numberOfLines={1} style={styles.activeFriendName}>
                        {friend.displayName.split(' ').slice(-2).join(' ')}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              {normalizedQuery && matchingFriends.length > 0 && (
                <View style={{ marginBottom: 8 }}>
                  <Text style={styles.searchSectionTitle}>BẠN BÈ</Text>
                  {matchingFriends.slice(0, 6).map(friend => (
                    <Pressable
                      key={friend.id}
                      onPress={() => void openDirectWithPeer(friend.id)}
                      style={styles.conversation}
                    >
                      <View style={styles.presenceAvatar}>
                        <Avatar peer={friend} size={44} />
                        {presence[friend.id]?.online && (
                          <View style={styles.presenceDot} />
                        )}
                      </View>
                      <View style={styles.conversationBody}>
                        <Text numberOfLines={1} style={styles.conversationName}>
                          {friend.displayName}
                        </Text>
                        <Text style={styles.preview}>
                          Chạm để mở cuộc trò chuyện
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                  {visibleItems.length > 0 && (
                    <Text style={styles.searchSectionTitle}>
                      CUỘC TRÒ CHUYỆN
                    </Text>
                  )}
                </View>
              )}
            </>
          }
          ListFooterComponent={
            <>
              {normalizedQuery &&
                (searchingMessages || searchedMessages.length > 0) && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.searchSectionTitle}>
                      TIN NHẮN TÌM THẤY
                    </Text>
                    {searchingMessages && (
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
                            void openConversationById(hit.conversationId)
                          }
                          style={styles.conversation}
                        >
                          <Avatar
                            peer={{
                              id: conv?.peer?.id ?? hit.conversationId,
                              displayName: convTitle,
                              avatarUrl: conv?.peer?.avatarUrl,
                            }}
                            size={42}
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
                    <Text style={styles.loadOlderText}>
                      Xem thêm cuộc trò chuyện
                    </Text>
                  )}
                </Pressable>
              )}
            </>
          }
          ListEmptyComponent={
            matchingFriends.length > 0 ||
            searchedMessages.length > 0 ||
            searchingMessages ? undefined : (
              <View style={styles.emptyCard}>
                <View style={styles.emptySymbol}>
                  <Text style={styles.emptySymbolText}>P</Text>
                </View>
                <Text style={styles.emptyTitle}>
                  {items.length
                    ? 'Không có kết quả phù hợp'
                    : 'Chưa có cuộc trò chuyện'}
                </Text>
                <Text style={styles.empty}>
                  {items.length
                    ? 'Thử đổi từ khóa hoặc bộ lọc.'
                    : 'Chọn nút cộng để bắt đầu nhắn tin với bạn bè.'}
                </Text>
              </View>
            )
          }
          contentContainerStyle={styles.conversationList}
          renderItem={({ item }) => (
            <Pressable
              accessibilityHint="Mở cuộc trò chuyện"
              accessibilityLabel={`${conversationName(item)}${
                item.unreadCount
                  ? `, ${item.unreadCount} tin nhắn chưa đọc`
                  : ''
              }`}
              accessibilityRole="button"
              onPress={() => onOpen(item)}
              style={({ pressed }) => [
                styles.conversation,
                !!item.unreadCount && styles.conversationUnread,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.presenceAvatar}>
                <Avatar
                  peer={{
                    id: item.peer?.id ?? item.id,
                    displayName: conversationName(item),
                    avatarUrl: item.peer?.avatarUrl,
                  }}
                  size={48}
                />
                {!!item.peer && presence[item.peer.id]?.online && (
                  <View style={styles.presenceDot} />
                )}
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
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.preview,
                      !!item.unreadCount && styles.previewUnread,
                    ]}
                  >
                    {item.lastMessage?.body ?? 'Bắt đầu trò chuyện ngay'}
                  </Text>
                  {!!item.unreadCount && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                      </Text>
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
