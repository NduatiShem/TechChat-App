# App Crash Troubleshooting Guide

## Common Crash Causes

### 1. **Unhandled Promise Rejections**
Async operations without try-catch can crash the app.

### 2. **Missing Error Boundaries**
React errors without error boundaries will crash the app.

### 3. **Network Errors**
API calls failing can cause crashes if not handled properly.

### 4. **Missing Null Checks**
Accessing properties on null/undefined objects.

### 5. **Initialization Errors**
Contexts or modules failing to initialize.

---

## Quick Diagnostic Steps

1. **Check Logcat/Console Logs:**
   ```bash
   # Android
   adb logcat | grep -i "ReactNative"
   
   # Or use React Native Debugger
   ```

2. **Enable Error Logging:**
   - Check console output in development
   - Look for red error screens

3. **Identify When It Crashes:**
   - On app startup?
   - When opening a specific screen?
   - During API calls?
   - When handling notifications?

---

## Common Fixes

### Fix 1: Add Error Boundaries
Wrap the app in error boundaries to catch React errors.

### Fix 2: Wrap All Async Operations
Ensure all async operations have try-catch blocks.

### Fix 3: Add Null Checks
Check for null/undefined before accessing properties.

### Fix 4: Handle Network Errors
Gracefully handle network failures.

---

## Next Steps

Check the error logs to identify the exact crash point.


