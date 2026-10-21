import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  Text,
  View,
} from 'react-native';
import * as api from '../../api';
import { styles } from '../../styles';

function localFileUri(path: string) {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export function MessageMedia({
  message,
  localPath,
  loading,
  playing,
  mine,
  onLoad,
  onOpen,
  onPlay,
}: {
  message: api.Message;
  localPath?: string;
  loading: boolean;
  playing: boolean;
  mine: boolean;
  onLoad: () => void;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const attempted = useRef(false);
  useEffect(() => {
    if (
      message.type === 'image' &&
      !message.deletedAt &&
      !localPath &&
      !loading &&
      !attempted.current
    ) {
      attempted.current = true;
      onLoad();
    }
  }, [loading, localPath, message.deletedAt, message.type, onLoad]);

  if (message.deletedAt || message.type === 'text') return null;
  if (message.type === 'location') {
    const latitude = message.content?.latitude;
    const longitude = message.content?.longitude;
    if (latitude === undefined || longitude === undefined) return null;
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() =>
          void Linking.openURL(
            `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
          )
        }
        style={[styles.mediaCard, mine && styles.mediaCardMine]}
      >
        <Text style={styles.mediaIcon}>⌖</Text>
        <View style={styles.mediaCardText}>
          <Text style={[styles.mediaTitle, mine && styles.messageTextMine]}>
            Vị trí được chia sẻ
          </Text>
          <Text style={[styles.mediaCaption, mine && styles.mediaCaptionMine]}>
            {latitude.toFixed(5)}, {longitude.toFixed(5)} · Mở bản đồ
          </Text>
        </View>
      </Pressable>
    );
  }
  if (message.type === 'image') {
    return localPath ? (
      <Pressable onPress={onOpen}>
        <Image
          accessibilityLabel={message.content?.fileName ?? 'Ảnh được gửi'}
          source={{ uri: localFileUri(localPath) }}
          style={styles.chatImage}
        />
      </Pressable>
    ) : (
      <Pressable
        disabled={loading}
        onPress={onLoad}
        style={styles.mediaLoading}
      >
        {loading ? (
          <ActivityIndicator color={mine ? 'white' : '#087f72'} />
        ) : null}
        <Text style={[styles.mediaTitle, mine && styles.messageTextMine]}>
          {loading ? 'Đang tải ảnh…' : 'Chạm để tải ảnh'}
        </Text>
      </Pressable>
    );
  }
  if (message.type === 'voice') {
    return (
      <Pressable
        disabled={loading}
        onPress={localPath ? onPlay : onLoad}
        style={[styles.mediaCard, mine && styles.mediaCardMine]}
      >
        {loading ? (
          <ActivityIndicator color={mine ? 'white' : '#087f72'} />
        ) : (
          <Text style={styles.mediaIcon}>{playing ? '■' : '▶'}</Text>
        )}
        <View style={styles.mediaCardText}>
          <Text style={[styles.mediaTitle, mine && styles.messageTextMine]}>
            {playing ? 'Đang phát tin nhắn thoại' : 'Tin nhắn thoại'}
          </Text>
          <Text style={[styles.mediaCaption, mine && styles.mediaCaptionMine]}>
            {localPath ? 'Chạm để phát hoặc dừng' : 'Chạm để tải'}
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      disabled={loading}
      onPress={localPath ? onOpen : onLoad}
      style={[styles.mediaCard, mine && styles.mediaCardMine]}
    >
      {loading ? (
        <ActivityIndicator color={mine ? 'white' : '#087f72'} />
      ) : (
        <Text style={styles.mediaIcon}>↓</Text>
      )}
      <View style={styles.mediaCardText}>
        <Text
          numberOfLines={2}
          style={[styles.mediaTitle, mine && styles.messageTextMine]}
        >
          {message.content?.fileName ?? 'Tệp đính kèm'}
        </Text>
        <Text style={[styles.mediaCaption, mine && styles.mediaCaptionMine]}>
          {localPath ? 'Chạm để mở' : 'Chạm để tải'}
        </Text>
      </View>
    </Pressable>
  );
}
