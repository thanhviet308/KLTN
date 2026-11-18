import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import * as api from './src/api';
import { Centered } from './src/components/Common';
import { Login } from './src/features/auth/LoginScreen';
import { Chat } from './src/features/chat/ChatScreen';
import { Home } from './src/features/home/HomeScreen';
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
      <StatusBar
        barStyle={!booting && !user ? 'light-content' : 'dark-content'}
      />
      {booting ? (
        <Centered label="Đang khôi phục phiên…" />
      ) : !user ? (
        <Login onLogin={setUser} />
      ) : (
        <CallProvider key={user.id} user={user} onExpired={expire}>
          {conversation ? (
            <Chat
              conversation={conversation}
              jumpTarget={jumpTarget}
              user={user}
              onBack={() => {
                setConversation(undefined);
                setJumpTarget(undefined);
              }}
              onExpired={expire}
            />
          ) : (
            <Home
              user={user}
              onUser={acceptUser}
              onOpen={openConversation}
              onExpired={expire}
            />
          )}
        </CallProvider>
      )}
    </View>
  );
}

export default App;
