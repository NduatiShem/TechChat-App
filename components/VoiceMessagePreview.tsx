import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface VoiceMessagePreviewProps {
  duration: number;
  isDark?: boolean;
}

export default function VoiceMessagePreview({ duration, isDark = false }: VoiceMessagePreviewProps) {
  const formatDuration = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons 
        name="microphone" 
        size={16} 
        color={isDark ? '#39B54A' : '#6B7280'} 
      />
      <Text style={[
        styles.durationText,
        { color: isDark ? '#283891' : '#6B7280' }
      ]}>
        {formatDuration(duration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  durationText: {
    fontSize: 14,
    fontWeight: '500',
  },
}); 