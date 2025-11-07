# Backend Fix: Filter Active Users Only

## Requirements
1. Users tab should only show active users (active_status = 1)
2. Messages/Conversations tab should only show conversations with active users
3. Prevent login if account is deactivated (active_status = 0)

## Backend Changes Needed

### 1. Update Users Endpoint - Filter Active Users

**File:** `app/Http/Controllers/Api/UserController.php` (or wherever `/users` is handled)

```php
public function users(Request $request)
{
    $user = $request->user();
    $users = User::getUserExceptUser($user);
    
    // ✅ Filter only active users (active_status = 1)
    $activeUsers = $users->where('active_status', 1);
    
    // Transform users to include avatar_url
    $usersWithAvatars = $activeUsers->map(function($user) {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'avatar_url' => $user->profile_image 
                ? asset('storage/profile_images/' . $user->profile_image) 
                : null,
            'created_at' => $user->created_at,
            'updated_at' => $user->updated_at,
        ];
    });
    
    return response()->json($usersWithAvatars);
}
```

**OR if using User::getUserExceptUser() method, update that method:**

```php
// In app/Models/User.php
public static function getUserExceptUser(User $currentUser)
{
    return User::where('id', '!=', $currentUser->id)
        ->where('active_status', 1) // ✅ Only active users
        ->orderBy('name')
        ->get();
}
```

### 2. Update Conversations Endpoint - Filter Active Users

**File:** `app/Models/Conversation.php` or wherever `getConversationsForSidebar2()` is

```php
public static function getConversationsForSidebar2(User $user)
{
    $userId = $user->id;
    
    // ✅ INDIVIDUAL CONVERSATIONS ONLY - No groups
    // ✅ Filter only active users
    $users = User::where('id', '!=', $userId)
        ->where('active_status', 1) // ✅ Only active users
        ->get();
    
    // ✅ FILTER: Only include users where current user has sent at least one message
    $usersWithOurMessages = $users->filter(function (User $otherUser) use ($userId) {
        return Mezzage::where('sender_id', $userId)
            ->where('receiver_id', $otherUser->id)
            ->exists();
    });
    
    // ✅ ONLY RETURN INDIVIDUAL CONVERSATIONS (No groups)
    $userConversations = $usersWithOurMessages->map(function (User $otherUser) use ($userId) {
        // ... rest of your existing code ...
    });
    
    return $userConversations;
}
```

### 3. Prevent Login for Deactivated Users

**File:** `app/Http/Controllers/Api/AuthController.php` (or wherever login is handled)

```php
public function login(Request $request)
{
    $credentials = $request->validate([
        'email' => 'required|email',
        'password' => 'required',
    ]);
    
    // Check if user exists and is active
    $user = User::where('email', $credentials['email'])->first();
    
    if (!$user) {
        return response()->json([
            'message' => 'Invalid credentials'
        ], 401);
    }
    
    // ✅ Check if account is deactivated
    if ($user->active_status == 0) {
        return response()->json([
            'message' => 'Your account has been deactivated. Please contact an administrator.',
            'account_deactivated' => true
        ], 403); // 403 Forbidden
    }
    
    // Attempt authentication
    if (!Auth::attempt($credentials)) {
        return response()->json([
            'message' => 'Invalid credentials'
        ], 401);
    }
    
    // Generate token
    $token = $user->createToken('auth_token')->plainTextToken;
    
    return response()->json([
        'user' => new UserResource($user),
        'token' => $token,
    ]);
}
```

## Frontend Changes

The frontend will automatically handle:
1. Users tab - will only show active users (filtered by backend)
2. Messages tab - will only show conversations with active users (filtered by backend)
3. Login - will show error message if account is deactivated (403 response)

## Testing

1. **Test Users Tab**: Should only show users with `active_status = 1`
2. **Test Messages Tab**: Should only show conversations with active users
3. **Test Login with Deactivated Account**: Should show error message and prevent login
4. **Test Login with Active Account**: Should work normally

