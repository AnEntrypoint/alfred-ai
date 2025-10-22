#!/usr/bin/env node

import { createInterface } from 'readline';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';

class AuthenticationManager {
  constructor() {
    this.tokenFile = join(homedir(), '.alfred', 'auth-token.json');
    this.configDir = join(homedir(), '.alfred');
  }

  async ensureConfigDir() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  async getAuthentication() {
    // Try environment variables (API keys for override)
    const envToken = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    if (envToken) {
      console.log('🌍 Using ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable');
      return envToken;
    }

    // Try Claude Code session tokens in common locations
    for (const location of this.claudeCodeLocations) {
      try {
        const data = await fs.readFile(location, 'utf8');
        const parsed = JSON.parse(data);

        // Look for various token fields in different formats
        const token = parsed.token || parsed.api_key || parsed.accessToken || parsed.access_token ||
                     parsed.sessionToken || parsed.session_token || parsed.authToken || parsed.auth_token;

        if (token && typeof token === 'string' && token.length > 10) {
          console.log(`✅ Found Claude Code token in ${location}`);

          // Validate token format (Claude tokens typically start with sk-ant-)
          if (token.startsWith('sk-ant-')) {
            return token;
          } else {
            console.log(`⚠️  Found token but format may be incorrect: ${token.substring(0, 10)}...`);
          }
        }
      } catch (error) {
        // File doesn't exist or can't be read, continue to next location
      }
    }

    console.log('❌ No Claude Code authentication found');

    // Prompt for browser authentication (fallback)
    console.log('🌐 Opening browser for authentication...\n');
    const authInstructions = `
🔐 Alfred Authentication

Since Claude uses API key authentication, please follow these steps:

1. Open https://console.claude.com in your browser
2. Sign in to your Claude account
3. Go to Account Settings → API Keys
4. Generate a new API key
5. Copy the API key

When you have your API key, you can:
- Set environment variable: export ANTHROPIC_API_KEY=your_key_here
- Or set environment variable: export ANTHROPIC_AUTH_TOKEN=your_key_here

To skip browser authentication, press Enter without pasting a key.
`;

    return new Promise((resolve, reject) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log(authInstructions);
      rl.question('\n🔗 Paste your Claude API key (or press Enter to skip): ', (input) => {
        const key = input.trim();

        if (key) {
          console.log('\n🔑 Using provided API key');
          resolve(key);
        } else {
          console.log('\n❌ No API key provided');
          console.log('\n📋 To use Alfred, please set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable');
          console.log('\n📋 Get your API key from: https://console.claude.com');
          reject(new Error('No API key provided'));
        }
      }).on('close', () => {
        rl.close();
      });
    });
  }

  async storeToken(token, expiresIn = null) {
    await this.ensureConfigDir();
    const expires = expiresIn ? Date.now() + expiresIn : null;
    const tokenData = {
      token,
      expires,
      created: Date.now()
    };

    await fs.writeFile(this.tokenFile, JSON.stringify(tokenData, null, 2));
  }

  async clearStoredToken() {
    try {
      await fs.unlink(this.tokenFile);
    } catch (error) {
      // File might not exist
    }
  }

  async logout() {
    await this.clearStoredToken();
    console.log('🔓 Logged out successfully! Stored authentication token cleared.');
  }
}

export default AuthenticationManager;