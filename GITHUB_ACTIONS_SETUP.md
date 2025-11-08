# GitHub Actions Setup Guide

This guide will help you set up GitHub Actions for continuous integration and deployment of your TechChat app.

## Prerequisites

1. GitHub repository (already have this)
2. Expo account with EAS access
3. EAS CLI installed locally (optional, for testing)

## Step 1: Get Your Expo Access Token

1. Go to [Expo Dashboard](https://expo.dev)
2. Navigate to: **Account Settings → Access Tokens**
3. Click **"Create Token"**
4. Give it a name (e.g., "GitHub Actions")
5. Copy the token (you won't see it again!)

## Step 2: Add Secret to GitHub

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `EXPO_TOKEN`
5. Value: Paste your Expo access token
6. Click **"Add secret"**

## Step 3: Verify Workflows

The workflows are already created in `.github/workflows/`. To test:

1. **Test CI Workflow:**
   ```bash
   # Make a small change and push
   git checkout -b test-ci
   git add .
   git commit -m "test: verify CI workflow"
   git push origin test-ci
   ```
   Then create a Pull Request to see CI run.

2. **Test Build Workflow:**
   - Go to **Actions** tab in GitHub
   - Select **"Build Android"**
   - Click **"Run workflow"**
   - Select branch and build profile
   - Click **"Run workflow"**

## Workflow Overview

### 🔍 CI Workflow
- **When:** Every push/PR to `main` or `develop`
- **What:** Lints code, checks TypeScript, verifies config, installs packages
- **Time:** ~2-3 minutes

### 🏗️ Build Android Workflow
- **When:** Push to `main`, version tags, or manual trigger
- **What:** Builds Android APK via EAS
- **Time:** ~15-30 minutes (builds happen on Expo servers)

**Note:** iOS builds are handled manually when needed.

### 📦 Release Workflow
- **When:** You push a version tag (e.g., `v1.0.0`)
- **What:** Creates GitHub release with changelog
- **Time:** ~1 minute

### 🔒 Security Scan Workflow
- **When:** Every push/PR and weekly schedule
- **What:** Scans for security vulnerabilities and hardcoded secrets
- **Time:** ~1-2 minutes

### 📊 Code Quality Workflow
- **When:** Every push/PR to `main` or `develop`
- **What:** Checks for console statements, TODOs, large files
- **Time:** ~1-2 minutes

### 🔄 Dependency Updates Workflow
- **When:** Weekly schedule (Mondays)
- **What:** Checks for outdated npm packages
- **Time:** ~1 minute

**Note:** Deployment to servers is done manually. GitHub Actions focuses on code quality, building apps, and automated checks.

## Build Profiles

Your `eas.json` defines three build profiles:

1. **development**: For development/testing
   - Includes dev client
   - Faster builds
   - Internal distribution

2. **preview**: For testing before production
   - Production-like builds
   - Internal distribution
   - Good for QA testing

3. **production**: For app store releases
   - Optimized builds
   - App store ready
   - Signed with production certificates

## Creating a Release

To create a new release:

```bash
# 1. Update version in app.json (if needed)
# 2. Commit changes
git add .
git commit -m "chore: bump version to 1.0.1"

# 3. Create and push tag
git tag v1.0.1
git push origin v1.0.1

# 4. GitHub Actions will automatically:
#    - Build production versions
#    - Create GitHub release
#    - Generate changelog
```

## Monitoring Builds

1. **GitHub Actions Tab:**
   - View workflow runs
   - See build logs
   - Download artifacts

2. **Expo Dashboard:**
   - View EAS builds
   - Download built apps
   - See build details

## Customization

### Change Build Triggers

Edit `.github/workflows/build-android.yml` or `build-ios.yml`:

```yaml
on:
  push:
    branches: [ main, develop ]  # Add more branches
  schedule:
    - cron: '0 0 * * 0'  # Weekly builds
```

### Add Notifications

Add Slack/Discord notifications:

```yaml
- name: Notify on success
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Add Testing

If you add tests later:

```yaml
- name: Run tests
  run: npm test
```

## Troubleshooting

### ❌ "EXPO_TOKEN not found"
- Verify secret is added: Settings → Secrets → Actions
- Check secret name is exactly `EXPO_TOKEN`

### ❌ "EAS build failed"
- Check Expo dashboard for detailed logs
- Verify `eas.json` is correct
- Ensure app.json is valid

### ❌ "TypeScript errors"
- Run locally: `npx tsc --noEmit`
- Fix errors before pushing

### ❌ "Linting failed"
- Run locally: `npm run lint`
- Fix linting errors
- Or add `// eslint-disable-next-line` for exceptions

## Best Practices

1. **Always run CI locally first:**
   ```bash
   npm run lint
   npx tsc --noEmit
   ```

2. **Use feature branches:**
   - Create PRs to trigger CI
   - Fix issues before merging

3. **Tag releases properly:**
   - Use semantic versioning: `v1.0.0`
   - Tag from `main` branch
   - Write meaningful commit messages

4. **Monitor build costs:**
   - EAS builds consume credits
   - Use preview builds for testing
   - Production builds for releases only

## Next Steps

1. ✅ Add `EXPO_TOKEN` secret
2. ✅ Test CI workflow with a PR
3. ✅ Test manual build workflow
4. ✅ Set up branch protection (optional)
   - Require CI to pass before merging
   - Settings → Branches → Add rule

## Branch Protection (Recommended)

Protect your `main` branch:

1. Go to **Settings** → **Branches**
2. Add rule for `main` branch
3. Enable:
   - ✅ Require pull request reviews
   - ✅ Require status checks to pass
   - ✅ Require branches to be up to date
   - Select: "CI" workflow

This ensures code quality before merging to main.

