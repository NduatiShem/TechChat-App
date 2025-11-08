import { useTheme } from '@/context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

interface VoicePlayerProps {
  uri: string;
  duration?: number; // in seconds
  size?: 'small' | 'medium' | 'large';
}

export default function VoicePlayer({ 
  uri, 
  duration: initialDuration, 
  size = 'medium' 
}: VoicePlayerProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [position, setPosition] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const { currentTheme } = useTheme();
  
  const isDark = currentTheme === 'dark';
  const positionInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadAudio();
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (positionInterval.current) {
        clearInterval(positionInterval.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]); // loadAudio and sound are stable, no need to include

  const loadAudio = async () => {
    try {
      setIsLoading(true);
      
      if (sound) {
        await sound.unloadAsync();
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );

      setSound(newSound);
      
      // Get duration if not provided
      if (!initialDuration) {
        const status = await newSound.getStatusAsync();
        if (status.isLoaded) {
          setDuration(status.durationMillis ? status.durationMillis / 1000 : 0);
        }
      }
    } catch (error) {
      console.error('Error loading audio:', error);
      Alert.alert('Error', 'Failed to load audio file.');
    } finally {
      setIsLoading(false);
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis ? status.positionMillis / 1000 : 0);
      
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
        if (positionInterval.current) {
          clearInterval(positionInterval.current);
        }
      }
    }
  };

  const togglePlayback = async () => {
    if (!sound) return;

    try {
      if (isPlaying) {
        await sound.pauseAsync();
        if (positionInterval.current) {
          clearInterval(positionInterval.current);
        }
      } else {
        await sound.playAsync();
        // Start position tracking
        positionInterval.current = setInterval(async () => {
          if (sound) {
            const status = await sound.getStatusAsync();
            if (status.isLoaded) {
              setPosition(status.positionMillis ? status.positionMillis / 1000 : 0);
            }
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error toggling playback:', error);
      Alert.alert('Error', 'Failed to play/pause audio.');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgressPercentage = () => {
    if (duration === 0) return 0;
    return (position / duration) * 100;
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          container: { padding: 8, borderRadius: 8 },
          icon: 16,
          text: 12,
          progressHeight: 2,
        };
      case 'large':
        return {
          container: { padding: 16, borderRadius: 16 },
          icon: 32,
          text: 18,
          progressHeight: 4,
        };
      default: // medium
        return {
          container: { padding: 12, borderRadius: 12 },
          icon: 24,
          text: 14,
          progressHeight: 3,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  if (isLoading) {
    return (
      <View style={[
        styles.container, 
        sizeStyles.container,
        { backgroundColor: isDark ? '#374151' : '#E5E7EB' }
      ]}>
        <MaterialCommunityIcons 
          name="loading" 
          size={sizeStyles.icon} 
          color={isDark ? '#9CA3AF' : '#6B7280'} 
        />
      </View>
    );
  }

  return (
    <View style={[
      styles.container, 
      sizeStyles.container,
      { backgroundColor: isDark ? '#374151' : '#E5E7EB' }
    ]}>
      <TouchableOpacity 
        onPress={togglePlayback} 
        style={styles.playButton}
        disabled={!sound}
      >
        <MaterialCommunityIcons 
          name={isPlaying ? 'pause' : 'play'} 
          size={sizeStyles.icon} 
          color={isDark ? '#FFFFFF' : '#1F2937'} 
        />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.progressContainer}>
          <View style={[
            styles.progressBar, 
            { 
              height: sizeStyles.progressHeight,
              backgroundColor: isDark ? '#4B5563' : '#D1D5DB' 
            }
          ]}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  width: `${getProgressPercentage()}%`,
                  backgroundColor: isDark ? '#39B54A' : '#39B54A' 
                }
              ]} 
            />
          </View>
        </View>

        <Text style={[
          styles.durationText, 
          { 
            fontSize: sizeStyles.text,
            color: isDark ? '#9CA3AF' : '#6B7280' 
          }
        ]}>
          {formatTime(position)} / {formatTime(duration)}
        </Text>
      </View>

      <MaterialCommunityIcons 
        name="waveform" 
        size={sizeStyles.icon * 0.8} 
        color={isDark ? '#6B7280' : '#9CA3AF'} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  progressContainer: {
    marginBottom: 4,
  },
  progressBar: {
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  durationText: {
    fontWeight: '500',
  },
}); 