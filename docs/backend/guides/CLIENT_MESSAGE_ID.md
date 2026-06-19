# Backend: `client_message_id` (idempotent sends)

> **Full controller patches:** see [MESSAGE_CONTROLLER_UPGRADE.md](./MESSAGE_CONTROLLER_UPGRADE.md) for drop-in changes to your existing `MessageController`, delta sync, and broadcasting.

The mobile app (Phase 1) sends every new message with a UUID field:

- **Form field:** `client_message_id`
- **Purpose:** Deduplicate retries — same UUID must not create two rows on the server.

## Laravel changes (required)

### 1. Migration

```php
Schema::table('mezzages', function (Blueprint $table) {
    $table->uuid('client_message_id')->nullable()->unique();
});
```

### 2. `StoreMessageRequest`

```php
'client_message_id' => ['nullable', 'uuid'],
```

### 3. `MessageController@store` (before `Mezzage::create`)

```php
$clientMessageId = $request->input('client_message_id');

if ($clientMessageId) {
    $existing = Mezzage::where('client_message_id', $clientMessageId)
        ->where('sender_id', auth()->id())
        ->first();

    if ($existing) {
        return new MessageResource($existing->load('attachments'));
    }
}

$data['client_message_id'] = $clientMessageId;
$message = Mezzage::create($data);
```

### 4. `MessageResource`

Include `client_message_id` in the JSON response so the app can correlate.

## Testing

1. Send a message from the app with network throttled.
2. Kill the app mid-send, reopen — only **one** row on the server for that UUID.
3. Retry the failed bubble in the app — still one server row.
