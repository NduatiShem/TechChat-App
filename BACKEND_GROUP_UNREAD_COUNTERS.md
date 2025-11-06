# Backend Implementation: Group Unread Counters

## Overview
This document describes the backend implementation needed to support unread message counters for groups, similar to individual conversations.

## Backend Requirements

### 1. MessageRead Model
You already have the `MessageRead` model. This is used to track which messages have been read by which users in groups.

**File:** `app/Models/MessageRead.php`

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class MessageRead extends Model
{
    use HasFactory;

    protected $fillable = ['message_id', 'user_id', 'group_id'];
    
    public function message()
    {
        return $this->belongsTo(Mezzage::class);
    }
    
    public function user()
    {
        return $this->belongsTo(User::class);
    }
    
    public function group()
    {
        return $this->belongsTo(Group::class);
    }
}
```

### 2. Add `reads` Relationship to Mezzage Model

**File:** `app/Models/Mezzage.php`

Add this relationship:

```php
public function reads()
{
    return $this->hasMany(MessageRead::class, 'message_id');
}
```

### 3. Groups Endpoint - Include Unread Count

**File:** `app/Http/Controllers/Api/GroupController.php` (or wherever your groups endpoint is)

Update the `index()` method to include `unread_count` for each group:

```php
public function index()
{
    $userId = auth()->id();
    
    // Get all groups the user is a member of
    $groups = Group::whereHas('members', function($query) use ($userId) {
        $query->where('user_id', $userId);
    })
    ->with(['lastMessage.attachments'])
    ->orderBy('updated_at', 'desc')
    ->get();
    
    $formattedGroups = $groups->map(function ($group) use ($userId) {
        $lastMessage = $group->lastMessage;
        
        // Calculate unread count for this group
        // Count messages where:
        // 1. group_id = this group's ID
        // 2. sender_id != current user (don't count own messages)
        // 3. Message doesn't have a read record for this user
        $unreadCount = Mezzage::where('group_id', $group->id)
            ->where('sender_id', '!=', $userId)
            ->whereDoesntHave('reads', function($query) use ($userId) {
                $query->where('user_id', $userId);
            })
            ->count();
        
        return [
            'id' => $group->id,
            'name' => $group->name,
            'description' => $group->description,
            'owner_id' => $group->owner_id,
            'created_at' => $group->created_at,
            'updated_at' => $group->updated_at,
            'last_message' => $lastMessage ? $lastMessage->message : null,
            'last_message_date' => $lastMessage ? $lastMessage->created_at : null,
            'last_message_attachments' => $lastMessage && $lastMessage->attachments ? 
                $lastMessage->attachments->map(function ($attachment) {
                    return [
                        'id' => $attachment->id,
                        'name' => $attachment->name,
                        'mime' => $attachment->mime,
                        'url' => $attachment->url,
                    ];
                })->toArray() : [],
            'unread_count' => $unreadCount, // ✅ Add this
        ];
    });
    
    return response()->json($formattedGroups);
}
```

### 4. Mark Group Messages as Read Endpoint

**File:** `app/Http/Controllers/Api/MessageController.php`

Add this method:

```php
/**
 * Mark all unread messages in a group as read
 * Called when user opens a group chat
 * 
 * @param Request $request
 * @return \Illuminate\Http\JsonResponse
 */
public function markGroupMessagesAsRead(Request $request)
{
    $validated = $request->validate([
        'groupId' => 'required|integer',
    ]);
    
    $group = Group::findOrFail($validated['groupId']);
    $user = auth()->user();
    
    // Check if user is a member of the group
    if (!$group->members()->where('user_id', $user->id)->exists()) {
        return response()->json(['error' => 'Unauthorized'], 403);
    }
    
    // Get all unread messages in the group
    $unreadMessages = Mezzage::where('group_id', $group->id)
        ->where('sender_id', '!=', $user->id)  // Exclude messages sent by the user
        ->whereDoesntHave('reads', function($query) use ($user) {
            $query->where('user_id', $user->id);
        })
        ->get();
    
    // Create read records for all unread messages
    $unreadCount = 0;
    foreach ($unreadMessages as $message) {
        MessageRead::updateOrCreate(
            ['message_id' => $message->id, 'user_id' => $user->id],
            ['group_id' => $message->group_id]
        );
        $unreadCount++;
    }
    
    // Emit the event for real-time updates (if you have this event)
    // event(new GroupMessagesRead($group, $user));
    
    return response()->json([
        'success' => true,
        'unreadCount' => $unreadCount
    ]);
}
```

### 5. Add Route

**File:** `routes/api.php`

Add this route:

```php
Route::post('/messages/mark-group-read', [MessageController::class, 'markGroupMessagesAsRead']);
```

Make sure it's inside your authenticated routes group:

```php
Route::middleware(['auth:sanctum'])->group(function () {
    // ... other routes
    Route::post('/messages/mark-group-read', [MessageController::class, 'markGroupMessagesAsRead']);
    // ... other routes
});
```

## Database Migration

Make sure you have a `message_reads` table with the following structure:

```php
Schema::create('message_reads', function (Blueprint $table) {
    $table->id();
    $table->foreignId('message_id')->constrained('mezzages')->onDelete('cascade');
    $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
    $table->foreignId('group_id')->nullable()->constrained('groups')->onDelete('cascade');
    $table->timestamps();
    
    // Prevent duplicate read records
    $table->unique(['message_id', 'user_id']);
});
```

## Frontend Implementation

The frontend is already implemented:

1. **Groups Screen** (`app/groups.tsx`):
   - Displays unread count badges next to group names
   - Syncs unread counts from backend to NotificationContext
   - Refreshes when screen comes into focus

2. **Group Chat Screen** (`app/chat/group/[id].tsx`):
   - Marks messages as read when group chat is opened
   - Updates unread count to 0 immediately
   - Uses `useFocusEffect` to mark as read on focus

3. **API Service** (`services/api.ts`):
   - Added `markMessagesAsRead` method to `groupsAPI`
   - Calls `POST /api/messages/mark-group-read` with `{ groupId }`

## Testing

1. **Send messages** in a group from User A
2. **Open group chat** as User B
3. **Check database** → `message_reads` table should have records for User B
4. **Check groups list** → Unread count should be 0 for that group
5. **Check tab badge** → Total unread count should update

## Notes

- Unread count is calculated based on messages that don't have a `MessageRead` record for the current user
- Only messages sent by other users are counted (not own messages)
- The `MessageRead` model uses a unique constraint on `['message_id', 'user_id']` to prevent duplicates
- The frontend automatically refreshes groups when returning from a chat, ensuring counts are up-to-date

