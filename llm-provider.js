#!/usr/bin/env node

import Anthropic from '@anthropic-ai/sdk';

let vercelAIAvailable = false;
try {
  const vercelAI = await import('ai');
  vercelAIAvailable = !!vercelAI.generateText;
} catch (e) {
  // Vercel AI SDK not available, will use Anthropic SDK directly
}

export class LLMProvider {
  constructor(authManager) {
    this.authManager = authManager;
    this.vercelAIAvailable = vercelAIAvailable;
    this.anthropic = this.initializeAnthropic();
  }

  initializeAnthropic() {
    if (this.authManager.isApiKey()) {
      return new Anthropic({
        apiKey: this.authManager.getApiKey(),
        baseURL: process.env.ANTHROPIC_BASE_URL
      });
    }

    if (this.authManager.isOAuth()) {
      return new Anthropic({
        apiKey: this.authManager.getOAuthToken(),
        baseURL: process.env.ANTHROPIC_BASE_URL,
        defaultHeaders: {
          'Authorization': `Bearer ${this.authManager.getOAuthToken()}`
        }
      });
    }

    throw new Error('No authentication configured');
  }

  async createMessage(request) {
    return this.anthropic.messages.create(request);
  }

  async streamMessage(request) {
    return this.anthropic.messages.create({
      ...request,
      stream: true
    });
  }

  getModel() {
    return process.env.ALFRED_MODEL || 'claude-opus-4-20250805';
  }

  getMaxTokens() {
    return parseInt(process.env.ALFRED_MAX_TOKENS || '8000', 10);
  }

  async createCompletion(messages, system, tools) {
    return this.createMessage({
      model: this.getModel(),
      max_tokens: this.getMaxTokens(),
      system,
      messages,
      tools
    });
  }

  async streamCompletion(messages, system, tools) {
    return this.streamMessage({
      model: this.getModel(),
      max_tokens: this.getMaxTokens(),
      system,
      messages,
      tools
    });
  }
}

export default LLMProvider;
