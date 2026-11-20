import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import { Avatar, InlineNotice } from '../../components/Common';
import { UiGlyph } from '../../components/Icons';
import { allPages, type Peer, type PersonRow } from '../../presence';
import { styles } from '../../styles';

type ConversationMember = {
  id: string;
  user: Peer;
  role: 'owner' | 'admin' | 'member';
};

const THEME_OPTIONS = [
  ['default', 'Mặc định', '#faf7f0'],
  ['ocean', 'Biển xanh', '#e7f3f8'],
  ['mint', 'Bạc hà', '#e8f5ee'],
  ['sunset', 'Hoàng hôn', '#fceee2'],
  ['rose', 'Hoa hồng', '#fbeaf0'],
  ['sand', 'Cát ấm', '#f3eadc'],
] as const;

export function ConversationInfo({
  conversation,
  currentTitle,
  currentBackground = 'default',
  nicknames = {},
  members,
  user,
  onClose,
  onClearHistory,
  onExpired,
  onLeave,
  onMembers,
  onTitle,
  onBackgroundChange,
  onNicknamesChange,
}: {
  conversation: api.Conversation;
  currentTitle: string;
  currentBackground?: string;
  nicknames?: Record<string, string>;
  members: ConversationMember[];
  user: api.User;
  onClose: () => void;
  onClearHistory: (clearedAfterSequence: string) => void;
  onExpired: () => void;
  onLeave: () => void;
  onMembers: (members: ConversationMember[]) => void;
  onTitle: (title: string) => void;
  onBackgroundChange?: (background: string) => void;
  onNicknamesChange?: (nicknames: Record<string, string>) => void;
}) {
  const [rename, setRename] = useState(currentTitle);
  const [targetMemberId, setTargetMemberId] = useState(
    members[0]?.id ?? user.id,
  );
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [friends, setFriends] = useState<Peer[]>([]);
  const [friendFilter, setFriendFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isGroup = conversation.type === 'group';
  const manager = isGroup && conversation.membership.role !== 'member';
  const owner = isGroup && conversation.membership.role === 'owner';

  const refresh = useCallback(async () => {
    try {
      const [nextMembers, friendRows] = await Promise.all([
        allPages<ConversationMember>(
          `/conversations/${conversation.id}/members`,
        ),
        isGroup ? allPages<PersonRow>('/friends') : Promise.resolve([]),
      ]);
      onMembers(nextMembers);
      setFriends(friendRows.map(row => row.user));
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    }
  }, [conversation.id, isGroup, onExpired, onMembers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeTargetMember =
    members.find(m => m.id === targetMemberId) ?? members[0];

  useEffect(() => {
    if (activeTargetMember) {
      setNicknameDraft(
        nicknames[activeTargetMember.id] ??
          nicknames[activeTargetMember.user.id] ??
          '',
      );
    }
  }, [activeTargetMember, nicknames]);

  async function run(
    work: () => Promise<void>,
    success: string,
    shouldRefresh = true,
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
      if (shouldRefresh) await refresh();
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setBusy(false);
    }
  }

  const availableFriends = friends.filter(
    friend => !members.some(member => member.user.id === friend.id),
  );
  const filteredFriends = availableFriends.filter(friend =>
    friend.displayName
      .toLocaleLowerCase('vi')
      .includes(friendFilter.trim().toLocaleLowerCase('vi')),
  );

  return (
    <View style={styles.page}>
      <View style={styles.chatHeader}>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.infoButtonActive,
          ]}
        >
          <UiGlyph name="back" color="#b75020" size={18} />
        </Pressable>
        <Text style={styles.infoHeaderTitle}>Thông tin trò chuyện</Text>
      </View>
      <ScrollView contentContainerStyle={styles.infoScreen}>
        <View style={styles.infoHero}>
          <Avatar
            peer={{
              id: conversation.peer?.id ?? conversation.id,
              displayName: currentTitle,
              avatarUrl: conversation.peer?.avatarUrl,
            }}
            size={72}
          />
          <Text style={styles.infoTitle}>{currentTitle}</Text>
          <Text style={styles.infoCaption}>
            {isGroup
              ? `${members.length} thành viên · ${
                  conversation.membership.role === 'owner'
                    ? 'Bạn là chủ nhóm'
                    : conversation.membership.role === 'admin'
                      ? 'Bạn là quản trị viên'
                      : 'Bạn là thành viên'
                }`
              : 'Cuộc trò chuyện riêng'}
          </Text>
        </View>
        {!!notice && (
          <View style={styles.listSuccessNotice}>
            <Text style={styles.successNoticeText}>{notice}</Text>
          </View>
        )}
        {!!error && (
          <View style={styles.listNotice}>
            <InlineNotice message={error} onRetry={() => void refresh()} />
          </View>
        )}
        <View style={styles.infoCard}>
          <Text style={styles.infoSectionTitle}>Tùy chỉnh đoạn chat</Text>
          <Text
            style={[styles.infoCaption, { marginTop: 0, marginBottom: 10 }]}
          >
            Biệt danh và nền được hiển thị cho mọi thành viên trong đoạn chat
            này.
          </Text>
          {members.length > 0 && activeTargetMember && (
            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.fieldLabel, { marginTop: 4 }]}>
                Đặt biệt danh cho
              </Text>
              <View style={styles.nicknameMemberChips}>
                {members.map(m => {
                  const selected = m.id === activeTargetMember.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setTargetMemberId(m.id)}
                      style={[
                        styles.nicknameMemberChip,
                        selected && styles.nicknameMemberChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.nicknameMemberChipText,
                          selected && styles.nicknameMemberChipTextActive,
                        ]}
                      >
                        {m.user.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                editable={!busy}
                maxLength={50}
                onChangeText={setNicknameDraft}
                placeholder="Nhập biệt danh (để trống để dùng tên gốc)"
                placeholderTextColor="#8c7662"
                style={styles.input}
                value={nicknameDraft}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void run(
                      async () => {
                        const res = await api.authenticated<{
                          conversation: api.Conversation;
                        }>(
                          `/conversations/${conversation.id}/members/${activeTargetMember.id}/nickname`,
                          { nickname: nicknameDraft.trim() },
                          'PATCH',
                        );
                        onNicknamesChange?.(res.conversation.nicknames ?? {});
                      },
                      'Đã cập nhật biệt danh.',
                      false,
                    )
                  }
                  style={styles.smallPrimary}
                >
                  <Text style={styles.smallPrimaryText}>Lưu biệt danh</Text>
                </Pressable>
                {!!(
                  nicknames[activeTargetMember.id] ||
                  nicknames[activeTargetMember.user.id]
                ) && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      void run(
                        async () => {
                          const res = await api.authenticated<{
                            conversation: api.Conversation;
                          }>(
                            `/conversations/${conversation.id}/members/${activeTargetMember.id}/nickname`,
                            { nickname: '' },
                            'PATCH',
                          );
                          setNicknameDraft('');
                          onNicknamesChange?.(res.conversation.nicknames ?? {});
                        },
                        'Đã khôi phục tên gốc.',
                        false,
                      )
                    }
                    style={styles.smallSecondary}
                  >
                    <Text style={styles.smallSecondaryText}>
                      Khôi phục tên gốc
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
          <Text style={[styles.fieldLabel, { marginTop: 2 }]}>
            Nền đoạn chat
          </Text>
          <View style={styles.themeSwatchGrid}>
            {THEME_OPTIONS.map(([val, label, swatchColor]) => {
              const active = currentBackground === val;
              return (
                <Pressable
                  key={val}
                  disabled={busy}
                  onPress={() =>
                    void run(
                      async () => {
                        const res = await api.authenticated<{
                          conversation: api.Conversation;
                        }>(
                          `/conversations/${conversation.id}/background`,
                          { background: val },
                          'PATCH',
                        );
                        onBackgroundChange?.(
                          res.conversation.background ?? val,
                        );
                      },
                      'Đã cập nhật nền đoạn chat.',
                      false,
                    )
                  }
                  style={[
                    styles.themeSwatchOption,
                    active && styles.themeSwatchOptionActive,
                  ]}
                >
                  <View
                    style={[
                      styles.themeSwatchCircle,
                      { backgroundColor: swatchColor },
                    ]}
                  />
                  <Text style={styles.themeSwatchLabel}>{label}</Text>
                  {active && (
                    <Text style={{ color: '#b75020', fontWeight: '800' }}>
                      ✓
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
        {manager && (
          <View style={styles.infoCard}>
            <Text style={styles.infoSectionTitle}>Tên nhóm</Text>
            <TextInput
              editable={!busy}
              maxLength={200}
              onChangeText={setRename}
              style={styles.input}
              value={rename}
            />
            <Pressable
              disabled={
                busy || !rename.trim() || rename.trim() === currentTitle
              }
              onPress={() =>
                void run(async () => {
                  await api.authenticated(
                    `/conversations/${conversation.id}`,
                    { title: rename.trim() },
                    'PATCH',
                  );
                  onTitle(rename.trim());
                }, 'Đã đổi tên nhóm.')
              }
              style={styles.compactPrimary}
            >
              <Text style={styles.compactPrimaryText}>Lưu tên nhóm</Text>
            </Pressable>
          </View>
        )}
        {manager && availableFriends.length > 0 && (
          <View style={styles.infoCard}>
            <View style={styles.pickerHeading}>
              <Text style={styles.infoSectionTitle}>Thêm thành viên</Text>
              <Text style={styles.pickerCount}>
                {selectedIds.length} đã chọn
              </Text>
            </View>
            {availableFriends.length > 4 && (
              <View style={styles.searchBarCompact}>
                <Text style={styles.searchIcon}>⌕</Text>
                <TextInput
                  accessibilityLabel="Lọc bạn bè để thêm vào nhóm"
                  onChangeText={setFriendFilter}
                  placeholder="Tìm bạn bè…"
                  placeholderTextColor="#8c7662"
                  style={styles.searchInput}
                  value={friendFilter}
                />
              </View>
            )}
            <View style={styles.addMemberList}>
              {filteredFriends.map(friend => {
                const checked = selectedIds.includes(friend.id);
                return (
                  <Pressable
                    key={friend.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() =>
                      setSelectedIds(prev =>
                        checked
                          ? prev.filter(id => id !== friend.id)
                          : [...prev, friend.id],
                      )
                    }
                    style={[
                      styles.addMemberOption,
                      checked && styles.addMemberOptionActive,
                    ]}
                  >
                    <Avatar peer={friend} size={34} />
                    <Text style={styles.addMemberName}>
                      {friend.displayName}
                    </Text>
                    <View
                      style={[
                        styles.checkbox,
                        checked && styles.checkboxChecked,
                      ]}
                    >
                      <Text style={styles.checkboxText}>
                        {checked ? '✓' : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              disabled={busy || !selectedIds.length}
              onPress={() =>
                void run(
                  async () => {
                    for (const id of selectedIds) {
                      await api.authenticated(
                        `/conversations/${conversation.id}/members`,
                        { userId: id },
                      );
                    }
                    setSelectedIds([]);
                  },
                  selectedIds.length > 1
                    ? `Đã thêm ${selectedIds.length} thành viên.`
                    : 'Đã thêm thành viên.',
                )
              }
              style={[
                styles.compactPrimary,
                (busy || !selectedIds.length) && styles.disabled,
              ]}
            >
              <Text style={styles.compactPrimaryText}>
                {selectedIds.length > 1
                  ? `Thêm ${selectedIds.length} thành viên`
                  : 'Thêm vào nhóm'}
              </Text>
            </Pressable>
          </View>
        )}
        <View style={styles.infoCard}>
          <Text style={styles.infoSectionTitle}>
            {isGroup ? `Thành viên (${members.length})` : 'Thành viên'}
          </Text>
          {members.map(member => {
            const self = member.user.id === user.id;
            return (
              <View key={member.id} style={styles.memberRow}>
                <Avatar peer={member.user} size={40} />
                <View style={styles.memberText}>
                  <Text numberOfLines={1} style={styles.memberName}>
                    {member.user.displayName}
                    {self ? ' (Bạn)' : ''}
                  </Text>
                  <Text style={styles.memberRole}>
                    {member.role === 'owner'
                      ? 'Chủ nhóm'
                      : member.role === 'admin'
                        ? 'Quản trị viên'
                        : 'Thành viên'}
                  </Text>
                </View>
                {owner && !self && member.role !== 'owner' && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      Alert.alert(
                        'Quản lý thành viên',
                        member.user.displayName,
                        [
                          {
                            text:
                              member.role === 'admin'
                                ? 'Gỡ quản trị'
                                : 'Đặt làm quản trị',
                            onPress: () =>
                              void run(
                                () =>
                                  api.authenticated(
                                    `/conversations/${conversation.id}/members/${member.user.id}`,
                                    {
                                      role:
                                        member.role === 'admin'
                                          ? 'member'
                                          : 'admin',
                                    },
                                    'PATCH',
                                  ),
                                'Đã cập nhật vai trò.',
                              ),
                          },
                          {
                            text: 'Chuyển quyền sở hữu',
                            onPress: () =>
                              Alert.alert(
                                'Chuyển quyền sở hữu?',
                                `Bạn sẽ không còn là chủ nhóm sau khi chuyển cho ${member.user.displayName}.`,
                                [
                                  { text: 'Hủy', style: 'cancel' },
                                  {
                                    text: 'Chuyển quyền',
                                    style: 'destructive',
                                    onPress: () =>
                                      void run(
                                        () =>
                                          api.authenticated(
                                            `/conversations/${conversation.id}/transfer-ownership`,
                                            { userId: member.user.id },
                                          ),
                                        'Đã chuyển quyền sở hữu.',
                                      ),
                                  },
                                ],
                              ),
                          },
                          {
                            text: 'Xóa khỏi nhóm',
                            style: 'destructive',
                            onPress: () =>
                              Alert.alert(
                                'Xóa khỏi nhóm?',
                                member.user.displayName,
                                [
                                  { text: 'Hủy', style: 'cancel' },
                                  {
                                    text: 'Xóa',
                                    style: 'destructive',
                                    onPress: () =>
                                      void run(
                                        () =>
                                          api.authenticated(
                                            `/conversations/${conversation.id}/members/${member.user.id}`,
                                            undefined,
                                            'DELETE',
                                          ),
                                        'Đã xóa thành viên.',
                                      ),
                                  },
                                ],
                              ),
                          },
                          { text: 'Đóng', style: 'cancel' },
                        ],
                      )
                    }
                    style={styles.memberMenu}
                  >
                    <Text style={styles.memberMenuText}>•••</Text>
                  </Pressable>
                )}
                {manager && !self && !owner && member.role === 'member' && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      Alert.alert('Xóa khỏi nhóm?', member.user.displayName, [
                        { text: 'Hủy', style: 'cancel' },
                        {
                          text: 'Xóa',
                          style: 'destructive',
                          onPress: () =>
                            void run(
                              () =>
                                api.authenticated(
                                  `/conversations/${conversation.id}/members/${member.user.id}`,
                                  undefined,
                                  'DELETE',
                                ),
                              'Đã xóa thành viên.',
                            ),
                        },
                      ])
                    }
                    style={styles.memberMenu}
                  >
                    <Text style={styles.memberMenuText}>Xóa</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        <Pressable
          disabled={busy}
          onPress={() =>
            Alert.alert(
              'Xóa lịch sử trò chuyện?',
              'Toàn bộ tin nhắn trước thời điểm này sẽ bị xóa khỏi tài khoản và thiết bị của bạn. Người khác vẫn giữ nguyên lịch sử của họ.',
              [
                { text: 'Hủy', style: 'cancel' },
                {
                  text: 'Xóa lịch sử',
                  style: 'destructive',
                  onPress: () =>
                    void run(
                      async () => {
                        const result = await api.authenticated<{
                          clearedAfterSequence: string;
                        }>(
                          `/conversations/${conversation.id}/history`,
                          undefined,
                          'DELETE',
                        );
                        onClearHistory(result.clearedAfterSequence);
                      },
                      '',
                      false,
                    ),
                },
              ],
            )
          }
          style={[styles.dangerWide, isGroup && !owner && { marginBottom: 10 }]}
        >
          <Text style={styles.dangerWideText}>Xóa lịch sử trò chuyện</Text>
        </Pressable>
        {isGroup && !owner && (
          <Pressable
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Rời nhóm?',
                'Bạn sẽ không thể xem tin nhắn mới sau khi rời nhóm.',
                [
                  { text: 'Ở lại', style: 'cancel' },
                  {
                    text: 'Rời nhóm',
                    style: 'destructive',
                    onPress: () =>
                      void run(
                        async () => {
                          await api.authenticated(
                            `/conversations/${conversation.id}/members/${user.id}`,
                            undefined,
                            'DELETE',
                          );
                          onLeave();
                        },
                        '',
                        false,
                      ),
                  },
                ],
              )
            }
            style={styles.dangerWide}
          >
            <Text style={styles.dangerWideText}>Rời nhóm</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
