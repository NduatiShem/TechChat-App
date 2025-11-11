# 🔍 Debugging FCM Token Registration

## Problem
Backend logs show: `"No FCM token found for user"` - meaning the user's `fcm_token` field in the database is NULL.

## Root Cause
The frontend is not successfully registering the FCM token with the backend.

---

## 🔍 Step 1: Check Frontend Console

### In your app, check for these logs:

1. **Token Generation:**
   ```
   Expo Push Token: ExponentPushToken[xxxxx]
   ```

2. **Registration Success:**
   ```
   Expo push token registered with backend
   ```

3. **Registration Error (if any):**
   ```
   Failed to register Expo push token with backend: [error]
   ```

### If you see errors:
- Check the error message
- Verify the API endpoint is correct
- Check if user is authenticated

---

## 🔍 Step 2: Verify Backend Endpoint Exists

### Check if this route exists in Laravel:

```php
// routes/api.php
Route::post('/user/fcm-token', [UserController::class, 'updateFcmToken'])
    ->middleware('auth:sanctum');
```

### Or check your UserController:

```php
public function updateFcmToken(Request $request)
{
    $validated = $request->validate([
        'fcm_token' => 'required|string',
    ]);
    
    $user = auth()->user();
    $user->fcm_token = $validated['fcm_token'];
    $user->save();
    
    return response()->json(['success' => true]);
}
```

---

## 🔍 Step 3: Test Token Registration Manually

### Option A: Test via API (Postman/curl)

```bash
# Get your auth token first (from app or login)
TOKEN="your_auth_token_here"

# Get Expo push token from app console
EXPO_TOKEN="ExponentPushToken[xxxxx]"

# Register token
curl -X POST https://healthclassique.tech-bridge.app/api/user/fcm-token \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fcm_token\": \"$EXPO_TOKEN\"}"
```

### Option B: Check Database Directly

```sql
-- Check if user has fcm_token
SELECT id, name, email, fcm_token 
FROM users 
WHERE id = 15;

-- Should show fcm_token if registered
```

---

## 🔍 Step 4: Check Frontend Code Flow

### The token registration happens in:

```typescript
// context/NotificationContext.tsx (line 169-175)
try {
  await authAPI.registerFcmToken(token.data);
  console.log('Expo push token registered with backend');
} catch (error) {
  console.error('Failed to register Expo push token with backend:', error);
}
```

### Possible Issues:

1. **User not logged in** - API call fails with 401
2. **API endpoint wrong** - 404 error
3. **Network error** - Connection failed
4. **Token generation failed** - No token to register

---

## ✅ Quick Fix: Add Better Logging

### Update NotificationContext.tsx:

```typescript
// Register token with backend
try {
  console.log('Attempting to register FCM token:', token.data.substring(0, 30) + '...');
  const response = await authAPI.registerFcmToken(token.data);
  console.log('✅ Expo push token registered with backend:', response);
} catch (error: any) {
  console.error('❌ Failed to register Expo push token with backend:', error);
  console.error('Error details:', {
    message: error?.message,
    status: error?.response?.status,
    data: error?.response?.data,
  });
}
```

---

## 🎯 Most Likely Issues

### 1. User Not Authenticated
**Symptom:** 401 Unauthorized error  
**Fix:** Make sure user is logged in before token registration

### 2. Backend Endpoint Missing
**Symptom:** 404 Not Found error  
**Fix:** Add the route to `routes/api.php`

### 3. Token Generation Failed
**Symptom:** No token generated (returns null)  
**Fix:** Check if FCM credentials are configured in EAS

### 4. Silent Failure
**Symptom:** No errors, but token not saved  
**Fix:** Check backend logs for validation errors

---

## 🔧 Backend Endpoint (If Missing)

### Add to `routes/api.php`:

```php
Route::post('/user/fcm-token', function (Request $request) {
    $validated = $request->validate([
        'fcm_token' => 'required|string',
    ]);
    
    $user = auth()->user();
    
    if (!$user) {
        return response()->json(['error' => 'Unauthenticated'], 401);
    }
    
    $user->fcm_token = $validated['fcm_token'];
    $user->save();
    
    \Log::info('FCM token registered', [
        'user_id' => $user->id,
        'token_preview' => substr($validated['fcm_token'], 0, 30) . '...'
    ]);
    
    return response()->json([
        'success' => true,
        'message' => 'FCM token registered successfully'
    ]);
})->middleware('auth:sanctum');
```

---

## 📋 Checklist

- [ ] Check frontend console for token generation logs
- [ ] Check frontend console for registration success/error
- [ ] Verify backend endpoint `/api/user/fcm-token` exists
- [ ] Test endpoint manually with Postman/curl
- [ ] Check database - does user have `fcm_token`?
- [ ] Verify user is authenticated when token is registered
- [ ] Check backend logs for any errors

---

## 🚀 Next Steps

1. **Check frontend console** - Look for token registration logs
2. **Verify backend endpoint** - Make sure route exists
3. **Test manually** - Use curl/Postman to test registration
4. **Check database** - Verify token is saved

Once the token is registered, notifications should work!

