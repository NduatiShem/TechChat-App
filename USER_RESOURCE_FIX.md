# Fix: Use UserResource in UserController

## Problem
The `/users/me` endpoint is returning the raw User model instead of using `UserResource`, so `avatar_url` is not being generated from `profile_image`.

## Current Code (WRONG)
```php
public function me(Request $request)
{
    return response()->json([
        'data' => auth()->user()  // ❌ Returns raw model, no avatar_url transformation
    ]);
}
```

## Fixed Code
```php
use App\Http\Resources\UserResource;

public function me(Request $request)
{
    return response()->json([
        'data' => new UserResource(auth()->user())  // ✅ Uses UserResource to transform avatar_url
    ]);
}
```

## Also Check These Endpoints

### 1. `/users` (index) - Get all users
```php
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
    
    $query->where('id', '!=', auth()->id());
    $users = $query->orderBy('name')->get();
    
    // ❌ Currently returns raw models
    return response()->json($users);
    
    // ✅ Should use UserResource
    return response()->json(UserResource::collection($users));
}
```

### 2. `/users/{id}` (show) - Get specific user
```php
public function show($id)
{
    $user = \App\Models\User::findOrFail($id);
    
    // ❌ Currently returns raw model
    return response()->json([
        'data' => $user
    ]);
    
    // ✅ Should use UserResource
    return response()->json([
        'data' => new UserResource($user)
    ]);
}
```

### 3. `/users/online` - Get online users
```php
public function getOnlineUsers()
{
    $fiveMinutesAgo = now()->subMinutes(5);
    
    $onlineUsers = \App\Models\User::where('last_seen_at', '>=', $fiveMinutesAgo)
        ->where('id', '!=', auth()->id())
        ->get();
    
    // ❌ Currently returns raw models
    return response()->json($onlineUsers);
    
    // ✅ Should use UserResource
    return response()->json(UserResource::collection($onlineUsers));
}
```

## Complete Fixed UserController

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function updateLastSeen(Request $request)
    {
        try {
            $user = auth()->user();
            
            if (!$user) {
                return response()->json(['message' => 'Unauthorized'], 401);
            }
            
            $user->update([
                'last_seen_at' => now()
            ]);
            
            return response()->json([
                'message' => 'Last seen updated successfully',
                'last_seen_at' => $user->last_seen_at instanceof \Carbon\Carbon 
                    ? $user->last_seen_at->toISOString() 
                    : $user->last_seen_at
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
            'data' => new UserResource(auth()->user())  // ✅ Use UserResource
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
        
        $query->where('id', '!=', auth()->id());
        $users = $query->orderBy('name')->get();
        
        return response()->json(UserResource::collection($users));  // ✅ Use UserResource
    }
    
    /**
     * Get a specific user
     */
    public function show($id)
    {
        $user = \App\Models\User::findOrFail($id);
        
        return response()->json([
            'data' => new UserResource($user)  // ✅ Use UserResource
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
        
        return response()->json(UserResource::collection($onlineUsers));  // ✅ Use UserResource
    }
}
```

## Summary

The main issue is that `/users/me` needs to use `UserResource` instead of returning the raw model. Once you update the `me()` method to use `new UserResource(auth()->user())`, the `avatar_url` will be properly generated from `profile_image` and your app will receive it on load.

