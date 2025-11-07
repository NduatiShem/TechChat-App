<?php
// Alternative Fix: If getGroupsForUser() already returns arrays with avatar_url
// Update your ProfileController or GroupController

use App\Models\Group;
use App\Models\Mezzage;
use Illuminate\Http\Request;

public function groups(Request $request)
{
    $user = $request->user();
    $groups = Group::getGroupsForUser($user);
    
    // Add unread_count and ensure avatar_url is included
    $groupsWithUnreadCount = $groups->map(function ($group) use ($user) {
        $groupId = is_array($group) ? $group['id'] : $group->id;
        
        // Calculate unread count for this group
        $unreadCount = Mezzage::where('group_id', $groupId)
            ->where('sender_id', '!=', $user->id)
            ->whereDoesntHave('reads', function($query) use ($user) {
                $query->where('user_id', $user->id);
            })
            ->count();
        
        // If group is an array, add unread_count and ensure avatar_url exists
        if (is_array($group)) {
            $group['unread_count'] = $unreadCount;
            
            // ✅ Ensure avatar_url is included (if not already present)
            if (!isset($group['avatar_url'])) {
                $groupModel = Group::find($groupId);
                if ($groupModel) {
                    $group['avatar_url'] = $groupModel->profile_image 
                        ? asset('storage/group_images/' . $groupModel->profile_image) 
                        : null;
                }
            }
        } else {
            // If group is a model, convert to array and add fields
            $groupArray = $group->toArray();
            $groupArray['unread_count'] = $unreadCount;
            
            // ✅ Ensure avatar_url is included
            if (!isset($groupArray['avatar_url'])) {
                $groupArray['avatar_url'] = $group->profile_image 
                    ? asset('storage/group_images/' . $group->profile_image) 
                    : null;
            }
            
            $group = $groupArray;
        }
        
        return $group;
    });
    
    return response()->json($groupsWithUnreadCount);
}

