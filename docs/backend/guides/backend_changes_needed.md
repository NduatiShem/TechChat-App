# Backend Changes for Last Seen and Online Status

## 1. Update User Model's `toConversationArray()` Method

Make sure the User model's `toConversationArray()` method includes user data with `last_seen_at`:

```php
// In App\Models\User

public function toConversationArray(?User $currentUser = null)
{
    return [
        'id' => $this->id,
        'name' => $this->name,
        'email' => $this->email,
        'avatar_url' => $this->avatar_url,
        'is_user' => true,
        'is_group' => false,
        'user_id' => $this->id,
        // Include user data with last_seen_at
        'user' => [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'avatar_url' => $this->avatar_url,
            'last_seen_at' => $this->last_seen_at ? ($this->last_seen_at instanceof \Carbon\Carbon ? $this->last_seen_at->toISOString() : $this->last_seen_at) : null,
            'created_at' => $this->created_at instanceof \Carbon\Carbon ? $this->created_at->toISOString() : $this->created_at,
            'updated_at' => $this->updated_at instanceof \Carbon\Carbon ? $this->updated_at->toISOString() : $this->updated_at,
        ],
        // Also include at root level for backward compatibility
        'last_seen_at' => $this->last_seen_at ? ($this->last_seen_at instanceof \Carbon\Carbon ? $this->last_seen_at->toISOString() : $this->last_seen_at) : null,
        'created_at' => $this->created_at instanceof \Carbon\Carbon ? $this->created_at->toISOString() : $this->created_at,
        'updated_at' => $this->updated_at instanceof \Carbon\Carbon ? $this->updated_at->toISOString() : $this->updated_at,
    ];
}
```

## 2. Add Last Seen Update Method to UserController (or create UserController)

If you don't have a UserController, create one:

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UserController extends Controller
{
    /**
     * Update the authenticated user's last_seen_at timestamp
     */
    public function updateLastSeen(Request $request)
    {
        try {
            $user = auth()->user();
            
            if (!$user) {
                return response()->json(['message' => 'Unauthorized'], 401);
            }
            
            // Update last_seen_at to current timestamp
            $user->update([
                'last_seen_at' => now()
            ]);
            
            return response()->json([
                'message' => 'Last seen updated successfully',
                'last_seen_at' => $user->last_seen_at instanceof \Carbon\Carbon ? $user->last_seen_at->toISOString() : $user->last_seen_at
            ]);
        } catch (\Exception $e) {
            \Log::error('Failed to update last_seen_at: ' . $e->getMessage());
            return response()->json(['message' => 'Failed to update last seen'], 500);
        }
    }
    
    /**
     * Get authenticated user's profile
     */
    public function me(Request $request)
    {
        return response()->json([
            'data' => auth()->user()
        ]);
    }
    
    /**
     * Get all users (for search/add users)
     */
    public function index(Request $request)
    {
        $search = $request->input('search');
        
        $query = \App\Models\User::query();
        
        if ($search) {
            $query->where(function($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }
        
        // Exclude current user
        $query->where('id', '!=', auth()->id());
        
        $users = $query->orderBy('name')->get();
        
        return response()->json($users);
    }
    
    /**
     * Get a specific user
     */
    public function show($id)
    {
        $user = \App\Models\User::findOrFail($id);
        
        return response()->json([
            'data' => $user
        ]);
    }
    
    /**
     * Get online users (users active within last 5 minutes)
     */
    public function getOnlineUsers()
    {
        $fiveMinutesAgo = now()->subMinutes(5);
        
        $onlineUsers = \App\Models\User::where('last_seen_at', '>=', $fiveMinutesAgo)
            ->where('id', '!=', auth()->id())
            ->get();
        
        return response()->json($onlineUsers);
    }
}
```

## 3. Update API Routes

Add the user routes to your `routes/api.php`:

```php
// Add this with your existing user routes or create a new UserController section

// Users
Route::get('/users', [UserController::class, 'index']);
Route::get('/users/{user}', [UserController::class, 'show']);
Route::get('/users/online', [UserController::class, 'getOnlineUsers']);
Route::post('/users/last-seen', [UserController::class, 'updateLastSeen'])->middleware('auth:sanctum');
Route::get('/users/me', [UserController::class, 'me'])->middleware('auth:sanctum');
```

Make sure to add the import at the top of your routes file:

```php
use App\Http\Controllers\Api\UserController;
```

## 4. Update MessageController's `byUser` Method (Optional Enhancement)

You can also ensure the user data is fresh by reloading it:

```php
public function byUser(User $user)
{
    $messages = Mezzage::where(function ($query) use ($user) {
        $query->where('sender_id', auth()->id())
              ->where('receiver_id', $user->id);
    })->orWhere(function ($query) use ($user) {
        $query->where('sender_id', $user->id)
              ->where('receiver_id', auth()->id());
    })
    ->latest()
    ->paginate(10);

    // Refresh user to get latest last_seen_at
    $user->refresh();

    return response()->json([
        'selectedConversation' => $user->toConversationArray(), 
        'messages' => MessageResource::collection($messages)
    ]);
}
```

## 5. Ensure User Model Has `last_seen_at` in $fillable

Make sure your User model allows mass assignment of `last_seen_at`:

```php
// In App\Models\User

protected $fillable = [
    'name',
    'email',
    'password',
    'avatar_url',
    'last_seen_at', // Add this
    // ... other fields
];

// Also ensure it's cast as a date
protected $casts = [
    'email_verified_at' => 'datetime',
    'last_seen_at' => 'datetime', // Add this
    'password' => 'hashed',
];
```

## Summary of Changes:

1. ✅ Update `User::toConversationArray()` to include `user.last_seen_at`
2. ✅ Create `UserController` with `updateLastSeen()` method
3. ✅ Add route: `POST /users/last-seen`
4. ✅ Ensure `last_seen_at` is in User model's `$fillable` and `$casts`

The frontend will automatically:
- Call `/users/last-seen` when app becomes active
- Call it every 2 minutes while app is active
- Call it when user sends a message
- Read `last_seen_at` from `selectedConversation.user.last_seen_at` to show online status and last seen time

