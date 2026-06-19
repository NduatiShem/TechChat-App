# Backend Implementation: Mark Messages as Read

## Overview
When a user opens a conversation, we need to mark all unread messages from the other user as read by updating the `read_at` column with the current timestamp.

## ⚠️ IMPORTANT: Use This Route (Recommended)

**PUT** `/api/messages/mark-read/{userId}`

Where `{userId}` is the ID of the other user in the individual conversation.

This is the **simpler and recommended** route. The frontend will try this first.

## Implementation

### 1. Add Route

**File:** `routes/api.php`

```php
Route::put('/messages/mark-read/{user}', [MessageController::class, 'markMessagesAsRead']);
```

### 2. Add Method to MessageController

**File:** `app/Http/Controllers/Api/MessageController.php`

```php
/**
 * Mark all unread messages from a specific user as read
 * Called when user opens a conversation
 * 
 * @param User $user The other user in the conversation
 * @return \Illuminate\Http\JsonResponse
 */
public function markMessagesAsRead(User $user)
{
    $currentUserId = auth()->id();
    
    // Validate: Don't allow marking own messages as read
    if ($user->id === $currentUserId) {
        return response()->json([
            'error' => 'Cannot mark own messages as read'
        ], 400);
    }
    
    // Find all unread messages sent by the other user to the current user
    // Conditions:
    // 1. sender_id = other user's ID (messages sent by them)
    // 2. receiver_id = current user's ID (messages received by us)
    // 3. read_at IS NULL (not yet read)
    // 4. group_id IS NULL (individual conversation, not group)
    $updated = Mezzage::where('sender_id', $user->id)
        ->where('receiver_id', $currentUserId)
        ->whereNull('read_at')
        ->whereNull('group_id')
        ->update([
            'read_at' => now()
        ]);
    
    return response()->json([
        'success' => true,
        'message' => 'Messages marked as read',
        'updated_count' => $updated
    ]);
}
```

## Alternative: Using Existing Route Structure

If you prefer to use the existing route structure (`PUT /api/conversations/{id}/read?type=individual`), here's the updated implementation:

### Route (if not already exists)
**File:** `routes/api.php`

```php
Route::put('/conversations/{id}/read', [MessageController::class, 'markConversationAsRead']);
```

### Method
**File:** `app/Http/Controllers/Api/MessageController.php`

```php
/**
 * Mark all unread messages in a conversation as read
 * 
 * @param int $id User ID (for individual) or Group ID (for group)
 * @param Request $request
 * @return \Illuminate\Http\JsonResponse
 */
public function markConversationAsRead($id, Request $request)
{
    $type = $request->query('type', 'individual'); // 'individual' or 'group'
    $currentUserId = auth()->id();
    
    if ($type === 'individual') {
        // For individual conversations, $id is the other user's ID
        $otherUser = User::find($id);
        
        if (!$otherUser) {
            return response()->json([
                'error' => 'User not found'
            ], 404);
        }
        
        // Mark all unread messages from the other user to the current user as read
        $updated = Mezzage::where('sender_id', $otherUser->id)
            ->where('receiver_id', $currentUserId)
            ->whereNull('read_at')
            ->whereNull('group_id')
            ->update([
                'read_at' => now()
            ]);
    } else {
        // For group conversations
        $group = Group::find($id);
        
        if (!$group) {
            return response()->json([
                'error' => 'Group not found'
            ], 404);
        }
        
        // Check if user is a member of the group
        if (!$group->members()->where('user_id', $currentUserId)->exists()) {
            return response()->json([
                'error' => 'Unauthorized'
            ], 403);
        }
        
        // Mark all unread messages in the group (except own messages) as read
        $updated = Mezzage::where('group_id', $group->id)
            ->where('sender_id', '!=', $currentUserId)
            ->whereNull('read_at')
            ->update([
                'read_at' => now()
            ]);
    }
    
    return response()->json([
        'success' => true,
        'message' => 'Messages marked as read',
        'updated_count' => $updated
    ]);
}
```

## Frontend API Call

The frontend is already calling this endpoint:

```typescript
// In app/chat/user/[id].tsx
await messagesAPI.markAsRead(Number(id), 'individual');
```

This calls: `PUT /api/conversations/{id}/read?type=individual`

## What Happens

1. **User opens conversation** → Frontend calls `markAsRead(userId, 'individual')`
2. **Backend receives request** → Finds all unread messages from that user
3. **Backend updates database** → Sets `read_at = now()` for all matching messages
4. **Backend returns response** → Includes count of updated messages
5. **Frontend updates UI** → Resets unread count and updates message display

## Database Query

The query updates messages where:
- `sender_id` = other user's ID (messages they sent)
- `receiver_id` = current user's ID (messages we received)
- `read_at IS NULL` (not yet read)
- `group_id IS NULL` (individual conversation)

## Example

**Before:**
```sql
SELECT * FROM mezzages 
WHERE sender_id = 2 
  AND receiver_id = 1 
  AND read_at IS NULL 
  AND group_id IS NULL;
-- Returns 3 unread messages
```

**After calling markAsRead:**
```sql
UPDATE mezzages 
SET read_at = '2024-01-15 10:30:00' 
WHERE sender_id = 2 
  AND receiver_id = 1 
  AND read_at IS NULL 
  AND group_id IS NULL;
-- Updates 3 messages
```

## Testing

1. **Send messages** from User A to User B
2. **Open conversation** as User B
3. **Check database** → `read_at` should be set to current timestamp
4. **Check unread count** → Should be 0 for that conversation

## Notes

- Only marks messages **received** by the current user (not messages they sent)
- Only marks messages in **individual** conversations (not groups)
- Only marks messages that are **unread** (`read_at IS NULL`)
- Uses `now()` to set the timestamp (Laravel's helper function)

