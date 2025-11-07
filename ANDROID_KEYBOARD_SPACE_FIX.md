# Android Keyboard Empty Space Fix

## Problem
After implementing KeyboardAvoidingView, Android builds showed a large empty space between the input bar and the keyboard, while Expo Go worked correctly.

## Root Cause
When using `windowSoftInputMode="adjustResize"` on Android, the system automatically resizes the window when the keyboard appears. Using `KeyboardAvoidingView` with `'height'` behavior on top of this causes double-adjustment, creating extra empty space.

## Solution
**Conditionally disable KeyboardAvoidingView on Android** since `adjustResize` already handles the keyboard resizing automatically.

### Changes Made

1. **Conditional KeyboardAvoidingView**
   - iOS: Use `KeyboardAvoidingView` with `'padding'` behavior (needed for iOS)
   - Android: Use plain `View` (let `adjustResize` handle it)

2. **Simplified Padding**
   - Android: Only use `insets.bottom` for safe area padding
   - iOS: Keep existing padding logic with keyboard height tracking

## Code Changes

### Before:
```tsx
<KeyboardAvoidingView
  style={{ flex: 1 }}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
>
  <View style={{ flex: 1 }}>
    {/* content */}
  </View>
</KeyboardAvoidingView>
```

### After:
```tsx
{Platform.OS === 'ios' ? (
  <KeyboardAvoidingView
    style={{ flex: 1 }}
    behavior="padding"
    keyboardVerticalOffset={0}
  >
    <View style={{ flex: 1 }}>
      {/* content */}
    </View>
  </KeyboardAvoidingView>
) : (
  <View style={{ flex: 1 }}>
    {/* content */}
  </View>
)}
```

### Input Bar Padding:
```tsx
paddingBottom: Platform.OS === 'android' 
  ? insets.bottom // Let adjustResize handle keyboard spacing
  : Math.max(insets.bottom + 8, keyboardHeight > 0 ? 8 : 16),
```

## Files Modified

1. `app/chat/user/[id].tsx`
   - Conditionally render KeyboardAvoidingView (iOS only)
   - Simplified Android padding

2. `app/chat/group/[id].tsx`
   - Same changes as user chat screen

## Why This Works

1. **Android `adjustResize`**:
   - The `windowSoftInputMode="adjustResize"` in AndroidManifest.xml automatically resizes the window
   - No need for KeyboardAvoidingView - it would interfere and create extra space
   - The system handles everything automatically

2. **iOS Behavior**:
   - iOS doesn't have the same automatic resizing
   - KeyboardAvoidingView with `'padding'` behavior is needed
   - Works correctly with the existing implementation

## Testing

After rebuilding, Android should:
- ✅ No empty space between input and keyboard
- ✅ Input bar stays visible above keyboard
- ✅ Smooth keyboard appearance/disappearance
- ✅ Works correctly in both Expo Go and production builds

## Next Steps

Rebuild the Android app:
```bash
npx expo prebuild --clean
npx expo run:android
```

The empty space issue should now be resolved! 🎉

