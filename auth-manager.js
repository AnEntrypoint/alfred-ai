#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';

class AuthenticationManager {
  constructor() {
    this.tokenFile = join(homedir(), '.alfred', 'auth-token.json');
    this.configDir = join(homedir(), '.alfred');

    // Potential Claude Code token locations
    this.claudeCodeLocations = [
      // macOS
      join(homedir(), 'Library', 'Application Support', 'Claude', 'auth.json'),
      join(homedir(), 'Library', 'Application Support', 'Claude', 'session.json'),
      join(homedir(), 'Library', 'Preferences', 'claude_desktop.json'),

      // Linux
      join(homedir(), '.config', 'Claude', 'auth.json'),
      join(homedir(), '.config', 'Claude', 'session.json'),
      join(homedir(), '.local', 'share', 'Claude', 'auth.json'),

      // Windows
      join(homedir(), 'AppData', 'Roaming', 'Claude', 'auth.json'),
      join(homedir(), 'AppData', 'Local', 'Claude', 'auth.json'),

      // Cross-platform cache locations
      join(homedir(), '.cache', 'claude', 'auth.json'),
      join(homedir(), '.cache', 'claude', 'session.json'),
    ];
  }

  async ensureConfigDir() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  async getStoredToken() {
    try {
      await this.ensureConfigDir();
      const tokenData = await fs.readFile(this.tokenFile, 'utf8');
      const { token, expires } = JSON.parse(tokenData);

      if (expires && Date.now() > expires) {
        await this.clearStoredToken();
        return null;
      }

      return token;
    } catch (error) {
      return null;
    }
  }

  async getClaudeCodeToken() {
    console.log('🔍 Checking for Claude Code authentication...');

    // Check for Claude Code environment variables first
    if (process.env.CLAUDE_API_KEY) {
      console.log('✅ Found CLAUDE_API_KEY environment variable');
      return process.env.CLAUDE_API_KEY;
    }

    // Check for Claude Code session tokens in common locations
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

    // Check for Claude Code specific environment variables
    const claudeEnvVars = [
      'CLAUDE_DESKTOP_API_KEY',
      'CLAUDE_SESSION_TOKEN',
      'CLAUDE_OAUTH_TOKEN',
      'CLAUDE_DESKTOP_SESSION'
    ];

    for (const envVar of claudeEnvVars) {
      if (process.env[envVar]) {
        console.log(`✅ Found ${envVar} environment variable`);
        return process.env[envVar];
      }
    }

    console.log('❌ No Claude Code authentication found');
    return null;
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

  
  async getAuthentication() {
    // Try environment variable first (highest priority - allows override)
    const envToken = process.env.ANTHROPIC_API_KEY;
    if (envToken) {
      console.log('🌍 Using ANTHROPIC_API_KEY environment variable');
      return envToken;
    }

    // Try legacy environment variable
    const legacyToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (legacyToken) {
      console.log('🌍 Using ANTHROPIC_AUTH_TOKEN environment variable');
      return legacyToken;
    }

    
    // Try Claude Code session tokens in common locations (original detection)
    const claudeCodeToken = await this.getClaudeCodeToken();
    if (claudeCodeToken) {
      console.log('🎭 Using Claude Code authentication token');
      return claudeCodeToken;
    }

    // Try stored token (cached from previous browser auth)
    // Note: Stored tokens are NOT saved from Claude Code detection
    const storedToken = await this.getStoredToken();
    if (storedToken) {
      console.log('🔑 Using stored authentication token');
      return storedToken;
    }

    // No authentication found
    console.log('❌ No authentication found');

    throw new Error(`
❌ Authentication required!

Please set one of the following:
  1. Run: export ANTHROPIC_API_KEY=your_api_key_here
  2. Run: export ANTHROPIC_AUTH_TOKEN=your_api_key_here
  3. Use browser authentication when prompted

Get your API key from: https://console.claude.com
    `);
  }

  async logout() {
    await this.clearStoredToken();
    console.log('🔓 Logged out successfully! Stored authentication token cleared.');
  }
}

export default AuthenticationManager;
