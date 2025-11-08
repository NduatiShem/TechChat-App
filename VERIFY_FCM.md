# ✅ Verifying FCM Credentials Before Build

## 🔍 Current Status Check

### Package Name Verification

**Issue Found:**
- `google-services.json` has: `com.techchat.messageapp`
- `app.json` has: `com.techchat.app`

**⚠️ CRITICAL:** These must match for FCM to work!

---

## ✅ Verification Steps

### Step 1: Check Package Name Match

```bash
# Check app.json package name
grep "package" app.json

# Check google-services.json package name  
grep "package_name" google-services.json
```

**They must be identical!**

### Step 2: Verify FCM Credentials Uploaded to Expo

Since `eas credentials` requires interactive input, you can verify by:

1. **Check if credentials exist:**
   - Try to build - if FCM is missing, build will warn you
   - Or check Expo dashboard: https://expo.dev/accounts/shemnd/projects/techchat/credentials

2. **Verify via build preview:**
   ```bash
   eas build --profile production --platform android --dry-run
   ```

### Step 3: Test FCM Configuration

The best way to verify is to check:
- Package names match
- Credentials are uploaded to Expo
- Build will include FCM

---

## 🔧 Fixing Package Name Mismatch

### Option A: Update app.json to match google-services.json

If `google-services.json` has the correct Firebase project:
```json
"package": "com.techchat.messageapp"
```

### Option B: Get new google-services.json with correct package

1. Go to Firebase Console
2. Add Android app with package: `com.techchat.app`
3. Download new `google-services.json`
4. Upload to Expo via `eas credentials`

---

## ✅ Quick Verification Command

```bash
# Check package names match
echo "App.json package:" && grep -A 1 '"android"' app.json | grep package
echo "Google-services package:" && grep package_name google-services.json

# If they match, you're good!
# If they don't match, fix one of them
```

---

## 🚀 Next Steps

1. **Fix package name mismatch** (if exists)
2. **Verify credentials uploaded** to Expo
3. **Build production APK**

---

**Status**: Checking credentials...

