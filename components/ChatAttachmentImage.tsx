import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, TouchableOpacity, View, type ImageStyle, type StyleProp } from 'react-native';

type ChatAttachmentImageProps = {
  uri: string | null;
  isDark: boolean;
  onPress?: () => void;
  style?: StyleProp<ImageStyle>;
};

export default function ChatAttachmentImage({
  uri,
  isDark,
  onPress,
  style,
}: ChatAttachmentImageProps) {
  const [failed, setFailed] = useState(false);

  const placeholder = (
    <View
      style={[
        {
          width: 200,
          height: 200,
          borderRadius: 12,
          backgroundColor: isDark ? '#374151' : '#F3F4F6',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style as object,
      ]}
    >
      <MaterialCommunityIcons
        name="image-broken-variant"
        size={40}
        color={isDark ? '#9CA3AF' : '#6B7280'}
      />
    </View>
  );

  if (!uri || failed) {
    return placeholder;
  }

  const image = (
    <Image
      source={{ uri }}
      style={[
        {
          width: 200,
          height: 200,
          borderRadius: 12,
          backgroundColor: isDark ? '#374151' : '#F3F4F6',
          alignSelf: 'flex-start',
          maxWidth: '100%',
        },
        style,
      ]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{image}</TouchableOpacity>;
  }

  return image;
}
