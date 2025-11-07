/**
 * Utility functions for text processing, URL detection, and video detection
 */

export interface TextPart {
  text: string;
  type: 'text' | 'url' | 'video';
  url?: string;
}

/**
 * Detects URLs in text and returns an array of text parts
 * Supports http, https, and www URLs
 */
export function detectUrls(text: string): TextPart[] {
  if (!text) return [];

  // URL regex pattern - matches http, https, and www URLs
  const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts: TextPart[] = [];
  let lastIndex = 0;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index);
      if (textBefore) {
        parts.push({ text: textBefore, type: 'text' });
      }
    }

    // Add the URL
    let url = match[0];
    // Add https:// if it's a www URL
    if (url.startsWith('www.')) {
      url = 'https://' + url;
    }
    
    // Check if it's a video URL
    const isVideo = isVideoUrl(url);
    
    parts.push({
      text: match[0],
      type: isVideo ? 'video' : 'url',
      url: url,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last URL
  if (lastIndex < text.length) {
    const textAfter = text.substring(lastIndex);
    if (textAfter) {
      parts.push({ text: textAfter, type: 'text' });
    }
  }

  // If no URLs found, return the whole text as a single part
  if (parts.length === 0) {
    parts.push({ text, type: 'text' });
  }

  return parts;
}

/**
 * Checks if a URL is a video URL
 * Supports YouTube, Vimeo, and direct video file URLs
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;

  const videoPatterns = [
    /youtube\.com\/watch/,
    /youtu\.be\//,
    /vimeo\.com\//,
    /\.mp4(\?|$)/i,
    /\.webm(\?|$)/i,
    /\.mov(\?|$)/i,
    /\.avi(\?|$)/i,
    /\.mkv(\?|$)/i,
    /\.m3u8(\?|$)/i,
  ];

  return videoPatterns.some(pattern => pattern.test(url));
}

/**
 * Extracts video ID from YouTube URL
 */
export function getYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
    /youtube\.com\/embed\/([^&\s]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extracts video ID from Vimeo URL
 */
export function getVimeoVideoId(url: string): string | null {
  const pattern = /vimeo\.com\/(\d+)/;
  const match = url.match(pattern);
  return match && match[1] ? match[1] : null;
}

/**
 * Checks if an attachment is a video based on MIME type
 */
export function isVideoAttachment(attachment: any): boolean {
  if (!attachment || !attachment.mime) return false;
  return attachment.mime.startsWith('video/');
}

