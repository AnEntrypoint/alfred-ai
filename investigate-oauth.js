#!/usr/bin/env node

import crypto from 'crypto';
import { URL } from 'url';

// Try different scope combinations to see what's valid
const scopeTests = [
  '',
  'offline_access',
  'profile',
  'email',
  'profile email',
  'profile email offline_access',
];

const OAUTH_CONFIG = {
  clientID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectPort: 3567,
  redirectPath: '/auth/callback',
  authorizationEndpoint: 'https://console.anthropic.com/oauth/authorize',
};

function generateCodeChallenge() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

function buildAuthUrl(scope) {
  const { challenge } = generateCodeChallenge();
  const redirectUri = `http://localhost:${OAUTH_CONFIG.redirectPort}${OAUTH_CONFIG.redirectPath}`;
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL(OAUTH_CONFIG.authorizationEndpoint);
  authUrl.searchParams.set('client_id', OAUTH_CONFIG.clientID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  if (scope) {
    authUrl.searchParams.set('scope', scope);
  }
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return authUrl.toString();
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  OAuth Scope Investigation');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('Testing different scope combinations:\n');

scopeTests.forEach((scope, index) => {
  console.log(`${index + 1}. Scope: "${scope || '(empty)'}"`);
  const url = buildAuthUrl(scope);
  console.log(`   URL: ${url}\n`);
});

console.log('\nTo test these:');
console.log('1. Copy each URL and open in browser');
console.log('2. See which scope parameter works (no error)');
console.log('3. Update oauth-authorize.js with the working scope\n');
