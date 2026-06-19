# MessageController upgrade (TechChat app)

Apply these changes on your **Laravel API** (not in this React Native repo). They match what the mobile app already sends and expects.

## Priority order

| Step | What | Why |
|------|------|-----|
| 1 | Migration + model | Persist `client_message_id` |
| 2 | `StoreMessageRequest` | Accept UUID from app |
| 3 | `store()` idempotency | Stop duplicate sends on retry |
| 4 | `MessageResource` | Echo `client_message_id` for dedup |
| 5 | `byUser()` / `byGroup()` delta | Power 30s polling (`after_id`) |
| 6 | Broadcasting channel/event | Match `realtimeService.ts` |

---

## 1. Migration

```bash
php artisan make:migration add_client_message_id_to_mezzages_table
```

```php
public function up(): void
{
    Schema::table('mezzages', function (Blueprint $table) {
        $table->uuid('client_message_id')->nullable()->unique()->after('id');
    });
}

public function down(): void
{
    Schema::table('mezzages', function (Blueprint $table) {
        $table->dropUnique(['client_message_id']);
        $table->dropColumn('client_message_id');
    });
}
```

Run: `php artisan migrate`

---

## 2. `Mezzage` model

Add to `$fillable`:

```php
'client_message_id',
```

---

## 3. `StoreMessageRequest`

```php
'client_message_id' => ['nullable', 'uuid'],
```

The app sends this on every outbox send as form field `client_message_id`.

---

## 4. `MessageResource`

Add to `toArray()`:

```php
'client_message_id' => $this->client_message_id,
```

Without this field, the app cannot correlate retries to the server row.

---

## 5. Replace `store()` (idempotent)

Drop this **before** `Mezzage::create($data)` in your existing method. Keep your attachment + conversation + `SocketMessage::dispatch` logic after create.

```php
public function store(StoreMessageRequest $request)
{
    $data = $request->validated();
    $data['sender_id'] = auth()->id();
    $clientMessageId = $data['client_message_id'] ?? null;
    $receiverId = $data['receiver_id'] ?? null;
    $groupId = $data['group_id'] ?? null;
    $files = $data['attachments'] ?? [];

    $loadRelations = fn (Mezzage $message) => $message->load([
        'sender', 'attachments', 'replyTo.sender', 'replyTo.attachments',
    ]);

    // Idempotent retry: same UUID + same sender => return existing row
    if ($clientMessageId) {
        $existing = Mezzage::where('client_message_id', $clientMessageId)
            ->where('sender_id', auth()->id())
            ->first();

        if ($existing) {
            return new MessageResource($loadRelations($existing));
        }
    }

    try {
        $message = Mezzage::create($data);
    } catch (\Illuminate\Database\QueryException $e) {
        // Race: two requests with same client_message_id
        if ($clientMessageId && str_contains($e->getMessage(), 'client_message_id')) {
            $existing = Mezzage::where('client_message_id', $clientMessageId)
                ->where('sender_id', auth()->id())
                ->first();

            if ($existing) {
                return new MessageResource($loadRelations($existing));
            }
        }
        throw $e;
    }

    // ... your existing attachment loop unchanged ...

    if ($receiverId) {
        Conversation::updateConversationWithMessage($receiverId, auth()->id(), $message);
    }

    if ($groupId) {
        Group::updateGroupWithMessage($groupId, $message);
    }

    SocketMessage::dispatch($message);

    return new MessageResource($loadRelations($message));
}
```

**Optional:** Remove or gate the verbose `Log::info('Raw request data')` lines in production.

---

## 6. Delta sync on `byUser()` and `byGroup()`

The app polls:

- `GET /api/messages/user/{userId}?after_id={latestId}&page=1&per_page=50`
- `GET /api/messages/group/{groupId}?after_id={latestId}&page=1&per_page=50`

Add `Request $request` and filter when `after_id` or `since` is present.

### `byUser(User $user, Request $request)`

Replace the query block with:

```php
$query = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments'])
    ->where(function ($q) use ($user) {
        $q->where(function ($q2) use ($user) {
            $q2->where('sender_id', auth()->id())
                ->where('receiver_id', $user->id);
        })->orWhere(function ($q2) use ($user) {
            $q2->where('sender_id', $user->id)
                ->where('receiver_id', auth()->id());
        });
    })
    ->whereNull('group_id');

if ($request->filled('after_id')) {
    $query->where('id', '>', (int) $request->input('after_id'));
} elseif ($request->filled('since')) {
    $query->where('created_at', '>', $request->input('since'));
}

$perPage = min((int) $request->input('per_page', 10), 100);
$messages = $query->latest()->paginate($perPage);
```

Keep your existing JSON response shape (`messages.data`, `newest_message_id`, etc.).

### `byGroup(Group $group, Request $request)`

```php
$query = Mezzage::with(['sender', 'attachments', 'replyTo.sender', 'replyTo.attachments'])
    ->where('group_id', $group->id);

if ($request->filled('after_id')) {
    $query->where('id', '>', (int) $request->input('after_id'));
} elseif ($request->filled('since')) {
    $query->where('created_at', '>', $request->input('since'));
}

$perPage = min((int) $request->input('per_page', 10), 100);
$messages = $query->latest()->paginate($perPage);
```

---

## 7. Realtime: align `SocketMessage` with the app

The app subscribes to:

| Chat | Channel | Event |
|------|---------|-------|
| DM | `private-conversation.individual.{otherUserId}` | `MessageSent` |
| Group | `private-conversation.group.{groupId}` | `MessageSent` |

Read receipts: `MessagesRead` on the same channel (optional for now).

### Your current `SocketMessage` vs what the app expects

| | Your backend today | App (`realtimeService.ts`) |
|--|-------------------|---------------------------|
| DM channel | `private-message.user.{sorted-sender-receiver}` | `private-conversation.individual.{userId}` |
| Group channel | `private-message.group.{groupId}` | `private-conversation.group.{groupId}` |
| Event name | default (`SocketMessage`) | `MessageSent` |
| Payload | `{ message: MessageResource }` | flat resource at root (`id`, `client_message_id`, …) |

**Fix on Laravel** (recommended): replace your event with the version in `docs/backend/guides/SOCKET_MESSAGE_BROADCAST.php`.

Key changes:

1. `broadcastAs()` → `'MessageSent'`
2. `broadcastWith()` → `(new MessageResource($message))->resolve()` (not wrapped in `message`)
3. `broadcastOn()` → `conversation.individual.{sender_id}` **and** `{receiver_id}` for DMs; `conversation.group.{groupId}` for groups
4. Update `routes/channels.php` to authorize `conversation.individual.*` and `conversation.group.*`

**Individual chat:** broadcast to **both** user channels so each participant’s open chat receives the event.

**Group chat:** one channel per group; members authorize via group membership.

Configure Reverb/Pusher in Laravel and set app env vars (see `.env.example` in this repo).

If you have a **web client** still on `message.user.*` / `message.group.*`, either migrate it to the new channels or broadcast on both channel sets temporarily.

---

## 8. Mark-as-read (already compatible)

Your existing endpoints match the app:

| App call | Your method |
|----------|-------------|
| `PUT /messages/mark-read/{userId}` | `markMessagesAsRead` |
| `POST /messages/mark-group-read` | `markGroupMessagesAsRead` |
| `PUT /conversations/{id}/read?type=` | `markConversationAsRead` |

No changes required unless you want to consolidate duplicate mark-read methods later.

---

## 9. Verification checklist

1. **Idempotency:** Send a message with Charles/Postman twice using the same `client_message_id` → one DB row, HTTP 200 both times.
2. **Resource:** Response JSON includes `"client_message_id": "..."`.
3. **Delta:** `GET ...?after_id=100` returns only messages with `id > 100`.
4. **App retry:** Airplane mode → send → reconnect → one bubble, one server row.
5. **Realtime:** Open chat on two devices; new message appears without waiting for poll (once broadcasting is wired).

---

## 10. Optional follow-ups (later)

- Fix `loadOlder()` DM query grouping (wrap `orWhere` in nested closures — same pattern as `byUser` above).
- Remove duplicate mark-read methods (`markConversationAsRead` vs `markConversationAsReadTwo`).
- Strip debug logging from `store()` in production.
- Per-user group read receipts (`message_reads` table) — you already use this in `markGroupMessagesAsRead`.
