import { useTheme } from '@/context/ThemeContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import MessageStatus from './MessageStatus';

interface VoiceMessageBubbleProps {
  uri: string | null; // Allow null for voice messages without URLs
  duration: number;
  isMine: boolean;
  timestamp: string;
  senderName?: string;
  textPart?: string; // Optional text part for voice messages with text
  readAt?: string | null; // Read receipt timestamp
  syncStatus?: 'synced' | 'pending' | 'failed'; // Message sync status
}

export default function VoiceMessageBubble({ 
  uri, 
  duration, 
  isMine, 
  timestamp,
  senderName,
  textPart,
  readAt,
  syncStatus = 'synced'
}: VoiceMessageBubbleProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const { currentTheme } = useTheme();
  
  const isDark = currentTheme === 'dark';
  const positionInterval = useRef<NodeJS.Timeout | null>(null);
  const waveformAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadAudio();
    return () => {
      console.log('VoiceMessageBubble - Cleaning up component');
      if (sound) {
        sound.unloadAsync();
      }
      if (positionInterval.current) {
        clearInterval(positionInterval.current);
        positionInterval.current = null;
      }
      stopWaveformAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]); // loadAudio, sound, and stopWaveformAnimation are stable, no need to include

  const loadAudio = async () => {
    try {
      setIsLoading(true);
      
      console.log('VoiceMessageBubble - Loading audio with URI:', uri);
      
      // Check if URI is null or empty (voice message without attachment due to database constraint)
      if (!uri || uri.trim() === '') {
        console.log('VoiceMessageBubble - No URI available, showing fallback UI');
        setSound(null);
        return;
      }
      
      // Validate URI format
      if (!uri.startsWith('http://') && !uri.startsWith('https://') && !uri.startsWith('file://')) {
        throw new Error(`Invalid URI format: ${uri}`);
      }
      
      if (sound) {
        console.log('VoiceMessageBubble - Unloading existing sound...');
        await sound.unloadAsync();
        setSound(null);
      }

      console.log('VoiceMessageBubble - Creating new sound object...');
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );

      console.log('VoiceMessageBubble - Sound object created successfully');
      setSound(newSound);
    } catch (error: unknown) {
      const err = error as any;
      console.error('Error loading audio:', error);
      console.error('VoiceMessageBubble - Failed URI:', uri);
      console.error('VoiceMessageBubble - Error details:', {
        message: err?.message,
        code: err?.code,
        stack: err?.stack
      });
      
      setSound(null);
      // Don't show alert for missing URI, just log the error
      if (uri) {
        Alert.alert('Error', 'Failed to load audio file.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis ? status.positionMillis / 1000 : 0);
      
      if (status.didJustFinish) {
        console.log('VoiceMessageBubble - Audio finished playing, resetting for replay');
        setIsPlaying(false);
        setPosition(0);
        if (positionInterval.current) {
          clearInterval(positionInterval.current);
        }
        stopWaveformAnimation();
        
        // Reset the sound object to allow replaying
        if (sound) {
          sound.setPositionAsync(0);
        }
      }
    }
  };

  const togglePlayback = async () => {
    // If no URI, show a message that audio is not available
    if (!uri) {
      Alert.alert(
        'Audio Not Available', 
        'Voice message audio is temporarily unavailable due to a database constraint issue. The message was sent successfully, but the audio file could not be saved. This will be fixed in the next update.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!sound) {
      console.log('VoiceMessageBubble - No sound object available, attempting to reload...');
      await loadAudio();
      return;
    }

    try {
      if (isPlaying) {
        console.log('VoiceMessageBubble - Pausing audio');
        await sound.pauseAsync();
        if (positionInterval.current) {
          clearInterval(positionInterval.current);
        }
        stopWaveformAnimation();
      } else {
        console.log('VoiceMessageBubble - Playing audio');
        
        // If we're at the end, reset to beginning before playing
        if (position >= duration) {
          console.log('VoiceMessageBubble - Resetting to beginning for replay');
          await sound.setPositionAsync(0);
          setPosition(0);
        }
        
        await sound.playAsync();
        startWaveformAnimation();
        
        // Clear any existing interval before starting a new one
        if (positionInterval.current) {
          clearInterval(positionInterval.current);
          positionInterval.current = null;
        }
        
        // Start position tracking
        positionInterval.current = setInterval(async () => {
          if (sound) {
            try {
              const status = await sound.getStatusAsync();
              if (status.isLoaded) {
                setPosition(status.positionMillis ? status.positionMillis / 1000 : 0);
              } else {
                // Sound is no longer loaded, clear interval
                console.log('VoiceMessageBubble - Sound no longer loaded, clearing interval');
                if (positionInterval.current) {
                  clearInterval(positionInterval.current);
                  positionInterval.current = null;
                }
                setIsPlaying(false);
                stopWaveformAnimation();
              }
            } catch (error) {
              console.error('Error getting sound status:', error);
              // Clear interval and reset state on error
              if (positionInterval.current) {
                clearInterval(positionInterval.current);
                positionInterval.current = null;
              }
              setIsPlaying(false);
              stopWaveformAnimation();
              setSound(null);
            }
          } else {
            // No sound object, clear interval
            console.log('VoiceMessageBubble - No sound object, clearing interval');
            if (positionInterval.current) {
              clearInterval(positionInterval.current);
              positionInterval.current = null;
            }
            setIsPlaying(false);
            stopWaveformAnimation();
          }
        }, 100);
      }
    } catch (error: unknown) {
      const err = error as any;
      console.error('Error toggling playback:', error);
      console.error('VoiceMessageBubble - Sound object state:', { sound: !!sound, isPlaying });
      
      // Try to reload the audio if there's an error
      if (err?.message?.includes('Player does not exist')) {
        console.log('VoiceMessageBubble - Player does not exist, reloading audio...');
        setSound(null);
        await loadAudio();
      } else {
        Alert.alert('Error', 'Failed to play/pause audio.');
      }
    }
  };

  const startWaveformAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(waveformAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: false,
        }),
        Animated.timing(waveformAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: false,
        }),
      ])
    ).start();
  };

  const stopWaveformAnimation = () => {
    waveformAnim.stopAnimation();
    waveformAnim.setValue(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };


  const renderWaveform = () => {
    const bars = 20;
    const barArray = Array.from({ length: bars }, (_, i) => i);
    
    return (
      <View style={styles.waveformContainer}>
        {barArray.map((_, index) => {
          // Create a more realistic waveform pattern
          const baseHeight = Math.sin(index * 0.4) * 6 + 8;
          const barHeight = isPlaying 
            ? baseHeight + Math.random() * 8
            : baseHeight;
          
          return (
            <Animated.View
              key={index}
              style={[
                styles.waveformBar,
                {
                  height: barHeight,
                  backgroundColor: isMine ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#1F2937'),
                  opacity: isPlaying ? 0.9 : 0.7,
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={[
        styles.container,
        isMine ? styles.myMessage : styles.otherMessage,
        { backgroundColor: isMine ? '#25D366' : (isDark ? '#374151' : '#E5E7EB') }
      ]}>
        <MaterialCommunityIcons 
          name="loading" 
          size={20} 
          color={isMine ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#1F2937')} 
        />
      </View>
    );
  }

  return (
    <View style={[
      styles.container,
      isMine ? styles.myMessage : styles.otherMessage,
      { backgroundColor: isMine ? '#25D366' : (isDark ? '#374151' : '#E5E7EB') }
    ]}>
      {/* Sender name for group messages */}
      {!isMine && senderName && (
        <Text style={[styles.senderName, { color: isMine ? '#E0E7FF' : '#6B7280' }]}>
          {senderName}
        </Text>
      )}

      {/* Text part if present */}
      {textPart && (
        <Text style={[
          styles.textPart,
          { color: isMine ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#1F2937') }
        ]}>
          {textPart}
        </Text>
      )}

      {/* Voice Message Content */}
      <View style={styles.voiceContent}>
        {/* Voice Icon */}
        <View style={styles.voiceIcon}>
          <MaterialCommunityIcons 
            name="microphone" 
            size={14} 
            color={isMine ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#1F2937')} 
          />
        </View>

        {/* Play/Pause Button or Warning Icon */}
        <TouchableOpacity 
          onPress={togglePlayback} 
          style={[
            styles.playButton,
            { backgroundColor: isMine ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)' }
          ]}
          disabled={isLoading}
        >
          <MaterialCommunityIcons 
            name={!uri ? 'alert-circle' : (isLoading ? 'loading' : (isPlaying ? 'pause' : 'play'))} 
            size={16} 
            color={isMine ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#1F2937')} 
          />
        </TouchableOpacity>

        {/* Waveform or Message */}
        <View style={styles.waveformWrapper}>
          {uri ? renderWaveform() : (
            <Text style={[
              styles.unavailableText,
              { color: isMine ? '#E0E7FF' : (isDark ? '#9CA3AF' : '#6B7280') }
            ]}>
              Voice message ({formatTime(duration)}) - Audio temporarily unavailable
            </Text>
          )}
        </View>

        {/* Duration */}
        <Text style={[
          styles.durationText,
          { color: isMine ? '#E0E7FF' : (isDark ? '#9CA3AF' : '#6B7280') }
        ]}>
          {uri ? `${formatTime(position)} / ${formatTime(duration)}` : formatTime(duration)}
        </Text>
      </View>

      {/* Timestamp and read receipt */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={[
          styles.timestamp,
          { color: isMine ? '#E0E7FF' : '#6B7280' }
        ]}>
          {timestamp}
        </Text>
        {/* Show read receipt only for messages we sent */}
        {isMine && (
          <MessageStatus 
            readAt={readAt} 
            syncStatus={syncStatus}
            isDark={isDark}
            size={12}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    padding: 12,
    maxWidth: '80%',
    marginVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  myMessage: {
    alignSelf: 'flex-end',
    borderTopRightRadius: 4,
    marginLeft: 40,
    marginRight: 0,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    borderTopLeftRadius: 4,
    marginLeft: 0,
    marginRight: 40,
  },
  senderName: {
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  voiceContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformWrapper: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 20,
  },
  waveformBar: {
    width: 2,
    borderRadius: 1,
  },
  durationText: {
    fontSize: 12,
    fontWeight: '500',
    minWidth: 50,
    textAlign: 'right',
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  unavailableText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    flex: 1,
  },
  textPart: {
    fontSize: 16,
    marginBottom: 8,
    lineHeight: 20,
  },
}); 