import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import { Avatar, InlineNotice, ScreenIntro } from '../../components/Common';
import type { PersonRow } from '../../presence';
import { styles } from '../../styles';

export function SearchPeopleScreen({ onExpired }: { onExpired: () => void }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [sent, setSent] = useState(new Set<string>());
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  async function search() {
    const value = query.trim();
    if (value.length < 2 || value.length > 100) {
      setError('Nhập tên hiển thị từ 2 đến 100 ký tự.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const page = await api.authenticated<api.Page<PersonRow>>(
        `/users?query=${encodeURIComponent(value)}&limit=50`,
      );
      setRows(page.items);
      setSearched(true);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setLoading(false);
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

  return (
    <View style={styles.screen}>
      <ScreenIntro title="Tìm bạn" caption="Tìm theo tên hiển thị" />
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
          placeholderTextColor="#7c8e98"
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
          const invited = sent.has(item.user.id);
          return (
            <View style={styles.personRow}>
              <Avatar peer={item.user} />
              <Text numberOfLines={2} style={styles.personName}>
                {item.user.displayName}
              </Text>
              <Pressable
                disabled={invited || !!busyId}
                onPress={() => void invite(item)}
                style={[
                  styles.smallPrimary,
                  invited && styles.smallButtonDisabled,
                ]}
              >
                <Text style={styles.smallPrimaryText}>
                  {invited ? 'Đã gửi' : 'Kết bạn'}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}
