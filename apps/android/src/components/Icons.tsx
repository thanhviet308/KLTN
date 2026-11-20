import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ICON_URIS, type IconAssetName } from './icon-assets';

/**
 * Overlapping dual speech bubbles from the Web Auth brand mark.
 */
export function SocialBrandIcon() {
  return (
    <View style={iconStyles.socialWrap} accessibilityElementsHidden>
      <View style={iconStyles.socialBubblePrimary}>
        <Text style={iconStyles.socialDots}>•••</Text>
      </View>
      <View style={iconStyles.socialBubbleCoral}>
        <Text style={iconStyles.socialDots}>•••</Text>
      </View>
    </View>
  );
}

function SvgPngIcon({
  name,
  color,
  size,
}: {
  name: IconAssetName;
  color: string;
  size: number;
}) {
  return (
    <Image
      source={{ uri: ICON_URIS[name] }}
      resizeMode="contain"
      style={{
        width: size,
        height: size,
        tintColor: color,
      }}
    />
  );
}

export function NavIcon({
  name,
  color,
  size = 20,
}: {
  name: 'chats' | 'people' | 'search' | 'account' | 'incoming' | 'outgoing';
  color: string;
  size?: number;
}) {
  return <SvgPngIcon name={name} color={color} size={size} />;
}

export function UiGlyph({
  name,
  color,
  size = 18,
}: {
  name:
    | 'phone'
    | 'video'
    | 'more'
    | 'plus'
    | 'mic'
    | 'send'
    | 'mail'
    | 'lock'
    | 'search'
    | 'back'
    | 'bell'
    | 'compose'
    | 'smile'
    | 'like'
    | 'pin'
    | 'chevronDown'
    | 'music'
    | 'trash'
    | 'close';
  color: string;
  size?: number;
}) {
  return <SvgPngIcon name={name} color={color} size={size} />;
}

const iconStyles = StyleSheet.create({
  socialWrap: {
    width: 44,
    height: 34,
    position: 'relative',
  },
  socialBubblePrimary: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 30,
    height: 25,
    borderRadius: 13,
    borderBottomLeftRadius: 4,
    backgroundColor: '#6a1e50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialBubbleCoral: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 25,
    borderRadius: 13,
    borderBottomRightRadius: 4,
    backgroundColor: '#ff7c71',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialDots: {
    color: '#fff4f6',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    lineHeight: 12,
  },
});
