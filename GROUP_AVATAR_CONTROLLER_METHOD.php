<?php
// Add this method to your GroupController (or ProfileController if groups are handled there)

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;

class GroupController extends Controller
{
    /**
     * Upload group profile picture
     * POST /api/groups/{id}/avatar
     */
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
}

