import fs from 'fs';
import path from 'path';
import os from 'os';

const ENV_API_KEY = 'ANTHROPIC_API_KEY';
const ENV_AUTH_TOKEN = 'ANTHROPIC_AUTH_TOKEN';
const ENV_OAUTH_TOKEN = 'ANTHROPIC_OAUTH_TOKEN';
const OAUTH_CACHE_DIR = path.join(os.homedir(), '.anthropic');
const OAUTH_CACHE_FILE = path.join(OAUTH_CACHE_DIR, 'oauth-token');

class AuthManager {
  constructor() {
    this.apiKey = null;
    this.authType = null;
    this.oauthToken = null;
  }

  async initialize() {
    console.error('[Auth Manager] Checking authentication...');

    this.apiKey = process.env[ENV_API_KEY] || process.env[ENV_AUTH_TOKEN];

    if (this.apiKey) {
      console.error('[Auth Manager] ✅ API key found in environment');
      this.authType = 'api_key';
      return { type: 'api_key', key: this.apiKey };
    }

    this.oauthToken = process.env[ENV_OAUTH_TOKEN] || this.loadCachedOAuthToken();

    if (this.oauthToken) {
      console.error('[Auth Manager] ✅ OAuth token found');
      this.authType = 'oauth';
      return { type: 'oauth', token: this.oauthToken };
    }

    console.error('[Auth Manager] ❌ No authentication found');
    console.error('');
    console.error('Authentication options:');
    console.error(`  1. API Key: export ${ENV_API_KEY}=your-api-key-here`);
    console.error(`  2. OAuth Token: export ${ENV_OAUTH_TOKEN}=your-oauth-token`);
    console.error(`  3. Shell config: source ~/zlaude`);
    console.error('');
    throw new Error('Authentication required (API key or OAuth token)');
  }

  loadCachedOAuthToken() {
    try {
      if (fs.existsSync(OAUTH_CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(OAUTH_CACHE_FILE, 'utf8'));
        if (cached.token && cached.expiresAt && new Date(cached.expiresAt) > new Date()) {
          return cached.token;
        }
        if (cached.token && !cached.expiresAt) {
          return cached.token;
        }
      }
    } catch (error) {
      // Silently fail if cache is corrupted
    }
    return null;
  }

  cacheOAuthToken(token, expiresIn = null) {
    try {
      if (!fs.existsSync(OAUTH_CACHE_DIR)) {
        fs.mkdirSync(OAUTH_CACHE_DIR, { recursive: true });
      }
      const cacheData = {
        token,
        cachedAt: new Date().toISOString(),
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
      };
      fs.writeFileSync(OAUTH_CACHE_FILE, JSON.stringify(cacheData), 'utf8');
      fs.chmodSync(OAUTH_CACHE_FILE, 0o600);
      console.error('[Auth Manager] ✅ OAuth token cached');
    } catch (error) {
      console.error(`[Auth Manager] ⚠️ Failed to cache OAuth token: ${error.message}`);
    }
  }

  getAuthHeader() {
    if (this.authType === 'api_key') {
      return `x-api-key: ${this.apiKey}`;
    }
    if (this.authType === 'oauth') {
      return `authorization: Bearer ${this.oauthToken}`;
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
    if (this.authType === 'oauth') {
      return {
        type: 'OAuth Token',
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
      apiKey: this.authType === 'api_key' ? this.apiKey : undefined,
      oauthToken: this.authType === 'oauth' ? this.oauthToken : undefined
    };
  }

  getApiKey() {
    return this.apiKey;
  }

  getOAuthToken() {
    return this.oauthToken;
  }

  isOAuth() {
    return this.authType === 'oauth';
  }

  isApiKey() {
    return this.authType === 'api_key';
  }
}

export default AuthManager;
