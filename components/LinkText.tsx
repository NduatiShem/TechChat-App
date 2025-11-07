import React from 'react';
import { Text, TouchableOpacity, Linking, StyleSheet, View } from 'react-native';
import { detectUrls, isVideoUrl } from '@/utils/textUtils';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface LinkTextProps {
  text: string;
  textStyle?: any;
  linkStyle?: any;
  isDark?: boolean;
  onVideoPress?: (url: string) => void;
}

/**
 * Component that renders text with clickable URLs
 * Automatically detects URLs and makes them clickable
 */
export default function LinkText({ 
  text, 
  textStyle, 
  linkStyle,
  isDark = false,
  onVideoPress 
}: LinkTextProps) {
  if (!text) return null;

  const parts = detectUrls(text);
  const defaultTextStyle = { color: textStyle?.color || (isDark ? '#fff' : '#111827' ) };
  const defaultLinkStyle = { 
    color: '#007AFF',
    textDecorationLine: 'underline' as const,
  };

  const handleLinkPress = async (url: string) => {
    try {
      // Check if it's a video URL
      if (isVideoUrl(url)) {
        if (onVideoPress) {
          onVideoPress(url);
        } else {
          // Fallback: open in browser
          const canOpen = await Linking.canOpenURL(url);
          if (canOpen) {
            await Linking.openURL(url);
          }
        }
      } else {
        // Regular URL - open in browser
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        }
      }
    } catch (error) {
      console.error('Error opening URL:', error);
    }
  };

  // If no URLs found, return simple text
  if (parts.length === 1 && parts[0].type === 'text') {
    return <Text style={[defaultTextStyle, textStyle]}>{text}</Text>;
  }

  // Render with links
  return (
    <Text style={[defaultTextStyle, textStyle]}>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <Text key={index} style={[defaultTextStyle, textStyle]}>{part.text}</Text>;
        }

        // URL or Video link - use Text with onPress
        const isVideo = part.type === 'video';
        const linkColor = isVideo ? '#FF0000' : '#007AFF'; // Red for video, blue for regular links

        return (
          <Text
            key={index}
            onPress={() => handleLinkPress(part.url || part.text)}
            style={[
              defaultLinkStyle,
              linkStyle,
              { color: linkColor }
            ]}
          >
            {part.text}
            {isVideo && ' ▶'}
          </Text>
        );
      })}
    </Text>
  );
}

