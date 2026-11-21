import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StatusBar, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import * as api from './src/api';
import { Centered } from './src/components/Common';
import { Login } from './src/features/auth/LoginScreen';
import { Chat } from './src/features/chat/ChatScreen';
import {
  ChatHistoryCache,
  isFreshHistory,
} from './src/features/chat/chat-history-cache';
import { Home } from './src/features/home/HomeScreen';
import { usePresence } from './src/presence';
import { styles } from './src/styles';
import { CallProvider } from './src/features/calls/CallProvider';

function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<api.User>();
  const userId = user?.id;
  const history = React.useMemo(
    () => (userId ? new ChatHistoryCache() : undefined),
    [userId],
  );
  const preloadHistory = useCallback(
    (next: api.Conversation) => {
      if (!history || isFreshHistory(history.get(next.id), next)) return;
      const cutoff = BigInt(next.membership.clearedAfterSequence ?? '0');
      void history.loadRecent(next.id, cutoff).catch(() => {});
    },
    [history],
  );
  const [conversation, setConversation] = useState<api.Conversation>();
  const [jumpTarget, setJumpTarget] = useState<{
    conversationId: string;
    messageId: string;
    token: number;
  }>();
  const jumpTokenRef = React.useRef(0);
  const expire = useCallback(() => {
    setConversation(undefined);
    setJumpTarget(undefined);
    setUser(undefined);
  }, []);
  const openConversation = useCallback(
    (next: api.Conversation, messageId?: string) => {
      setConversation(next);
      if (messageId) {
        jumpTokenRef.current += 1;
        setJumpTarget({
          conversationId: next.id,
          messageId,
          token: jumpTokenRef.current,
        });
      } else {
        setJumpTarget(undefined);
      }
    },
    [],
  );
  const acceptUser = useCallback((next: api.User) => {
    api.rememberUser(next);
    setUser(next);
  }, []);

  useEffect(() => {
    if (!conversation) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setConversation(undefined);
      setJumpTarget(undefined);
      return true;
    });
    return () => sub.remove();
  }, [conversation]);

  useEffect(() => {
    let active = true;
    void api
      .restore()
      .then(session => {
        if (active) setUser(session?.user);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <View
      style={[
        styles.app,
        !booting && !user && styles.appLogin,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <StatusBar barStyle="dark-content" />
      {booting ? (
        <Centered label="Đang khôi phục phiên…" />
      ) : !user ? (
        <Login onLogin={setUser} />
      ) : (
        <SignedInShell
          key={user.id}
          conversation={conversation}
          history={history}
          jumpTarget={jumpTarget}
          user={user}
          onBack={() => {
            setConversation(undefined);
            setJumpTarget(undefined);
          }}
          onExpired={expire}
          onOpen={openConversation}
          onPreload={preloadHistory}
          onUser={acceptUser}
        />
      )}
    </View>
  );
}

function SignedInShell({
  conversation,
  history,
  jumpTarget,
  user,
  onBack,
  onExpired,
  onOpen,
  onPreload,
  onUser,
}: {
  conversation?: api.Conversation;
  history?: ChatHistoryCache;
  jumpTarget?: { conversationId: string; messageId: string; token: number };
  user: api.User;
  onBack: () => void;
  onExpired: () => void;
  onOpen: (conversation: api.Conversation, messageId?: string) => void;
  onPreload: (conversation: api.Conversation) => void;
  onUser: (user: api.User) => void;
}) {
  const presence = usePresence(user.id, onExpired);
  return (
    <CallProvider user={user} onExpired={onExpired}>
      <View
        style={[
          styles.page,
          conversation && history ? { display: 'none' } : undefined,
        ]}
      >
        <Home
          active={!conversation}
          presence={presence}
          user={user}
          onUser={onUser}
          onOpen={onOpen}
          onPreload={onPreload}
          onExpired={onExpired}
        />
      </View>
      {conversation && history && (
        <Chat
          key={conversation.id}
          conversation={conversation}
          history={history}
          jumpTarget={jumpTarget}
          presence={presence}
          user={user}
          onBack={onBack}
          onExpired={onExpired}
        />
      )}
    </CallProvider>
  );
}

export default App;
