# When to Rebuild vs. Use Dev Server

## Quick Answer

**For the changes we just made (error handling, component fixes):**
- ✅ **NO REBUILD NEEDED** - Just restart the dev server
- The development build can hot-reload these changes

**Only rebuild if you changed:**
- `app.json` configuration (splash screen, package name, etc.)
- Native modules or plugins
- Assets that need to be bundled

---

## Development Build Workflow

### ✅ Changes That DON'T Require Rebuild

**These can be hot-reloaded with the dev server:**

1. **JavaScript/TypeScript code changes**
   - Component updates
   - Context/provider changes
   - API service changes
   - Error handling improvements
   - UI/styling changes

2. **React Native code**
   - Screen components
   - Navigation logic
   - State management
   - Business logic

**To apply these changes:**
```bash
# Just restart the dev server
npm start
# or
expo start
```

Then:
- The app will automatically reload
- Or press `r` in the terminal to reload
- Or shake device and select "Reload"

---

### ❌ Changes That REQUIRE Rebuild

**These need a new build:**

1. **app.json changes:**
   - Splash screen background color ✅ (we changed this)
   - Package name/bundle ID
   - App icons
   - Permissions
   - Plugins configuration

2. **Native code changes:**
   - Native module modifications
   - Plugin configurations
   - Android/iOS specific settings

3. **Asset changes:**
   - App icons
   - Splash screen images (if the file itself changed)
   - Native assets

---

## For Your Recent Changes

### ✅ No Rebuild Needed (Hot Reload)
- Error boundary component
- AuthContext error handling
- NotificationContext error handling
- AppLayout error handling
- All JavaScript/TypeScript fixes

**Action:** Just restart `expo start` and reload

### ⚠️ Rebuild Needed
- Splash screen background color change in `app.json`

**Action:** Rebuild to see the white splash screen

---

## Recommended Workflow

### Option 1: Test Error Fixes First (No Rebuild)
```bash
# 1. Restart dev server
npm start

# 2. Reload app in development build
# (Press 'r' in terminal or shake device)

# 3. Test if crashes are fixed
```

### Option 2: Rebuild for Splash Screen Change
```bash
# If you want to see the white splash screen
eas build --profile development --platform android
```

---

## Best Practice

1. **For code changes (error handling, components):**
   - ✅ Use dev server - fast iteration
   - Test immediately without rebuilding

2. **For configuration changes (app.json):**
   - ⚠️ Rebuild required
   - But you can test code fixes first, then rebuild later

---

## Summary

**Right Now:**
- ✅ Test the crash fixes with dev server (no rebuild needed)
- ⚠️ Rebuild later for splash screen color change

**Command:**
```bash
npm start
# Then reload the app to test crash fixes
```


