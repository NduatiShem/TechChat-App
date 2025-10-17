import { useTheme } from '@/context/ThemeContext';
import React from 'react';
import { Image, Text, View } from 'react-native';

interface UserAvatarProps {
  avatarUrl?: string | null;
  name: string | null | undefined;
  size?: number;
  style?: any;
}

export default function UserAvatar({ avatarUrl, name, size = 40, style }: UserAvatarProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';

  const getInitials = (userName: string | null | undefined) => {
    if (!userName || typeof userName !== 'string') {
      return 'U';
    }
    return userName
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: avatarUrl ? 'transparent' : '#39B54A',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    ...style,
  };

  const textStyle = {
    fontSize: size * 0.4,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  };

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={containerStyle}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={containerStyle}>
      <Text style={textStyle}>{getInitials(name)}</Text>
    </View>
  );
} 