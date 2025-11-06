# ✅ Unread Message Counters - WhatsApp Style

## Overview

Implemented WhatsApp-style unread message counters:
- **Individual conversation badges**: Green badge on each conversation showing unread count
- **Total tab badge**: Green badge on "Messages" tab showing total unread count across all conversations

---

## How It Works

### Logic:
- **Count messages where**:
  - `read_at IS NULL` (message hasn't been read)
  - `sender_id != current_user_id` (messages sent TO us, not by us)
  - `receiver_id == current_user_id` (messages sent to current user)

### Display:
- **Per conversation**: Green badge on avatar and next to name
- **Total on tab**: Green badge on "Messages" tab icon
- **Format**: Shows number (e.g., "5") or "99+" if over 99

---

## Frontend Implementation

### ✅ Already Implemented:

1. **Individual Conversation Badges** (`app/index.tsx`):
   - Badge on avatar (top-right corner)
   - Badge next to conversation name
   - Shows `unread_count` from backend

2. **Total Tab Badge** (`app/_layout.tsx`):
   - `NotificationBadge` component on Messages tab
   - Automatically calculates total from all conversation counts
   - Shows total unread count across all conversations

3. **NotificationContext**:
   - Tracks `conversationCounts` (per conversation)
   - Calculates `unreadCount` (total across all conversations)
   - Updates automatically when conversations load

---

## Backend Implementation Required

### Update `getConversationsForSidebar` Method:

```php
public static function getConversationsForSidebar(User $user)
{
    $userId = $user->id;
    
    // ✅ INDIVIDUAL CONVERSATIONS ONLY - No groups
    $users = User::getUserExceptUser($user);
    
    // ✅ FILTER: Only include users where current user has sent at least one message
    $usersWithOurMessages = $users->filter(function (User $otherUser) use ($userId) {
        return Mezzage::where('sender_id', $userId)
            ->where('receiver_id', $otherUser->id)
            ->exists();
    });
    
    // ✅ ONLY RETURN INDIVIDUAL CONVERSATIONS (No groups)
    $userConversations = $usersWithOurMessages->map(function (User $otherUser) use ($userId) {
        $conversation = $otherUser->toConversationArray();
        
        // ✅ CALCULATE UNREAD COUNT:
        // Count messages sent TO current user that haven't been read (read_at IS NULL)
        // Only count messages where sender_id != current_user_id (messages sent to us)
        $unreadCount = Mezzage::where(function ($query) use ($userId, $otherUser) {
            // Messages between current user and this user
            $query->where(function ($q) use ($userId, $otherUser) {
                $q->where('sender_id', $otherUser->id)
                  ->where('receiver_id', $userId);
            })->orWhere(function ($q) use ($userId, $otherUser) {
                $q->where('sender_id', $userId)
                  ->where('receiver_id', $otherUser->id);
            });
        })
        ->whereNull('read_at')              // Only unread messages (read_at IS NULL)
        ->where('sender_id', '!=', $userId)  // Only messages sent TO us (not by us)
        ->whereNull('group_id')              // Individual conversations only
        ->count();
        
        $conversation['unread_count'] = $unreadCount;
        
        // ✅ ADD READ RECEIPT FIELDS:
        $lastMessage = Mezzage::where(function ($query) use ($userId, $otherUser) {
            $query->where('sender_id', $userId)
                  ->where('receiver_id', $otherUser->id);
        })->orWhere(function ($query) use ($userId, $otherUser) {
            $query->where('sender_id', $otherUser->id)
                  ->where('receiver_id', $userId);
        })
        ->latest()
        ->first();
        
        if ($lastMessage) {
            $conversation['last_message_sender_id'] = $lastMessage->sender_id;
            
            if ($lastMessage->sender_id == $userId) {
                $conversation['last_message_read_at'] = $lastMessage->read_at;
            } else {
                $conversation['last_message_read_at'] = null;
            }
        } else {
            $conversation['last_message_sender_id'] = null;
            $conversation['last_message_read_at'] = null;
        }
        
        $conversation['is_user'] = true;
        $conversation['is_group'] = false;
        
        return $conversation;
    });
    
    return $userConversations;
}
```

---

## Key Points

### Unread Count Logic:
```php
// Count messages where:
// 1. read_at IS NULL (not read yet)
// 2. sender_id != current_user_id (sent TO us, not BY us)
// 3. receiver_id == current_user_id (sent to current user)
// 4. group_id IS NULL (individual conversations only)
```

### What Gets Counted:
- ✅ Messages sent TO you that you haven't read
- ❌ Messages you sent (not counted)
- ❌ Messages you've already read (read_at has timestamp)
- ❌ Group messages (only individual conversations)

---

## Visual Design

### Individual Conversation Badge:
- **Position**: Top-right corner of avatar AND next to conversation name
- **Color**: Green (`bg-green-500`)
- **Size**: Small circular badge
- **Text**: White, bold, shows number or "99+"

### Total Tab Badge:
- **Position**: Top-right corner of "Messages" tab icon
- **Color**: Green (`bg-green-500`)
- **Size**: Small circular badge
- **Text**: White, bold, shows total number or "99+"

---

## Example Response

After backend update, your `/api/conversations` response should include:

```json
[
  {
    "id": 1,
    "name": "John Doe",
    "unread_count": 5,              // ← Unread messages sent TO you
    "last_message": "Hello",
    "last_message_sender_id": 1,
    "last_message_read_at": null,
    ...
  },
  {
    "id": 2,
    "name": "Jane Smith",
    "unread_count": 0,               // ← No unread messages
    "last_message": "Thanks!",
    "last_message_sender_id": 2,
    "last_message_read_at": null,
    ...
  }
]
```

**Total unread count** = Sum of all `unread_count` values (e.g., 5 + 0 = 5)

---

## Testing

### Test Scenarios:

1. **Send message to you**:
   - Backend should count it if `read_at IS NULL`
   - Badge should appear on conversation
   - Total count should increase

2. **Read a message**:
   - Backend updates `read_at` timestamp
   - Badge count should decrease
   - Total count should decrease

3. **Multiple unread messages**:
   - Badge should show correct count
   - Total should sum all conversations

4. **No unread messages**:
   - Badges should not appear
   - Total should be 0

---

## Frontend Status

✅ **Already Working**:
- Individual conversation badges
- Total tab badge
- Automatic calculation from backend `unread_count`
- Updates when conversations load

---

## Backend Status

⚠️ **Needs Update**:
- Add `unread_count` calculation to `getConversationsForSidebar`
- Count messages where `read_at IS NULL` and `sender_id != current_user_id`

---

**Status**: Frontend Ready - Backend Update Required  
**Last Updated**: Unread Counters v1.0

