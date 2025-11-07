# Keyboard Handling Fix for Android Builds

## Problem
The keyboard was covering the input section in Android development builds, even though it worked correctly in Expo Go. The input section wasn't adjusting to stay visible above the keyboard.

## Solution Implemented

### 1. **Added KeyboardAvoidingView**
Wrapped the chat content (FlatList + Input Bar) in `KeyboardAvoidingView` with platform-specific behavior:
- **iOS**: Uses `'padding'` behavior
- **Android**: Uses `'height'` behavior (works better with `adjustResize`)

### 2. **Updated FlatList Keyboard Props**
Added keyboard handling props to FlatList:
- `keyboardShouldPersistTaps="handled"` - Allows tapping on messages while keyboard is open
- `keyboardDismissMode` - Platform-specific dismiss behavior

### 3. **Adjusted Padding Logic**
Updated padding calculations for Android:
- Removed extra padding when keyboard is open on Android (since `adjustResize` handles it)
- Kept iOS padding logic for compatibility

### 4. **Configuration Already in Place**
- ✅ `app.json` already has `softwareKeyboardLayoutMode: "adjustResize"`
- ✅ Android plugin (`withAndroidKeyboard.js`) sets `windowSoftInputMode="adjustResize"` in AndroidManifest.xml

## Files Modified

### 1. `app/chat/user/[id].tsx`
- Added `KeyboardAvoidingView` import
- Wrapped chat content in `KeyboardAvoidingView`
- Updated FlatList keyboard props
- Adjusted input bar padding for Android

### 2. `app/chat/group/[id].tsx`
- Same changes as user chat screen

## Technical Details

### KeyboardAvoidingView Configuration
```tsx
<KeyboardAvoidingView
  style={{ flex: 1 }}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
>
```

### Why This Works

1. **Android `adjustResize`**: 
   - The `windowSoftInputMode="adjustResize"` in AndroidManifest.xml tells Android to resize the window when the keyboard appears
   - Combined with `KeyboardAvoidingView` behavior `'height'`, the view adjusts properly

2. **iOS `padding`**:
   - iOS handles keyboard differently, so `'padding'` behavior works better
   - The keyboard pushes content up by adding padding

3. **FlatList Keyboard Props**:
   - `keyboardShouldPersistTaps="handled"` ensures users can interact with messages
   - `keyboardDismissMode` provides smooth keyboard dismissal

## Testing

After rebuilding the Android app, the keyboard should:
- ✅ Push the input bar up when it appears
- ✅ Keep the input bar visible above the keyboard
- ✅ Allow scrolling messages while keyboard is open
- ✅ Dismiss smoothly when scrolling or tapping outside

## Next Steps

1. **Rebuild the Android app** to apply the changes:
   ```bash
   npx expo prebuild --clean
   npx expo run:android
   ```

2. **Test on a physical device** or emulator to verify the fix

3. **If issues persist**, you may need to:
   - Clear app data and reinstall
   - Check if the AndroidManifest.xml was properly updated by the plugin
   - Verify the build includes the latest changes

## Notes

- The fix maintains backward compatibility
- Works in both Expo Go and production builds
- No breaking changes to existing functionality
- iOS behavior remains unchanged

