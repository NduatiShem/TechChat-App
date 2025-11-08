# GitHub Actions Workflows

This directory contains GitHub Actions workflows for continuous integration and deployment of the TechChat app.

## Workflows

### 1. CI (`ci.yml`)
**Triggers:** Push/PR to `main` or `develop` branches

**Jobs:**
- **Lint & Type Check**: Runs ESLint and TypeScript type checking
- **Build Check**: Verifies app.json and EAS configuration

**Purpose:** Ensure code quality before merging

### 2. Code Quality (`code-quality.yml`)
**Triggers:** Push/PR to `main` or `develop` branches

**Checks:**
- ESLint validation
- TypeScript type checking
- Console statement detection
- TODO/FIXME comment detection
- Large file detection

**Purpose:** Code quality and maintainability checks

### 3. Build Android (`build-android.yml`)
**Triggers:**
- Push to `main` branch
- Version tags (v*)
- Manual workflow dispatch

**Build Profiles:**
- `development`: Development builds with dev client
- `preview`: Preview builds for testing
- `production`: Production builds for release

**Purpose:** Automated Android APK builds

**Note:** iOS builds are handled manually when needed.

### 4. Release (`release.yml`)
**Triggers:** Version tags (v*.*.*)

**Actions:**
- Generates changelog from git commits
- Creates GitHub release with changelog

**Purpose:** Automated release management

### 6. Security Scan (`security-scan.yml`)
**Triggers:** Push/PR to `main` or `develop`, weekly schedule

**Actions:**
- Runs `npm audit` for security vulnerabilities
- Checks for hardcoded secrets/passwords
- Creates GitHub issue if vulnerabilities found

**Purpose:** Security monitoring

### 7. Update Dependencies (`update-dependencies.yml`)
**Triggers:** Weekly schedule (Mondays)

**Actions:**
- Checks for outdated npm packages
- Creates GitHub issue with update recommendations

**Purpose:** Keep dependencies up to date

**Note:** All workflows automatically install packages (`npm ci`) to ensure dependencies are up to date. Deployment to servers is handled manually.

## Required Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

1. **EXPO_TOKEN**: Your Expo access token
   - Get it from: https://expo.dev/accounts/[your-account]/settings/access-tokens
   - Required for: Building with EAS

## Setup Instructions

1. **Get Expo Token:**
   ```bash
   # Install EAS CLI if not already installed
   npm install -g eas-cli
   
   # Login to Expo
   eas login
   
   # Get your token from Expo dashboard
   # https://expo.dev/accounts/[your-account]/settings/access-tokens
   ```

2. **Add Secret to GitHub:**
   - Go to your repository on GitHub
   - Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `EXPO_TOKEN`
   - Value: Your Expo access token
   - Click "Add secret"

3. **Verify Workflows:**
   - Push a commit to `main` or `develop` branch
   - Go to Actions tab in GitHub
   - Verify workflows run successfully

## Usage

### Automatic Builds
- **On push to main**: Automatically builds Android preview versions
- **On version tag**: Automatically builds Android production versions

### Manual Builds
1. Go to Actions tab in GitHub
2. Select "Build Android"
3. Click "Run workflow"
4. Select build profile
5. Click "Run workflow"

### Creating Releases
1. Create and push a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. The release workflow will automatically:
   - Build Android production version
   - Create a GitHub release
   - Generate changelog

## Workflow Status Badges

Add these badges to your README.md:

```markdown
![CI](https://github.com/your-username/TechChat-App/workflows/CI/badge.svg)
![Build Android](https://github.com/your-username/TechChat-App/workflows/Build%20Android/badge.svg)
```

## Troubleshooting

### Build Failures
- Check EAS build logs in Expo dashboard
- Verify `EXPO_TOKEN` secret is set correctly
- Ensure `eas.json` is properly configured

### CI Failures
- Fix linting errors: `npm run lint`
- Fix TypeScript errors: `npx tsc --noEmit`
- Review console statement warnings

### Missing Secrets
- Ensure `EXPO_TOKEN` is added to repository secrets
- Verify token has necessary permissions

