<?php

// Fix for UserController::me() method
// The issue: $user->avatar_url doesn't exist as a column
// Solution: Build avatar_url the same way UserResource does

public function me()
{
    $user = auth()->user();
    
    // Build avatar_url the same way UserResource does
    $avatarUrl = $user->profile_image 
        ? asset('storage/profile_images/' . $user->profile_image) 
        : null;
    
    return response()->json([
        'status' => 'success',
        'data' => [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'email_verified_at' => $user->email_verified_at,
            'avatar_url' => $avatarUrl,  // ✅ Build it from profile_image
            'is_admin' => $user->is_admin,
            'created_at' => $user->created_at,
            'updated_at' => $user->updated_at,
        ]
    ]);
}

// OR even better - use UserResource (recommended):
use App\Http\Resources\UserResource;

public function me()
{
    return response()->json([
        'status' => 'success',
        'data' => new UserResource(auth()->user())  // ✅ Uses UserResource automatically
    ]);
}

