import React from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import * as api from '../api';
import type { Peer } from '../presence';
import { initials } from '../utils';
import { styles } from '../styles';

export function Centered({ label }: { label: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color="#087f72" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <View style={styles.brand}>
      <View style={[styles.brandIcon, inverse && styles.brandIconInverse]}>
        <Text
          style={[styles.brandIconText, inverse && styles.brandIconTextInverse]}
        >
          P
        </Text>
      </View>
      <Text style={[styles.brandName, inverse && styles.brandNameInverse]}>
        PingPong<Text style={styles.brandPeriod}>.</Text>
      </Text>
    </View>
  );
}

export function InlineNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Text style={styles.noticeIconText}>!</Text>
      </View>
      <Text style={styles.noticeText}>{message}</Text>
      {!!onRetry && (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.noticeAction,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.noticeActionText}>Thử lại</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Avatar({ peer, size = 44 }: { peer: Peer; size?: number }) {
  const source = api.avatarUrl(peer.avatarUrl);
  return (
    <View
      accessibilityLabel={`Ảnh đại diện của ${peer.displayName}`}
      accessibilityRole="image"
      style={[
        styles.dynamicAvatar,
        { width: size, height: size, borderRadius: Math.round(size * 0.34) },
      ]}
    >
      {source ? (
        <Image
          source={{ uri: source }}
          style={{ width: size, height: size, resizeMode: 'cover' }}
        />
      ) : (
        <Text style={styles.dynamicAvatarText}>
          {initials(peer.displayName)}
        </Text>
      )}
    </View>
  );
}

export function ScreenIntro({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  return (
    <View style={styles.screenIntro}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCaption}>{caption}</Text>
    </View>
  );
}
