# Backend Fix: Users Endpoint Must Return avatar_url

## Issue
The `/users` endpoint (used by the Users tab) is not returning `avatar_url` for users, causing profile pictures to not display.

## Root Cause
The `/users` endpoint is likely returning raw User models instead of using `UserResource`, which means `avatar_url` is not being computed from `profile_image`.

## Solution

### Update Your Users Endpoint

**File:** `app/Http/Controllers/Api/UserController.php` (or wherever your users endpoint is)

**Current Code (WRONG):**
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
    
    // ❌ Returns raw models - no avatar_url transformation
    return response()->json($users);
}
```

**Fixed Code (Option 1 - Use UserResource - Recommended):**
```php
use App\Http\Resources\UserResource;

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
    
    // ✅ Use UserResource to ensure avatar_url is included
    return response()->json(UserResource::collection($users));
}
```

**Fixed Code (Option 2 - Manual avatar_url):**
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
    
    // ✅ Manually add avatar_url to each user
    $usersWithAvatar = $users->map(function ($user) {
        $userArray = $user->toArray();
        $userArray['avatar_url'] = $user->profile_image 
            ? asset('storage/profile_images/' . $user->profile_image) 
            : null;
        return $userArray;
    });
    
    return response()->json($usersWithAvatar);
}
```

## Verify Your UserResource

Make sure your `UserResource` includes `avatar_url`:

**File:** `app/Http/Resources/UserResource.php`

```php
public function toArray($request)
{
    return [
        'id' => $this->id,
        'name' => $this->name,
        'email' => $this->email,
        // ✅ Ensure this is included
        'avatar_url' => $this->profile_image 
            ? asset('storage/profile_images/' . $this->profile_image) 
            : null,
        'created_at' => $this->created_at,
        'updated_at' => $this->updated_at,
        // ... other fields
    ];
}
```

## Testing

1. **Test the endpoint**: Make a request to `GET /api/users`
2. **Check the response**: Verify that each user object includes `avatar_url`:
   ```json
   [
     {
       "id": 1,
       "name": "Gerald Mwaki",
       "email": "gerald.mwaki@healthclassique.com",
       "avatar_url": "http://your-domain.com/storage/profile_images/filename.jpg",
       ...
     }
   ]
   ```
3. **If `avatar_url` is `null`**: Check that:
   - The user has a `profile_image` value in the database
   - The `storage:link` has been run: `php artisan storage:link`
   - The file exists in `storage/app/public/profile_images/`

## Summary

The frontend is already correctly using `UserAvatar` component and expecting `avatar_url` in the response. The issue is that the backend `/users` endpoint needs to return `avatar_url` for each user, either by:
1. Using `UserResource::collection($users)` (recommended)
2. Manually computing `avatar_url` from `profile_image` for each user

Once you update the backend endpoint to include `avatar_url`, the Users tab will display profile pictures correctly.

