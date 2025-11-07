import { useTheme } from '@/context/ThemeContext';
import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface GroupAvatarProps {
  avatarUrl?: string | null;
  name: string | null | undefined;
  size?: number;
  style?: any;
}

export default function GroupAvatar({ avatarUrl, name, size = 40, style }: GroupAvatarProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';
  const [imageError, setImageError] = useState(false);

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: '#283891', // Primary color for groups
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    overflow: 'hidden' as const,
    ...style,
  };

  const imageStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  // Show image if avatarUrl exists, is not empty, and hasn't errored
  const shouldShowImage = avatarUrl && 
                         avatarUrl.trim() !== '' && 
                         !imageError &&
                         (avatarUrl.startsWith('http://') || 
                          avatarUrl.startsWith('https://') || 
                          avatarUrl.startsWith('file://') ||
                          avatarUrl.startsWith('content://'));

  if (shouldShowImage) {
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: avatarUrl }}
          style={imageStyle}
          resizeMode="cover"
          onError={() => {
            setImageError(true);
          }}
        />
      </View>
    );
  }

  // For groups without images, show the account-group icon
  return (
    <View style={containerStyle}>
      <MaterialCommunityIcons name="account-group" size={size * 0.6} color="white" />
    </View>
  );
}

