# Group Creation Permissions Guide

## Current Implementation

Currently, **only administrators** (`is_admin = true`) can create groups. This is checked in:
- **Frontend**: `app/groups.tsx` - `handleCreateGroup()` checks `user?.is_admin`
- **Backend**: Should also check permissions (see options below)

## Permission Options

### Option 1: Only Administrators (Current)
**Who can create:** Only users with `is_admin = true`

**Frontend:** Already implemented
```typescript
if (!user?.is_admin) {
  Alert.alert('Permission Denied', 'Only administrators can create groups.');
  return;
}
```

**Backend:** Add check in your group creation endpoint
```php
public function store(Request $request)
{
    $user = $request->user();
    
    // ✅ Only admins can create groups
    if (!$user->is_admin) {
        return response()->json([
            'message' => 'Only administrators can create groups'
        ], 403);
    }
    
    // ... rest of group creation logic
}
```

---

### Option 2: All Active Users
**Who can create:** Any user with `active_status = 1`

**Frontend:** Remove admin check
```typescript
// Remove the admin check - allow all users
const handleCreateGroup = () => {
  router.push('/create-group');
};
```

**Backend:** Check active status
```php
public function store(Request $request)
{
    $user = $request->user();
    
    // ✅ Only active users can create groups
    if ($user->active_status != 1) {
        return response()->json([
            'message' => 'Your account must be active to create groups'
        ], 403);
    }
    
    // ... rest of group creation logic
}
```

---

### Option 3: Admins + Specific Role/Permission
**Who can create:** Admins + users with a specific permission flag

**Example:** Add `can_create_groups` column to users table

**Frontend:**
```typescript
const canCreateGroup = user?.is_admin || user?.can_create_groups;

const handleCreateGroup = () => {
  if (!canCreateGroup) {
    Alert.alert('Permission Denied', 'You do not have permission to create groups.');
    return;
  }
  router.push('/create-group');
};
```

**Backend:**
```php
public function store(Request $request)
{
    $user = $request->user();
    
    // ✅ Admins or users with can_create_groups permission
    if (!$user->is_admin && !$user->can_create_groups) {
        return response()->json([
            'message' => 'You do not have permission to create groups'
        ], 403);
    }
    
    // ... rest of group creation logic
}
```

---

### Option 4: Based on User Count/Plan
**Who can create:** Based on subscription plan or user tier

**Example:** Premium users can create unlimited groups, free users limited

**Frontend:**
```typescript
const canCreateGroup = user?.is_admin || 
                      (user?.subscription_plan === 'premium') || 
                      (user?.groups_created_count < user?.max_groups_allowed);

const handleCreateGroup = () => {
  if (!canCreateGroup) {
    Alert.alert(
      'Limit Reached', 
      'You have reached your group creation limit. Upgrade to premium for unlimited groups.'
    );
    return;
  }
  router.push('/create-group');
};
```

**Backend:**
```php
public function store(Request $request)
{
    $user = $request->user();
    
    // ✅ Check if user can create more groups
    if (!$user->is_admin) {
        $groupsCreated = Group::where('owner_id', $user->id)->count();
        $maxGroups = $user->max_groups_allowed ?? 0;
        
        if ($groupsCreated >= $maxGroups) {
            return response()->json([
                'message' => 'You have reached your group creation limit'
            ], 403);
        }
    }
    
    // ... rest of group creation logic
}
```

---

## Recommended: Option 1 or Option 2

**For most apps:**
- **Option 1 (Admin only)** - If you want controlled group creation
- **Option 2 (All active users)** - If you want open group creation

## Implementation Steps

1. **Decide on permission model** (Option 1, 2, 3, or 4)
2. **Update frontend** - Modify `app/groups.tsx` and `app/create-group.tsx`
3. **Update backend** - Add permission check in group creation endpoint
4. **Test** - Verify permissions work correctly

## Current Frontend Code Locations

- **Groups Screen**: `app/groups.tsx` - `handleCreateGroup()` function
- **Create Group Screen**: `app/create-group.tsx` - No permission check (relies on backend)
- **UI Elements**: Create button visibility in `app/groups.tsx`

