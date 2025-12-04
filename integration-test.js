#!/usr/bin/env node

import AuthManager from './auth-manager.js';
import SystemPromptBuilder from './system-prompt-builder.js';
import LLMProvider from './llm-provider.js';

async function testIntegration() {
  console.log('🧪 Alfred AI Integration Test\n');

  try {
    console.log('1️⃣  Testing AuthManager...');
    const authManager = new AuthManager();
    await authManager.initialize();
    console.log('   ✓ AuthManager initialized\n');

    console.log('2️⃣  Testing SystemPromptBuilder...');
    const mockTools = [
      { name: 'Edit', description: 'Edit files' },
      { name: 'Glob', description: 'Find files' },
      { name: 'Execute', description: 'Execute code' }
    ];
    const mcpDocs = SystemPromptBuilder.extractMCPToolDocs(mockTools);
    const systemPrompt = SystemPromptBuilder.buildCodeExecutionPrompt(mockTools, mcpDocs);
    console.log(`   ✓ System prompt generated (${systemPrompt.length} chars)\n`);

    console.log('3️⃣  Testing LLMProvider...');
    const llmProvider = new LLMProvider(authManager);
    console.log(`   ✓ LLM Provider initialized`);
    console.log(`   ✓ Model: ${llmProvider.getModel()}`);
    console.log(`   ✓ Max Tokens: ${llmProvider.getMaxTokens()}\n`);

    console.log('4️⃣  Testing auth methods...');
    console.log(`   ✓ isApiKey(): ${authManager.isApiKey()}`);
    console.log(`   ✓ isOAuth(): ${authManager.isOAuth()}\n`);

    console.log('✅ All integration tests passed!\n');
    console.log('System Features:');
    console.log('  • OAuth authentication with caching');
    console.log('  • API key fallback');
    console.log('  • System prompt with MCP documentation');
    console.log('  • Code-based execution model');
    console.log('  • LLM provider abstraction (Vercel SDK compatible)');

  } catch (error) {
    console.error(`\n❌ Integration test failed: ${error.message}\n`);
    process.exit(1);
  }
}

testIntegration();
