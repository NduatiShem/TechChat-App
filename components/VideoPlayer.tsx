import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Text } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getYouTubeVideoId, getVimeoVideoId, isVideoUrl } from '@/utils/textUtils';
import { WebView } from 'react-native-webview';

interface VideoPlayerProps {
  url: string;
  isMine?: boolean;
  isDark?: boolean;
  style?: any;
  thumbnailUrl?: string;
}

/**
 * Component for playing videos in chat messages
 * Supports:
 * - Direct video file URLs (mp4, webm, mov, etc.)
 * - YouTube URLs
 * - Vimeo URLs
 */
export default function VideoPlayer({ 
  url, 
  isMine = false, 
  isDark = false,
  style,
  thumbnailUrl 
}: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = React.useRef<Video>(null);

  // Check if it's a YouTube or Vimeo URL
  const youtubeId = getYouTubeVideoId(url);
  const vimeoId = getVimeoVideoId(url);
  const isEmbeddedVideo = youtubeId || vimeoId;

  // For direct video files
  const isDirectVideo = isVideoUrl(url) && !youtubeId && !vimeoId;

  const handlePlayPause = async () => {
    if (isEmbeddedVideo) {
      // For YouTube/Vimeo, open in fullscreen modal
      setShowFullscreen(true);
      return;
    }

    if (videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
    } else if ('error' in status) {
      setError('Failed to load video');
      console.error('Video playback error:', status.error);
    }
  };

  // YouTube embed URL
  const getYouTubeEmbedUrl = (videoId: string) => {
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  };

  // Vimeo embed URL
  const getVimeoEmbedUrl = (videoId: string) => {
    return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
  };

  // Render YouTube/Vimeo thumbnail with play button
  if (isEmbeddedVideo) {
    return (
      <>
        <TouchableOpacity
          onPress={handlePlayPause}
          style={[
            styles.container,
            style,
            {
              backgroundColor: isMine 
                ? (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)')
                : (isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.1)'),
            }
          ]}
          activeOpacity={0.8}
        >
          <View style={styles.thumbnailContainer}>
            {thumbnailUrl ? (
              <View style={styles.thumbnailPlaceholder}>
                <Text style={{ color: isMine ? '#fff' : (isDark ? '#fff' : '#111827') }}>
                  {youtubeId ? 'YouTube' : 'Vimeo'}
                </Text>
              </View>
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <MaterialCommunityIcons 
                  name={youtubeId ? 'youtube' : 'video'} 
                  size={48} 
                  color={isMine ? '#fff' : (isDark ? '#fff' : '#111827')} 
                />
              </View>
            )}
            <View style={styles.playButtonOverlay}>
              <MaterialCommunityIcons name="play-circle" size={64} color="#fff" />
            </View>
          </View>
          <Text 
            style={[
              styles.videoLabel,
              { color: isMine ? '#fff' : (isDark ? '#fff' : '#111827') }
            ]}
            numberOfLines={1}
          >
            {url}
          </Text>
        </TouchableOpacity>

        {/* Fullscreen Modal for YouTube/Vimeo */}
        <Modal
          visible={showFullscreen}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setShowFullscreen(false)}
        >
          <View style={styles.fullscreenContainer}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFullscreen(false)}
            >
              <MaterialCommunityIcons name="close" size={32} color="#fff" />
            </TouchableOpacity>
            <WebView
              source={{ 
                uri: youtubeId ? getYouTubeEmbedUrl(youtubeId) : getVimeoEmbedUrl(vimeoId!) 
              }}
              style={styles.webview}
              allowsFullscreenVideo
              mediaPlaybackRequiresUserAction={false}
            />
          </View>
        </Modal>
      </>
    );
  }

  // Direct video file
  if (isDirectVideo) {
    return (
      <View style={[styles.container, style]}>
        <Video
          ref={videoRef}
          source={{ uri: url }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          onError={(error) => {
            setError('Failed to load video');
            console.error('Video error:', error);
          }}
        />
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>
    );
  }

  // Fallback: not a recognized video URL
  return null;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 4,
  },
  thumbnailContainer: {
    width: '100%',
    height: 200,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonOverlay: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoLabel: {
    padding: 8,
    fontSize: 12,
    textAlign: 'center',
  },
  video: {
    width: '100%',
    height: 200,
  },
  errorContainer: {
    padding: 12,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    borderRadius: 8,
  },
  errorText: {
    color: '#FF0000',
    fontSize: 12,
    textAlign: 'center',
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    padding: 8,
  },
  webview: {
    flex: 1,
  },
});

