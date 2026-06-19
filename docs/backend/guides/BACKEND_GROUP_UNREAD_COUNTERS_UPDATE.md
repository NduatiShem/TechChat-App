# Backend Update: Add Unread Count to Groups Endpoint

## Your Current Implementation

**Route:** `Route::get('/groups', [ProfileController::class, 'groups']);`

**Controller Method:**
```php
public function groups(Request $request)
{
    $user = $request->user();
    $groups = Group::getGroupsForUser($user);
    return response()->json($groups);
}
```

## Option 1: Update in Controller (Recommended)

Update your `groups()` method in `ProfileController` to add unread count:

```php
public function groups(Request $request)
{
    $user = $request->user();
    $groups = Group::getGroupsForUser($user);
    
    // Add unread_count to each group
    $groupsWithUnreadCount = $groups->map(function ($group) use ($user) {
        // Calculate unread count for this group
        // Count messages where:
        // 1. group_id = this group's ID
        // 2. sender_id != current user (don't count own messages)
        // 3. Message doesn't have a read record for this user
        $unreadCount = Mezzage::where('group_id', $group['id'] ?? $group->id)
            ->where('sender_id', '!=', $user->id)
            ->whereDoesntHave('reads', function($query) use ($user) {
                $query->where('user_id', $user->id);
            })
            ->count();
        
        // Add unread_count to the group array/object
        if (is_array($group)) {
            $group['unread_count'] = $unreadCount;
        } else {
            $group->unread_count = $unreadCount;
        }
        
        return $group;
    });
    
    return response()->json($groupsWithUnreadCount);
}
```

## Option 2: Update in Group Model Method

If you prefer to keep the logic in the `Group` model, update `getGroupsForUser()`:

**File:** `app/Models/Group.php`

```php
public static function getGroupsForUser(User $user)
{
    $groups = Group::whereHas('members', function($query) use ($user) {
        $query->where('user_id', $user->id);
    })
    ->with(['lastMessage.attachments'])
    ->orderBy('updated_at', 'desc')
    ->get();
    
    return $groups->map(function ($group) use ($user) {
        // Calculate unread count
        $unreadCount = Mezzage::where('group_id', $group->id)
            ->where('sender_id', '!=', $user->id)
            ->whereDoesntHave('reads', function($query) use ($user) {
                $query->where('user_id', $user->id);
            })
            ->count();
        
        // Convert to array and add unread_count
        $groupArray = $group->toArray();
        $groupArray['unread_count'] = $unreadCount;
        
        return $groupArray;
    });
}
```

## Prerequisites

### 1. Add `reads` Relationship to Mezzage Model

**File:** `app/Models/Mezzage.php`

Add this relationship:

```php
public function reads()
{
    return $this->hasMany(MessageRead::class, 'message_id');
}
```

### 2. Make Sure MessageRead Model Exists

You already have this model. Make sure it's set up correctly:

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

## Response Format

After the update, your `/api/groups` response should include `unread_count`:

```json
[
  {
    "id": 1,
    "name": "Frida Christiansen",
    "description": "Group description",
    "owner_id": 1,
    "last_message": "Just vibes",
    "last_message_date": "2024-01-15 10:30:00",
    "unread_count": 5,  // ← NEW: Unread message count
    ...
  },
  {
    "id": 2,
    "name": "Dr. Roselyn Stehr Sr.",
    "last_message": "Test",
    "unread_count": 0,  // ← NEW: No unread messages
    ...
  }
]
```

## Testing

1. **Send messages** in a group from User A
2. **Check groups endpoint** as User B → Should see `unread_count > 0`
3. **Open group chat** as User B → Messages marked as read
4. **Check groups endpoint again** → Should see `unread_count = 0`

## Notes

- The unread count is calculated based on messages that don't have a `MessageRead` record for the current user
- Only messages sent by other users are counted (not own messages)
- The count is calculated in real-time when the endpoint is called

