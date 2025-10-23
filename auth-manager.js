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
    // Try environment variable first (highest priority)
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

    // Try stored token (cached from previous manual input)
    const storedToken = await this.getStoredToken();
    if (storedToken) {
      console.log('🔑 Using stored authentication token');
      return storedToken;
    }

    // No authentication found
    console.log('❌ No authentication found');

    throw new Error(`
❌ Authentication required!

Please set your API key:
  export ANTHROPIC_API_KEY=your_api_key_here

Get your API key from: https://console.anthropic.com
    `);
  }

  async logout() {
    await this.clearStoredToken();
    console.log('🔓 Logged out successfully! Stored authentication token cleared.');
  }
}

export default AuthenticationManager;
