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
import { Avatar, InlineNotice, ScreenIntro } from '../../components/Common';
import type { Peer, PersonRow } from '../../presence';
import { styles } from '../../styles';

export function SearchPeopleScreen({
  onExpired,
  onOpen,
  onGoRequests,
}: {
  onExpired: () => void;
  onOpen?: (conversation: api.Conversation) => void;
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
    <View style={styles.screen}>
      <ScreenIntro title="Tìm bạn" caption="Tìm theo tên hiển thị hoặc email" />
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Tên người dùng cần tìm"
          autoCapitalize="words"
          maxLength={100}
          onChangeText={value => {
            setQuery(value);
            setError('');
          }}
          onSubmitEditing={() => void search()}
          placeholder="Nhập ít nhất 2 ký tự"
          placeholderTextColor="#8c7662"
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        <Pressable
          disabled={loading}
          onPress={() => void search()}
          style={styles.searchButton}
        >
          {loading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.searchButtonText}>Tìm</Text>
          )}
        </Pressable>
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
              ) : status === 'incoming' ? (
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
          );
        }}
      />
    </View>
  );
}
