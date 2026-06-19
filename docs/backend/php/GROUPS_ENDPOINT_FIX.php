<?php
// Fix for groups() method to include avatar_url
// Update your ProfileController or GroupController

use App\Http\Resources\GroupResource;
use App\Models\Group;
use App\Models\Mezzage;
use Illuminate\Http\Request;

public function groups(Request $request)
{
    $user = $request->user();
    $groups = Group::getGroupsForUser($user);
    
    // ✅ Use GroupResource to ensure avatar_url is included
    $groupsWithData = GroupResource::collection($groups);
    
    // Add unread_count to each group
    $groupsWithUnreadCount = $groupsWithData->map(function ($groupResource) use ($user) {
        $groupData = $groupResource->toArray($request);
        $groupId = $groupData['id'];
        
        // Calculate unread count for this group
        $unreadCount = Mezzage::where('group_id', $groupId)
            ->where('sender_id', '!=', $user->id)
            ->whereDoesntHave('reads', function($query) use ($user) {
                $query->where('user_id', $user->id);
            })
            ->count();
        
        // Add unread_count to the group data
        $groupData['unread_count'] = $unreadCount;
        
        return $groupData;
    });
    
    return response()->json($groupsWithUnreadCount);
}

