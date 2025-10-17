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

interface VoiceRecorderProps {
  onRecordingComplete: (uri: string, duration: number) => void;
  onCancel?: () => void;
  maxDuration?: number; // in seconds
}

export default function VoiceRecorder({ 
  onRecordingComplete, 
  onCancel, 
  maxDuration = 60 
}: VoiceRecorderProps) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [hasPermission, setHasPermission] = useState(false);
  const { currentTheme } = useTheme();
  
  const isDark = currentTheme === 'dark';
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const durationInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    requestPermissions();
    return () => {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
    };
  }, []);

  const requestPermissions = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      setHasPermission(status === 'granted');
      
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please grant microphone permission to record voice messages.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
      Alert.alert('Error', 'Failed to request microphone permission.');
    }
  };

  const startRecording = async () => {
    if (!hasPermission) {
      await requestPermissions();
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(recording);
      setIsRecording(true);
      setDuration(0);

      // Start pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Start duration timer
      durationInterval.current = setInterval(() => {
        setDuration(prev => {
          const newDuration = prev + 1;
          if (newDuration >= maxDuration) {
            stopRecording();
          }
          return newDuration;
        });
      }, 1000);

    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      setIsRecording(false);
      pulseAnim.stopAnimation();
      
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      if (uri && duration > 0) {
        onRecordingComplete(uri, duration);
      }
      
      setRecording(null);
      setDuration(0);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to stop recording.');
    }
  };

  const cancelRecording = () => {
    if (recording) {
      recording.stopAndUnloadAsync();
      setRecording(null);
    }
    setIsRecording(false);
    pulseAnim.stopAnimation();
    
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    
    setDuration(0);
    onCancel?.();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
        <TouchableOpacity onPress={requestPermissions} style={styles.permissionButton}>
          <MaterialCommunityIcons 
            name="microphone-off" 
            size={24} 
            color={isDark ? '#EF4444' : '#DC2626'} 
          />
          <Text style={[styles.permissionText, { color: isDark ? '#EF4444' : '#DC2626' }]}>
            Grant Microphone Permission
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
      {isRecording ? (
        <View style={styles.recordingContainer}>
          <Animated.View style={[styles.pulseContainer, { transform: [{ scale: pulseAnim }] }]}>
            <MaterialCommunityIcons 
              name="microphone" 
              size={32} 
              color="#EF4444" 
            />
          </Animated.View>
          
          <Text style={[styles.durationText, { color: isDark ? '#FFFFFF' : '#1F2937' }]}>
            {formatDuration(duration)}
          </Text>
          
          <Text style={[styles.recordingText, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
            Recording...
          </Text>
          
          <View style={styles.buttonContainer}>
            <TouchableOpacity onPress={cancelRecording} style={styles.cancelButton}>
              <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={stopRecording} style={styles.stopButton}>
              <MaterialCommunityIcons name="stop" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.readyContainer}>
          <TouchableOpacity onPress={startRecording} style={styles.recordButton}>
            <MaterialCommunityIcons 
              name="microphone" 
              size={24} 
              color="#FFFFFF" 
            />
          </TouchableOpacity>
          
          <Text style={[styles.readyText, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
            Tap to record voice message
          </Text>
          
          <Text style={[styles.maxDurationText, { color: isDark ? '#6B7280' : '#9CA3AF' }]}>
            Max {maxDuration}s
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  permissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  permissionText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  recordingContainer: {
    alignItems: 'center',
    width: '100%',
  },
  pulseContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  durationText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  recordingText: {
    fontSize: 16,
    marginBottom: 24,
  },
  buttonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  cancelButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyContainer: {
    alignItems: 'center',
  },
  recordButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#39B54A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  readyText: {
    fontSize: 16,
    marginBottom: 8,
  },
  maxDurationText: {
    fontSize: 14,
  },
}); 