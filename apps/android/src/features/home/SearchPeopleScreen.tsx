import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import { Avatar, InlineNotice } from '../../components/Common';
import { NavIcon } from '../../components/Icons';
import type { Peer, PersonRow } from '../../presence';
import { styles } from '../../styles';

export function SearchPeopleScreen({
  incomingCount = 0,
  onExpired,
  onOpen,
  onSwitchSection,
  onGoRequests,
}: {
  incomingCount?: number;
  onExpired: () => void;
  onOpen?: (conversation: api.Conversation) => void;
  onSwitchSection?: (
    section: 'friends' | 'incoming' | 'outgoing' | 'search',
  ) => void;
  onGoRequests?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [sent, setSent] = useState(new Set<string>());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  async function search(isRefresh = false) {
    const value = query.trim();
    if (value.length < 2 || value.length > 100) {
      if (!isRefresh) setError('Nhập tên hiển thị từ 2 đến 100 ký tự.');
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const page = await api.authenticated<api.Page<PersonRow | Peer>>(
        `/users?query=${encodeURIComponent(value)}&limit=50`,
      );
      setRows(
        page.items.map(item =>
          'user' in item ? item : { id: item.id, user: item },
        ),
      );
      setSearched(true);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function invite(row: PersonRow) {
    setBusyId(row.user.id);
    setError('');
    try {
      await api.authenticated('/friend-requests', {
        recipientId: row.user.id,
      });
      setSent(previous => new Set(previous).add(row.user.id));
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setBusyId('');
    }
  }

  async function openDirect(row: PersonRow) {
    if (!onOpen) return;
    setBusyId(row.user.id);
    setError('');
    try {
      const result = await api.authenticated<{
        conversation: api.Conversation;
      }>('/conversations', { type: 'direct', recipientId: row.user.id });
      onOpen(result.conversation);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setBusyId('');
    }
  }

  return (
    <View style={styles.threadCardInner}>
      <View style={styles.peopleHeaderRow}>
        <View>
          <Text style={styles.screenEyebrow}>DANH BẠ & KẾT NỐI</Text>
          <Text style={styles.sectionTitle}>Bạn bè</Text>
        </View>
        {searched && (
          <Pressable
            disabled={loading || refreshing}
            onPress={() => void search(true)}
            style={({ pressed }) => [
              styles.smallSecondary,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.smallSecondaryText}>Tải lại</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.friendsHubGrid}>
        {(
          [
            [
              'friends',
              'Tất cả bạn bè',
              'Danh sách bạn bè đã kết nối',
              'people',
            ],
            [
              'incoming',
              'Lời mời nhận',
              'Lời mời kết bạn gửi đến bạn',
              'incoming',
            ],
            ['outgoing', 'Lời mời đã gửi', 'Lời mời bạn đã gửi đi', 'outgoing'],
            ['search', 'Tìm bạn', 'Tìm kiếm và kết bạn mới', 'search'],
          ] as const
        ).map(([key, label, hint, iconName]) => {
          const active = key === 'search';
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (key !== 'search') {
                  if (onSwitchSection) onSwitchSection(key);
                  else onGoRequests?.();
                }
              }}
              style={({ pressed }) => [
                styles.friendsHubTab,
                active && styles.friendsHubTabActive,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.friendsHubIconBox,
                  active && styles.friendsHubIconBoxActive,
                ]}
              >
                <NavIcon
                  name={iconName}
                  color={active ? '#ffffff' : '#89542f'}
                  size={16}
                />
              </View>
              <View style={styles.friendsHubCopy}>
                <View style={styles.friendsHubTitleRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.friendsHubTitle,
                      active && styles.friendsHubTitleActive,
                    ]}
                  >
                    {label}
                  </Text>
                  {key === 'incoming' && incomingCount > 0 && (
                    <View style={styles.friendsHubBadge}>
                      <Text style={styles.friendsHubBadgeText}>
                        {incomingCount > 99 ? '99+' : incomingCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text numberOfLines={1} style={styles.friendsHubHint}>
                  {hint}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.searchCardForm}>
        <Text style={[styles.fieldLabel, { marginTop: 0, marginBottom: 2 }]}>
          Tìm theo tên hiển thị
        </Text>
        <View style={styles.searchCardInputRow}>
          <TextInput
            accessibilityLabel="Tên người dùng cần tìm"
            autoCapitalize="words"
            maxLength={100}
            onChangeText={value => {
              setQuery(value);
              setError('');
            }}
            onSubmitEditing={() => void search()}
            placeholder="Nhập tên hiển thị của bạn bè"
            placeholderTextColor="#8c7662"
            returnKeyType="search"
            style={[styles.input, { flex: 1, minHeight: 44 }]}
            value={query}
          />
          <Pressable
            disabled={loading}
            onPress={() => void search()}
            style={[
              styles.smallPrimary,
              { minHeight: 44, paddingHorizontal: 16 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.smallPrimaryText}>Tìm kiếm</Text>
            )}
          </Pressable>
        </View>
      </View>
      {!!error && (
        <View style={styles.listNotice}>
          <InlineNotice message={error} />
        </View>
      )}
      <FlatList
        contentContainerStyle={styles.peopleList}
        data={rows}
        keyExtractor={row => row.id}
        refreshControl={
          searched ? (
            <RefreshControl
              colors={['#b75020']}
              refreshing={refreshing}
              onRefresh={() => void search(true)}
              tintColor="#b75020"
            />
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptySymbol}>
              <Text style={styles.emptySymbolText}>⌕</Text>
            </View>
            <Text style={styles.emptyTitle}>
              {searched ? 'Không tìm thấy người dùng' : 'Tìm một người bạn'}
            </Text>
            <Text style={styles.empty}>
              {searched
                ? 'Thử tìm bằng tên hiển thị đầy đủ hoặc từ khóa khác.'
                : 'Nhập tên hiển thị để gửi lời mời kết bạn.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = sent.has(item.user.id)
            ? 'outgoing'
            : (item.user.friendshipStatus ?? 'none');
          return (
            <View style={styles.personRow}>
              <Avatar peer={item.user} />
              <View style={styles.personIdentity}>
                <Text numberOfLines={2} style={styles.personName}>
                  {item.user.displayName}
                </Text>
                <Text style={styles.personPresence}>
                  {status === 'friends'
                    ? 'Đã là bạn bè'
                    : status === 'incoming'
                      ? 'Đã gửi lời mời cho bạn'
                      : status === 'outgoing'
                        ? 'Đang chờ xác nhận'
                        : 'Người dùng PingPong'}
                </Text>
              </View>
              {status === 'friends' ? (
                <Pressable
                  disabled={!!busyId}
                  onPress={() => void openDirect(item)}
                  style={styles.smallPrimary}
                >
                  <Text style={styles.smallPrimaryText}>Nhắn tin</Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable
                    disabled={!!busyId}
                    onPress={() => void openDirect(item)}
                    style={styles.smallSecondary}
                  >
                    <Text style={styles.smallSecondaryText}>Nhắn tin</Text>
                  </Pressable>
                  {status === 'incoming' ? (
                    <Pressable
                      disabled={!!busyId}
                      onPress={onGoRequests}
                      style={styles.smallSecondary}
                    >
                      <Text style={styles.smallSecondaryText}>Xem lời mời</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      disabled={status === 'outgoing' || !!busyId}
                      onPress={() => void invite(item)}
                      style={[
                        styles.smallPrimary,
                        status === 'outgoing' && styles.smallButtonDisabled,
                      ]}
                    >
                      <Text style={styles.smallPrimaryText}>
                        {status === 'outgoing' ? 'Đã gửi' : 'Kết bạn'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}
