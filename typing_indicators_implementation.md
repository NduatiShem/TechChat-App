# Typing Indicators Implementation Guide

## Current Structure Assessment

### ✅ What You Have:
1. **Backend Events**: `SocketMessage` event broadcasting (Laravel)
2. **Push Notifications**: Expo notifications for new messages
3. **API Structure**: RESTful API with axios
4. **Chat UI**: Well-structured chat screens with input handling

### ❌ What's Missing for Typing Indicators:
1. **WebSocket/Real-time Connection**: No Pusher/Socket.io client on frontend
2. **Typing Status Events**: No `TypingStatus` event on backend
3. **Typing API Endpoints**: No endpoints to update/check typing status
4. **Typing State Management**: No state to track who's typing

## Implementation Options

### Option 1: WebSocket/Pusher (Recommended - Real-time)
**Best for**: Real-time, low latency typing indicators
**Requires**: 
- Backend: Pusher/Socket.io server
- Frontend: Pusher JS or Socket.io client library
- Events: Typing status events

**Pros**:
- Real-time updates
- Low latency
- Scalable

**Cons**:
- More complex setup
- Additional dependencies
- May require paid services (Pusher)

### Option 2: Polling API (Simpler - Quick Implementation)
**Best for**: Quick implementation without WebSocket infrastructure
**Requires**:
- Backend: API endpoints for typing status
- Frontend: Polling every 1-2 seconds
- State management for typing users

**Pros**:
- Simple to implement
- Uses existing REST API
- No additional services

**Cons**:
- Higher latency (1-2 seconds)
- More API calls (battery/bandwidth)
- Not ideal for production

### Option 3: Hybrid (Recommended for Your Current Setup)
**Best for**: Gradual migration to real-time
**Approach**:
- Start with polling (quick implementation)
- Add WebSocket later for better performance

## Recommended Implementation (Hybrid Approach)

### Phase 1: Backend Setup (Required First)

#### 1. Create TypingStatus Event (if using Laravel Broadcasting)

```php
// app/Events/TypingStatus.php
<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TypingStatus implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $userId;
    public $receiverId;
    public $groupId;
    public $isTyping;
    public $user;

    public function __construct($userId, $receiverId = null, $groupId = null, $isTyping = true)
    {
        $this->userId = $userId;
        $this->receiverId = $receiverId;
        $this->groupId = $groupId;
        $this->isTyping = $isTyping;
        $this->user = \App\Models\User::find($userId);
    }

    public function broadcastOn()
    {
        if ($this->groupId) {
            return new Channel('group.' . $this->groupId);
        }
        // For individual chats, broadcast to both users
        return [
            new Channel('user.' . $this->userId),
            new Channel('user.' . $this->receiverId),
        ];
    }

    public function broadcastAs()
    {
        return 'typing-status';
    }

    public function broadcastWith()
    {
        return [
            'user_id' => $this->userId,
            'receiver_id' => $this->receiverId,
            'group_id' => $this->groupId,
            'is_typing' => $this->isTyping,
            'user' => [
                'id' => $this->user->id,
                'name' => $this->user->name,
                'avatar_url' => $this->user->avatar_url,
            ],
        ];
    }
}
```

#### 2. Add Typing Status API Endpoints

```php
// In MessageController.php

/**
 * Update typing status
 */
public function updateTypingStatus(Request $request)
{
    $request->validate([
        'receiver_id' => 'nullable|exists:users,id',
        'group_id' => 'nullable|exists:groups,id',
        'is_typing' => 'required|boolean',
    ]);

    $receiverId = $request->input('receiver_id');
    $groupId = $request->input('group_id');
    $isTyping = $request->input('is_typing');

    // Dispatch typing status event
    broadcast(new \App\Events\TypingStatus(
        auth()->id(),
        $receiverId,
        $groupId,
        $isTyping
    ))->toOthers();

    return response()->json([
        'success' => true,
        'is_typing' => $isTyping,
    ]);
}

/**
 * Get typing status for a conversation
 */
public function getTypingStatus(Request $request)
{
    $request->validate([
        'receiver_id' => 'nullable|exists:users,id',
        'group_id' => 'nullable|exists:groups,id',
    ]);

    $receiverId = $request->input('receiver_id');
    $groupId = $request->input('group_id');

    // In a real implementation, you'd store typing status in cache/DB
    // For now, return empty (or implement caching)
    return response()->json([
        'typing_users' => [],
    ]);
}
```

#### 3. Add Routes

```php
// In routes/api.php

Route::post('/messages/typing', [MessageController::class, 'updateTypingStatus'])->middleware('auth:sanctum');
Route::get('/messages/typing', [MessageController::class, 'getTypingStatus'])->middleware('auth:sanctum');
```

### Phase 2: Frontend Setup (Polling Approach)

#### 1. Add Typing API Methods

```typescript
// In services/api.ts - add to messagesAPI

typing: (data: {
  receiver_id?: number;
  group_id?: number;
  is_typing: boolean;
}) => api.post('/messages/typing', data),

getTypingStatus: (receiverId?: number, groupId?: number) => {
  const params = new URLSearchParams();
  if (receiverId) params.append('receiver_id', receiverId.toString());
  if (groupId) params.append('group_id', groupId.toString());
  return api.get(`/messages/typing?${params.toString()}`);
},
```

#### 2. Create Typing Hook

```typescript
// hooks/useTypingIndicator.ts

import { useEffect, useRef, useState } from 'react';
import { messagesAPI } from '@/services/api';

interface TypingUser {
  id: number;
  name: string;
  avatar_url?: string;
}

export const useTypingIndicator = (
  receiverId?: number,
  groupId?: number,
  currentUserId?: number
) => {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingUpdateRef = useRef<number>(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced function to send typing status
  const setTyping = (isTyping: boolean) => {
    const now = Date.now();
    
    // Throttle: only send every 500ms
    if (now - lastTypingUpdateRef.current < 500) {
      return;
    }
    
    lastTypingUpdateRef.current = now;

    messagesAPI.typing({
      receiver_id: receiverId,
      group_id: groupId,
      is_typing: isTyping,
    }).catch(error => {
      console.error('Error updating typing status:', error);
    });
  };

  // Poll for typing status (every 1.5 seconds)
  useEffect(() => {
    if (!receiverId && !groupId) return;

    const pollTypingStatus = async () => {
      try {
        const response = await messagesAPI.getTypingStatus(receiverId, groupId);
        const typingUsers = response.data.typing_users || [];
        
        // Filter out current user
        const otherUsersTyping = typingUsers.filter(
          (user: TypingUser) => user.id !== currentUserId
        );
        
        setTypingUsers(otherUsersTyping);
      } catch (error) {
        console.error('Error fetching typing status:', error);
      }
    };

    // Poll immediately, then every 1.5 seconds
    pollTypingStatus();
    pollIntervalRef.current = setInterval(pollTypingStatus, 1500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [receiverId, groupId, currentUserId]);

  // Clear typing status when user stops typing
  useEffect(() => {
    return () => {
      setTyping(false);
    };
  }, []);

  return {
    typingUsers,
    setTyping,
    isAnyoneTyping: typingUsers.length > 0,
  };
};
```

#### 3. Update Chat Screen to Use Typing Indicator

```typescript
// In app/chat/user/[id].tsx

import { useTypingIndicator } from '@/hooks/useTypingIndicator';

// Inside component:
const { typingUsers, setTyping, isAnyoneTyping } = useTypingIndicator(
  Number(id),
  undefined,
  user?.id
);

const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

// Handle input change
const handleInputChange = (text: string) => {
  setInput(text);
  
  // Clear existing timeout
  if (typingTimeoutRef.current) {
    clearTimeout(typingTimeoutRef.current);
  }
  
  // Send typing status
  setTyping(true);
  
  // Stop typing after 3 seconds of inactivity
  typingTimeoutRef.current = setTimeout(() => {
    setTyping(false);
  }, 3000);
};

// Update TextInput
<TextInput
  // ... existing props
  onChangeText={handleInputChange}
  onBlur={() => setTyping(false)}
/>
```

#### 4. Add Typing Indicator UI Component

```typescript
// components/TypingIndicator.tsx

import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface TypingIndicatorProps {
  typingUsers: Array<{ id: number; name: string }>;
  isDark: boolean;
}

export default function TypingIndicator({ typingUsers, isDark }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const getTypingText = () => {
    if (typingUsers.length === 1) {
      return `${typingUsers[0].name} is typing...`;
    } else if (typingUsers.length === 2) {
      return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    } else {
      return `${typingUsers.length} people are typing...`;
    }
  };

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isDark ? '#1F2937' : '#F9FAFB',
      }}
    >
      <MaterialCommunityIcons
        name="pencil"
        size={16}
        color={isDark ? '#9CA3AF' : '#6B7280'}
        style={{ marginRight: 8 }}
      />
      <Text
        style={{
          color: isDark ? '#9CA3AF' : '#6B7280',
          fontSize: 12,
          fontStyle: 'italic',
        }}
      >
        {getTypingText()}
      </Text>
    </View>
  );
}
```

#### 5. Add Typing Indicator to Chat Screen

```typescript
// In chat screen, above the input area:

<TypingIndicator typingUsers={typingUsers} isDark={isDark} />

{/* Rest of your input UI */}
```

### Phase 3: Optional - Upgrade to WebSocket (Later)

If you want real-time updates without polling:

1. **Install Pusher or Socket.io client**:
```bash
npm install pusher-js
# or
npm install socket.io-client
```

2. **Create WebSocket service**:
```typescript
// services/realtimeService.ts
import Pusher from 'pusher-js';

class RealtimeService {
  private pusher: Pusher | null = null;

  connect(token: string) {
    this.pusher = new Pusher('your-pusher-key', {
      cluster: 'your-cluster',
      authEndpoint: '/api/broadcasting/auth',
      auth: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
  }

  subscribe(channel: string, event: string, callback: (data: any) => void) {
    const chan = this.pusher?.subscribe(channel);
    chan?.bind(event, callback);
  }

  disconnect() {
    this.pusher?.disconnect();
  }
}
```

3. **Replace polling with WebSocket listeners**:
```typescript
// In useTypingIndicator hook, replace polling with:
useEffect(() => {
  if (!receiverId && !groupId) return;

  const channelName = groupId 
    ? `group.${groupId}` 
    : `user.${receiverId}`;

  realtimeService.subscribe(
    channelName,
    'typing-status',
    (data: any) => {
      if (data.is_typing && data.user_id !== currentUserId) {
        setTypingUsers(prev => [...prev, data.user]);
      } else {
        setTypingUsers(prev => prev.filter(u => u.id !== data.user_id));
      }
    }
  );

  return () => {
    realtimeService.unsubscribe(channelName);
  };
}, [receiverId, groupId]);
```

## Summary

**Yes, your current structure can support typing indicators!**

**Recommended Path:**
1. ✅ Start with **polling approach** (Phase 2) - Quick to implement
2. ✅ Use your existing REST API structure
3. ✅ Later upgrade to WebSocket (Phase 3) for better performance

**Estimated Implementation Time:**
- Backend: 1-2 hours
- Frontend (polling): 2-3 hours
- Frontend (WebSocket): 3-4 hours

The architecture is well-suited for this feature - you just need to add the typing status endpoints and hook up the UI!

