import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import * as api from '../../api';
import { Avatar, Brand } from '../../components/Common';
import { NavIcon, UiGlyph } from '../../components/Icons';
import { usePresence, type Peer } from '../../presence';
import { styles } from '../../styles';
import { AccountScreen } from './AccountScreen';
import { ConversationList } from './ConversationList';
import { PeopleScreen } from './PeopleScreen';
import { SearchPeopleScreen } from './SearchPeopleScreen';

type MainTab = 'chats' | 'people' | 'search' | 'account';

interface NoticeItem {
  id: string;
  type: string;
  title?: string;
  body?: string;
  readAt?: string | null;
  createdAt: string;
  actor?: Peer | null;
  data?: {
    actorId?: string;
    actorName?: string;
    actorAvatarUrl?: string | null;
    conversationId?: string;
    senderId?: string;
  } | null;
}

interface NoticePage {
  items: NoticeItem[];
  nextCursor: string | null;
  unreadCount: number;
}

interface SessionDevice {
  id: string;
  deviceName?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  current?: boolean;
}

function relativeNoticeTime(createdAt: string) {
  const ms = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 60000) return 'Vừa xong';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function Home({
  active = true,
  user,
  onUser,
  onOpen,
  onPreload,
  onExpired,
}: {
  active?: boolean;
  user: api.User;
  onUser: (user: api.User) => void;
  onOpen: (conversation: api.Conversation, messageId?: string) => void;
  onPreload: (conversation: api.Conversation) => void;
  onExpired: () => void;
}) {
  const [tab, setTab] = useState<MainTab>('chats');
  const [unreadCount, setUnreadCount] = useState(0);
  const [incomingCount, setIncomingCount] = useState(0);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionDevice[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [noticeCount, setNoticeCount] = useState(0);
  const [noticeFilterUnread, setNoticeFilterUnread] = useState(false);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const presence = usePresence(user.id, onExpired);

  useEffect(() => {
    void api
      .me()
      .then(onUser)
      .catch(next => {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
      });
  }, [onExpired, onUser]);

  const loadCountsAndNotices = useCallback(async () => {
    try {
      const [incomingPage, noticePage] = await Promise.all([
        api
          .authenticated<api.Page<{ id: string }>>(
            '/friend-requests?direction=incoming&limit=20',
          )
          .catch(() => ({ items: [], nextCursor: null })),
        api
          .authenticated<NoticePage>('/notifications?limit=20')
          .catch(() => ({ items: [], nextCursor: null, unreadCount: 0 })),
      ]);
      setIncomingCount(incomingPage.items.length);
      setNotices(noticePage.items);
      setNoticeCount(noticePage.unreadCount ?? 0);
    } catch {
      /* Background polling ignores transient errors. */
    }
  }, []);

  useEffect(() => {
    if (!active || tab === 'chats') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setTab('chats');
      return true;
    });
    return () => sub.remove();
  }, [active, tab]);

  useEffect(() => {
    if (!active) return;
    void loadCountsAndNotices();
    const timer = setInterval(() => void loadCountsAndNotices(), 20000);
    return () => clearInterval(timer);
  }, [active, loadCountsAndNotices, tab, user.id]);

  async function openNotifications() {
    setNoticesOpen(true);
    setNoticesLoading(true);
    try {
      const page = await api.authenticated<NoticePage>(
        '/notifications?limit=20',
      );
      setNotices(page.items);
      setNoticeCount(page.unreadCount ?? 0);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
    } finally {
      setNoticesLoading(false);
    }
  }

  async function markNoticeRead(id?: string) {
    const nowIso = new Date().toISOString();
    setNotices(prev =>
      prev.map(item =>
        !id || item.id === id
          ? { ...item, readAt: item.readAt ?? nowIso }
          : item,
      ),
    );
    setNoticeCount(prev => (id ? Math.max(0, prev - 1) : 0));
    try {
      await api.authenticated(
        `/notifications/${id ? `${id}/read` : 'read-all'}`,
        undefined,
        'PATCH',
      );
    } catch {
      void loadCountsAndNotices();
    }
  }

  async function openSessions() {
    setAccountMenuOpen(false);
    setSessionsOpen(true);
    setSessionsLoading(true);
    try {
      const res = await api.authenticated<{ items: SessionDevice[] }>(
        '/auth/sessions',
      );
      setSessions(res.items ?? []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function revokeSession(sessionId: string) {
    try {
      await api.authenticated(
        `/auth/sessions/${sessionId}`,
        undefined,
        'DELETE',
      );
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch {
      /* Ignore */
    }
  }

  async function logout() {
    setAccountMenuOpen(false);
    try {
      await api.logout();
    } catch {
      // The local secure token is cleared even if revocation cannot reach API.
    } finally {
      onExpired();
    }
  }

  const isFriendsTab = tab === 'people' || tab === 'search';
  const visibleNotices = noticeFilterUnread
    ? notices.filter(n => !n.readAt)
    : notices;

  return (
    <View style={styles.home}>
      <View style={styles.webHeader}>
        <View style={styles.webHeaderTopRow}>
          <Brand />
          <View style={styles.webHeaderActions}>
            <Pressable
              accessibilityLabel={`Thông báo, ${noticeCount} chưa đọc`}
              accessibilityRole="button"
              onPress={() => void openNotifications()}
              style={({ pressed }) => [
                styles.notificationBellBtn,
                pressed && styles.pressed,
              ]}
            >
              <UiGlyph name="bell" color="#533a28" size={19} />
              {noticeCount > 0 && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>
                    {noticeCount > 99 ? '99+' : noticeCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityLabel={`Tài khoản của ${user.displayName}`}
              accessibilityRole="button"
              onPress={() => setAccountMenuOpen(true)}
              style={({ pressed }) => [
                styles.accountToggleBtn,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.accountAvatarRing}>
                <Avatar peer={user} size={36} />
              </View>
              <View style={styles.accountChevronBadge}>
                <UiGlyph name="chevronDown" color="#5d4736" size={11} />
              </View>
            </Pressable>
          </View>
        </View>
        <View style={styles.webHeaderNavRow}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'chats' }}
            onPress={() => setTab('chats')}
            style={[
              styles.webHeaderNavBtn,
              tab === 'chats' && styles.webHeaderNavBtnActive,
            ]}
          >
            <NavIcon
              name="chats"
              color={tab === 'chats' ? '#a64d25' : '#81664e'}
              size={17}
            />
            <Text
              style={[
                styles.webHeaderNavText,
                tab === 'chats' && styles.webHeaderNavTextActive,
              ]}
            >
              Đoạn chat
            </Text>
            {unreadCount > 0 && (
              <View style={styles.webHeaderNavBadge}>
                <Text style={styles.webHeaderNavBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: isFriendsTab }}
            onPress={() => setTab('people')}
            style={[
              styles.webHeaderNavBtn,
              isFriendsTab && styles.webHeaderNavBtnActive,
            ]}
          >
            <NavIcon
              name="people"
              color={isFriendsTab ? '#a64d25' : '#81664e'}
              size={17}
            />
            <Text
              style={[
                styles.webHeaderNavText,
                isFriendsTab && styles.webHeaderNavTextActive,
              ]}
            >
              Bạn bè
            </Text>
            {incomingCount > 0 && (
              <View style={styles.webHeaderNavBadge}>
                <Text style={styles.webHeaderNavBadgeText}>
                  {incomingCount > 99 ? '99+' : incomingCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.webHomeLayout}>
        <View style={styles.webHomeMainCard}>
          {tab === 'chats' && (
            <ConversationList
              active={active}
              user={user}
              onOpen={onOpen}
              onPreload={onPreload}
              onExpired={onExpired}
              onUnreadCount={setUnreadCount}
              presence={presence}
            />
          )}
          {tab === 'people' && (
            <PeopleScreen
              incomingCount={incomingCount}
              onIncomingCount={setIncomingCount}
              onExpired={onExpired}
              onOpen={onOpen}
              onSearch={() => setTab('search')}
              presence={presence}
            />
          )}
          {tab === 'search' && (
            <SearchPeopleScreen
              incomingCount={incomingCount}
              onExpired={onExpired}
              onOpen={onOpen}
              onSwitchSection={section => {
                if (section !== 'search') setTab('people');
              }}
              onGoRequests={() => setTab('people')}
            />
          )}
          {tab === 'account' && (
            <AccountScreen
              user={user}
              onExpired={onExpired}
              onLogout={logout}
              onUser={onUser}
            />
          )}
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={accountMenuOpen}
        onRequestClose={() => setAccountMenuOpen(false)}
      >
        <Pressable
          style={styles.accountMenuBackdrop}
          onPress={() => setAccountMenuOpen(false)}
        >
          <Pressable style={styles.accountDropdownMenu} onPress={() => {}}>
            <Text numberOfLines={1} style={styles.accountDropdownName}>
              {user.displayName}
            </Text>
            <Pressable
              onPress={() => void openSessions()}
              style={({ pressed }) => [
                styles.accountDropdownItem,
                pressed && styles.accountDropdownItemPressed,
              ]}
            >
              <Text style={styles.accountDropdownItemText}>
                Thiết bị đăng nhập
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAccountMenuOpen(false);
                setTab('account');
              }}
              style={({ pressed }) => [
                styles.accountDropdownItem,
                pressed && styles.accountDropdownItemPressed,
              ]}
            >
              <Text style={styles.accountDropdownItemText}>
                Tài khoản của tôi
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void logout()}
              style={({ pressed }) => [
                styles.accountDropdownItem,
                pressed && styles.accountDropdownItemPressed,
              ]}
            >
              <Text
                style={[
                  styles.accountDropdownItemText,
                  { color: '#a13d34', fontWeight: '700' },
                ]}
              >
                Đăng xuất
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={noticesOpen}
        onRequestClose={() => setNoticesOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setNoticesOpen(false)}
        >
          <Pressable style={styles.notificationModalCard} onPress={() => {}}>
            <View style={styles.notificationHeader}>
              <View>
                <Text style={styles.notificationTitle}>Thông báo</Text>
                <Text style={styles.notificationSubtitle}>
                  {noticeCount} thông báo chưa đọc
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Đóng thông báo"
                onPress={() => setNoticesOpen(false)}
                style={styles.noteCloseBtn}
              >
                <UiGlyph name="close" color="#5d493f" size={16} />
              </Pressable>
            </View>
            <View style={styles.notificationToolbar}>
              <Pressable
                onPress={() => setNoticeFilterUnread(false)}
                style={[
                  styles.notificationFilterBtn,
                  !noticeFilterUnread && styles.notificationFilterBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.notificationFilterText,
                    !noticeFilterUnread && styles.notificationFilterTextActive,
                  ]}
                >
                  Tất cả
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNoticeFilterUnread(true)}
                style={[
                  styles.notificationFilterBtn,
                  noticeFilterUnread && styles.notificationFilterBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.notificationFilterText,
                    noticeFilterUnread && styles.notificationFilterTextActive,
                  ]}
                >
                  Chưa đọc
                </Text>
              </Pressable>
              <Pressable
                disabled={!noticeCount}
                onPress={() => void markNoticeRead()}
                style={[
                  styles.notificationReadAllBtn,
                  !noticeCount && styles.disabled,
                ]}
              >
                <Text style={styles.notificationReadAllText}>Đọc tất cả</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.notificationList}>
              {noticesLoading && !visibleNotices.length ? (
                <ActivityIndicator
                  color="#b75020"
                  style={{ marginVertical: 24 }}
                />
              ) : !visibleNotices.length ? (
                <View style={styles.emptyInline}>
                  <Text style={styles.emptyTitle}>
                    {noticeFilterUnread
                      ? 'Bạn đã đọc hết thông báo'
                      : 'Chưa có thông báo'}
                  </Text>
                  <Text style={styles.empty}>
                    Lời mời kết bạn, cuộc gọi nhỡ và kết quả AI sẽ xuất hiện ở
                    đây.
                  </Text>
                </View>
              ) : (
                visibleNotices.map(item => {
                  const actorName =
                    item.actor?.displayName ?? item.data?.actorName ?? '';
                  const text =
                    item.body ??
                    item.title ??
                    (item.type === 'friend_request'
                      ? 'đã gửi lời mời kết bạn'
                      : item.type === 'friend_accepted'
                        ? 'đã chấp nhận lời mời kết bạn'
                        : 'Thông báo mới');
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        if (!item.readAt) void markNoticeRead(item.id);
                        setNoticesOpen(false);
                        if (
                          item.type === 'friend_request' ||
                          item.type === 'friend_accepted'
                        ) {
                          setTab('people');
                        } else {
                          setTab('chats');
                        }
                      }}
                      style={[
                        styles.notificationItem,
                        !item.readAt && styles.notificationItemUnread,
                      ]}
                    >
                      <Avatar
                        peer={{
                          id: item.actor?.id ?? item.data?.actorId ?? item.id,
                          displayName: actorName || 'PingPong',
                          avatarUrl:
                            item.actor?.avatarUrl ?? item.data?.actorAvatarUrl,
                        }}
                        size={40}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.notificationBodyText}>
                          {actorName ? (
                            <Text style={{ fontWeight: '700' }}>
                              {actorName}{' '}
                            </Text>
                          ) : null}
                          {text}
                        </Text>
                        <Text style={styles.notificationTimeText}>
                          {relativeNoticeTime(item.createdAt)}
                        </Text>
                      </View>
                      {!item.readAt && <View style={styles.notificationDot} />}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={sessionsOpen}
        onRequestClose={() => setSessionsOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setSessionsOpen(false)}
        >
          <Pressable style={styles.notificationModalCard} onPress={() => {}}>
            <View style={styles.notificationHeader}>
              <View>
                <Text style={styles.notificationTitle}>Thiết bị đăng nhập</Text>
                <Text style={styles.notificationSubtitle}>
                  Các phiên đang hoạt động của bạn
                </Text>
              </View>
              <Pressable
                onPress={() => setSessionsOpen(false)}
                style={styles.noteCloseBtn}
              >
                <UiGlyph name="close" color="#5d493f" size={16} />
              </Pressable>
            </View>
            <ScrollView style={styles.notificationList}>
              {sessionsLoading ? (
                <ActivityIndicator
                  color="#b75020"
                  style={{ marginVertical: 24 }}
                />
              ) : !sessions.length ? (
                <View style={styles.emptyInline}>
                  <Text style={styles.emptyTitle}>Phiên hiện tại</Text>
                  <Text style={styles.empty}>
                    PingPong Android · Đang hoạt động
                  </Text>
                </View>
              ) : (
                sessions.map(s => (
                  <View key={s.id} style={styles.notificationItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.conversationName}>
                        {s.deviceName || s.userAgent || 'Thiết bị PingPong'}
                        {s.current ? ' (Hiện tại)' : ''}
                      </Text>
                      <Text style={styles.personPresence}>
                        {relativeNoticeTime(s.lastUsedAt ?? s.createdAt)}
                      </Text>
                    </View>
                    {!s.current && (
                      <Pressable
                        onPress={() => void revokeSession(s.id)}
                        style={styles.smallSecondary}
                      >
                        <Text style={styles.smallSecondaryText}>Đăng xuất</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
