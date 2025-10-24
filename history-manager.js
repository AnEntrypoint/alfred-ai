#!/usr/bin/env node



import { spawn, fork } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'fs';
import * as fs from 'fs';
import { join, resolve, dirname } from 'path';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'readline';
import AuthManager from './auth-manager.js';


let config, mcpManager, historyManager, executionManager, authManager;



class HistoryManager {
  constructor() {
    this.mcpCalls = [];
    this.executeInputs = [];
    this.executeOutputs = [];
    this.hooks = [];
    this.tokenCount = 0;
  }

  addHook(hookName, hookOutput) {
    this.hooks.push({
      name: hookName,
      output: hookOutput,
      timestamp: Date.now()
    });
    console.error(`[Hook] ${hookName} added to history`);
    this.updateTokenCount();
  }

  logHooks() {
    if (this.hooks.length === 0) {
      console.error('[Hooks] No hooks initialized');
      return;
    }
    console.error(`[Hooks] Initialized ${this.hooks.length} hooks: ${this.hooks.map(h => h.name).join(', ')}`);
  }

  recordMcpCall(serverName, toolName, args, result) {
    this.mcpCalls.push({
      serverName,
      toolName,
      args: this.compactData(args),
      result: this.compactData(result),
      timestamp: Date.now()
    });

    if (this.mcpCalls.length > 10) {
      const removed = this.mcpCalls.shift();
      this.tokenCount -= this.estimateTokens(removed);
    }

    this.updateTokenCount();
  }

  recordExecute(input, output) {
    const inputRecord = {
      data: input,
      timestamp: Date.now(),
      isSummary: false,
      summarized: false
    };

    const outputRecord = {
      data: output,
      timestamp: Date.now(),
      isSummary: false,
      summarized: false
    };

    this.executeInputs.push(inputRecord);
    this.executeOutputs.push(outputRecord);

    if (this.executeInputs.length > 80) {
      this.executeInputs.shift();
    }
    if (this.executeOutputs.length > 80) {
      this.executeOutputs.shift();
    }

    this.updateTokenCount();

    this.scheduleAsyncSummarization();
  }

  scheduleAsyncSummarization() {
    if (this.executeInputs.length > 3) {
      const toSummarize = this.executeInputs.slice(0, -3);
      for (let i = 0; i < toSummarize.length; i++) {
        const record = toSummarize[i];
        if (!record.summarized && !record.isSummary) {
          record.summarized = true;
          this.summarizeExecutionRecord(record, 'input');
        }
      }
    }

    if (this.executeOutputs.length > 10) {
      const toSummarize = this.executeOutputs.slice(0, -10);
      for (let i = 0; i < toSummarize.length; i++) {
        const record = toSummarize[i];
        if (!record.summarized && !record.isSummary) {
          record.summarized = true;
          this.summarizeExecutionRecord(record, 'output');
        }
      }
    }
  }

  async summarizeExecutionRecord(record, type) {
    try {
      const dataStr = JSON.stringify(record.data);

      if (dataStr.length < 100) {
        return;
      }

      const summaryPrompt = type === 'input'
        ? `Summarize this code execution input in 1-2 sentences:\n${dataStr.substring(0, 2000)}`
        : `Summarize this code execution output in 1-2 sentences:\n${dataStr.substring(0, 2000)}`;

      const summary = this.createSummary(dataStr);

      record.data = summary;
      record.isSummary = true;

      this.updateTokenCount();
    } catch (error) {
    }
  }

  compactData(data) {
    if (typeof data === 'string') {
      if (data.length > 500) {
        return this.createSummary(data);
      }
      return data;
    }

    if (typeof data === 'object' && data !== null) {
      const compacted = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 200) {
          compacted[key] = this.createSummary(value);
        } else {
          compacted[key] = value;
        }
      }
      return compacted;
    }

    return data;
  }

  createSummary(text) {
    return text.substring(0, 500);
  }

  estimateTokens(data) {
    return JSON.stringify(data).length;
  }

  updateTokenCount() {
    let totalTokens = 0;

    for (const call of this.mcpCalls) {
      totalTokens += this.estimateTokens(call);
    }

    for (const input of this.executeInputs) {
      totalTokens += this.estimateTokens(input);
    }

    for (const output of this.executeOutputs) {
      totalTokens += this.estimateTokens(output);
    }

    for (const hook of this.hooks) {
      totalTokens += this.estimateTokens(hook);
    }

    this.tokenCount = totalTokens;
  }

  performCleanup() {

    const currentMcpCount = this.mcpCalls.length;

    if (currentMcpCount > 10) {
      const toRemove = currentMcpCount - 10;
      this.mcpCalls.splice(0, toRemove);
    }

    this.updateTokenCount();
  }

  getSummary() {
    return {
      mcpCalls: this.mcpCalls.length,
      executeInputs: this.executeInputs.length,
      executeOutputs: this.executeOutputs.length,
      estimatedTokens: this.tokenCount
    };
  }
}


export default HistoryManager;