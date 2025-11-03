# Backend Avatar Upload API Documentation

## Required Backend Endpoint

### POST `/api/user/avatar`

Upload a user's profile avatar image.

#### Authentication
- **Required**: Yes (Bearer Token)
- **Header**: `Authorization: Bearer {token}`

#### Request
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `avatar` (file): Image file (JPEG, PNG, GIF)
  - Max file size: 5MB
  - Supported formats: `image/jpeg`, `image/png`, `image/gif`

#### Response

**Success (200 OK)**
```json
{
  "message": "Avatar uploaded successfully",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "avatar_url": "https://your-domain.com/storage/avatars/user_1_avatar.jpg",
    "created_at": "2024-01-01T00:00:00.000000Z",
    "updated_at": "2024-01-01T00:00:00.000000Z"
  }
}
```

**Error (400 Bad Request)**
```json
{
  "error": "Validation failed",
  "message": "The avatar field is required."
}
```

**Error (401 Unauthorized)**
```json
{
  "message": "Unauthenticated."
}
```

**Error (413 Payload Too Large)**
```json
{
  "error": "File too large",
  "message": "The avatar must not be greater than 5MB."
}
```

## Laravel Implementation Example

### Controller Method

```php
// app/Http/Controllers/Api/UserController.php (or ProfileController.php)

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

/**
 * Upload user avatar
 */
public function uploadAvatar(Request $request)
{
    // Validate the uploaded file
    $validator = Validator::make($request->all(), [
        'avatar' => 'required|image|mimes:jpeg,png,jpg,gif|max:5120', // 5MB max
    ]);

    if ($validator->fails()) {
        return response()->json([
            'error' => 'Validation failed',
            'message' => $validator->errors()->first(),
        ], 400);
    }

    try {
        $user = auth()->user();
        
        // Delete old avatar if exists
        if ($user->avatar_url) {
            $oldAvatarPath = str_replace('/storage/', '', parse_url($user->avatar_url, PHP_URL_PATH));
            if (Storage::disk('public')->exists($oldAvatarPath)) {
                Storage::disk('public')->delete($oldAvatarPath);
            }
        }
        
        // Store new avatar
        $file = $request->file('avatar');
        $fileName = 'user_' . $user->id . '_avatar.' . $file->getClientOriginalExtension();
        $path = $file->storeAs('avatars', $fileName, 'public');
        
        // Update user's avatar_url
        $user->avatar_url = Storage::url($path);
        $user->save();
        
        return response()->json([
            'message' => 'Avatar uploaded successfully',
            'user' => $user->fresh(),
        ], 200);
        
    } catch (\Exception $e) {
        \Log::error('Avatar upload error: ' . $e->getMessage());
        return response()->json([
            'error' => 'Upload failed',
            'message' => 'Failed to upload avatar. Please try again.',
        ], 500);
    }
}
```

### Route Definition

```php
// routes/api.php

Route::middleware('auth:sanctum')->group(function () {
    // ... other routes ...
    
    Route::post('/user/avatar', [UserController::class, 'uploadAvatar']);
    // OR
    Route::post('/users/avatar', [UserController::class, 'uploadAvatar']);
});
```

### Alternative: Using Laravel's File Storage

If you want to use a different storage approach:

```php
public function uploadAvatar(Request $request)
{
    $validator = Validator::make($request->all(), [
        'avatar' => 'required|image|mimes:jpeg,png,jpg,gif|max:5120',
    ]);

    if ($validator->fails()) {
        return response()->json([
            'error' => 'Validation failed',
            'message' => $validator->errors()->first(),
        ], 400);
    }

    try {
        $user = auth()->user();
        $file = $request->file('avatar');
        
        // Generate unique filename
        $fileName = 'avatar_' . $user->id . '_' . time() . '.' . $file->getClientOriginalExtension();
        
        // Store in public/avatars directory
        $path = $file->storeAs('avatars', $fileName, 'public');
        
        // Update user avatar URL
        $user->avatar_url = asset('storage/' . $path);
        // OR if using full URL:
        // $user->avatar_url = config('app.url') . '/storage/' . $path;
        $user->save();
        
        return response()->json([
            'message' => 'Avatar uploaded successfully',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'avatar_url' => $user->avatar_url,
                'created_at' => $user->created_at,
                'updated_at' => $user->updated_at,
            ],
        ], 200);
        
    } catch (\Exception $e) {
        \Log::error('Avatar upload error: ' . $e->getMessage());
        return response()->json([
            'error' => 'Upload failed',
            'message' => 'Failed to upload avatar. Please try again.',
        ], 500);
    }
}
```

### Database Migration (if needed)

Make sure your `users` table has an `avatar_url` column:

```php
// If you need to add it:
Schema::table('users', function (Blueprint $table) {
    $table->string('avatar_url')->nullable()->after('email');
});
```

## Notes

1. **File Size**: The frontend checks for 5MB max, but the backend should also validate this.
2. **Storage**: Make sure your `storage/app/public` directory is linked:
   ```bash
   php artisan storage:link
   ```
3. **Permissions**: Ensure the `storage/app/public/avatars` directory has write permissions.
4. **File Cleanup**: Optionally delete old avatars when a new one is uploaded.
5. **Image Optimization**: Consider resizing/optimizing images on the backend before storing.

## Testing

You can test the endpoint using:

```bash
curl -X POST http://localhost:8000/api/user/avatar \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "avatar=@/path/to/image.jpg"
```

Or use Postman:
1. Method: POST
2. URL: `http://localhost:8000/api/user/avatar`
3. Headers: `Authorization: Bearer YOUR_TOKEN`
4. Body: form-data
5. Key: `avatar` (type: File)
6. Value: Select an image file

