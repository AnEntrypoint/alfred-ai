#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createServer } from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { chromium } from 'playwright';

const OAUTH_CACHE_DIR = path.join(os.homedir(), '.anthropic');
const OAUTH_CACHE_FILE = path.join(OAUTH_CACHE_DIR, 'oauth-credentials.json');

// Anthropic's public OAuth client ID from Claude Code
const OAUTH_CONFIG = {
  clientID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectPort: 3567,
  redirectPath: '/auth/callback',
  scopes: 'openid email profile offline_access',
  authorizationEndpoint: 'https://console.anthropic.com/api/oauth/authorize',
  tokenEndpoint: 'https://console.anthropic.com/api/oauth/token'
};

let authorizationCode = null;
let authServer = null;

// PKCE helper functions
function generateCodeChallenge() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function startCallbackServer() {
  return new Promise((resolve) => {
    authServer = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${OAUTH_CONFIG.redirectPort}`);

      if (url.pathname === OAUTH_CONFIG.redirectPath) {
        authorizationCode = url.searchParams.get('code');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>OAuth Success</title>
            <style>
              body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #333; margin: 0 0 10px 0; }
              p { color: #666; margin: 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Authentication Successful</h1>
              <p>You can close this window and return to the terminal.</p>
            </div>
          </body>
          </html>
        `);

        setTimeout(() => resolve(), 1000);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    authServer.listen(OAUTH_CONFIG.redirectPort, 'localhost', () => {
      resolve();
    });
  });
}

async function setupOAuthLogin() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Alfred AI - OAuth Setup (Anthropic/Claude)');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Generate PKCE challenge
    const { codeVerifier, codeChallenge } = generateCodeChallenge();

    // Start callback server
    await startCallbackServer();

    const redirectUri = `http://localhost:${OAUTH_CONFIG.redirectPort}${OAUTH_CONFIG.redirectPath}`;
    const state = crypto.randomBytes(16).toString('hex');

    // Build authorization URL
    const authUrl = new URL(OAUTH_CONFIG.authorizationEndpoint);
    authUrl.searchParams.set('client_id', OAUTH_CONFIG.clientID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', OAUTH_CONFIG.scopes);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log('🌐 Opening browser for OAuth login...\n');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    console.log('📝 Steps:');
    console.log('   1. Log in with your Anthropic account');
    console.log('   2. Grant permission for Alfred AI to access your account');
    console.log('   3. Wait for the success page\n');

    // Listen for authorization code
    let codeReceived = false;
    const codeWaiter = new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (authorizationCode) {
          codeReceived = true;
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });

    await page.goto(authUrl.toString(), {
      waitUntil: 'networkidle',
      timeout: 60000
    }).catch(() => {});

    // Wait for code or timeout
    await Promise.race([
      codeWaiter,
      new Promise(resolve => setTimeout(resolve, 300000)) // 5 minute timeout
    ]);

    await browser.close();
    authServer.close();

    if (!authorizationCode) {
      console.error('\n❌ No authorization code received');
      process.exit(1);
    }

    console.log('✅ Authorization successful!\n');

    // Exchange code for tokens (with PKCE verifier)
    console.log('🔄 Exchanging authorization code for tokens...\n');

    const tokenResponse = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        client_id: OAUTH_CONFIG.clientID,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      }).toString()
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokens = await tokenResponse.json();

    // Save OAuth credentials
    if (!fs.existsSync(OAUTH_CACHE_DIR)) {
      fs.mkdirSync(OAUTH_CACHE_DIR, { recursive: true });
    }

    const credentials = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type || 'Bearer',
      scope: tokens.scope,
      obtainedAt: new Date().toISOString(),
      clientID: OAUTH_CONFIG.clientID,
      tokenEndpoint: OAUTH_CONFIG.tokenEndpoint
    };

    fs.writeFileSync(OAUTH_CACHE_FILE, JSON.stringify(credentials, null, 2), 'utf8');
    fs.chmodSync(OAUTH_CACHE_FILE, 0o600);

    console.log('✅ OAuth credentials saved successfully!');
    console.log(`\nCredentials location: ${OAUTH_CACHE_FILE}`);
    console.log('Permissions: 0600 (secure)\n');

    console.log('You can now use Alfred AI:');
    console.log('  npx alfred-ai@latest "your task here"\n');

  } catch (error) {
    console.error('\n❌ OAuth setup failed:', error.message);
    if (authServer) authServer.close();
    process.exit(1);
  }
}

setupOAuthLogin();
