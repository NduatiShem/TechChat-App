# 🎨 Updating App Icon to Use TechChat Logo

## Current Situation

**The TechChat logo (green/blue "Te" design) is:**
- ✅ Used in app UI (login/signup screens)
- ❌ NOT used as the Android launcher icon

**Current Android Icons:**
- `playstore-icon.png` - Used for Android icon
- `ic_launcher_foreground.png` - Used for adaptive icon
- These are different from the TechChat logo

---

## Solution: Update Icons to Use TechChat Logo

### Option 1: Use Existing Logo File (Quick)

If `healtclassique-icon.png` is the TechChat logo:

1. **Copy logo to icon locations:**
   ```bash
   # Copy to playstore icon
   cp assets/images/healtclassique-icon.png assets/ic_launcher/android/playstore-icon.png
   
   # Copy to adaptive icon foreground (need to resize to 432x432)
   # You'll need to resize the image first
   ```

2. **Update app.json** (if needed)

### Option 2: Generate All Icon Sizes (Recommended)

For proper Android icons, you need multiple sizes:

1. **Create icon from TechChat logo:**
   - Use the logo shown in Expo (green/blue "Te" design)
   - Generate all required sizes:
     - 512x512 for playstore-icon.png
     - 432x432 for adaptive icon foreground
     - Various sizes for mipmap folders

2. **Tools to generate icons:**
   - Online: https://www.appicon.co/
   - Expo: `npx expo-optimize` or `eas build:configure`
   - Manual: Resize in image editor

---

## Steps to Update

### Step 1: Prepare Your Logo

1. Get the TechChat logo file (the one with green/blue "Te")
2. Ensure it's square (1:1 aspect ratio)
3. Recommended size: 1024x1024 or larger

### Step 2: Generate Android Icons

**Using Expo CLI (Easiest):**
```bash
# This will generate all required icon sizes
npx expo-optimize
```

**Or manually:**
1. Create 512x512 version → `playstore-icon.png`
2. Create 432x432 version → `mipmap-xxxhdpi/ic_launcher_foreground.png`
3. Generate all mipmap sizes (ldpi, mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)

### Step 3: Update app.json (if needed)

The current config should work once icons are updated:
```json
"android": {
  "icon": "./assets/ic_launcher/android/playstore-icon.png",
  "adaptiveIcon": {
    "foregroundImage": "./assets/ic_launcher/android/mipmap-xxxhdpi/ic_launcher_foreground.png",
    "backgroundColor": "#283891"
  }
}
```

### Step 4: Rebuild

After updating icons:
```bash
eas build --profile development --platform android
```

---

## Quick Fix (If Logo File Exists)

If you have the TechChat logo file ready:

1. **Find the logo file** (check if it's `healtclassique-icon.png` or another file)
2. **Replace the icon files:**
   ```bash
   # Backup current icons first
   cp assets/ic_launcher/android/playstore-icon.png assets/ic_launcher/android/playstore-icon.png.backup
   
   # Copy your logo (resize to 512x512 first if needed)
   # Then copy to icon location
   ```
3. **Rebuild the app**

---

## What You Need

1. **Source logo file** - The TechChat logo (green/blue "Te" design)
2. **Image editor** - To resize if needed
3. **Or use online tool** - To generate all sizes automatically

---

## Next Steps

1. **Locate your TechChat logo file**
2. **Generate Android icon sizes** (or use existing if already correct size)
3. **Replace current icon files**
4. **Rebuild the app**

Would you like me to help you:
- Find the logo file?
- Generate the icon sizes?
- Update the configuration?


