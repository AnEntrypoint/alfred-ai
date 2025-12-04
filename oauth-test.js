#!/usr/bin/env node

import AuthManager from './auth-manager.js';

async function testOAuthIntegration() {
  console.log('🔑 OAuth Authentication Test\n');

  const authManager = new AuthManager();

  console.log('Testing authentication detection:\n');

  try {
    await authManager.initialize();

    const authInfo = authManager.getAuthInfo();
    console.log(`✅ Authentication Type: ${authInfo.type}`);
    console.log(`✅ Status: ${authInfo.status}\n`);

    const authData = authManager.getAuthData();
    console.log('Authentication Data:');
    console.log(`  - Type: ${authData.type}`);
    console.log(`  - Has API Key: ${!!authData.apiKey}`);
    console.log(`  - Has OAuth Token: ${!!authData.oauthToken}\n`);

    console.log('OAuth Utilities:');
    console.log(`  - isOAuth(): ${authManager.isOAuth()}`);
    console.log(`  - isApiKey(): ${authManager.isApiKey()}\n`);

    if (authManager.isOAuth()) {
      console.log('🔐 OAuth Token Caching:');
      authManager.cacheOAuthToken(authManager.getOAuthToken());
      console.log('  ✓ Token cached successfully\n');
    }

    console.log('✅ All authentication checks passed!');
  } catch (error) {
    console.error(`❌ Authentication failed: ${error.message}\n`);
    console.error('To test OAuth, set:');
    console.error('  export ANTHROPIC_OAUTH_TOKEN=your-oauth-token');
    console.error('\nOr use API key authentication:');
    console.error('  export ANTHROPIC_API_KEY=your-api-key\n');
    process.exit(1);
  }
}

testOAuthIntegration();
