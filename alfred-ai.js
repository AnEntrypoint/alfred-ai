#!/usr/bin/env node

/**
 * Alfred AI - A simplified, SDK-free version of codemode
 * Uses MCP client/server directly without the agent SDK
 * Automatically handles OAuth authentication for Claude Max subscriptions
 */

import { spawn, fork } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import * as fs from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import AuthManager from './auth-manager.js';

// Global configuration (loaded after classes are defined)
let config, mcpManager, historyManager, executionManager, authManager;

function loadConfig() {
  const configPath = join(process.cwd(), '.codemode.json');

  if (!existsSync(configPath)) {
    throw new Error(`BRUTAL ERROR: Config file not found at ${configPath} - Create .codemode.json in current working directory`);
  }

  try {
    const configData = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!configData.mcpServers) {
      throw new Error('BRUTAL ERROR: config.mcpServers is undefined');
    }
    return {
      config: configData,
      configDir: dirname(configPath)
    };
  } catch (error) {
    throw new Error(`BRUTAL ERROR: Failed to load config: ${error.message}`);
  }
}

// MCP Manager - handles direct MCP communication
class MCPManager extends EventEmitter {
  constructor() {
    super();
    this.servers = new Map();
    this.nextId = 0;
  }

  async initialize() {
    console.error('[MCP Manager] Initializing servers...');

    for (const [serverName, serverConfig] of Object.entries(config.config.mcpServers)) {
      if (serverName === 'alfred-ai') continue;

      try {
        await this.startServer(serverName, serverConfig);
      } catch (error) {
        console.error(`[MCP Manager] Failed to start ${serverName}:`, error.message);
      }
    }

    console.error('[MCP Manager] Initialization complete');
  }

  async startServer(serverName, serverConfig) {
    console.error(`[MCP Manager] Starting ${serverName}...`);

    // Resolve relative paths
    const resolvedArgs = serverConfig.args.map(arg => {
      if (arg.endsWith('.js') && !arg.startsWith('-') && !arg.startsWith('/')) {
        const resolved = join(config.configDir, arg);
        return resolved;
      }
      return arg;
    });

    const proc = spawn(serverConfig.command, resolvedArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    const serverState = {
      process: proc,
      tools: [],
      nextId: 0,
      buffer: '',
      pendingCalls: new Map()
    };

    this.servers.set(serverName, serverState);

    // Handle responses
    proc.stdout.on('data', (data) => {
      serverState.buffer += data.toString();
      const lines = serverState.buffer.split('\n');
      serverState.buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (serverState.pendingCalls.has(response.id)) {
              const { resolve, reject } = serverState.pendingCalls.get(response.id);
              serverState.pendingCalls.delete(response.id);

              if (response.error) {
                reject(new Error(response.error.message || 'MCP error'));
              } else {
                resolve(response.result);
              }
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[MCP Manager] ${serverName}:`, data.toString().trim());
    });

    proc.on('error', (err) => {
      console.error(`[MCP Manager] ${serverName} error:`, err.message);
    });

    proc.on('close', () => {
      console.error(`[MCP Manager] ${serverName} closed`);
      this.servers.delete(serverName);
    });

    // Initialize MCP connection
    await this.sendRequest(serverName, {
      jsonrpc: '2.0',
      id: serverState.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'alfred-ai', version: '1.0.0' }
      }
    });

    // Get tools list
    const toolsResult = await this.sendRequest(serverName, {
      jsonrpc: '2.0',
      id: serverState.nextId++,
      method: 'tools/list'
    });

    if (!toolsResult.tools) {
      throw new Error(`No tools received from ${serverName}`);
    }

    serverState.tools = toolsResult.tools;
    console.error(`[MCP Manager] ✓ ${serverName}: ${serverState.tools.length} tool(s)`);
  }

  async sendRequest(serverName, request) {
    const serverState = this.servers.get(serverName);
    if (!serverState) {
      throw new Error(`MCP server ${serverName} not found`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverState.pendingCalls.delete(request.id);
        reject(new Error(`MCP request timeout for ${serverName}`));
      }, 30000);

      serverState.pendingCalls.set(request.id, {
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });

      serverState.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async callTool(serverName, toolName, args) {
    const result = await this.sendRequest(serverName, {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    });

    // Store call in history for cleanup
    historyManager.recordMcpCall(serverName, toolName, args, result);

    const content = result.content;
    if (Array.isArray(content) && content[0]?.type === 'text') {
      return content[0].text;
    }
    return JSON.stringify(result);
  }

  getAllTools() {
    const allTools = {};
    for (const [serverName, serverState] of this.servers) {
      allTools[serverName] = serverState.tools;
    }
    return allTools;
  }

  shutdown() {
    for (const [serverName, serverState] of this.servers) {
      console.error(`[MCP Manager] Shutting down ${serverName}`);
      try {
        serverState.process.kill('SIGTERM');
      } catch (error) {
        // Ignore shutdown errors
      }
    }
    this.servers.clear();
  }
}

// History Manager - handles intelligent cleanup and compaction
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
    console.error('[Hooks] Initialized hooks:');
    for (const hook of this.hooks) {
      const preview = hook.output.substring(0, 100);
      console.error(`  - ${hook.name}: ${preview}${hook.output.length > 100 ? '...' : ''}`);
    }
  }

  recordMcpCall(serverName, toolName, args, result) {
    this.mcpCalls.push({
      serverName,
      toolName,
      args: this.compactData(args),
      result: this.compactData(result),
      timestamp: Date.now()
    });

    // Cleanup old MCP calls (keep only last 10)
    if (this.mcpCalls.length > 10) {
      const removed = this.mcpCalls.shift();
      this.tokenCount -= this.estimateTokens(removed);
    }

    this.updateTokenCount();
  }

  recordExecute(input, output) {
    this.executeInputs.push({
      data: input,
      timestamp: Date.now()
    });

    this.executeOutputs.push({
      data: output,
      timestamp: Date.now()
    });

    // Cleanup old execute inputs (keep only last 3)
    if (this.executeInputs.length > 3) {
      const removedInput = this.executeInputs.shift();
      this.tokenCount -= this.estimateTokens(removedInput);
    }

    if (this.executeOutputs.length > 3) {
      const removedOutput = this.executeOutputs.shift();
      this.tokenCount -= this.estimateTokens(removedOutput);
    }

    // Also clean up old hooks when cleaning up execution outputs
    if (this.executeOutputs.length > 3 && this.hooks.length > 0) {
      const removedHook = this.hooks.shift();
      this.tokenCount -= this.estimateTokens(removedHook);
    }

    this.updateTokenCount();
  }

  compactData(data) {
    // Create intelligent English summaries for older data
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
    // Create intelligent English summaries
    if (text.includes('Error:') || text.includes('error')) {
      return `Error message about ${text.substring(0, 50)}...`;
    }

    if (text.includes('console.log') || text.includes('print')) {
      return `Code execution output with ${text.split('\n').length} lines`;
    }

    if (text.includes('{') && text.includes('}')) {
      return `JSON data structure with ${Object.keys(JSON.parse(text) || {}).length} fields`;
    }

    return `Text content (${text.length} chars): ${text.substring(0, 100)}...`;
  }

  estimateTokens(data) {
    // Rough token estimation (1 token ≈ 4 characters)
    const text = JSON.stringify(data);
    return Math.ceil(text.length / 4);
  }

  updateTokenCount() {
    // Calculate total tokens from all stored data
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

    // If we exceed 60k tokens, perform aggressive cleanup
    if (this.tokenCount > 60000) {
      this.performAggressiveCleanup();
    }
  }

  performAggressiveCleanup() {
    console.error('[History Manager] Performing aggressive cleanup - exceeded 60k tokens');

    // Remove oldest 50% of MCP calls
    const callsToRemove = Math.floor(this.mcpCalls.length / 2);
    this.mcpCalls.splice(0, callsToRemove);

    // Remove oldest execute inputs/outputs and hooks together
    if (this.executeInputs.length > 1) {
      this.executeInputs.splice(0, Math.floor(this.executeInputs.length / 2));
    }

    if (this.executeOutputs.length > 1) {
      this.executeOutputs.splice(0, Math.floor(this.executeOutputs.length / 2));
    }

    // Remove hooks at same rate as execution outputs
    if (this.hooks.length > 1) {
      this.hooks.splice(0, Math.floor(this.hooks.length / 2));
    }

    // Compact remaining data aggressively
    this.mcpCalls = this.mcpCalls.map(call => ({
      ...call,
      args: this.compactData(call.args),
      result: this.compactData(call.result)
    }));

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

// Execution Manager - handles code execution without SDK
class ExecutionManager {
  constructor() {
    this.nextExecId = 0;
    this.runningExecutions = new Map();
    this.finalPromptCalled = false;
    this.eagerPrompts = [];
  }

  queueEagerPrompt(execId, message, logs) {
    const prompt = {
      execId,
      message,
      logs,
      timestamp: Date.now()
    };
    this.eagerPrompts.push(prompt);
    console.error(`[Eager Prompt Queued] ${execId}: ${message}`);
  }

  getQueuedPrompts() {
    const prompts = this.eagerPrompts;
    this.eagerPrompts = [];
    return prompts;
  }

  callFinalPrompt() {
    if (this.finalPromptCalled) {
      console.error('[Final Prompt] Already called - preventing infinite loop');
      return false;
    }
    this.finalPromptCalled = true;
    return true;
  }

  resetFinalPromptFlag() {
    this.finalPromptCalled = false;
  }

  async execute(args) {
    const { code, runtime, timeout = 10000 } = args;

    if (!code) {
      throw new Error('Code is required for execution');
    }

    if (!runtime) {
      throw new Error('Runtime parameter is required (nodejs, deno, bun, python, bash, go, rust, c, cpp)');
    }

    const execId = `exec_${this.nextExecId++}`;
    console.error(`[Execution Manager] Starting execution ${execId}`);

    try {
      const result = await this.executeCode(code, runtime, timeout, execId);

      // Store in history
      historyManager.recordExecute(
        { code: this.compactCode(code), runtime },
        { success: true, result: this.compactData(result) }
      );

      // End-of-execution notification
      console.error('\n' + '='.repeat(60));
      console.error('[EXECUTION COMPLETE] Success');
      console.error(`[EXECUTION COMPLETE] Execution ID: ${execId}`);
      console.error(`[EXECUTION COMPLETE] Runtime: ${runtime}`);
      console.error('[EXECUTION COMPLETE] Full output:');
      console.error(result);
      console.error('='.repeat(60) + '\n');

      return {
        success: true,
        result,
        execId
      };
    } catch (error) {
      // Store error in history
      historyManager.recordExecute(
        { code: this.compactCode(code), runtime },
        { success: false, error: error.message }
      );

      // End-of-execution notification with error
      console.error('\n' + '='.repeat(60));
      console.error('[EXECUTION FAILED] Error occurred');
      console.error(`[EXECUTION FAILED] Execution ID: ${execId}`);
      console.error(`[EXECUTION FAILED] Runtime: ${runtime}`);
      console.error('[EXECUTION FAILED] Full error output:');
      console.error(error.message);
      console.error('='.repeat(60) + '\n');

      return {
        success: false,
        error: error.message,
        execId
      };
    }
  }

  async executeCode(code, runtime, timeout, execId) {
    return new Promise((resolve, reject) => {
      let tempFile;
      const startTime = Date.now();
      let timeoutTriggered = false;
      let promiseResolved = false;
      let lastLogSize = 0;
      let accumulatedStdout = '';
      let accumulatedStderr = '';

      try {
        const extension = this.getFileExtension(runtime);
        tempFile = join(tmpdir(), `alfred-ai-${uuidv4()}${extension}`);

        fs.writeFileSync(tempFile, code);

        const command = this.getExecutionCommand(runtime, tempFile);

        console.error(`[execution] Spawning ${command.cmd} with args: ${JSON.stringify(command.args)}`);

        const child = spawn(command.cmd, command.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd()
        });

        console.error(`[child process hook] PID: ${child.pid}, Command: ${command.cmd}`);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          const output = data.toString();
          stdout += output;
          accumulatedStdout += output;
          console.error(`[stdout hook] Received ${output.length} bytes: ${output.substring(0, 100)}${output.length > 100 ? '...' : ''}`);
          process.stderr.write(output);
        });

        child.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          accumulatedStderr += output;
          console.error(`[stderr hook] Received ${output.length} bytes: ${output.substring(0, 100)}${output.length > 100 ? '...' : ''}`);
          process.stderr.write(output);
        });

        const timer = setTimeout(() => {
          timeoutTriggered = true;
          console.error(`[timeout] Execution timeout after ${timeout}ms - process continues in background (PID ${child.pid})`);

          // Immediately resolve the promise so agent can continue
          const logs = `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`;
          const timeoutMessage = `⏱️ Execution timeout after ${timeout}ms. Process (PID ${child.pid}) continues in background. Logs below. Updates every 60s.`;

          // Queue eager prompt for agent awareness
          this.queueEagerPrompt(execId, timeoutMessage, logs);

          // Resolve immediately with timeout message so agent can continue working
          if (!promiseResolved) {
            promiseResolved = true;
            resolve(`${timeoutMessage}\n\n${logs}\n\nTime: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
          }

          // Reset logs for background monitoring
          lastLogSize = 0;
          accumulatedStdout = '';
          accumulatedStderr = '';

          // Start 60-second notification timer for background execution
          const progressTimer = setInterval(() => {
            if (!child.exitCode && !child.killed) {
              const newLogs = `${accumulatedStdout}${accumulatedStderr ? '\nSTDERR:\n' + accumulatedStderr : ''}`;
              if (newLogs.length > lastLogSize) {
                this.queueEagerPrompt(
                  execId,
                  `📊 Background process (PID ${child.pid}) still running. New output received.`,
                  newLogs
                );
                lastLogSize = newLogs.length;
                accumulatedStdout = '';
                accumulatedStderr = '';
              }
            } else {
              clearInterval(progressTimer);
              // Final notification when process completes
              this.queueEagerPrompt(
                execId,
                `✅ Background process (PID ${child.pid}) completed.`,
                `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`
              );
            }
          }, 60000);

          // Store timer for cleanup
          child._progressTimer = progressTimer;

          // Don't kill process - let it continue running in background
          // User instructions: "watch and kill it" - process continues until completion
        }, timeout);

        child.on('close', (code) => {
          clearTimeout(timer);
          if (child._progressTimer) {
            clearInterval(child._progressTimer);
          }

          const endTime = Date.now();
          const duration = endTime - startTime;
          const seconds = (duration / 1000).toFixed(2);
          const minutes = (duration / 60000).toFixed(2);
          const timeDisplay = duration > 60000 ? `${minutes}min` : `${seconds}s`;

          console.error(`[close hook] Process exited with code: ${code}`);
          console.error(`[close hook] Final stdout length: ${stdout.length}, stderr length: ${stderr.length}`);
          console.error(`[execution complete] Time: ${timeDisplay}`);

          // Cleanup temp file
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // Ignore cleanup errors
          }

          const result = stdout || (stderr ? `Warning: ${stderr}` : 'Execution completed successfully');
          const resultWithTiming = `${result}\n\nTime: ${timeDisplay}`;

          // If timeout was triggered, hand over final logs via eager prompt
          if (timeoutTriggered) {
            console.error(`[process end] Final logs being handed to agent`);
            this.queueEagerPrompt(
              execId,
              `✅ Background process (PID ${child.pid}) completed with exit code ${code}. Final logs below.`,
              `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`
            );
            // Don't resolve again - timeout already resolved the promise
            return;
          }

          // Only resolve if not already resolved by timeout
          if (!promiseResolved) {
            promiseResolved = true;
            if (code === 0) {
              resolve(resultWithTiming);
            } else {
              reject(new Error(`Execution failed with code ${code}: ${stderr || stdout}\n\nTime: ${timeDisplay}`));
            }
          }
        });

        child.on('error', (error) => {
          clearTimeout(timer);
          if (child._progressTimer) {
            clearInterval(child._progressTimer);
          }

          // Cleanup temp file
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // Ignore cleanup errors
          }

          reject(error);
        });

      } catch (error) {
        // Cleanup temp file if it exists
        if (tempFile) {
          try {
            unlinkSync(tempFile);
          } catch (e) {
            // Ignore cleanup errors
          }
        }

        reject(error);
      }
    });
  }

  getFileExtension(runtime) {
    switch (runtime) {
      case 'nodejs':
        return '.js';
      case 'deno':
        return '.ts';
      case 'bun':
        return '.js';
      case 'python':
        return '.py';
      case 'bash':
        return '.sh';
      case 'go':
        return '.go';
      case 'rust':
        return '.rs';
      case 'c':
        return '.c';
      case 'cpp':
        return '.cpp';
      default:
        throw new Error(`Invalid runtime: ${runtime}`);
    }
  }

  getExecutionCommand(runtime, filepath) {
    switch (runtime) {
      case 'nodejs':
        return { cmd: 'node', args: [filepath] };
      case 'deno':
        return { cmd: 'deno', args: ['run', filepath] };
      case 'bun':
        return { cmd: 'bun', args: ['run', filepath] };
      case 'python':
        return { cmd: 'python3', args: [filepath] };
      case 'bash':
        return { cmd: 'bash', args: [filepath] };
      case 'go':
        return { cmd: 'go', args: ['run', filepath] };
      case 'rust':
        return { cmd: 'rustc', args: [filepath, '-o', filepath.replace('.rs', '')] };
      case 'c':
        const execFile = filepath.replace('.c', '');
        return { cmd: 'bash', args: ['-c', `gcc "${filepath}" -o "${execFile}" && "${execFile}"`] };
      case 'cpp':
        const cppExecFile = filepath.replace('.cpp', '');
        return { cmd: 'bash', args: ['-c', `g++ "${filepath}" -o "${cppExecFile}" && "${cppExecFile}"`] };
      default:
        throw new Error(`Invalid runtime: ${runtime}`);
    }
  }

  compactCode(code) {
    // Create summary of code for history
    if (code.length > 200) {
      const lines = code.split('\n').length;
      const language = this.detectLanguage(code);
      return `${language} code (${lines} lines): ${code.substring(0, 100)}...`;
    }
    return code;
  }

  compactData(data) {
    return historyManager.compactData(data);
  }

  detectLanguage(code) {
    if (code.includes('def ') || code.includes('import ')) return 'Python';
    if (code.includes('function ') || code.includes('const ')) return 'JavaScript';
    if (code.includes('package main')) return 'Go';
    if (code.includes('fn main()')) return 'Rust';
    if (code.includes('#include')) return 'C/C++';
    if (code.includes('#!/bin/bash')) return 'Bash';
    return 'Unknown';
  }

  kill(execId) {
    const execution = this.runningExecutions.get(execId);
    if (execution) {
      execution.process.kill('SIGKILL');
      this.runningExecutions.delete(execId);
      return { success: true, message: `Execution ${execId} killed` };
    }
    return { success: false, message: `Execution ${execId} not found` };
  }
}

// MCP Server implementation
class AlfredMCPServer {
  constructor() {
    this.handlers = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    // Handle tools/list
    this.handlers.set('tools/list', async (request) => {
      const allTools = mcpManager.getAllTools();
      const tools = [];

      // Add execute tool
      tools.push({
        name: 'execute',
        description: 'Execute code in the specified runtime',
        input_schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Code to execute'
            },
            runtime: {
              type: 'string',
              enum: ['nodejs', 'deno', 'bun', 'python', 'bash', 'go', 'rust', 'c', 'cpp'],
              description: 'Runtime to execute the code in'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 240000)',
              default: 240000
            }
          },
          required: ['code', 'runtime']
        }
      });

      // Add tools from all MCP servers
      for (const [serverName, serverTools] of Object.entries(allTools)) {
        for (const tool of serverTools) {
          tools.push({
            name: `${serverName}_${tool.name}`,
            description: `[${serverName}] ${tool.description}`,
            input_schema: tool.input_schema || tool.inputSchema
          });
        }
      }

      // Add management tools
      tools.push({
        name: 'alfred_status',
        description: 'Get Alfred AI system status and history summary',
        input_schema: {
          type: 'object',
          properties: {}
        }
      });

      tools.push({
        name: 'alfred_kill',
        description: 'Kill a running execution',
        input_schema: {
          type: 'object',
          properties: {
            execId: {
              type: 'string',
              description: 'Execution ID to kill'
            }
          },
          required: ['execId']
        }
      });

      tools.push({
        name: 'alfred',
        description: 'Run Alfred AI agent with full agentic capabilities to accomplish complex tasks. Alfred can use all available tools in an autonomous loop to complete your request.',
        input_schema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The task or request for Alfred to accomplish'
            }
          },
          required: ['prompt']
        }
      });

      return { tools };
    });

    // Handle tools/call
    this.handlers.set('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'execute') {
          return await this.handleExecute(args);
        } else if (name === 'alfred_status') {
          return await this.handleStatus();
        } else if (name === 'alfred_kill') {
          return await this.handleKill(args);
        } else if (name === 'alfred') {
          return await this.handleAlfred(args);
        } else if (name.includes('_')) {
          // Handle delegated MCP tools
          const [serverName, toolName] = name.split('_');
          const result = await mcpManager.callTool(serverName, toolName, args);
          return {
            content: [{ type: 'text', text: result }]
          };
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        // Return MCP error response for tool errors
        throw error; // Let the MCP handler format this as a proper error
      }
    });
  }

  async handleExecute(args) {
    // Validate parameters according to the schema - let validation errors bubble up
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: arguments must be an object');
    }

    // Check for required 'code' parameter
    if (args.code === undefined || args.code === null || typeof args.code !== 'string') {
      throw new Error('Invalid arguments: "code" parameter is required and must be a string');
    }

    // Check for required 'runtime' parameter
    if (args.runtime === undefined || args.runtime === null || typeof args.runtime !== 'string') {
      throw new Error('Invalid arguments: "runtime" parameter is required and must be a string');
    }

    // Handle empty code as a special case - return error response but don't throw
    if (args.code.trim() === '') {
      return {
        content: [{
          type: 'text',
          text: 'Execution failed: No code to execute'
        }],
        isError: true
      };
    }

    // Check for allowed parameters
    const allowedParams = ['code', 'runtime', 'timeout'];
    const providedParams = Object.keys(args);
    const invalidParams = providedParams.filter(param => !allowedParams.includes(param));

    if (invalidParams.length > 0) {
      throw new Error(`Invalid arguments: unknown parameter(s): ${invalidParams.join(', ')}`);
    }

    // Validate runtime
    if (!['nodejs', 'deno', 'bun', 'python', 'bash', 'go', 'rust', 'c', 'cpp'].includes(args.runtime)) {
      throw new Error(`Invalid arguments: "runtime" must be one of: nodejs, deno, bun, python, bash, go, rust, c, cpp`);
    }

    // Validate timeout if provided
    if (args.timeout && (typeof args.timeout !== 'number' || args.timeout <= 0)) {
      throw new Error('Invalid arguments: "timeout" must be a positive number');
    }

    // Only catch execution errors, not validation errors
    try {
      const result = await executionManager.execute(args);

      return {
        content: [{
          type: 'text',
          text: result.success
            ? `Execution completed successfully:\n${result.result}`
            : `Execution failed: ${result.error}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Execution error: ${error.message}`
        }]
      };
    }
  }

  async handleStatus() {
    const historySummary = historyManager.getSummary();
    const allTools = mcpManager.getAllTools();
    const totalTools = Object.values(allTools).reduce((sum, tools) => sum + tools.length, 0) + 3; // +3 for alfred tools

    return {
      content: [{
        type: 'text',
        text: `Alfred AI System Status:
- MCP Servers: ${Object.keys(allTools).length}
- Total Tools Available: ${totalTools}
- History: ${historySummary.mcpCalls} MCP calls, ${historySummary.executeInputs} executions
- Estimated Tokens Used: ${historySummary.estimatedTokens}/60000

Active MCP Servers:
${Object.keys(allTools).map(name => `  - ${name}: ${allTools[name].length} tools`).join('\n')}

Available Tools:
  - execute: Execute code with automatic runtime detection
  - alfred_status: Show this status
  - alfred_kill: Kill running executions
  - ${Object.entries(allTools).map(([server, tools]) =>
    tools.map(tool => `  - ${server}_${tool.name}: ${tool.description}`).join('\n')
  ).join('\n')}`
      }]
    };
  }

  async handleKill(args) {
    try {
      const result = executionManager.kill(args.execId);
      return {
        content: [{
          type: 'text',
          text: result.message
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async handleAlfred(args) {
    try {
      const { prompt } = args;
      if (!prompt) {
        throw new Error('prompt parameter is required');
      }

      const apiKey = authManager.getApiKey();
      if (!apiKey) {
        throw new Error('No API key available for Alfred agent');
      }

      // Exclude alfred tool to prevent recursion
      // Keep verbose=true for nested calls to maintain observability
      const output = await runAgenticLoop(prompt, this, apiKey, true, true);

      return {
        content: [{
          type: 'text',
          text: output || 'Alfred completed the task successfully.'
        }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Alfred Error: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async handleRequest(request) {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      throw new Error(`Unknown method: ${request.method}`);
    }

    return await handler(request);
  }
}

// Initialize hooks
async function initializeHooks() {
  console.error('[Hooks] Initializing system hooks...');

  // Get the actual working directory where the command was invoked
  // This ensures hooks run in the user's directory, not the npm/npx cache
  const hookWorkingDir = process.cwd();
  console.error(`[Hooks] Running hooks in working directory: ${hookWorkingDir}`);

  // Hook 1: Thorns hook
  try {
    const thornsOutput = await new Promise((resolve, reject) => {
      let output = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Thorns hook timeout'));
      }, 10000);

      const child = spawn('npx', ['-y', 'mcp-thorns@latest'], {
        cwd: hookWorkingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && output.trim()) {
          console.error('[Hooks] Thorns hook output:', output.substring(0, 50));
          resolve(output.trim());
        } else {
          reject(new Error(`Thorns hook failed with code ${code}. stderr: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    historyManager.addHook('thorns', thornsOutput);
    console.error('[Hooks] ✓ Thorns hook loaded');
  } catch (error) {
    console.error('[Hooks] ✗ Thorns hook failed:', error.message);
  }

  // Hook 2: Prompt hook (START_MD from remote)
  try {
    const promptOutput = await new Promise((resolve, reject) => {
      let output = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Prompt hook timeout'));
      }, 10000);

      const child = spawn('curl', ['-s', 'https://raw.githubusercontent.com/AnEntrypoint/glootie-cc/refs/heads/master/start.md'], {
        cwd: hookWorkingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && output.trim()) {
          console.error('[Hooks] Prompt hook output:', output.substring(0, 50));
          resolve(output.trim());
        } else {
          reject(new Error(`Prompt hook failed with code ${code}. stderr: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    historyManager.addHook('prompt', promptOutput);
    console.error('[Hooks] ✓ Prompt hook loaded');
  } catch (error) {
    console.error('[Hooks] ✗ Prompt hook failed:', error.message);
  }

  // Hook 3: WFGY hook
  try {
    const wfgyOutput = await new Promise((resolve, reject) => {
      let output = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('WFGY hook timeout'));
      }, 10000);

      const child = spawn('npx', ['-y', 'wfgy@latest', 'hook'], {
        cwd: hookWorkingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && output.trim()) {
          console.error('[Hooks] WFGY hook output:', output.substring(0, 50));
          resolve(output.trim());
        } else {
          reject(new Error(`WFGY hook failed with code ${code}. stderr: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    historyManager.addHook('wfgy', wfgyOutput);
    console.error('[Hooks] ✓ WFGY hook loaded');
  } catch (error) {
    console.error('[Hooks] ✗ WFGY hook failed:', error.message);
  }

  // Log all hooks that were successfully loaded
  historyManager.logHooks();
}

// Main server loop
async function main() {
  console.error('Alfred AI - Simplified CodeMode with OAuth starting...');

  // Initialize authentication first
  authManager = new AuthManager();

  try {
    await authManager.initialize();
  } catch (err) {
    console.error('Fatal: Authentication initialization failed');
    process.exit(1);
  }

  // Initialize global state
  config = loadConfig();
  mcpManager = new MCPManager();
  historyManager = new HistoryManager();
  executionManager = new ExecutionManager();

  console.error('Config loaded from:', join(process.cwd(), '.codemode.json'));

  const authInfo = authManager.getAuthInfo();
  console.error(`Authentication: ${authInfo.type} - ${authInfo.status}`);
  if (authInfo.creditsReset) {
    console.error(`Credits: ${authInfo.creditsReset}`);
  }

  // Initialize hooks
  await initializeHooks();

  const mcpServer = new AlfredMCPServer();

  // Initialize MCP manager
  await mcpManager.initialize();

  // Initialize execution manager
  executionManager.mcpManager = mcpManager;

  console.error('Alfred AI ready - Accepting MCP requests via stdio');

  // Handle stdio communication
  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', async (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const request = JSON.parse(line);
          const response = {
            jsonrpc: '2.0',
            id: request.id
          };

          try {
            response.result = await mcpServer.handleRequest(request);
          } catch (error) {
            response.error = {
              code: -32603,
              message: error.message
            };
          }

          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
          console.error('Failed to parse request:', error.message);
        }
      }
    }
  });

  process.on('SIGINT', () => {
    console.error('\nAlfred AI shutting down...');
    mcpManager.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('\nAlfred AI shutting down...');
    mcpManager.shutdown();
    process.exit(0);
  });
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  mcpManager.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Shared agentic loop function
async function runAgenticLoop(taskPrompt, mcpServer, apiKey, verbose = true, excludeAlfred = false) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  // Get all available tools
  const toolsResult = await mcpServer.handleRequest({
    method: 'tools/list',
    params: {}
  });

  // Filter out alfred tool if excluded (prevents recursion)
  if (excludeAlfred) {
    toolsResult.tools = toolsResult.tools.filter(t => t.name !== 'alfred');
  }

  const anthropic = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL
  });

  const messages = [{
    role: 'user',
    content: taskPrompt
  }];

  if (verbose) console.error('\n🤖 Agent starting...\n');

  let output = '';

  // Run agentic loop
  let continueLoop = true;
  while (continueLoop) {
    const stream = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      tools: toolsResult.tools,
      messages,
      stream: true
    });

    let currentText = '';
    let currentThinking = false;
    const assistantContent = [];
    let hasToolUse = false;
    let stop_reason = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          currentThinking = true;
          if (verbose) console.error(`\n💭 Thought:`);
        } else if (event.content_block.type === 'tool_use') {
          hasToolUse = true;
          if (verbose) console.error(`\n🔧 Tool: ${event.content_block.name}`);
          assistantContent.push({
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: {}
          });
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          // Stream text output
          const text = event.delta.text;
          currentText += text;
          if (verbose) process.stderr.write(text);
          output += text;
        } else if (event.delta.type === 'input_json_delta') {
          // Accumulate tool input
          const lastTool = assistantContent[assistantContent.length - 1];
          if (lastTool && lastTool.type === 'tool_use') {
            lastTool.input_json = (lastTool.input_json || '') + event.delta.partial_json;
          }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentThinking) {
          if (verbose) console.error(''); // newline after streaming text
          assistantContent.push({ type: 'text', text: currentText });
          currentText = '';
          currentThinking = false;
        } else {
          // Finalize tool input
          const lastTool = assistantContent[assistantContent.length - 1];
          if (lastTool && lastTool.type === 'tool_use' && lastTool.input_json) {
            lastTool.input = JSON.parse(lastTool.input_json);
            delete lastTool.input_json;
          }
        }
      } else if (event.type === 'message_delta') {
        stop_reason = event.delta.stop_reason || stop_reason;
      }
    }

    messages.push({
      role: 'assistant',
      content: assistantContent
    });

    // Process tool uses
    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        // Log tool input
        if (verbose && block.input && Object.keys(block.input).length > 0) {
          console.error(`📥 Input:`);
          for (const [key, value] of Object.entries(block.input)) {
            if (typeof value === 'string' && value.length > 200) {
              console.error(`  ${key}: ${value.substring(0, 200)}...`);
            } else {
              console.error(`  ${key}: ${JSON.stringify(value)}`);
            }
          }
        }

        try {
          const result = await mcpServer.handleRequest({
            method: 'tools/call',
            params: {
              name: block.name,
              arguments: block.input
            }
          });

          // Log tool output
          if (verbose && result.content) {
            console.error(`📤 Output:`);
            for (const contentBlock of result.content) {
              if (contentBlock.type === 'text') {
                const text = contentBlock.text;
                if (text.length > 500) {
                  console.error(`  ${text.substring(0, 500)}...`);
                } else {
                  console.error(`  ${text}`);
                }
              }
            }
          }

          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result.content)
            }]
          });
        } catch (error) {
          if (verbose) console.error(`❌ Tool error: ${error.message}`);
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: error.message }),
              is_error: true
            }]
          });
        }
      }
    }

    continueLoop = hasToolUse && stop_reason === 'tool_use';
  }

  return output;
}

// CLI Agent mode - run Anthropic AI agent with the task
async function runCLIMode(taskPrompt) {
  console.error('Alfred AI - CLI Mode');
  console.error('Task:', taskPrompt);

  // Initialize authentication
  authManager = new AuthManager();
  try {
    await authManager.initialize();
  } catch (err) {
    console.error('Fatal: Authentication initialization failed');
    process.exit(1);
  }

  const authInfo = authManager.getAuthInfo();
  console.error(`Authentication: ${authInfo.type} - ${authInfo.status}`);

  const apiKey = authManager.getApiKey();
  if (!apiKey) {
    console.error('Fatal: No API key available');
    process.exit(1);
  }

  // Initialize config for MCP servers
  try {
    config = loadConfig();
  } catch (err) {
    // If no config, create minimal config
    config = { config: { mcpServers: {} }, configDir: process.cwd() };
  }

  mcpManager = new MCPManager();
  historyManager = new HistoryManager();
  executionManager = new ExecutionManager();

  // Initialize hooks
  await initializeHooks();

  const mcpServer = new AlfredMCPServer();
  await mcpManager.initialize();
  executionManager.mcpManager = mcpManager;

  await runAgenticLoop(taskPrompt, mcpServer, apiKey, true);

  console.error('\n✅ Task completed\n');
  mcpManager.shutdown();
  process.exit(0);
}

// Start the server or CLI
// Check if this file is being run directly (not imported as a module)
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (
  resolve(process.argv[1]) === __filename ||
  process.argv[1].endsWith('alfred-ai.js') ||
  process.argv[1].endsWith('alfred-ai')
);

if (isMainModule) {
  const args = process.argv.slice(2);

  // Check for CLI mode: any argument that's not 'mcp'
  if (args.length > 0 && args[0] !== 'mcp') {
    const taskPrompt = args.join(' ');
    runCLIMode(taskPrompt).catch(error => {
      console.error('Failed to run CLI mode:', error);
      process.exit(1);
    });
  } else {
    // MCP server mode
    main().catch(error => {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    });
  }
}

export { AlfredMCPServer, MCPManager, HistoryManager, ExecutionManager };