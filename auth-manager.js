import fs from 'fs';
import path from 'path';
import os from 'os';

const ENV_API_KEY = 'ANTHROPIC_API_KEY';

class AuthManager {
  constructor() {
    this.apiKey = null;
    this.authType = null;
  }

  async initialize() {
    console.error('[Auth Manager] Checking authentication...');

    this.apiKey = process.env[ENV_API_KEY];

    if (this.apiKey) {
      console.error('[Auth Manager] ✅ API key found in environment');
      this.authType = 'api_key';
      return { type: 'api_key', key: this.apiKey };
    }

    console.error('[Auth Manager] ❌ No API key found');
    console.error('');
    console.error('Please set ANTHROPIC_API_KEY environment variable:');
    console.error(`  export ${ENV_API_KEY}=your-api-key-here`);
    console.error('');
    throw new Error('API key required');
  }

  getAuthHeader() {
    if (this.authType === 'api_key') {
      return `x-api-key: ${this.apiKey}`;
    }

    throw new Error('No valid authentication available');
  }

  getAuthInfo() {
    if (this.authType === 'api_key') {
      return {
        type: 'API Key',
        status: '✅ Active'
      };
    }

    return {
      type: 'None',
      status: '❌ Not authenticated'
    };
  }

  async ensureAuthenticated() {
    if (!this.authType) {
      await this.initialize();
    }

    return this.authType !== null;
  }

  getAuthData() {
    return {
      type: this.authType,
      apiKey: this.apiKey
    };
  }

  getApiKey() {
    return this.apiKey;
  }
}

export default AuthManager;
