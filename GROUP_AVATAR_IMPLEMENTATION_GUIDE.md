# Group Avatar Upload Implementation Guide

This guide provides all the necessary code and steps to implement group profile picture upload functionality for admins and group owners.

## Overview

The implementation allows administrators and group owners to upload and update group profile pictures. The feature includes:
- Image picker (camera or photo library)
- Image compression and validation
- Backend storage in `storage/app/public/group_images`
- Frontend display with cache busting
- Permission checks (admin or owner only)

## Backend Implementation

### 1. Migration: Add `profile_image` Column

**File:** Create migration: `php artisan make:migration add_profile_image_to_groups_table`

**Content:** See `GROUP_AVATAR_MIGRATION.php`

```bash
php artisan migrate
```

### 2. Create Storage Directory

```bash
php artisan storage:link
mkdir -p storage/app/public/group_images
chmod -R 775 storage/app/public/group_images
```

### 3. Add Route

**File:** `routes/api.php`

Add this route (see `GROUP_AVATAR_ROUTE.php`):

```php
Route::post('/groups/{group}/avatar', [GroupController::class, 'uploadAvatar'])->middleware('auth:sanctum');
```

### 4. Add Controller Method

**File:** `app/Http/Controllers/Api/GroupController.php` (or wherever your group routes are handled)

Add the `uploadAvatar` method (see `GROUP_AVATAR_CONTROLLER_METHOD.php`):

```php
public function uploadAvatar(Request $request, Group $group)
{
    // Check if user is admin or group owner
    $user = $request->user();
    if (!$user->is_admin && $group->owner_id !== $user->id) {
        return response()->json([
            'message' => 'Only administrators or group owners can update group profile picture'
        ], 403);
    }

    // Validate request
    $request->validate([
        'avatar' => 'required|image|mimes:jpeg,png,jpg,gif|max:5120', // 5MB max
    ]);

    try {
        // Delete old profile image if exists
        if ($group->profile_image) {
            $oldImagePath = 'public/group_images/' . $group->profile_image;
            if (Storage::exists($oldImagePath)) {
                Storage::delete($oldImagePath);
            }
        }

        // Store new image
        $file = $request->file('avatar');
        $fileName = time() . '_' . uniqid() . '.' . $file->getClientOriginalExtension();
        $filePath = $file->storeAs('public/group_images', $fileName);

        // Update group with new profile image filename
        $group->profile_image = $fileName;
        $group->save();

        // Return success response with avatar URL
        $avatarUrl = asset('storage/group_images/' . $fileName);

        return response()->json([
            'message' => 'Group profile picture updated successfully',
            'avatar_url' => $avatarUrl,
        ], 200);

    } catch (\Exception $e) {
        Log::error('Failed to upload group avatar: ' . $e->getMessage());
        return response()->json([
            'message' => 'Failed to upload group profile picture',
            'error' => $e->getMessage()
        ], 500);
    }
}
```

### 5. Update Group Model/Resource

**File:** `app/Models/Group.php` or `app/Http/Resources/GroupResource.php`

Ensure `avatar_url` is computed from `profile_image` (see `GROUP_RESOURCE_AVATAR_URL.php`):

```php
// In toConversationArray() method or GroupResource
'avatar_url' => $this->profile_image 
    ? asset('storage/group_images/' . $this->profile_image) 
    : null,
```

### 6. Update Group Model Fillable

**File:** `app/Models/Group.php`

Add `profile_image` to `$fillable` array:

```php
protected $fillable = [
    'name',
    'description',
    'owner_id',
    'profile_image', // Add this
    // ... other fields
];
```

## Frontend Implementation

### 1. API Service Update

**File:** `services/api.ts`

Already updated with `uploadAvatar` method:

```typescript
uploadAvatar: (groupId: number, formData: FormData) => {
  return api.post(`/groups/${groupId}/avatar`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
},
```

### 2. Group Info Screen Update

**File:** `app/group-info.tsx`

Already updated with:
- Image picker functionality
- Avatar upload handler
- Cache busting mechanism
- Permission checks (admin/owner only)
- Visual indicators (camera icon, loading state)

### 3. Display Group Avatars

The group avatar is now displayed in:
- Group Info screen (with upload capability for admins/owners)
- Groups list (if `avatar_url` is included in the groups API response)
- Chat screens (if `avatar_url` is included in group conversation data)

## Testing Checklist

- [ ] Run migration: `php artisan migrate`
- [ ] Create storage directory and link: `php artisan storage:link`
- [ ] Test upload as admin: Should work
- [ ] Test upload as group owner: Should work
- [ ] Test upload as regular member: Should be denied (403)
- [ ] Test image validation: Try uploading non-image file (should fail)
- [ ] Test file size limit: Try uploading >5MB image (should fail)
- [ ] Verify old image is deleted when new one is uploaded
- [ ] Verify avatar displays correctly after upload
- [ ] Verify avatar appears in groups list
- [ ] Verify avatar appears in chat screens

## Notes

1. **Storage Path**: Images are stored in `storage/app/public/group_images/`
2. **File Naming**: Files are named with timestamp and unique ID to prevent conflicts
3. **Old Image Cleanup**: Old images are automatically deleted when a new one is uploaded
4. **Permissions**: Only admins and group owners can upload/update group avatars
5. **Cache Busting**: Frontend uses version parameter to force image refresh after upload
6. **Image Compression**: Images are compressed to 90% quality and converted to JPEG format

## Troubleshooting

### Images not displaying
- Check if `storage:link` has been run
- Verify file permissions on `storage/app/public/group_images`
- Check if `avatar_url` is being computed correctly in Group model/resource

### Upload fails
- Check file size (must be < 5MB)
- Verify user has admin or owner permissions
- Check server logs for errors
- Verify storage directory exists and is writable

### Permission denied
- Ensure user is either admin (`is_admin = true`) or group owner (`owner_id = user_id`)
- Check authentication token is valid

