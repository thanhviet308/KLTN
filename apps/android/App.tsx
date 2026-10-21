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
  const expire = useCallback(() => {
    setConversation(undefined);
    setUser(undefined);
  }, []);
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
      ) : conversation ? (
        <Chat
          conversation={conversation}
          user={user}
          onBack={() => setConversation(undefined)}
          onExpired={expire}
        />
      ) : (
        <Home
          user={user}
          onUser={acceptUser}
          onOpen={setConversation}
          onExpired={expire}
        />
      )}
    </View>
  );
}

export default App;
