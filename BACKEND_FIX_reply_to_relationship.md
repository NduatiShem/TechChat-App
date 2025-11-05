# Backend Fix: Load `reply_to` Relationship When Fetching Messages

## Problem
After refreshing, reply messages appear as normal messages because the backend is not loading the `reply_to` relationship when fetching messages.

## Solution

You need to make **3 changes** on the backend:

### 1. Add `replyTo` Relationship to Mezzage Model

**File:** `app/Models/Mezzage.php`

Add this relationship method:

```php
public function replyTo()
{
    return $this->belongsTo(Mezzage::class, 'reply_to_id');
}
```

### 2. Update MessageController to Load `replyTo` Relationship

**File:** `app/Http/Controllers/Api/MessageController.php`

Update the `byUser`, `byGroup`, and `loadOlder` methods to include `replyTo` in the `with()` clause:

#### Update `byUser` method:
```php
public function byUser(User $user)
{
    $messages = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments'])
        ->where(function ($query) use ($user) {
            $query->where('sender_id', auth()->id())
                  ->where('receiver_id', $user->id);
        })->orWhere(function ($query) use ($user) {
            $query->where('sender_id', $user->id)
                  ->where('receiver_id', auth()->id());
        })
        ->latest()
        ->paginate(10);

    $user->refresh();

    return response()->json([
        'selectedConversation' => $user->toConversationArray(), 
        'messages' => MessageResource::collection($messages)
    ]);
}
```

#### Update `byGroup` method:
```php
public function byGroup(Group $group)
{
    $messages = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments'])
        ->where('group_id', $group->id)
        ->latest()
        ->paginate(10);

    return response([
        'selectedConversation' => $group->toConversationArray(), 
        'messages' => MessageResource::collection($messages),
    ]);
}
```

#### Update `loadOlder` method:
```php
public function loadOlder(Mezzage $message)
{
    $query = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments']);
    
    if($message->group_id){
        $messages = $query->where('created_at', '<', $message->created_at)
            ->where('group_id', $message->group_id)
            ->latest()
            ->paginate(10);
    }else{
        $messages = $query->where('created_at', '<', $message->created_at)
            ->where(function ($query) use ($message) {
                $query->where('sender_id', $message->sender_id)
                    ->where('receiver_id', $message->receiver_id)
                    ->orWhere('sender_id', $message->receiver_id)
                    ->where('receiver_id', $message->sender_id);
            })
            ->latest()
            ->paginate(10);
    }

    return MessageResource::collection($messages);
}
```

**Key Change:** Add `'replyTo.sender', 'replyTo.attachments'` to the `with()` array.

### 3. Update MessageResource to Include `reply_to` Data

**File:** `app/Http/Resources/MessageResource.php`

Add the `reply_to` field to the `toArray()` method:

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class MessageResource extends JsonResource
{
    public function toArray($request)
    {
        return [
            'id' => $this->id,
            'message' => $this->message,
            'sender_id' => $this->sender_id,
            'receiver_id' => $this->receiver_id,
            'group_id' => $this->group_id,
            'reply_to_id' => $this->reply_to_id,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'read_at' => $this->read_at,
            
            // Include sender data
            'sender' => $this->whenLoaded('sender', function () {
                return [
                    'id' => $this->sender->id,
                    'name' => $this->sender->name,
                    'avatar_url' => $this->sender->avatar_url,
                ];
            }),
            
            // Include reply_to data if it exists
            'reply_to' => $this->whenLoaded('replyTo', function () {
                return [
                    'id' => $this->replyTo->id,
                    'message' => $this->replyTo->message,
                    'sender' => [
                        'id' => $this->replyTo->sender_id,
                        'name' => $this->replyTo->sender->name ?? 'Unknown User',
                        'avatar_url' => $this->replyTo->sender->avatar_url ?? null,
                    ],
                    'attachments' => $this->replyTo->attachments->map(function ($attachment) {
                        return [
                            'id' => $attachment->id,
                            'name' => $attachment->name,
                            'mime' => $attachment->mime,
                            'url' => $attachment->url ?? Storage::url($attachment->path),
                        ];
                    }) ?? [],
                ];
            }),
            
            // Include attachments
            'attachments' => $this->whenLoaded('attachments', function () {
                return $this->attachments->map(function ($attachment) {
                    return [
                        'id' => $attachment->id,
                        'name' => $attachment->name,
                        'mime' => $attachment->mime,
                        'size' => $attachment->size,
                        'url' => $attachment->url ?? Storage::url($attachment->path),
                        'path' => $attachment->path,
                    ];
                });
            }),
        ];
    }
}
```

## Summary

After making these 3 changes:

1. ✅ `reply_to_id` is saved (already working)
2. ✅ `replyTo` relationship is loaded when fetching messages
3. ✅ `reply_to` data is included in the API response
4. ✅ Frontend will display reply messages correctly after refresh

## Testing

After making these changes:
1. Send a reply message
2. Refresh the app
3. The reply message should show the quoted message preview (like WhatsApp)

The frontend will receive messages like this:
```json
{
  "id": 353,
  "message": "Work",
  "reply_to_id": 352,
  "reply_to": {
    "id": 352,
    "message": "Got it!",
    "sender": {
      "id": 1,
      "name": "John Doe",
      "avatar_url": "https://..."
    },
    "attachments": []
  }
}
```


