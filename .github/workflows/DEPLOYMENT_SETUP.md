# 🚀 Deployment Setup Guide

## Quick Setup

### Step 1: Generate SSH Key Pair

On your local machine:
```bash
# Generate SSH key for GitHub Actions
ssh-keygen -t rsa -b 4096 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy

# This creates two files:
# ~/.ssh/github_actions_deploy (private key - add to GitHub)
# ~/.ssh/github_actions_deploy.pub (public key - add to server)
```

### Step 2: Add Public Key to Server

```bash
# Copy public key to server
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@your-server-ip

# OR manually add to server:
# 1. SSH into server
ssh user@your-server-ip

# 2. Add public key to authorized_keys
echo "YOUR_PUBLIC_KEY_CONTENT" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

### Step 3: Add Secrets to GitHub

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Add these secrets:

#### Required Secrets:

**SERVER_HOST**
- Value: Your server IP or domain (e.g., `123.45.67.89` or `healthclassique.tech-bridge.app`)

**SERVER_USER**
- Value: SSH username (e.g., `root`, `ubuntu`, or your username)

**SERVER_SSH_KEY**
- Value: Content of private key file (`~/.ssh/github_actions_deploy`)
- Copy the entire content including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`

**SERVER_DEPLOY_PATH**
- Value: Full path to your project on server (e.g., `/var/www/TechChat-App` or `/home/user/TechChat-App`)

#### Optional Secrets:

**SERVER_PORT**
- Value: SSH port (defaults to 22 if not set)
- Only needed if your server uses a non-standard SSH port

### Step 4: Verify Setup

1. Push a commit to `main` branch
2. Go to Actions tab in GitHub
3. Check if "Deploy to Server (Git Pull)" workflow runs successfully
4. Verify changes are deployed on your server

## How It Works

### Automatic Deployment Flow:

1. **Push to main branch** → Triggers deployment workflow
2. **Code Quality Checks** → Runs linting and type checking
3. **SSH to Server** → Connects using provided credentials
4. **Git Pull** → Pulls latest changes from GitHub
5. **Install Dependencies** → Runs `npm install --production`
6. **Done!** → Your server is updated

### Manual Deployment:

1. Go to Actions tab
2. Select "Deploy to Server (Git Pull)"
3. Click "Run workflow"
4. Select branch and run

## Troubleshooting

### SSH Connection Fails

**Check:**
- Server is accessible: `ping your-server-ip`
- SSH port is correct
- Public key is in `~/.ssh/authorized_keys` on server
- Private key is correctly added to GitHub secrets (include BEGIN/END lines)

**Test SSH connection:**
```bash
ssh -i ~/.ssh/github_actions_deploy user@your-server-ip
```

### Git Pull Fails

**Check:**
- Repository is cloned on server
- Git remote is configured correctly
- Server has access to GitHub (for private repos, use deploy key)
- Branch name matches (usually `main`)

**On server:**
```bash
cd /path/to/project
git remote -v
git pull origin main
```

### Installation Fails

**Check:**
- Node.js is installed on server: `node --version`
- npm is installed: `npm --version`
- Dependencies can be installed: `npm install`
- Network connectivity to npm registry

### Permission Denied

**Check:**
- User has write permissions to project directory
- User can run npm commands
- File permissions are correct

**Fix permissions:**
```bash
chown -R user:user /path/to/project
chmod -R 755 /path/to/project
```

## Security Best Practices

1. **Use dedicated SSH key** - Don't use your personal SSH key
2. **Restrict key permissions** - Only allow access to specific directory
3. **Use deploy keys** - For private repos, use GitHub deploy keys instead of personal tokens
4. **Rotate keys regularly** - Change SSH keys periodically
5. **Monitor deployments** - Check GitHub Actions logs regularly

## Alternative: Using Deploy Keys (For Private Repos)

If your repository is private, use deploy keys instead:

1. **Generate SSH key** (same as above)
2. **Add public key to GitHub:**
   - Go to repository Settings → Deploy keys
   - Click "Add deploy key"
   - Paste public key content
   - Check "Allow write access" (if you need to push)
3. **Add private key to GitHub Secrets** (same as above)

## Next Steps

After setup:
- ✅ Test deployment with a small change
- ✅ Verify web build works on server
- ✅ Check server logs for any errors
- ✅ Set up web server (Nginx/Apache) to serve `web-build` folder

