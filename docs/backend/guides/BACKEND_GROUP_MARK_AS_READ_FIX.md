# Backend Fix: Mark Group Messages as Read

## Error
```
Call to undefined method App\Events\MessageRead::updateOrCreate()
```

## Problem
The code is trying to call `updateOrCreate()` on `MessageRead` which is being resolved as an Event class instead of the Model class.

## Solution

**File:** `app/Http/Controllers/Api/MessageController.php`

Make sure you're using the correct namespace for the `MessageRead` model:

```php
use App\Models\MessageRead; // ✅ Use the Model, not the Event

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
        // ✅ IMPORTANT: Use App\Models\MessageRead, not App\Events\MessageRead
        MessageRead::updateOrCreate(
            [
                'message_id' => $message->id, 
                'user_id' => $user->id
            ],
            [
                'group_id' => $message->group_id
            ]
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

## Route

**File:** `routes/api.php`

```php
Route::post('/messages/mark-group-read', [MessageController::class, 'markGroupMessagesAsRead']);
```

## Important Notes

1. **Namespace**: Make sure you import `App\Models\MessageRead` at the top of your controller:
   ```php
   use App\Models\MessageRead;
   ```

2. **Not the Event**: If you have an Event class also named `MessageRead`, make sure you're using the Model, not the Event.

3. **Model Check**: Verify your `MessageRead` model extends `Model`:
   ```php
   namespace App\Models;
   
   use Illuminate\Database\Eloquent\Model;
   
   class MessageRead extends Model
   {
       protected $fillable = ['message_id', 'user_id', 'group_id'];
       // ...
   }
   ```

## Alternative: If You Have Naming Conflicts

If you have both an Event and a Model with the same name, you can use the fully qualified class name:

```php
// Instead of:
MessageRead::updateOrCreate(...)

// Use:
\App\Models\MessageRead::updateOrCreate(...)
```

Or alias the import:

```php
use App\Models\MessageRead as MessageReadModel;
use App\Events\MessageRead as MessageReadEvent;

// Then use:
MessageReadModel::updateOrCreate(...)
```

