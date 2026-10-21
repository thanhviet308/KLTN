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
import { allPages, type Peer, type PersonRow } from '../../presence';
import { styles } from '../../styles';

type ConversationMember = {
  id: string;
  user: Peer;
  role: 'owner' | 'admin' | 'member';
};

export function ConversationInfo({
  conversation,
  currentTitle,
  members,
  user,
  onClose,
  onExpired,
  onLeave,
  onMembers,
  onTitle,
}: {
  conversation: api.Conversation;
  currentTitle: string;
  members: ConversationMember[];
  user: api.User;
  onClose: () => void;
  onExpired: () => void;
  onLeave: () => void;
  onMembers: (members: ConversationMember[]) => void;
  onTitle: (title: string) => void;
}) {
  const [rename, setRename] = useState(currentTitle);
  const [friends, setFriends] = useState<Peer[]>([]);
  const [addUserId, setAddUserId] = useState('');
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

  return (
    <View style={styles.page}>
      <View style={styles.chatHeader}>
        <Pressable onPress={onClose} style={styles.backButton}>
          <Text style={styles.back}>‹</Text>
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
            <Text style={styles.infoSectionTitle}>Thêm thành viên</Text>
            <View style={styles.addMemberList}>
              {availableFriends.map(friend => (
                <Pressable
                  key={friend.id}
                  onPress={() => setAddUserId(friend.id)}
                  style={[
                    styles.addMemberOption,
                    addUserId === friend.id && styles.addMemberOptionActive,
                  ]}
                >
                  <Avatar peer={friend} size={34} />
                  <Text style={styles.addMemberName}>{friend.displayName}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              disabled={busy || !addUserId}
              onPress={() =>
                void run(async () => {
                  await api.authenticated(
                    `/conversations/${conversation.id}/members`,
                    { userId: addUserId },
                  );
                  setAddUserId('');
                }, 'Đã thêm thành viên.')
              }
              style={styles.compactPrimary}
            >
              <Text style={styles.compactPrimaryText}>Thêm vào nhóm</Text>
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
