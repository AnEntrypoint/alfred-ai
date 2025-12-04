import fs from 'fs';
import path from 'path';
import os from 'os';

const OAUTH_CACHE_DIR = path.join(os.homedir(), '.anthropic');
const OAUTH_CACHE_FILE = path.join(OAUTH_CACHE_DIR, 'oauth-credentials.json');

class OAuthManager {
  constructor() {
    this.credentials = null;
    this.loadCredentials();
  }

  loadCredentials() {
    try {
      if (fs.existsSync(OAUTH_CACHE_FILE)) {
        const data = fs.readFileSync(OAUTH_CACHE_FILE, 'utf8');
        this.credentials = JSON.parse(data);
      }
    } catch (error) {
      // Credentials not available
    }
  }

  hasCredentials() {
    return !!this.credentials && !!this.credentials.accessToken;
  }

  getAccessToken() {
    return this.credentials?.accessToken;
  }

  getRefreshToken() {
    return this.credentials?.refreshToken;
  }

  isExpired() {
    if (!this.credentials) return false;
    if (!this.credentials.obtainedAt || !this.credentials.expiresIn) return false;

    const obtainedTime = new Date(this.credentials.obtainedAt).getTime();
    const expirationTime = obtainedTime + (this.credentials.expiresIn * 1000);
    const now = Date.now();

    // Consider expired if within 5 minutes of expiration
    return now > (expirationTime - 300000);
  }

  async refreshAccessToken() {
    if (!this.credentials?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(this.credentials.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refreshToken,
          client_id: this.credentials.clientID
        }).toString()
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const newTokens = await response.json();
      this.credentials.accessToken = newTokens.access_token;
      this.credentials.expiresIn = newTokens.expires_in;
      this.credentials.obtainedAt = new Date().toISOString();

      // Save updated credentials
      fs.writeFileSync(OAUTH_CACHE_FILE, JSON.stringify(this.credentials, null, 2), 'utf8');
      fs.chmodSync(OAUTH_CACHE_FILE, 0o600);

      return this.credentials.accessToken;
    } catch (error) {
      throw new Error(`Failed to refresh OAuth token: ${error.message}`);
    }
  }

  async getValidAccessToken() {
    if (!this.hasCredentials()) {
      throw new Error('OAuth credentials not configured. Run: npx alfred-ai@latest --login');
    }

    if (this.isExpired()) {
      await this.refreshAccessToken();
    }

    return this.getAccessToken();
  }

  getCredentials() {
    return this.credentials;
  }
}

export default OAuthManager;
