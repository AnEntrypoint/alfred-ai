# OAuth Setup for Alfred AI - Max Plan Access

## Option 1: Use Claude Code's OAuth (Recommended)

If you're using Claude Code, you can leverage its existing authentication:

1. Open Claude Code
2. Go to Settings → Authentication
3. Sign in with your Anthropic account
4. Claude Code will handle OAuth automatically
5. Alfred AI will inherit these credentials

This is the cleanest approach - no additional login needed.

## Option 2: Manual OAuth Login via Anthropic Console

If you need to set up OAuth separately:

### Step 1: Visit Anthropic Console
Go to: https://console.anthropic.com/account/settings

### Step 2: Create API Key
1. Click "Create API Key"
2. Name it: "Alfred AI"
3. Select your plan tier (Pro, Team, Enterprise)
4. Copy the token

### Step 3: Set OAuth Token

**Option A: Interactive Setup**
```bash
npx alfred-ai@latest --oauth-login
# Paste your token when prompted
```

**Option B: Direct Token Setup**
```bash
node oauth-login.js --token sk-ant-xxxxxxxxxxxxx
```

**Option C: Environment Variable**
```bash
export ANTHROPIC_OAUTH_TOKEN=sk-ant-xxxxxxxxxxxxx
npx alfred-ai@latest "your task"
```

## Option 3: OAuth Authorization Flow

For programmatic access with full OAuth flow:

1. Visit: https://console.anthropic.com/account/auth
2. Authorize the application
3. Claude Code or Alfred will receive the auth token

## Verify OAuth Setup

Check if OAuth token is properly configured:

```bash
# Check cached token
node oauth-login.js --check

# Test with Alfred
npx alfred-ai@latest "list files"
```

## API Access Levels

OAuth tokens from Anthropic Console provide:

- ✅ Full API access with your current plan
- ✅ No daily usage restrictions
- ✅ Access to all latest models
- ✅ Priority support (if applicable)
- ✅ Secure token caching

## Token Security

OAuth tokens are cached securely:

```
Location: ~/.anthropic/oauth-token
Permissions: 0600 (owner read/write only)
Format: JSON with expiration tracking
```

## Troubleshooting

### Token Not Working
1. Verify token is valid: https://console.anthropic.com/account/settings
2. Check expiration date
3. Ensure it's not disabled in console

### No OAuth Support in Claude Code
If using older Claude Code version:
```bash
# Fallback to API key
export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
npx alfred-ai@latest "your task"
```

### Permission Denied When Saving Token
```bash
# Fix permissions on cache directory
mkdir -p ~/.anthropic
chmod 700 ~/.anthropic
```

## For Claude Code Integration

Alfred AI automatically uses:
1. Claude Code's cached OAuth tokens (if available)
2. Environment variables (ANTHROPIC_OAUTH_TOKEN, ANTHROPIC_API_KEY)
3. ~/.anthropic/oauth-token (if cached locally)

No additional setup needed if you're already authenticated in Claude Code!

## Questions?

For API issues: https://console.anthropic.com/help
For OAuth flow: https://console.anthropic.com/account/auth
For Alfred AI issues: Check the main README.md
