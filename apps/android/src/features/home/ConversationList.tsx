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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'unread' | 'group'>('all');
  const [composing, setComposing] = useState(false);
  const [conversationType, setConversationType] = useState<'direct' | 'group'>(
    'direct',
  );
  const [friends, setFriends] = useState<Peer[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

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

  const visibleItems = items.filter(item => {
    const matchesQuery = conversationName(item)
      .toLocaleLowerCase('vi')
      .includes(query.trim().toLocaleLowerCase('vi'));
    const matchesCategory =
      category === 'all' ||
      (category === 'unread' && item.unreadCount > 0) ||
      (category === 'group' && item.type === 'group');
    return matchesQuery && matchesCategory;
  });

  async function openComposer() {
    setComposing(true);
    setError('');
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
          <Text style={styles.backLinkText}>‹ Quay lại tin nhắn</Text>
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
              placeholderTextColor="#7c8e98"
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
          <ActivityIndicator color="#087f72" style={styles.inlineLoader} />
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
          <Text style={styles.sectionTitle}>Tin nhắn</Text>
          <Text style={styles.sectionCaption}>
            {items.length
              ? `${items.length} cuộc trò chuyện`
              : 'Các cuộc trò chuyện của bạn'}
          </Text>
        </View>
        <Pressable onPress={() => void openComposer()} style={styles.newChat}>
          <Text style={styles.newChatText}>＋</Text>
        </Pressable>
      </View>
      <View style={styles.conversationTools}>
        <View style={styles.searchBarCompact}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            accessibilityLabel="Tìm cuộc trò chuyện"
            onChangeText={setQuery}
            placeholder="Tìm cuộc trò chuyện"
            placeholderTextColor="#7c8e98"
            style={styles.searchInput}
            value={query}
          />
        </View>
        <View style={styles.chipRow}>
          {(
            [
              ['all', 'Tất cả'],
              ['unread', 'Chưa đọc'],
              ['group', 'Nhóm'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setCategory(key)}
              style={[styles.chip, category === key && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  category === key && styles.chipTextActive,
                ]}
              >
                {label}
              </Text>
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
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              colors={['#087f72']}
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor="#087f72"
            />
          }
          ListEmptyComponent={
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
