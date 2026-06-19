# Backend: Group Get Endpoint Should Return Members

## Issue
The `/groups/{id}` endpoint needs to return the full group details including the members list so the frontend can display updated member information after adding members.

## Required Response Format

**Endpoint:** `GET /api/groups/{id}`

**Response should include:**
```json
{
  "id": 1,
  "name": "Frida Christiansen",
  "description": "Just vibes",
  "owner_id": 1,
  "profile_image": "filename.jpg",
  "avatar_url": "http://domain.com/storage/group_images/filename.jpg",
  "created_at": "2025-04-15T00:00:00.000000Z",
  "updated_at": "2025-04-15T00:00:00.000000Z",
  "users": [
    {
      "id": 1,
      "name": "Super Admin",
      "email": "super.admin@healthclassique.com",
      "avatar_url": "http://domain.com/storage/profile_images/avatar.jpg",
      "pivot": {
        "is_admin": false
      }
    },
    {
      "id": 2,
      "name": "Paul Mwitu",
      "email": "paul.mwite@healthclassique.com",
      "avatar_url": null,
      "pivot": {
        "is_admin": false
      }
    }
    // ... more members
  ]
}
```

## Implementation Example

**File:** `app/Http/Controllers/Api/GroupController.php` (or wherever groups are handled)

```php
public function show(Group $group)
{
    // Load relationships
    $group->load(['users', 'owner']);
    
    // Use GroupResource or manually format
    return response()->json([
        'id' => $group->id,
        'name' => $group->name,
        'description' => $group->description,
        'owner_id' => $group->owner_id,
        'profile_image' => $group->profile_image,
        'avatar_url' => $group->profile_image 
            ? asset('storage/group_images/' . $group->profile_image) 
            : null,
        'created_at' => $group->created_at,
        'updated_at' => $group->updated_at,
        'users' => $group->users->map(function($user) {
            return [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'avatar_url' => $user->profile_image 
                    ? asset('storage/profile_images/' . $user->profile_image) 
                    : null,
                'pivot' => [
                    'is_admin' => $user->pivot->is_admin ?? false,
                ],
            ];
        }),
    ]);
}
```

**OR use GroupResource:**

```php
use App\Http\Resources\GroupResource;

public function show(Group $group)
{
    $group->load(['users', 'owner']);
    return response()->json(new GroupResource($group));
}
```

## Verify GroupResource Includes Users

Make sure your `GroupResource` includes the `users` relationship:

```php
// In app/Http/Resources/GroupResource.php
public function toArray($request)
{
    return [
        'id' => $this->id,
        'name' => $this->name,
        'description' => $this->description,
        'owner' => new UserResource($this->owner), 
        'users' => UserResource::collection($this->whenLoaded('users')), // ✅ Include users
        'avatar_url' => $this->profile_image 
            ? asset('storage/group_images/' . $this->profile_image) 
            : null,
    ];
}
```

## Testing

After implementing:
1. Call `GET /api/groups/{id}` 
2. Verify response includes `users` array with all members
3. Add a member via `POST /api/groups/{id}/members`
4. Call `GET /api/groups/{id}` again
5. Verify new member appears in `users` array

