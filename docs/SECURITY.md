# Security — Phase 0 actions

## Firebase Admin SDK (critical)

If a `*-firebase-adminsdk-*.json` or `temp*.b64` file was ever committed:

1. **Rotate** the service account key in [Firebase Console](https://console.firebase.google.com) → Project Settings → Service accounts → Generate new private key.
2. **Revoke** the old key.
3. Store the new JSON only in your Laravel server / CI secrets — **never** in this mobile repo.
4. Scrub git history (requires team coordination):

```bash
# Example with git-filter-repo (install separately)
git filter-repo --path-glob '*firebase-adminsdk*.json' --invert-paths
git filter-repo --path-glob 'temp*.b64' --invert-paths
git push --force-with-lease
```

5. Confirm `.gitignore` includes `*-firebase-adminsdk-*.json` and `temp*.b64`.

## Sentry

Set `EXPO_PUBLIC_SENTRY_DSN` in EAS secrets for production builds. Without it, the SDK stays disabled (no crash reporting).

## Environment files

Do not commit `.env` with API keys. Use EAS environment variables or `eas secret:create`.
