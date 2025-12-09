# Backend Implementation Guide: Message Editing with Time Limit

## Overview
This guide shows how to implement message editing functionality with a 15-minute time limit on the backend.

## 1. Database Migration

Add an `edited_at` timestamp field to the messages table:

```php
// Create migration: php artisan make:migration add_edited_at_to_messages_table

public function up()
{
    Schema::table('messages', function (Blueprint $table) {
        $table->timestamp('edited_at')->nullable()->after('read_at');
    });
}

public function down()
{
    Schema::table('messages', function (Blueprint $table) {
        $table->dropColumn('edited_at');
    });
}
```

Run the migration:
```bash
php artisan migrate
```

## 2. Update Message Model

Add `edited_at` to the fillable array:

```php
// app/Models/Mezzage.php (or Message.php)

protected $fillable = [
    'message',
    'sender_id',
    'receiver_id',
    'group_id',
    'reply_to_id',
    'read_at',
    'edited_at', // Add this
];

protected $casts = [
    'created_at' => 'datetime',
    'updated_at' => 'datetime',
    'read_at' => 'datetime',
    'edited_at' => 'datetime', // Add this
];
```

## 3. Add Update Method to MessageController

Add this method to your `MessageController`:

```php
// app/Http/Controllers/Api/MessageController.php

/**
 * Update (edit) a message
 * 
 * @param Request $request
 * @param Mezzage $message
 * @return \Illuminate\Http\JsonResponse
 */
public function update(Request $request, Mezzage $message)
{
    // Validate that user owns the message
    if ($message->sender_id !== auth()->id()) {
        return response()->json([
            'message' => 'You can only edit your own messages'
        ], 403);
    }

    // Check time limit (15 minutes)
    $messageCreatedAt = new \Carbon\Carbon($message->created_at);
    $now = now();
    $diffInMinutes = $now->diffInMinutes($messageCreatedAt);

    if ($diffInMinutes > 15) {
        return response()->json([
            'message' => 'You can only edit messages within 15 minutes of sending them'
        ], 400);
    }

    // Validate request
    $validated = $request->validate([
        'message' => 'required|string|max:5000', // Adjust max length as needed
    ]);

    // Update message
    $message->update([
        'message' => $validated['message'],
        'edited_at' => now(),
    ]);

    // Load relationships for response
    $message->load(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments']);

    return response()->json(new MessageResource($message));
}
```

## 4. Add Route

Add the update route to your `routes/api.php`:

```php
// Inside your authenticated routes group
Route::middleware(['auth:sanctum'])->group(function () {
    // ... existing routes ...
    
    Route::put('/messages/{message}', [MessageController::class, 'update']);
    
    // ... other routes ...
});
```

## 5. Update MessageResource

Make sure `MessageResource` includes `edited_at`:

```php
// app/Http/Resources/MessageResource.php

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
        'edited_at' => $this->edited_at, // Add this
        
        // ... rest of your fields ...
    ];
}
```

## 6. Optional: Add Validation Request

Create a form request for better validation:

```php
// php artisan make:request UpdateMessageRequest

// app/Http/Requests/UpdateMessageRequest.php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateMessageRequest extends FormRequest
{
    public function authorize()
    {
        // Check if user owns the message
        $message = $this->route('message');
        return $message && $message->sender_id === auth()->id();
    }

    public function rules()
    {
        return [
            'message' => 'required|string|max:5000',
        ];
    }

    public function messages()
    {
        return [
            'message.required' => 'Message content is required',
            'message.max' => 'Message cannot exceed 5000 characters',
        ];
    }
}
```

Then update the controller method:

```php
public function update(UpdateMessageRequest $request, Mezzage $message)
{
    // Time limit check
    $messageCreatedAt = new \Carbon\Carbon($message->created_at);
    $now = now();
    $diffInMinutes = $now->diffInMinutes($messageCreatedAt);

    if ($diffInMinutes > 15) {
        return response()->json([
            'message' => 'You can only edit messages within 15 minutes of sending them'
        ], 400);
    }

    // Update message
    $message->update([
        'message' => $request->validated()['message'],
        'edited_at' => now(),
    ]);

    $message->load(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments']);

    return response()->json(new MessageResource($message));
}
```

## 7. Testing

Test the endpoint:

```bash
# Edit a message (within 15 minutes)
curl -X PUT http://your-domain/api/messages/123 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"message": "Edited message text"}'
```

Expected response:
```json
{
  "id": 123,
  "message": "Edited message text",
  "sender_id": 1,
  "created_at": "2025-12-04T10:00:00.000000Z",
  "edited_at": "2025-12-04T10:05:00.000000Z",
  ...
}
```

## Features Implemented

✅ **Time Limit**: Messages can only be edited within 15 minutes
✅ **Ownership Check**: Users can only edit their own messages
✅ **Edited Indicator**: Frontend shows "• Edited" next to timestamp
✅ **Edit UI**: Input bar changes to edit mode when editing
✅ **Validation**: Backend validates time limit and ownership
✅ **State Management**: Frontend updates message in real-time after edit

## Configuration

To change the time limit, update the `15` in both:
1. Frontend: `app/chat/user/[id].tsx` and `app/chat/group/[id].tsx` - `canEditMessage` function
2. Backend: `MessageController::update` method - time limit check

## Notes

- The frontend already implements the UI and API calls
- The backend needs to be implemented as shown above
- Messages with attachments cannot be edited (only text can be changed)
- Voice messages cannot be edited
- The edit option only appears for messages sent by the current user within the time limit





