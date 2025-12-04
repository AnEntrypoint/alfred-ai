#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import * as readline from 'readline';

const OAUTH_CACHE_DIR = path.join(os.homedir(), '.anthropic');
const OAUTH_CACHE_FILE = path.join(OAUTH_CACHE_DIR, 'oauth-token');
const CLAUDE_CODE_DIR = path.join(os.homedir(), '.claude-code');
const CLAUDE_CODE_AUTH_FILE = path.join(CLAUDE_CODE_DIR, 'auth.json');

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function loadClaudeCodeCredentials() {
  try {
    if (fs.existsSync(CLAUDE_CODE_AUTH_FILE)) {
      const authData = JSON.parse(fs.readFileSync(CLAUDE_CODE_AUTH_FILE, 'utf8'));
      if (authData.token) {
        return authData.token;
      }
    }
  } catch (error) {
    // Silently continue if Claude Code auth not available
  }
  return null;
}

async function loginWithOAuth() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Alfred AI - OAuth Login for Max Plan Access');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check if Claude Code credentials are available
  const claudeCodeToken = loadClaudeCodeCredentials();
  if (claudeCodeToken) {
    console.log('✅ Found Claude Code credentials!\n');
    const useExisting = await promptUser('Use Claude Code\'s OAuth token? (y/n): ');
    if (useExisting.toLowerCase() === 'y' || useExisting.toLowerCase() === 'yes') {
      try {
        if (!fs.existsSync(OAUTH_CACHE_DIR)) {
          fs.mkdirSync(OAUTH_CACHE_DIR, { recursive: true });
        }

        const cacheData = {
          token: claudeCodeToken,
          cachedAt: new Date().toISOString(),
          expiresAt: null,
          source: 'claude-code'
        };

        fs.writeFileSync(OAUTH_CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
        fs.chmodSync(OAUTH_CACHE_FILE, 0o600);

        console.log('\n✅ Claude Code OAuth token imported successfully!');
        console.log(`   Token: ${claudeCodeToken.substring(0, 20)}...`);
        console.log(`   Cached at: ${OAUTH_CACHE_FILE}\n`);
        return;
      } catch (error) {
        console.error('\n❌ Failed to import Claude Code token:', error.message);
      }
    }
  }

  console.log('To use Alfred AI with maximum API access, authenticate via OAuth.\n');
  console.log('Steps:');
  console.log('1. Visit: https://console.anthropic.com/account/settings/credentials');
  console.log('2. Create a new API key with max plan access');
  console.log('3. Paste the OAuth token below\n');

  console.log('Note: OAuth tokens provide:');
  console.log('  • Full API access with current plan limits');
  console.log('  • No daily usage restrictions');
  console.log('  • Token caching for offline access\n');

  const token = await promptUser('Paste your OAuth token: ');

  if (!token || token.trim().length === 0) {
    console.error('\n❌ No token provided');
    process.exit(1);
  }

  try {
    // Create cache directory if it doesn't exist
    if (!fs.existsSync(OAUTH_CACHE_DIR)) {
      fs.mkdirSync(OAUTH_CACHE_DIR, { recursive: true });
    }

    // Cache the token
    const cacheData = {
      token: token.trim(),
      cachedAt: new Date().toISOString(),
      expiresAt: null
    };

    fs.writeFileSync(OAUTH_CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
    fs.chmodSync(OAUTH_CACHE_FILE, 0o600);

    console.log('\n✅ OAuth token saved successfully!');
    console.log(`\nToken cache location: ${OAUTH_CACHE_FILE}`);
    console.log('Permissions: 0600 (secure)\n');

    console.log('You can now use Alfred AI:');
    console.log('  npx alfred-ai@latest "your task here"\n');

    console.log('Or set explicitly:');
    console.log(`  export ANTHROPIC_OAUTH_TOKEN="${token.trim().substring(0, 20)}..."`);
    console.log('  npx alfred-ai@latest "your task here"\n');

  } catch (error) {
    console.error('\n❌ Failed to save OAuth token:', error.message);
    process.exit(1);
  }
}

// Check for command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node oauth-login.js [options]

Options:
  --help, -h        Show this help message
  --check           Check if OAuth token is cached
  --clear           Remove cached OAuth token
  --token <token>   Set token without interactive prompt

Examples:
  node oauth-login.js
  node oauth-login.js --check
  node oauth-login.js --token sk-ant-xxxxx
`);
  process.exit(0);
}

if (args.includes('--check')) {
  if (fs.existsSync(OAUTH_CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(OAUTH_CACHE_FILE, 'utf8'));
    console.log('✅ OAuth token is cached');
    console.log(`   Token: ${cached.token.substring(0, 20)}...`);
    console.log(`   Cached at: ${cached.cachedAt}`);
  } else {
    console.log('❌ No cached OAuth token found');
    console.log(`   Expected location: ${OAUTH_CACHE_FILE}`);
  }
  process.exit(0);
}

if (args.includes('--clear')) {
  if (fs.existsSync(OAUTH_CACHE_FILE)) {
    fs.unlinkSync(OAUTH_CACHE_FILE);
    console.log('✅ OAuth token cache cleared');
  } else {
    console.log('ℹ️  No cached token to clear');
  }
  process.exit(0);
}

// Check for --token argument
const tokenIndex = args.indexOf('--token');
if (tokenIndex !== -1 && args[tokenIndex + 1]) {
  const token = args[tokenIndex + 1];
  try {
    if (!fs.existsSync(OAUTH_CACHE_DIR)) {
      fs.mkdirSync(OAUTH_CACHE_DIR, { recursive: true });
    }

    const cacheData = {
      token,
      cachedAt: new Date().toISOString(),
      expiresAt: null
    };

    fs.writeFileSync(OAUTH_CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
    fs.chmodSync(OAUTH_CACHE_FILE, 0o600);

    console.log('✅ OAuth token set successfully!');
    console.log(`   Cached at: ${OAUTH_CACHE_FILE}`);
  } catch (error) {
    console.error('❌ Failed to save token:', error.message);
    process.exit(1);
  }
  process.exit(0);
}

// Interactive login
loginWithOAuth().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
