<?php
// Add this route to your routes/api.php file

use App\Http\Controllers\Api\GroupController;

// Group avatar upload route
Route::post('/groups/{group}/avatar', [GroupController::class, 'uploadAvatar'])->middleware('auth:sanctum');

