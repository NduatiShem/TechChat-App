import type { RefObject } from 'react';
import type { FlatList } from 'react-native';

const EDGE_THRESHOLD = 50;

const SCROLL_TO_BOTTOM_DELAYS = [0, 100, 250, 500, 800, 1200];

export function getChatScrollEdges(
  contentOffsetY: number,
  contentHeight: number,
  viewportHeight: number,
) {
  const scrollableHeight = Math.max(0, contentHeight - viewportHeight);
  return {
    scrollableHeight,
    isAtBottom:
      scrollableHeight <= EDGE_THRESHOLD ||
      contentOffsetY >= scrollableHeight - EDGE_THRESHOLD,
    isAtTop: contentOffsetY <= EDGE_THRESHOLD,
    distanceFromBottom: Math.max(0, scrollableHeight - contentOffsetY),
  };
}

function scrollOnce(
  list: FlatList<any>,
  itemCount: number,
  animated: boolean,
) {
  try {
    list.scrollToEnd({ animated });
    return;
  } catch {
    // scrollToEnd can throw before layout is ready
  }

  try {
    list.scrollToIndex({
      index: Math.max(0, itemCount - 1),
      animated,
      viewPosition: 1,
    });
  } catch {
    // scrollToIndex can fail before rows are measured
  }
}

export function scrollChatListToBottom(
  listRef: RefObject<FlatList<any> | null>,
  itemCount: number,
  animated = false,
) {
  if (!listRef.current || itemCount <= 0) return;
  requestAnimationFrame(() => {
    if (listRef.current) {
      scrollOnce(listRef.current, itemCount, animated);
    }
  });
}

export function scheduleScrollChatListToBottom(
  listRef: RefObject<FlatList<any> | null>,
  itemCount: number,
  animated = false,
): () => void {
  const timers = SCROLL_TO_BOTTOM_DELAYS.map((delay) =>
    setTimeout(() => {
      if (listRef.current && itemCount > 0) {
        scrollOnce(listRef.current, itemCount, animated);
      }
    }, delay),
  );
  return () => timers.forEach(clearTimeout);
}
