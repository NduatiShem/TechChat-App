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

### 3. Deploy to Server (`deploy-git.yml`) - **RECOMMENDED**
**Triggers:**
- Push to `main` branch
- Manual workflow dispatch

**Actions:**
- Runs linting and type checking
- Connects to server via SSH
- Pulls latest changes from GitHub
- Installs dependencies

**Purpose:** Automated deployment to production server

**Required Secrets:**
- `SERVER_HOST`: Server IP address or domain
- `SERVER_USER`: SSH username
- `SERVER_SSH_KEY`: Private SSH key for authentication
- `SERVER_PORT`: SSH port (optional, defaults to 22)
- `SERVER_DEPLOY_PATH`: Path to project directory on server

### 4. Deploy to Server (`deploy.yml`) - Alternative
**Triggers:**
- Push to `main` branch
- Manual workflow dispatch

**Actions:**
- Copies files to server via SCP
- Runs deployment commands on server

**Purpose:** Alternative deployment method using file copy

**Note:** Android builds are now handled manually when needed using `eas build`.

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

### For Deployment (Required)
1. **SERVER_HOST**: Your server IP address or domain (e.g., `123.45.67.89` or `healthclassique.tech-bridge.app`)
2. **SERVER_USER**: SSH username (e.g., `root` or `ubuntu`)
3. **SERVER_SSH_KEY**: Private SSH key for authentication
   - Generate: `ssh-keygen -t rsa -b 4096 -C "github-actions"`
   - Copy private key content to GitHub secret
   - Add public key to server: `cat ~/.ssh/id_rsa.pub >> ~/.ssh/authorized_keys`
4. **SERVER_PORT**: SSH port (optional, defaults to 22)
5. **SERVER_DEPLOY_PATH**: Path to project directory on server (e.g., `/var/www/TechChat-App`)

### For Building (Optional - if you need automated builds)
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

### Automatic Deployment
- **On push to main**: Automatically deploys to production server
- The workflow will:
  1. Run linting and type checking
  2. Connect to server via SSH
  3. Pull latest changes from GitHub
  4. Install dependencies

### Manual Deployment
1. Go to Actions tab in GitHub
2. Select "Deploy to Server (Git Pull)"
3. Click "Run workflow"
4. Select branch (usually `main`)
5. Click "Run workflow"

### Manual Android Builds (When Needed)
If you need to build Android APK, run locally:
```bash
eas build --profile production --platform android
```

### Creating Releases
1. Create and push a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. The release workflow will automatically:
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

