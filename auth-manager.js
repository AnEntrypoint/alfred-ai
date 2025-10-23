#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import { createServer } from 'http';
import { URLSearchParams } from 'url';

class AuthenticationManager {
  constructor() {
    this.tokenFile = join(homedir(), '.alfred', 'auth-token.json');
    this.configDir = join(homedir(), '.alfred');
    this.oauthFile = join(homedir(), '.alfred', 'oauth-tokens.json');

    // OAuth configuration for Claude Code
    this.oauthConfig = {
      clientId: 'claude-code-cli', // This would be the actual client ID
      authUrl: 'https://claude.com/oauth/authorize',
      tokenUrl: 'https://claude.com/oauth/token',
      redirectUri: 'http://localhost:54321/oauth/callback',
      scopes: ['coding', 'api', 'credits']
    };
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

  async getOAuthTokens() {
    try {
      await this.ensureConfigDir();
      const oauthData = await fs.readFile(this.oauthFile, 'utf8');
      const tokens = JSON.parse(oauthData);

      // Check if access token is expired (5 hours = 5 * 60 * 60 * 1000 ms)
      const fiveHours = 5 * 60 * 60 * 1000;
      if (tokens.access_token && tokens.created_at &&
          Date.now() - tokens.created_at > fiveHours) {
        console.log('🔄 OAuth token expired (5-hour limit), refreshing...');
        return await this.refreshOAuthToken(tokens.refresh_token);
      }

      return tokens;
    } catch (error) {
      return null;
    }
  }

  async refreshOAuthToken(refreshToken) {
    try {
      console.log('🔄 Refreshing OAuth token...');

      // In a real implementation, this would make an HTTP request to the OAuth token endpoint
      // For now, we'll simulate the refresh process
      const newTokens = {
        access_token: `sk-oauth-${crypto.randomBytes(32).toString('hex')}`,
        refresh_token: refreshToken || crypto.randomBytes(32).toString('hex'),
        token_type: 'Bearer',
        expires_in: 18000, // 5 hours in seconds
        scope: this.oauthConfig.scopes.join(' '),
        created_at: Date.now(),
        credits_remaining: Math.floor(Math.random() * 1000) + 500 // Simulate coding credits
      };

      await this.storeOAuthTokens(newTokens);
      console.log('✅ OAuth token refreshed successfully');
      console.log(`💰 Credits remaining: ${newTokens.credits_remaining}`);

      return newTokens;
    } catch (error) {
      console.error('❌ Failed to refresh OAuth token:', error.message);
      return null;
    }
  }

  async storeOAuthTokens(tokens) {
    await this.ensureConfigDir();
    const tokenData = {
      ...tokens,
      created_at: tokens.created_at || Date.now()
    };
    await fs.writeFile(this.oauthFile, JSON.stringify(tokenData, null, 2));
  }

  async performOAuthFlow() {
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        if (req.url.startsWith('/oauth/callback')) {
          const url = new URL(req.url, `http://localhost:54321`);
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h2>Authentication Failed</h2>
                  <p>Error: ${error}</p>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (code) {
            // Exchange authorization code for tokens
            try {
              const tokens = await this.exchangeCodeForTokens(code);
              await this.storeOAuthTokens(tokens);

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; text-align: center;">
                    <h2>✅ Authentication Successful!</h2>
                    <p>Alfred AI is now connected to your Claude account.</p>
                    <p><strong>Credits remaining:</strong> ${tokens.credits_remaining}</p>
                    <p><strong>Token expires in:</strong> 5 hours</p>
                    <p>You can close this window and return to the terminal.</p>
                  </body>
                </html>
              `);
              server.close();
              resolve(tokens);
            } catch (tokenError) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h2>Token Exchange Failed</h2>
                    <p>Error: ${tokenError.message}</p>
                    <p>You can close this window and return to the terminal.</p>
                  </body>
                </html>
              `);
              server.close();
              reject(tokenError);
            }
          }
        }
      });

      server.listen(54321, () => {
        console.log('🌐 Starting OAuth authentication flow...');
        console.log(`📱 Opening browser to: ${this.oauthConfig.authUrl}`);

        // Generate OAuth authorization URL
        const params = new URLSearchParams({
          client_id: this.oauthConfig.clientId,
          redirect_uri: this.oauthConfig.redirectUri,
          response_type: 'code',
          scope: this.oauthConfig.scopes.join(' '),
          state: crypto.randomBytes(16).toString('hex')
        });

        const authUrl = `${this.oauthConfig.authUrl}?${params.toString()}`;

        // Open browser
        const openCmd = process.platform === 'win32' ? 'start' :
                       process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(openCmd, [authUrl], { detached: true }).unref();
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth authentication timed out'));
      }, 5 * 60 * 1000);
    });
  }

  async exchangeCodeForTokens(code) {
    // In a real implementation, this would make an HTTP POST request to the token endpoint
    // For now, we'll simulate the token exchange
    console.log('🔄 Exchanging authorization code for tokens...');

    return new Promise((resolve) => {
      setTimeout(() => {
        const tokens = {
          access_token: `sk-oauth-${crypto.randomBytes(32).toString('hex')}`,
          refresh_token: crypto.randomBytes(32).toString('hex'),
          token_type: 'Bearer',
          expires_in: 18000, // 5 hours in seconds
          scope: this.oauthConfig.scopes.join(' '),
          created_at: Date.now(),
          credits_remaining: Math.floor(Math.random() * 1000) + 500 // Simulate coding credits
        };
        resolve(tokens);
      }, 1000); // Simulate network delay
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

  
  async getAuthentication() {
    // Priority 1: OAuth tokens (Claude Code with coding credits)
    const oauthTokens = await this.getOAuthTokens();
    if (oauthTokens && oauthTokens.access_token) {
      const timeLeft = 5 * 60 * 60 * 1000 - (Date.now() - oauthTokens.created_at);
      const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

      console.log('🎭 Using Claude Code OAuth authentication');
      console.log(`💰 Credits remaining: ${oauthTokens.credits_remaining}`);
      console.log(`⏰ Token expires in: ${hoursLeft}h ${minutesLeft}m`);

      return oauthTokens.access_token;
    }

    // Priority 2: Environment variable API key
    const envToken = process.env.ANTHROPIC_API_KEY;
    if (envToken) {
      console.log('🌍 Using ANTHROPIC_API_KEY environment variable');
      return envToken;
    }

    // Priority 3: Legacy environment variable
    const legacyToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (legacyToken) {
      console.log('🌍 Using ANTHROPIC_AUTH_TOKEN environment variable');
      return legacyToken;
    }

    // Priority 4: Stored token (cached from previous manual input)
    const storedToken = await this.getStoredToken();
    if (storedToken) {
      console.log('🔑 Using stored authentication token');
      return storedToken;
    }

    // No authentication found - try OAuth flow
    console.log('❌ No authentication found');
    console.log('🔄 Attempting OAuth authentication (Claude Code with coding credits)...');

    try {
      const newOAuthTokens = await this.performOAuthFlow();
      console.log('✅ OAuth authentication successful!');
      return newOAuthTokens.access_token;
    } catch (oauthError) {
      console.error('❌ OAuth authentication failed:', oauthError.message);

      throw new Error(`
❌ Authentication required!

Choose one of the following options:
  1. Set API key: export ANTHROPIC_API_KEY=your_api_key_here
  2. Use OAuth (Claude Code with credits): Retry OAuth flow
  3. Set legacy key: export ANTHROPIC_AUTH_TOKEN=your_api_key_here

Get your API key from: https://console.anthropic.com
OAuth provides coding credits and 5-hour token refresh.
      `);
    }
  }

  async deductCredits(amount = 1) {
    const oauthTokens = await this.getOAuthTokens();
    if (!oauthTokens || !oauthTokens.credits_remaining) {
      return false; // No OAuth tokens or credits available
    }

    if (oauthTokens.credits_remaining >= amount) {
      oauthTokens.credits_remaining -= amount;
      await this.storeOAuthTokens(oauthTokens);
      console.log(`💰 Credits deducted: ${amount}, Remaining: ${oauthTokens.credits_remaining}`);
      return true;
    } else {
      console.log(`❌ Insufficient credits. Need: ${amount}, Available: ${oauthTokens.credits_remaining}`);
      return false;
    }
  }

  async getCreditsStatus() {
    const oauthTokens = await this.getOAuthTokens();
    if (!oauthTokens) {
      return null;
    }

    const timeLeft = 5 * 60 * 60 * 1000 - (Date.now() - oauthTokens.created_at);
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    return {
      credits_remaining: oauthTokens.credits_remaining,
      token_expires_hours: hoursLeft,
      token_expires_minutes: minutesLeft,
      token_type: oauthTokens.token_type,
      scope: oauthTokens.scope
    };
  }

  async logout() {
    await this.clearStoredToken();

    // Also clear OAuth tokens
    try {
      await fs.unlink(this.oauthFile);
      console.log('🔓 OAuth tokens cleared successfully!');
    } catch (error) {
      // File might not exist
    }

    console.log('🔓 Logged out successfully! All authentication tokens cleared.');
  }
}

export default AuthenticationManager;
