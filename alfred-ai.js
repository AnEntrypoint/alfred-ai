#!/usr/bin/env node

/**
 * Alfred AI - A simplified, SDK-free version of codemode
 * Uses MCP client/server directly without the agent SDK
 * Automatically handles OAuth authentication for Claude Max subscriptions
 */

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

// Global configuration (loaded after classes are defined)
let config, mcpManager, historyManager, executionManager, authManager;

// Capture original working directory at startup (before any changes)
const ORIGINAL_CWD = process.cwd();

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
      cwd: ORIGINAL_CWD
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
    if (serverState.tools.length > 0) {
      for (const tool of serverState.tools) {
        console.error(`  - ${tool.name}`);
      }
    }
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

  // Handle tool call from JSON-RPC (used by execute environment)
  async handleToolCall(toolName, args) {
    // Parse tool name to find server (format: mcp__servername__toolname or just toolname for builtInTools)
    let serverName, actualToolName;

    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      serverName = parts[1];
      actualToolName = parts[2];
    } else {
      // Built-in tools don't have mcp__ prefix
      serverName = 'builtInTools';
      actualToolName = toolName;
    }

    // Call the tool via sendRequest
    return await this.sendRequest(serverName, {
      method: 'tools/call',
      params: {
        name: actualToolName,
        arguments: args
      }
    });
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
      try {
        const parsed = JSON.parse(text);
        return `JSON data structure with ${Object.keys(parsed || {}).length} fields`;
      } catch (e) {
        // Not valid JSON, continue to default summary
      }
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
  }

  performCleanup() {
    // Cleanup runs once per LLM call to remove items older than 10 steps
    // Keep MCP calls (max 10) - natural limit from recordMcpCall
    // Keep execute inputs/outputs (max 3 each) - natural limit from recordExecute
    // Keep hooks (max 3) - naturally cleaned with execute outputs

    const currentMcpCount = this.mcpCalls.length;
    const currentInputCount = this.executeInputs.length;
    const currentOutputCount = this.executeOutputs.length;
    const currentHookCount = this.hooks.length;

    if (currentMcpCount > 10) {
      const toRemove = currentMcpCount - 10;
      this.mcpCalls.splice(0, toRemove);
      console.error(`[History Manager] Cleaned up ${toRemove} old MCP calls`);
    }

    if (currentInputCount > 3) {
      const toRemove = currentInputCount - 3;
      this.executeInputs.splice(0, toRemove);
      console.error(`[History Manager] Cleaned up ${toRemove} old execute inputs`);
    }

    if (currentOutputCount > 3) {
      const toRemove = currentOutputCount - 3;
      this.executeOutputs.splice(0, toRemove);
      console.error(`[History Manager] Cleaned up ${toRemove} old execute outputs`);
    }

    if (currentHookCount > 3) {
      const toRemove = currentHookCount - 3;
      this.hooks.splice(0, toRemove);
      console.error(`[History Manager] Cleaned up ${toRemove} old hooks`);
    }

    // Recalculate tokens after cleanup
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

  getTodoStatus() {
    // Get todo status from historyManager if available
    if (typeof historyManager !== 'undefined' && historyManager.getTodos) {
      try {
        const todos = historyManager.getTodos();
        if (!Array.isArray(todos)) {
          throw new Error(`Expected getTodos() to return array, got ${typeof todos}`);
        }
        return todos;
      } catch (e) {
        console.error(`❌ Error retrieving todos from history: ${e.message}`);
        throw e; // Re-throw so caller knows there was an error
      }
    }
    // No todo tracking available
    return [];
  }

  async execute(args) {
    const { code, runtime, timeout = 10000 } = args;

    if (!code) {
      throw new Error('Code is required for execution');
    }

    if (!runtime) {
      throw new Error('Runtime parameter is required (nodejs, deno, bun, python, bash, go, rust, c, cpp)');
    }

    // Reject executions that attempt to use pkill
    if (code.includes('pkill')) {
      throw new Error('Execution rejected: pkill command is not allowed');
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

        // Copy MCP helper module to temp directory for access by executed code
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const helperSource = join(__dirname, 'mcp-runtime-helpers.cjs');
        const helperDest = join(tmpdir(), 'mcp-runtime-helpers.cjs');
        try {
          copyFileSync(helperSource, helperDest);
        } catch (e) {
          console.error('[execution] Warning: Could not copy MCP helper module:', e.message);
        }

        const command = this.getExecutionCommand(runtime, tempFile);

        console.error(`[execution] Spawning ${command.cmd} with args: ${JSON.stringify(command.args, null, 2)}`);

        // Pass MCP tools information to execution environment
        const childEnv = {
          ...process.env,
          // Export available MCP servers as JSON
          ALFRED_MCP_TOOLS: JSON.stringify(mcpManager ? mcpManager.getAllTools() : {}),
          // Pass working directory for MCP context (use original cwd where npx was invoked)
          CODEMODE_WORKING_DIRECTORY: ORIGINAL_CWD
        };

        const child = spawn(command.cmd, command.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: ORIGINAL_CWD,
          env: childEnv
        });

        console.error(`[child process hook] PID: ${child.pid}, Command: ${command.cmd}`);

        let stdout = '';
        let stderr = '';
        let stdoutBuffer = ''; // Buffer for JSON-RPC line parsing

        child.stdout.on('data', async (data) => {
          const output = data.toString();
          stdoutBuffer += output;

          // Process complete lines for JSON-RPC requests
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            // Check if this line is a JSON-RPC request
            let isJsonRpc = false;
            try {
              const parsed = JSON.parse(line);
              if (parsed.jsonrpc === '2.0' && parsed.method === 'tools/call') {
                isJsonRpc = true;
                // Handle MCP tool call from executed code
                const { id, params } = parsed;
                const { name: toolName, arguments: toolArgs } = params;

                try {
                  // Call the MCP tool
                  const result = await mcpManager.handleToolCall(toolName, toolArgs);
                  const response = {
                    jsonrpc: '2.0',
                    id,
                    result
                  };
                  // Send response back to child process
                  child.stdin.write(JSON.stringify(response) + '\n');
                } catch (error) {
                  const response = {
                    jsonrpc: '2.0',
                    id,
                    error: {
                      code: -32603,
                      message: error.message
                    }
                  };
                  child.stdin.write(JSON.stringify(response) + '\n');
                }
              }
            } catch (e) {
              // Not JSON or not a JSON-RPC request, treat as normal output
            }

            // If not JSON-RPC, add to stdout as normal
            if (!isJsonRpc) {
              stdout += line + '\n';
              accumulatedStdout += line + '\n';
              process.stderr.write(line + '\n');
            }
          }
        });

        child.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          accumulatedStderr += output;
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
            const elapsedMs = Math.max(0, Date.now() - startTime);
            const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
            resolve(`${timeoutMessage}\n\n${logs}\n\nTime: ${elapsedSeconds}s`);
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
          // Ensure duration is a valid number to prevent NaN
          const validDuration = typeof duration === 'number' && !isNaN(duration) && duration >= 0 ? duration : 0;
          const seconds = (validDuration / 1000).toFixed(2);
          const minutes = (validDuration / 60000).toFixed(2);
          const timeDisplay = validDuration > 60000 ? `${minutes}min` : `${seconds}s`;

          console.error(`[close hook] Process exited with code: ${code}`);
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
        return { cmd: 'node', args: ['--no-deprecation', filepath] };
      case 'deno':
        return { cmd: 'deno', args: ['run', filepath] };
      case 'bun':
        return { cmd: 'bun', args: ['run', filepath] };
      case 'python':
        return { cmd: 'python3', args: [filepath] };
      case 'bash':
        // Use bash -c to execute the code directly, allowing proper command interpretation
        // This enables commands like: npx clasp settings, git status, etc to work correctly
        const bashCode = fs.readFileSync(filepath, 'utf8');
        return { cmd: 'bash', args: ['-c', bashCode] };
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

      // Build execute tool description with dynamic MCP tool list
      let executeDescription = `Execute code in the specified runtime with access to MCP tool functions via JSON-RPC.

CRITICAL: The code you provide will be written to a temp file and executed directly by the runtime interpreter.
- For nodejs runtime: Provide pure JavaScript code (like you'd put in a .js file)
- For python runtime: Provide pure Python code (like you'd put in a .py file)
- For bash runtime: Provide bash script code (like you'd put in a .sh file)

DO NOT:
- Mix syntax from different languages (e.g., # comments in JavaScript)
- Include shell commands like "node -e" or "python -c"

Preference order: python > nodejs > bash

MCP TOOLS AVAILABLE via JSON-RPC stdio:
To use MCP tools from Node.js, require the helper module from /tmp:
  const mcp = require('/tmp/mcp-runtime-helpers.cjs');
  await mcp.browser_navigate({url: 'https://example.com'});

Available MCP functions:
`;

      // Add Playwright tools
      const playwrightTools = allTools['playwright'] || [];
      if (playwrightTools.length > 0) {
        executeDescription += `\nPlaywright Browser Automation (${playwrightTools.length} functions):\n`;
        playwrightTools.forEach(tool => {
          const params = Object.keys(tool.input_schema?.properties || {}).join(', ');
          executeDescription += `  - mcp.${tool.name}({${params}}): ${tool.description}\n`;
        });
      }

      // Add Vexify tools
      const vexifyTools = allTools['vexify'] || [];
      if (vexifyTools.length > 0) {
        executeDescription += `\nCode Search (${vexifyTools.length} functions):\n`;
        vexifyTools.forEach(tool => {
          const params = Object.keys(tool.input_schema?.properties || {}).join(', ');
          executeDescription += `  - mcp.${tool.name}({${params}}): ${tool.description}\n`;
        });
      }

      executeDescription += `\nEnvironment variables:
- ALFRED_MCP_TOOLS: JSON string of all available MCP tools with full schemas
- CODEMODE_WORKING_DIRECTORY: Current working directory`;

      // Add execute tool
      tools.push({
        name: 'execute',
        description: executeDescription,
        input_schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Source code to execute (NOT shell commands). For nodejs: pure JavaScript code. For python: pure Python code. For bash: bash script code. Do NOT include shell invocations like "node -e" or "python -c" - just provide the raw source code for the runtime.'
            },
            runtime: {
              type: 'string',
              enum: ['python', 'nodejs', 'bash', 'deno', 'bun', 'go', 'rust', 'c', 'cpp'],
              description: 'Runtime to execute the code in. Preference order: python > nodejs > bash. Available: nodejs, deno, bun, python, bash, go, rust, c, cpp'
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

      // Add built-in file operation and utility tools with dynamic descriptions from MCP server
      const builtInTools = allTools['builtInTools'] || [];
      const builtInToolNames = ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'todo'];

      for (const toolName of builtInToolNames) {
        const mcpTool = builtInTools.find(t => t.name === toolName);
        if (mcpTool) {
          tools.push({
            name: toolName,
            description: mcpTool.description,
            input_schema: mcpTool.input_schema || mcpTool.inputSchema
          });
        }
      }

      // MCP tools (playwright, vexify, etc.) are NOT directly exposed to agent
      // They are available as function calls within the execute tool environment

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
        } else if (['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'todo'].includes(name)) {
          // Delegate built-in tools to the builtInTools MCP server
          const result = await mcpManager.callTool('builtInTools', name, args);
          return {
            content: [{ type: 'text', text: result }]
          };
        } else {
          // Try to route unknown tools to appropriate MCP servers
          const allTools = mcpManager.getAllTools();

          // Search for the tool in all available MCP servers
          for (const [serverName, tools] of Object.entries(allTools)) {
            if (Array.isArray(tools) && tools.some(t => t.name === name)) {
              const result = await mcpManager.callTool(serverName, name, args);
              return {
                content: [{ type: 'text', text: result }]
              };
            }
          }

          // Tool not found in any server
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

      // Ensure history manager is initialized for nested calls
      if (!historyManager) {
        historyManager = new HistoryManager();
      }

      // Ensure execution manager is initialized
      if (!executionManager) {
        executionManager = new ExecutionManager();
        executionManager.mcpManager = mcpManager;
      }

      // Ensure we only trigger final prompt once per handleAlfred call
      executionManager.resetFinalPromptFlag();

      // Exclude alfred tool to prevent recursion
      // Keep verbose=true for nested calls to maintain observability
      const output = await runAgenticLoop(prompt, this, apiKey, true, true);

      // Queue sub-agent output as eager prompt to main thread
      const subAgentId = `alfred_${Date.now()}`;
      const summarizedOutput = output ? output.substring(0, 500) : 'No output';
      executionManager.queueEagerPrompt(
        subAgentId,
        `✅ Sub-agent Alfred completed: ${summarizedOutput}${output && output.length > 500 ? '...' : ''}`,
        output || ''
      );

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
  const hookWorkingDir = ORIGINAL_CWD;
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
          console.error('[Hooks] ✓ Thorns hook loaded');
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
          console.error('[Hooks] ✓ Prompt hook loaded');
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
          console.error('[Hooks] ✓ WFGY hook loaded');
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
}

// Signal handlers - handle Ctrl-C gracefully
process.on('SIGINT', () => {
  console.error('\n\nAlfred AI shutting down...');
  if (mcpManager) {
    mcpManager.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\nAlfred AI shutting down...');
  if (mcpManager) {
    mcpManager.shutdown();
  }
  process.exit(0);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  if (mcpManager) {
    mcpManager.shutdown();
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Disable buffering on stderr to ensure real-time streaming output
if (process.stderr && typeof process.stderr._handle !== 'undefined') {
  try {
    process.stderr._handle.setBlocking(true);
  } catch (e) {
    // Ignore if setBlocking not available (some Node versions)
  }
}

// Shared agentic loop function
async function runAgenticLoop(taskPrompt, mcpServer, apiKey, verbose = true, excludeAlfred = false, historyManager = null) {
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

  // Add environmental context to help agent understand its situation
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);
  const contextInfo = [];

  // Add working directory context
  contextInfo.push(`Working directory: ${cwd}`);

  // Check for package.json to understand if it's a Node project
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      contextInfo.push(`Current project: ${pkg.name} v${pkg.version}`);
    }
  } catch (e) {
    // Not a Node project, that's fine
  }

  // Add context about relative paths mentioned in the task
  const relativePathMatch = taskPrompt.match(/\.\.[\/\\]\w+/g);
  if (relativePathMatch) {
    contextInfo.push(`Parent directory: ${parentDir}`);
  }

  // Add hook content if available
  let hooksContent = '';
  if (historyManager && historyManager.hooks.length > 0) {
    const hookPrompts = historyManager.hooks.map(h => h.output).join('\n\n');
    hooksContent = `\n\n${hookPrompts}`;
  }

  // Construct enhanced prompt with context and hooks
  const enhancedPrompt = contextInfo.length > 0
    ? `${taskPrompt}\n\nContext:\n${contextInfo.join('\n')}${hooksContent}`
    : `${taskPrompt}${hooksContent}`;

  const messages = [{
    role: 'user',
    content: enhancedPrompt
  }];

  if (verbose) {
    console.error('\n🤖 Agent starting...\n');

    // Group tools by server
    const toolsByServer = {};
    const builtInTools = [];

    for (const tool of toolsResult.tools) {
      if (tool.name === 'execute' || tool.name === 'alfred_status' || tool.name === 'alfred_kill' || tool.name === 'alfred') {
        builtInTools.push(tool);
      } else {
        // Extract server name from tool name (format: serverName_toolName)
        const parts = tool.name.split('_');
        const serverName = parts[0];
        if (!toolsByServer[serverName]) {
          toolsByServer[serverName] = [];
        }
        toolsByServer[serverName].push(tool);
      }
    }

    // Display built-in tools
    if (builtInTools.length > 0) {
      console.error('[Built-in Tools]');
      for (const tool of builtInTools) {
        console.error(`  ✓ ${tool.name}: ${tool.description}`);
      }
      console.error('');
    }

    // Display tools by server
    if (Object.keys(toolsByServer).length > 0) {
      console.error('[MCP Server Tools]');
      for (const [serverName, tools] of Object.entries(toolsByServer)) {
        console.error(`  ${serverName} (${tools.length} tools)`);
        for (const tool of tools) {
          // Extract just the tool name without server prefix
          const toolNameOnly = tool.name.substring(serverName.length + 1);
          console.error(`    • ${toolNameOnly}`);
        }
      }
      console.error('');
    }

    console.error(`[Tools Summary] Total: ${toolsResult.tools.length} tools available\n`);
  }

  let output = '';

  // Track recently called tools to prevent loops
  const recentToolCalls = [];

  // Run agentic loop
  let continueLoop = true;
  while (continueLoop) {
    // Cleanup once per LLM iteration to enforce max item limits
    if (historyManager) {
      historyManager.performCleanup();
    }

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
    let currentToolInputJson = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          currentThinking = true;
          console.error(`\n💭 Thought:`);
        } else if (event.content_block.type === 'tool_use') {
          hasToolUse = true;
          console.error(`\n🔧 Tool: ${event.content_block.name}`);
          assistantContent.push({
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: {}
          });
          currentToolInputJson = '';
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          // Stream text output in real-time
          const text = event.delta.text;
          currentText += text;
          process.stderr.write(text);
          output += text;
        } else if (event.delta.type === 'input_json_delta') {
          // Stream tool input assembly in real-time
          const partial = event.delta.partial_json;
          currentToolInputJson += partial;
          const lastTool = assistantContent[assistantContent.length - 1];
          if (lastTool && lastTool.type === 'tool_use') {
            lastTool.input_json = currentToolInputJson;
            // Stream partial JSON input directly to console with enhanced visibility (always enabled)
            // Add visual indicators for better streaming experience
            if (currentToolInputJson.length === partial.length) {
              // First character of the tool input
              process.stderr.write(`\n🔧 ${lastTool.name} Input (streaming):\n  `);
            } else if (partial.trim() === '' && currentToolInputJson.trim().endsWith(',')) {
              // Empty whitespace after comma for better formatting
              process.stderr.write(partial);
            } else if (partial === '{' || partial === '[') {
              // Opening brackets
              process.stderr.write(partial);
            } else if (partial === '}' || partial === ']') {
              // Closing brackets
              process.stderr.write(partial);
              process.stderr.write('\n'); // Newline after complete JSON
            } else {
              // Regular content
              process.stderr.write(partial);
            }
          }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentThinking) {
          console.error(''); // newline after streaming text
          assistantContent.push({ type: 'text', text: currentText });
          currentText = '';
          currentThinking = false;
        } else {
          // Finalize tool input
          const lastTool = assistantContent[assistantContent.length - 1];
          if (lastTool && lastTool.type === 'tool_use' && lastTool.input_json) {
            try {
              lastTool.input = JSON.parse(lastTool.input_json);
              console.error(''); // newline after tool input
            } catch (e) {
              console.error(`\n  (Failed to parse tool input: ${e.message})`);
            }
            delete lastTool.input_json;
          }
          currentToolInputJson = '';
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
        // Detect tool calling loops only for tools prone to infinite loops
        const toolName = block.name;
        const toolsToCheckForLoops = [
          'mcp__plugin_glootie-cc_playwright__browser_take_screenshot',
          'mcp__plugin_glootie-cc_playwright__browser_snapshot'
        ];

        // Only track loops for specific problematic tools
        if (toolsToCheckForLoops.includes(toolName)) {
          // Track recent tool calls (keep last 5)
          recentToolCalls.push(toolName);
          if (recentToolCalls.length > 5) {
            recentToolCalls.shift();
          }

          // Check if we're in a loop (same tool called 3 times in a row)
          if (recentToolCalls.length >= 3) {
            const lastThree = recentToolCalls.slice(-3);
            if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
              console.error(`\n⚠️  Loop detected: ${toolName} called 3 times in a row. Stopping to prevent infinite loop.`);
              // Stop the loop and return current output
              continueLoop = false;
              break;
            }
          }
        }

        // Log tool input with enhanced context (always enabled)
        if (block.input && Object.keys(block.input).length > 0) {
          console.error(`\n📥 ${block.name} Final Input:`);
          for (const [key, value] of Object.entries(block.input)) {
            if (typeof value === 'string' && value.length > 200) {
              console.error(`  ${key}: ${value.substring(0, 200)}...`);
            } else {
              console.error(`  ${key}: ${JSON.stringify(value)}`);
            }
          }
          console.error(`  📋 Input size: ${JSON.stringify(block.input).length} characters`);
        } else {
          console.error(`\n📥 ${block.name} Input: (empty)`);
        }

        const startTime = Date.now();
        try {
          process.stderr.write(`\n📤 Executing tool...\n`);

          // Validate Playwright screenshot parameters
          if (block.name === 'mcp__plugin_glootie-cc_playwright__browser_take_screenshot') {
            const args = block.input || {};
            // fullPage cannot be used with element screenshots
            if (args.fullPage && (args.element || args.ref)) {
              if (args.fullPage) {
                // Remove conflicting element parameters if fullPage is set
                delete args.element;
                delete args.ref;
              }
            }
          }

          const result = await mcpServer.handleRequest({
            method: 'tools/call',
            params: {
              name: block.name,
              arguments: block.input
            }
          });

          const endTime = Date.now();
          const executionTime = endTime - startTime;

          // Stream tool output in real-time (always enabled)
          if (result.content) {
            process.stderr.write(`📤 Output:\n`);
            for (const contentBlock of result.content) {
              if (contentBlock.type === 'text') {
                const text = contentBlock.text;
                // Stream output in chunks for real-time visibility
                process.stderr.write(`  ${text}\n`);
              }
            }
          }

          // Log execution summary (always enabled)
          process.stderr.write(`\n⏱️  Tool executed in ${executionTime}ms\n`);

          // Extract text content from result
          let resultText = '';
          if (result.content && Array.isArray(result.content)) {
            for (const contentBlock of result.content) {
              if (contentBlock.type === 'text') {
                resultText += contentBlock.text;
              }
            }
          } else if (typeof result.content === 'string') {
            resultText = result.content;
          }

          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              content: resultText
            }]
          });
        } catch (error) {
          const endTime = Date.now();
          const executionTime = endTime - startTime;
          process.stderr.write(`\n❌ Tool error after ${executionTime}ms: ${error.message}\n`);
          process.stderr.write(`💡 Error details: ${error.stack || 'No stack trace available'}\n`);
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

// Setup interactive input listening - allows user to type prompts during agent execution
// Returns a cleanup function to disable interactive mode
function setupInteractiveInput(onPromptSubmitted) {
  let currentPrompt = '';
  let promptVisible = false;
  const dataHandler = (key) => {
    const char = key.toString();

    // ESC key (0x1B) - cancel prompt
    if (char === '\u001b') {
      if (promptVisible) {
        currentPrompt = '';
        promptVisible = false;
        process.stderr.write('\n❌ Prompt cancelled\n');
        process.stderr.write('\n🎯 Type your prompt (ESC to cancel, ENTER to execute):\n');
      }
      return;
    }

    // ENTER key (0x0D or 0x0A) - submit prompt
    if (char === '\r' || char === '\n') {
      if (currentPrompt.trim()) {
        const submittedPrompt = currentPrompt;
        currentPrompt = '';
        promptVisible = false;
        process.stderr.write('\n');

        // Call the callback with the submitted prompt
        onPromptSubmitted(submittedPrompt);
      }
      return;
    }

    // Regular character input
    if (char >= ' ' && char <= '~') {
      currentPrompt += char;
      if (!promptVisible) {
        promptVisible = true;
        process.stderr.write('\n🎯 Prompt: ');
      }
      process.stderr.write(char);
    }

    // Backspace (0x08 or 0x7F)
    if (char === '\u0008' || char === '\u007F') {
      if (currentPrompt.length > 0) {
        currentPrompt = currentPrompt.slice(0, -1);
        process.stderr.write('\b \b');
      }
    }
  };

  // Enable raw mode and set up listener
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on('data', dataHandler);

  // Return cleanup function
  return () => {
    process.stdin.removeListener('data', dataHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };
}

// CLI Agent mode - run Anthropic AI agent with the task
async function runCLIMode(taskPrompt) {
  console.error('📝 Task:');
  console.error(taskPrompt);
  console.error('');

  // Initialize authentication
  authManager = new AuthManager();
  try {
    await authManager.initialize();
  } catch (err) {
    console.error('Fatal: Authentication initialization failed');
    process.exit(1);
  }


  const apiKey = authManager.getApiKey();
  if (!apiKey) {
    console.error('Fatal: No API key available');
    process.exit(1);
  }

  // Initialize config for MCP servers
  try {
    config = loadConfig();
  } catch (err) {
    // If no config, create default config with essential MCP servers
    console.error('[Config] No .codemode.json found, using default MCP server configuration');
    config = {
      config: {
        mcpServers: {
          'playwright': {
            'command': 'npx',
            'args': ['-y', '@playwright/mcp']
          },
          'vexify': {
            'command': 'npx',
            'args': ['-y', 'vexify@latest', 'mcp']
          }
        }
      },
      configDir: process.cwd()
    };
  }

  mcpManager = new MCPManager();
  historyManager = new HistoryManager();
  executionManager = new ExecutionManager();

  // Start hooks and MCP initialization in parallel (don't await yet)
  const hooksPromise = initializeHooks();
  const mcpInitPromise = mcpManager.initialize();

  // Continue with other setup while initialization happens in background
  const mcpServer = new AlfredMCPServer();
  executionManager.mcpManager = mcpManager;

  // Block for initialization to complete before running agent loop
  await Promise.all([hooksPromise, mcpInitPromise]);

  // Set up interactive input listening
  let userPrompt = null;
  const cleanupInteractive = setupInteractiveInput((prompt) => {
    userPrompt = prompt;
    console.error(`📝 Eager prompt queued: ${prompt}`);
    historyManager.queueEagerPrompt('cli_interactive', '💬 User submitted interactive prompt during CLI execution', prompt);
  });

  // Run agent with automatic todo-aware resumption
  let currentPrompt = taskPrompt;
  let iterationCount = 0;
  const maxIterations = 20; // Prevent infinite loops

  while (iterationCount < maxIterations) {
    iterationCount++;

    // Run the agent loop with current prompt
    await runAgenticLoop(currentPrompt, mcpServer, apiKey, true, false, historyManager);

    // Check for incomplete todo items after agent completes
    if (typeof executionManager !== 'undefined' && executionManager.getTodoStatus) {
      try {
        const todos = executionManager.getTodoStatus();
        const incompleteTodos = todos.filter(t => t.status !== 'completed');

        if (incompleteTodos.length > 0) {
          console.error(`\n🔄 Found ${incompleteTodos.length} incomplete todo(s). Resuming agent...\n`);

          // Format incomplete todos for the next iteration
          const todoList = incompleteTodos
            .map((t, i) => `${i + 1}. [${t.status}] ${t.content}`)
            .join('\n');

          // Create a continuation prompt that references the incomplete todos
          currentPrompt = `Continue from where you left off. The following items still need to be completed:\n\n${todoList}\n\nPlease continue working on these incomplete items and complete the task.`;
        } else {
          // All todos are complete
          console.error('\n✅ All todo items completed\n');
          break;
        }
      } catch (e) {
        // Report the error when checking todos
        console.error(`\n❌ Error checking todo status: ${e.message}\n`);
        console.error(`Error details: ${e.stack}\n`);
        console.error('⚠️  Stopping agent loop due to todo check error\n');
        process.exit(1);
      }
    } else {
      // No todo tracking available, exit after first iteration
      console.error('\n✅ Task completed\n');
      break;
    }
  }

  if (iterationCount >= maxIterations) {
    console.error('\n⚠️  Reached maximum iterations. Stopping agent loop.\n');
  }

  // Clean up interactive input
  cleanupInteractive();

  mcpManager.shutdown();
  process.exit(0);
}

// Interactive prompt handler
async function runInteractiveMode() {
  console.error('\n🎯 Alfred AI - Interactive Mode');
  console.error('Start typing your prompt (Press ESC to cancel, ENTER to execute):\n');

  // Initialize authentication
  authManager = new AuthManager();
  try {
    await authManager.initialize();
  } catch (err) {
    console.error('Fatal: Authentication initialization failed');
    process.exit(1);
  }


  const apiKey = authManager.getApiKey();
  if (!apiKey) {
    console.error('Fatal: No API key available');
    process.exit(1);
  }

  // Initialize config for MCP servers
  try {
    config = loadConfig();
  } catch (err) {
    config = {
      config: {
        mcpServers: {
          'playwright': {
            'command': 'npx',
            'args': ['-y', '@playwright/mcp']
          },
          'vexify': {
            'command': 'npx',
            'args': ['-y', 'vexify@latest', 'mcp']
          }
        }
      },
      configDir: process.cwd()
    };
  }

  mcpManager = new MCPManager();
  historyManager = new HistoryManager();
  executionManager = new ExecutionManager();

  const hooksPromise = initializeHooks();
  const mcpInitPromise = mcpManager.initialize();

  const mcpServer = new AlfredMCPServer();
  executionManager.mcpManager = mcpManager;

  await Promise.all([hooksPromise, mcpInitPromise]);

  // Set up interactive input listening for prompt submission
  const cleanupInteractive = setupInteractiveInput((prompt) => {
    console.error(`\n📝 Executing prompt: ${prompt}\n`);

    // Queue the prompt as an eager prompt
    historyManager.queueEagerPrompt(
      'interactive_prompt',
      '💬 User submitted prompt via interactive mode',
      prompt
    );

    // Run the agentic loop
    runAgenticLoop(prompt, mcpServer, apiKey, true, false, historyManager)
      .then(() => {
        console.error('\n✅ Task completed\n');
        cleanupInteractive();
        mcpManager.shutdown();
        process.exit(0);
      })
      .catch(error => {
        console.error('Failed to run agent:', error);
        cleanupInteractive();
        mcpManager.shutdown();
        process.exit(1);
      });
  });
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

  // Check for interactive mode: no arguments or 'interactive' flag
  if (args.length === 0 || args[0] === 'interactive') {
    runInteractiveMode().catch(error => {
      console.error('Failed to run interactive mode:', error);
      process.exit(1);
    });
  }
  // Check for CLI mode: any argument that's not 'mcp'
  else if (args.length > 0 && args[0] !== 'mcp') {
    const taskPrompt = args.join(' ');
    runCLIMode(taskPrompt).catch(error => {
      console.error('Failed to run CLI mode:', error);
      process.exit(1);
    });
  }
  // MCP server mode
  else {
    main().catch(error => {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    });
  }
}

export { AlfredMCPServer, MCPManager, HistoryManager, ExecutionManager };