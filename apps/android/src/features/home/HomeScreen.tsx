import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as api from '../../api';
import { Avatar, Brand } from '../../components/Common';
import { usePresence } from '../../presence';
import { styles } from '../../styles';
import { AccountScreen } from './AccountScreen';
import { ConversationList } from './ConversationList';
import { PeopleScreen } from './PeopleScreen';
import { SearchPeopleScreen } from './SearchPeopleScreen';

type MainTab = 'chats' | 'people' | 'search' | 'account';

export function Home({
  user,
  onUser,
  onOpen,
  onExpired,
}: {
  user: api.User;
  onUser: (user: api.User) => void;
  onOpen: (conversation: api.Conversation) => void;
  onExpired: () => void;
}) {
  const [tab, setTab] = useState<MainTab>('chats');
  const presence = usePresence(user.id, onExpired);

  useEffect(() => {
    void api
      .me()
      .then(onUser)
      .catch(next => {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
      });
  }, [onExpired, onUser]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      // The local secure token is cleared even if revocation cannot reach API.
    } finally {
      onExpired();
    }
  }

  return (
    <View style={styles.home}>
      <View style={styles.appBar}>
        <Brand />
        <View style={styles.accountArea}>
          <Avatar peer={user} size={34} />
          <Pressable
            accessibilityLabel={`Mở tài khoản của ${user.displayName}`}
            accessibilityRole="button"
            onPress={() => setTab('account')}
            style={({ pressed }) => [
              styles.accountShortcut,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={styles.accountShortcutText}>
              {user.displayName}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.homeContent}>
        {tab === 'chats' && (
          <ConversationList
            onOpen={onOpen}
            onExpired={onExpired}
            presence={presence}
          />
        )}
        {tab === 'people' && (
          <PeopleScreen
            onExpired={onExpired}
            onOpen={onOpen}
            onSearch={() => setTab('search')}
            presence={presence}
          />
        )}
        {tab === 'search' && <SearchPeopleScreen onExpired={onExpired} />}
        {tab === 'account' && (
          <AccountScreen
            user={user}
            onExpired={onExpired}
            onLogout={logout}
            onUser={onUser}
          />
        )}
      </View>
      <View style={styles.bottomNav}>
        {(
          [
            ['chats', '▣', 'Tin nhắn'],
            ['people', '♟', 'Bạn bè'],
            ['search', '⌕', 'Tìm bạn'],
            ['account', '●', 'Tài khoản'],
          ] as const
        ).map(([key, icon, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={styles.bottomNavItem}
          >
            <Text
              style={[
                styles.bottomNavIcon,
                tab === key && styles.bottomNavTextActive,
              ]}
            >
              {icon}
            </Text>
            <Text
              style={[
                styles.bottomNavText,
                tab === key && styles.bottomNavTextActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
