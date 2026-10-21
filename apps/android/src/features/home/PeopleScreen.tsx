import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import * as api from '../../api';
import {
  Avatar,
  Centered,
  InlineNotice,
  ScreenIntro,
} from '../../components/Common';
import {
  allPages,
  presenceLabel,
  type PersonRow,
  type Presence,
} from '../../presence';
import { styles } from '../../styles';

export function PeopleScreen({
  onExpired,
  onOpen,
  onSearch,
  presence,
}: {
  onExpired: () => void;
  onOpen: (conversation: api.Conversation) => void;
  onSearch: () => void;
  presence: Record<string, Presence>;
}) {
  const [section, setSection] = useState<'friends' | 'incoming' | 'outgoing'>(
    'friends',
  );
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const path =
        section === 'friends'
          ? '/friends'
          : `/friend-requests?direction=${section}`;
      setRows(await allPages<PersonRow>(path));
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setLoading(false);
    }
  }, [onExpired, section]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    row: PersonRow,
    action: 'accept' | 'reject' | 'cancel' | 'remove' | 'message',
  ) {
    if (busyId) return;
    setBusyId(row.id);
    setError('');
    setNotice('');
    try {
      if (action === 'message') {
        const result = await api.authenticated<{
          conversation: api.Conversation;
        }>('/conversations', { type: 'direct', recipientId: row.user.id });
        onOpen(result.conversation);
        return;
      }
      if (action === 'remove')
        await api.authenticated(`/friends/${row.user.id}`, undefined, 'DELETE');
      else
        await api.authenticated(
          `/friend-requests/${row.id}`,
          { action },
          'PATCH',
        );
      setNotice(
        action === 'accept'
          ? 'Đã chấp nhận lời mời.'
          : action === 'remove'
            ? 'Đã hủy kết bạn.'
            : action === 'cancel'
              ? 'Đã thu hồi lời mời.'
              : 'Đã từ chối lời mời.',
      );
      await load();
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setBusyId('');
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenIntro title="Kết nối" caption="Bạn bè và lời mời của bạn" />
      <View style={styles.segmentedControl}>
        {(
          [
            ['friends', 'Bạn bè'],
            ['incoming', 'Lời mời'],
            ['outgoing', 'Đã gửi'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === key }}
            onPress={() => setSection(key)}
            style={[
              styles.segmentButton,
              section === key && styles.segmentButtonActive,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                section === key && styles.segmentTextActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {!!notice && (
        <View style={styles.listSuccessNotice}>
          <Text style={styles.successNoticeText}>{notice}</Text>
        </View>
      )}
      {!!error && (
        <View style={styles.listNotice}>
          <InlineNotice message={error} onRetry={() => void load()} />
        </View>
      )}
      {loading ? (
        <Centered label="Đang tải danh sách…" />
      ) : (
        <FlatList
          contentContainerStyle={styles.peopleList}
          data={rows}
          keyExtractor={row => row.id}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <View style={styles.emptySymbol}>
                <Text style={styles.emptySymbolText}>P</Text>
              </View>
              <Text style={styles.emptyTitle}>
                {section === 'friends'
                  ? 'Chưa có bạn bè'
                  : section === 'incoming'
                    ? 'Chưa có lời mời mới'
                    : 'Không có lời mời đang chờ'}
              </Text>
              <Text style={styles.empty}>
                {section === 'friends'
                  ? 'Tìm người bạn muốn kết nối để bắt đầu trò chuyện.'
                  : 'Lời mời kết bạn sẽ xuất hiện tại đây.'}
              </Text>
              {section === 'friends' && (
                <Pressable onPress={onSearch} style={styles.compactPrimary}>
                  <Text style={styles.compactPrimaryText}>Tìm bạn</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.personRow}>
              <View style={styles.presenceAvatar}>
                <Avatar peer={item.user} />
                {section === 'friends' && presence[item.user.id]?.online && (
                  <View style={styles.presenceDot} />
                )}
              </View>
              <View style={styles.personIdentity}>
                <Text numberOfLines={2} style={styles.personName}>
                  {item.user.displayName}
                </Text>
                {section === 'friends' && (
                  <Text numberOfLines={1} style={styles.personPresence}>
                    {presenceLabel(presence[item.user.id])}
                  </Text>
                )}
              </View>
              <View style={styles.personActions}>
                {section === 'friends' ? (
                  <>
                    <Pressable
                      disabled={!!busyId}
                      onPress={() => void act(item, 'message')}
                      style={styles.smallPrimary}
                    >
                      <Text style={styles.smallPrimaryText}>Nhắn tin</Text>
                    </Pressable>
                    <Pressable
                      disabled={!!busyId}
                      onPress={() =>
                        Alert.alert(
                          'Hủy kết bạn?',
                          `Bạn sẽ không thể nhắn tin mới cho ${item.user.displayName} cho đến khi kết bạn lại.`,
                          [
                            { text: 'Giữ lại', style: 'cancel' },
                            {
                              text: 'Hủy kết bạn',
                              style: 'destructive',
                              onPress: () => void act(item, 'remove'),
                            },
                          ],
                        )
                      }
                      style={styles.smallSecondary}
                    >
                      <Text style={styles.smallSecondaryText}>Hủy</Text>
                    </Pressable>
                  </>
                ) : section === 'incoming' ? (
                  <>
                    <Pressable
                      disabled={!!busyId}
                      onPress={() => void act(item, 'accept')}
                      style={styles.smallPrimary}
                    >
                      <Text style={styles.smallPrimaryText}>Chấp nhận</Text>
                    </Pressable>
                    <Pressable
                      disabled={!!busyId}
                      onPress={() => void act(item, 'reject')}
                      style={styles.smallSecondary}
                    >
                      <Text style={styles.smallSecondaryText}>Từ chối</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    disabled={!!busyId}
                    onPress={() => void act(item, 'cancel')}
                    style={styles.smallSecondary}
                  >
                    <Text style={styles.smallSecondaryText}>Thu hồi</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
