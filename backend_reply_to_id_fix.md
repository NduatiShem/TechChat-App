# Backend Fix: `reply_to_id` Validation Issue

## Problem
The `reply_to_id` field is being received in the raw request but is becoming `null` after validation. This happens because `reply_to_id` is not included in the `StoreMessageRequest` validation rules.

## Solution

### 1. Fix `StoreMessageRequest` Validation Rules

Add `reply_to_id` to the validation rules in your `StoreMessageRequest` class:

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreMessageRequest extends FormRequest
{
    public function authorize()
    {
        return true;
    }

    public function rules()
    {
        return [
            'message' => 'nullable|string|max:5000',
            'receiver_id' => 'nullable|integer|exists:users,id',
            'group_id' => 'nullable|integer|exists:groups,id',
            'reply_to_id' => 'nullable|integer|exists:messages,id', // Add this line
            'attachments' => 'nullable|array',
            'attachments.*' => 'file|max:10240', // 10MB max per file
        ];
    }

    public function messages()
    {
        return [
            'receiver_id.exists' => 'The selected receiver does not exist.',
            'group_id.exists' => 'The selected group does not exist.',
            'reply_to_id.exists' => 'The message being replied to does not exist.', // Add this
            'attachments.*.max' => 'Each attachment must not exceed 10MB.',
        ];
    }
}
```

**Note**: If your table is named `mezzages` instead of `messages`, change the validation rule to:
```php
'reply_to_id' => 'nullable|integer|exists:mezzages,id',
```

### 2. Fix Duplicate `reply_to_id` in `$fillable` Array

In your `Mezzage` model (or `Message` model), ensure `reply_to_id` appears only once in the `$fillable` array:

```php
protected $fillable = [
    'message',
    'sender_id',
    'group_id',
    'receiver_id',
    'conversation_id',
    'reply_to_id', // Remove duplicate - keep only one instance
    'read_at',
];
```

### 3. Ensure `MessageResource` Includes `reply_to` Data

Make sure your `MessageResource` includes the `reply_to` relationship when loading messages. The `MessageResource` should load the `replyTo` relationship:

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

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

### 4. Update `MessageController` to Load `replyTo` Relationship

In your `MessageController`, ensure you load the `replyTo` relationship when fetching messages:

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

### 5. Ensure `Mezzage` Model Has `replyTo` Relationship

In your `Mezzage` model, add the `replyTo` relationship:

```php
public function replyTo()
{
    return $this->belongsTo(Mezzage::class, 'reply_to_id');
}
```

Also ensure the relationship is loaded in the `MessageResource` or the controller queries.

## Summary

The main fix is to add `reply_to_id` to the `StoreMessageRequest` validation rules. After this change:
1. The `reply_to_id` will be included in `$request->validated()`
2. It will be saved to the database
3. The `reply_to` relationship will be loaded when fetching messages
4. The frontend will receive the `reply_to` data and display reply messages correctly


