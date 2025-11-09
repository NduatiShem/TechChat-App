# 🚀 EAS Update - Over-the-Air Updates Setup

## ✅ What's Configured

- ✅ `expo-updates` package installed
- ✅ Updates enabled in `app.json`
- ✅ Update channels configured in `eas.json`
- ✅ Runtime version policy set to `appVersion`

---

## 🎯 What is EAS Update?

**EAS Update** allows you to push JavaScript and asset updates to your app **instantly** without:
- ❌ Rebuilding the app
- ❌ Going through App Store/Play Store
- ❌ Users downloading new APK/IPA

**Perfect for:**
- Bug fixes
- UI improvements
- Feature additions (JavaScript only)
- Content updates

---

## ⚠️ What CAN'T Be Updated Over-the-Air

You still need to rebuild for:
- Native code changes
- New native dependencies
- App version changes (major)
- Icon/splash screen changes
- Permissions changes

---

## 📋 How It Works

### 1. Initial Build
```bash
eas build --profile production --platform android
```
- Creates APK with embedded JavaScript bundle
- Sets up update channel: `production`

### 2. Make Changes
- Update your JavaScript/TypeScript code
- Update assets (images, etc.)
- No native changes

### 3. Publish Update
```bash
eas update --branch production --message "Bug fixes"
```
- Uploads new JavaScript bundle
- Users get update automatically on next app launch

### 4. Users Get Update
- App checks for updates on launch
- Downloads update in background
- Applies update on next restart

---

## 🚀 Quick Start Guide

### Step 1: Build Your App (First Time)

```bash
# Build production APK with updates enabled
eas build --profile production --platform android
```

This creates the initial build with EAS Update enabled.

### Step 2: Distribute to Users

- Download APK from build
- Share with users
- Users install APK

### Step 3: Make Code Changes

Edit your JavaScript/TypeScript files:
- Fix bugs
- Add features
- Update UI
- Change content

### Step 4: Publish Update

```bash
# Publish update to production channel
eas update --branch production --message "Fixed login bug"
```

**That's it!** Users will get the update automatically.

---

## 📝 Update Commands

### Publish Update to Production
```bash
eas update --branch production --message "Your update message"
```

### Publish Update to Preview
```bash
eas update --branch preview --message "Preview update"
```

### Publish Update to Development
```bash
eas update --branch development --message "Dev update"
```

### View Update History
```bash
eas update:list --branch production
```

### View Update Details
```bash
eas update:view <update-id>
```

---

## 🔧 Configuration Details

### app.json Updates Config

```json
"updates": {
  "url": "https://u.expo.dev/ff808b2d-601c-4c49-9969-b884cfb8b1e7",
  "fallbackToCacheTimeout": 0,
  "checkAutomatically": "ON_LOAD",
  "enabled": true
}
```

**Settings:**
- `checkAutomatically: "ON_LOAD"` - Checks for updates when app loads
- `fallbackToCacheTimeout: 0` - Uses cached version if update fails
- `enabled: true` - Updates are enabled

### eas.json Update Channels

```json
"update": {
  "production": { "channel": "production" },
  "preview": { "channel": "preview" },
  "development": { "channel": "development" }
}
```

**Channels:**
- `production` - For production builds
- `preview` - For preview/test builds
- `development` - For development builds

---

## 🎯 Update Workflow

### Typical Workflow

1. **Build initial app:**
   ```bash
   eas build --profile production --platform android
   ```

2. **Distribute to users:**
   - Share APK
   - Users install

3. **Make changes:**
   - Fix bugs
   - Update code

4. **Publish update:**
   ```bash
   eas update --branch production --message "Fixed bug X"
   ```

5. **Users get update:**
   - Automatically on next app launch
   - No action needed from users

---

## 📱 User Experience

### How Users Get Updates

1. **App launches**
2. **Checks for updates** (in background)
3. **Downloads update** (if available)
4. **Shows update available** (optional)
5. **Applies update** on next restart

### Update Behavior

- **Automatic**: Updates download automatically
- **Background**: Doesn't interrupt user
- **Fast**: Only JavaScript/assets, not full app
- **Reliable**: Falls back to cached version if update fails

---

## 🔍 Testing Updates

### Test Update Before Publishing

1. **Build preview version:**
   ```bash
   eas build --profile preview --platform android
   ```

2. **Install on test device**

3. **Publish test update:**
   ```bash
   eas update --branch preview --message "Test update"
   ```

4. **Verify update works**

5. **Publish to production:**
   ```bash
   eas update --branch production --message "Production update"
   ```

---

## 📊 Update Management

### View All Updates

```bash
# List all production updates
eas update:list --branch production

# List all updates
eas update:list
```

### Rollback Update

If an update causes issues:

```bash
# View update history
eas update:list --branch production

# Rollback to previous version
eas update:rollback --branch production
```

### Delete Update

```bash
eas update:delete <update-id>
```

---

## ⚙️ Advanced Configuration

### Custom Update Check Frequency

In `app.json`:

```json
"updates": {
  "checkAutomatically": "ON_LOAD",  // or "ON_ERROR_RECOVERY", "NEVER"
  "fallbackToCacheTimeout": 0
}
```

**Options:**
- `ON_LOAD` - Check every time app loads (recommended)
- `ON_ERROR_RECOVERY` - Check only after errors
- `NEVER` - Manual check only

### Runtime Version

Current setting: `"runtimeVersion": { "policy": "appVersion" }`

This means:
- Updates work for same app version
- New app version requires new build

**To allow updates across versions:**

```json
"runtimeVersion": "1.0.0"
```

---

## 🚨 Important Notes

### When to Rebuild

**Rebuild required for:**
- App version changes (1.0.0 → 1.1.0)
- Native code changes
- New native dependencies
- Icon/splash changes
- Permission changes

**Update works for:**
- JavaScript/TypeScript changes
- UI updates
- Bug fixes
- Asset updates (images, etc.)
- Configuration changes (non-native)

### Version Compatibility

- Updates work within same runtime version
- Different runtime versions need new build
- Current policy: `appVersion` (updates work for same version)

---

## 📈 Best Practices

1. **Test updates in preview first**
2. **Use descriptive update messages**
3. **Monitor update adoption**
4. **Keep builds for rollback**
5. **Document breaking changes**

---

## 🎉 Benefits

✅ **Instant updates** - No app store wait  
✅ **No user action** - Automatic updates  
✅ **Fast deployment** - Minutes, not days  
✅ **Easy rollback** - If issues occur  
✅ **Cost effective** - No rebuild needed  

---

## 🔗 Useful Commands

```bash
# Publish update
eas update --branch production --message "Update message"

# List updates
eas update:list --branch production

# View update
eas update:view <update-id>

# Rollback
eas update:rollback --branch production

# Delete update
eas update:delete <update-id>
```

---

## ✅ Setup Complete!

Your app is now configured for over-the-air updates!

**Next Steps:**
1. Build your production app
2. Distribute to users
3. Make code changes
4. Publish updates with `eas update`

**No Play Store needed!** 🎉

---

**Last Updated**: EAS Update Setup Guide  
**Status**: Ready to Use

