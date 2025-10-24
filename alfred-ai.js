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


class MCPManager extends EventEmitter {
  constructor() {
    super();
    this.servers = new Map();
    this.nextId = 0;
    this.playwrightServers = []; 
    this.playwrightServerUsage = new Map(); 
  }

  async initialize() {
    console.error('[MCP] Initializing servers...');
    for (const [serverName, serverConfig] of Object.entries(config.config.mcpServers)) {
      if (serverName === 'alfred-ai') continue;

      try {
        await this.startServer(serverName, serverConfig);
      } catch (error) {
        console.error(`[${serverName}] Error: ${error.message}`);
      }
    }
    console.error('[MCP] Ready\n');
  }

  async startServer(serverName, serverConfig) {

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
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
    });

    proc.on('error', (err) => {
      console.error(`[Server Error] ${serverName}: ${err.message}`);
    });

    proc.on('close', () => {
      this.servers.delete(serverName);
    });

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

    const toolsResult = await this.sendRequest(serverName, {
      jsonrpc: '2.0',
      id: serverState.nextId++,
      method: 'tools/list'
    });

    if (!toolsResult.tools) {
      throw new Error(`No tools received from ${serverName}`);
    }

    serverState.tools = toolsResult.tools;
    if (serverState.tools.length > 0) {
      const toolNames = serverState.tools.map(t => t.name).join(', ');
      console.error(`[${serverName}] Loaded: ${toolNames}`);
    }

    if (serverName.startsWith('playwright')) {
      this.playwrightServers.push(serverName);
      this.playwrightServerUsage.set(serverName, 0);
    }
  }

  getPlaywrightServer() {
    if (this.playwrightServers.length === 0) {
      return 'playwright'; 
    }

    let leastUsedServer = this.playwrightServers[0];
    let minUsage = this.playwrightServerUsage.get(leastUsedServer) || 0;

    for (const serverName of this.playwrightServers) {
      const usage = this.playwrightServerUsage.get(serverName) || 0;
      if (usage < minUsage) {
        leastUsedServer = serverName;
        minUsage = usage;
      }
    }

    this.playwrightServerUsage.set(leastUsedServer, minUsage + 1);

    return leastUsedServer;
  }

  releasePlaywrightServer(serverName) {
    if (this.playwrightServers.includes(serverName)) {
      const currentUsage = this.playwrightServerUsage.get(serverName) || 1;
      this.playwrightServerUsage.set(serverName, Math.max(0, currentUsage - 1));
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

    historyManager.recordMcpCall(serverName, toolName, args, result);

    const content = result.content;
    if (Array.isArray(content) && content[0]?.type === 'text') {
      return content[0].text;
    }
    return JSON.stringify(result);
  }

  async handleToolCall(toolName, args) {
    let serverName, actualToolName;

    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      let baseServerName = parts[1];
      actualToolName = parts[2];

      if (baseServerName === 'playwright') {
        serverName = this.getPlaywrightServer();
      } else {
        serverName = baseServerName;
      }
    } else {
      serverName = 'builtInTools';
      actualToolName = toolName;
    }

    const serverState = this.servers.get(serverName);
    if (!serverState) {
      throw new Error(`MCP server ${serverName} not found`);
    }

    return await this.sendRequest(serverName, {
      jsonrpc: '2.0',
      id: serverState.nextId++,
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
      try {
        serverState.process.kill('SIGTERM');
      } catch (error) {
      }
    }
    this.servers.clear();
  }
}


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
    if (typeof historyManager !== 'undefined' && historyManager.getTodos) {
      try {
        const todos = historyManager.getTodos();
        if (!Array.isArray(todos)) {
          throw new Error(`Expected getTodos() to return array, got ${typeof todos}`);
        }
        return todos;
      } catch (e) {
        console.error(`❌ Error retrieving todos from history: ${e.message}`);
        throw e; 
      }
    }
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

    if (code.includes('pkill')) {
      throw new Error('Execution rejected: pkill command is not allowed');
    }

    const execId = `exec_${this.nextExecId++}`;

    try {
      const result = await this.executeCode(code, runtime, timeout, execId);

      historyManager.recordExecute(
        { code: this.compactCode(code), runtime },
        { success: true, result: this.compactData(result) }
      );


      return {
        success: true,
        result,
        execId
      };
    } catch (error) {
      historyManager.recordExecute(
        { code: this.compactCode(code), runtime },
        { success: false, error: error.message }
      );


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

        const childEnv = {
          ...process.env,
          ALFRED_MCP_TOOLS: JSON.stringify(mcpManager ? mcpManager.getAllTools() : {}),
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
        let stdoutBuffer = ''; 

        child.stdout.on('data', async (data) => {
          const output = data.toString();
          stdoutBuffer += output;

          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop() || ''; 

          for (const line of lines) {
            let isJsonRpc = false;
            try {
              const parsed = JSON.parse(line);
              if (parsed.jsonrpc === '2.0' && parsed.method === 'tools/call') {
                isJsonRpc = true;
                const { id, params } = parsed;
                const { name: toolName, arguments: toolArgs } = params;


                try {
                  const result = await mcpManager.handleToolCall(toolName, toolArgs);


                  const response = {
                    jsonrpc: '2.0',
                    id,
                    result
                  };
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
            }

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

          const logs = `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`;
          const timeoutMessage = `⏱️ Execution timeout after ${timeout}ms. Process (PID ${child.pid}) continues in background. Logs below. Updates every 60s.`;

          this.queueEagerPrompt(execId, timeoutMessage, logs);

          if (!promiseResolved) {
            promiseResolved = true;
            const elapsedMs = Math.max(0, Date.now() - startTime);
            const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
            resolve(`${timeoutMessage}\n\n${logs}\n\nTime: ${elapsedSeconds}s`);
          }

          lastLogSize = 0;
          accumulatedStdout = '';
          accumulatedStderr = '';

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
              this.queueEagerPrompt(
                execId,
                `✅ Background process (PID ${child.pid}) completed.`,
                `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`
              );
            }
          }, 60000);

          child._progressTimer = progressTimer;

        }, timeout);

        child.on('close', (code) => {
          clearTimeout(timer);
          if (child._progressTimer) {
            clearInterval(child._progressTimer);
          }

          const endTime = Date.now();
          const duration = endTime - startTime;
          const validDuration = typeof duration === 'number' && !isNaN(duration) && duration >= 0 ? duration : 0;
          const seconds = (validDuration / 1000).toFixed(2);
          const minutes = (validDuration / 60000).toFixed(2);
          const timeDisplay = validDuration > 60000 ? `${minutes}min` : `${seconds}s`;

          console.error(`[close hook] Process exited with code: ${code}`);
          console.error(`[execution complete] Time: ${timeDisplay}`);

          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
          }

          const result = stdout || (stderr ? `Warning: ${stderr}` : 'Execution completed successfully');
          const resultWithTiming = `${result}\n\nTime: ${timeDisplay}`;

          if (timeoutTriggered) {
            console.error(`[process end] Final logs being handed to agent`);
            this.queueEagerPrompt(
              execId,
              `✅ Background process (PID ${child.pid}) completed with exit code ${code}. Final logs below.`,
              `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`
            );
            return;
          }

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

          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
          }

          reject(error);
        });

      } catch (error) {
        if (tempFile) {
          try {
            unlinkSync(tempFile);
          } catch (e) {
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


class AlfredMCPServer {
  constructor() {
    this.handlers = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    this.handlers.set('tools/list', async (request) => {
      const allTools = mcpManager.getAllTools();
      const tools = [];

      let executeDescription = `Execute code in the specified runtime with EXCLUSIVE access to MCP tool functions via JSON-RPC stdio.

⚠️ CRITICAL INSTRUCTIONS FOR MCP TOOL USAGE:
- You MUST use MCP tools ONLY through the JSON-RPC helper in executed code
- You MUST NOT use any CLI versions of these tools (e.g., no 'playwright' command, no browser CLIs)
- ALL MCP tool interactions must happen via require('/tmp/mcp-runtime-helpers.cjs') in nodejs
- Every task involving testing/browsing/searching MUST use these MCP functions
- Write your code as pure JavaScript/Python/Bash that calls the MCP tools via the helper

CODE EXECUTION RULES:
- Provide pure source code (NOT shell commands or invocations)
- For nodejs runtime: Pure JavaScript code (like you'd put in a .js file)
- For python runtime: Pure Python code (like you'd put in a .py file)
- For bash runtime: Bash script code (like you'd put in a .sh file)

DO NOT:
- Use CLI tools like 'playwright', 'npx playwright', 'python -m pytest' etc.
- Mix syntax from different languages (e.g., # comments in JavaScript)
- Include shell commands like "node -e" or "python -c" - just provide raw source code
- Try to access Playwright/other tools except through the JSON-RPC helper

Preference order: python > nodejs > bash

MCP TOOLS AVAILABLE via JSON-RPC stdio (REQUIRED FOR TESTING):
To use MCP tools from Node.js code, require the helper module from /tmp:
  const mcp = require('/tmp/mcp-runtime-helpers.cjs');

  const result = await mcp.browser_navigate({url: 'https://example.com'});
  const screenshot = await mcp.browser_take_screenshot({});
  const snapshot = await mcp.browser_snapshot({});

Available MCP functions:
`;

      const playwrightTools = allTools['playwright'] || [];
      if (playwrightTools.length > 0) {
        executeDescription += `\nPlaywright Browser Automation (${playwrightTools.length} functions):\n`;
        playwrightTools.forEach(tool => {
          const params = Object.keys(tool.input_schema?.properties || {}).join(', ');
          executeDescription += `  - mcp.${tool.name}({${params}}): ${tool.description}\n`;
        });
      }

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

    this.handlers.set('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'execute') {
          return await this.handleExecute(args);
        } else if (name === 'alfred_kill') {
          return await this.handleKill(args);
        } else if (name === 'alfred') {
          return await this.handleAlfred(args);
        } else if (['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'todo'].includes(name)) {
          const result = await mcpManager.callTool('builtInTools', name, args);
          return {
            content: [{ type: 'text', text: result }]
          };
        } else {
          const allTools = mcpManager.getAllTools();

          for (const [serverName, tools] of Object.entries(allTools)) {
            if (Array.isArray(tools) && tools.some(t => t.name === name)) {
              const result = await mcpManager.callTool(serverName, name, args);
              return {
                content: [{ type: 'text', text: result }]
              };
            }
          }

          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        throw error; 
      }
    });
  }

  async handleExecute(args) {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: arguments must be an object');
    }

    if (args.code === undefined || args.code === null || typeof args.code !== 'string') {
      throw new Error('Invalid arguments: "code" parameter is required and must be a string');
    }

    if (args.runtime === undefined || args.runtime === null || typeof args.runtime !== 'string') {
      throw new Error('Invalid arguments: "runtime" parameter is required and must be a string');
    }

    if (args.code.trim() === '') {
      return {
        content: [{
          type: 'text',
          text: 'Execution failed: No code to execute'
        }],
        isError: true
      };
    }

    const allowedParams = ['code', 'runtime', 'timeout'];
    const providedParams = Object.keys(args);
    const invalidParams = providedParams.filter(param => !allowedParams.includes(param));

    if (invalidParams.length > 0) {
      throw new Error(`Invalid arguments: unknown parameter(s): ${invalidParams.join(', ')}`);
    }

    if (!['nodejs', 'deno', 'bun', 'python', 'bash', 'go', 'rust', 'c', 'cpp'].includes(args.runtime)) {
      throw new Error(`Invalid arguments: "runtime" must be one of: nodejs, deno, bun, python, bash, go, rust, c, cpp`);
    }

    if (args.timeout && (typeof args.timeout !== 'number' || args.timeout <= 0)) {
      throw new Error('Invalid arguments: "timeout" must be a positive number');
    }

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

      if (!historyManager) {
        historyManager = new HistoryManager();
      }

      if (!executionManager) {
        executionManager = new ExecutionManager();
        executionManager.mcpManager = mcpManager;
      }

      executionManager.resetFinalPromptFlag();

      const output = await runAgenticLoop(prompt, this, apiKey, true, true);

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


async function runHookProcess(name, command, args, options = {}) {
  const timeout = options.timeout || 10000;
  const cwd = options.cwd || ORIGINAL_CWD;
  const shell = options.shell || false;

  return new Promise((resolve, reject) => {
    let output = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${name} hook timeout`));
    }, timeout);

    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && output.trim()) {
        console.error(`[Hooks] ✓ ${name} hook loaded`);
        resolve(output.trim());
      } else {
        reject(new Error(`${name} hook failed with code ${code}. stderr: ${stderr}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}


async function initializeHooks() {
  console.error('[Hooks] Initializing system hooks...');

  const hookWorkingDir = ORIGINAL_CWD;
  console.error(`[Hooks] Running hooks in working directory: ${hookWorkingDir}`);

  try {
    const thornsOutput = await runHookProcess('Thorns', 'npx', ['-y', 'mcp-thorns@latest'], {
      cwd: hookWorkingDir,
      shell: true
    });
    historyManager.addHook('thorns', thornsOutput);
  } catch (error) {
    console.error('[Hooks] ✗ Thorns hook failed:', error.message);
  }

  try {
    const promptOutput = await runHookProcess('Prompt', 'curl', ['-s', 'https://raw.githubusercontent.com/AnEntrypoint/glootie-cc/refs/heads/master/start.md'], {
      cwd: hookWorkingDir
    });
    historyManager.addHook('prompt', promptOutput);
  } catch (error) {
    console.error('[Hooks] ✗ Prompt hook failed:', error.message);
  }

  try {
    const wfgyOutput = await runHookProcess('WFGY', 'npx', ['-y', 'wfgy@latest', 'hook'], {
      cwd: hookWorkingDir,
      shell: true
    });
    historyManager.addHook('wfgy', wfgyOutput);
  } catch (error) {
    console.error('[Hooks] ✗ WFGY hook failed:', error.message);
  }

  historyManager.logHooks();
}


async function main() {
  console.error('Alfred AI - Simplified CodeMode with OAuth starting...');

  authManager = new AuthManager();

  try {
    await authManager.initialize();
  } catch (err) {
    console.error('Fatal: Authentication initialization failed');
    process.exit(1);
  }

  config = loadConfig();
  mcpManager = new MCPManager();
  historyManager = new HistoryManager();
  executionManager = new ExecutionManager();

  console.error('Config loaded from:', join(process.cwd(), '.codemode.json'));

  if (authInfo.creditsReset) {
    console.error(`Credits: ${authInfo.creditsReset}`);
  }

  await initializeHooks();

  const mcpServer = new AlfredMCPServer();

  await mcpManager.initialize();

  executionManager.mcpManager = mcpManager;

  console.error('Alfred AI ready - Accepting MCP requests via stdio');

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


if (process.stderr && typeof process.stderr._handle !== 'undefined') {
  try {
    process.stderr._handle.setBlocking(true);
  } catch (e) {
  }
}


async function runAgenticLoop(taskPrompt, mcpServer, apiKey, verbose = true, excludeAlfred = false, historyManager = null) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  const toolsResult = await mcpServer.handleRequest({
    method: 'tools/list',
    params: {}
  });

  if (excludeAlfred) {
    toolsResult.tools = toolsResult.tools.filter(t => t.name !== 'alfred');
  }

  const anthropic = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL
  });

  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);
  const contextInfo = [];

  contextInfo.push(`Working directory: ${cwd}`);

  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      contextInfo.push(`Current project: ${pkg.name} v${pkg.version}`);
    }
  } catch (e) {
  }

  const relativePathMatch = taskPrompt.match(/\.\.[\/\\]\w+/g);
  if (relativePathMatch) {
    contextInfo.push(`Parent directory: ${parentDir}`);
  }

  let hooksContent = '';
  if (historyManager && historyManager.hooks.length > 0) {
    const hookPrompts = historyManager.hooks.map(h => h.output).join('\n\n');
    hooksContent = `\n\n${hookPrompts}`;
  }

  const enhancedPrompt = contextInfo.length > 0
    ? `${taskPrompt}\n\nContext:\n${contextInfo.join('\n')}${hooksContent}`
    : `${taskPrompt}${hooksContent}`;

  const messages = [{
    role: 'user',
    content: enhancedPrompt
  }];

  if (verbose) {
    console.error('\n🤖 Agent starting...\n');

    const toolsByServer = {};
    const builtInTools = [];

    for (const tool of toolsResult.tools) {
      if (tool.name === 'execute' || tool.name === 'alfred_kill' || tool.name === 'alfred') {
        builtInTools.push(tool);
      } else {
        const parts = tool.name.split('_');
        const serverName = parts[0];
        if (!toolsByServer[serverName]) {
          toolsByServer[serverName] = [];
        }
        toolsByServer[serverName].push(tool);
      }
    }

    if (builtInTools.length > 0) {
      console.error('[Built-in Tools]');
      for (const tool of builtInTools) {
        console.error(`  ✓ ${tool.name}: ${tool.description}`);
      }
      console.error('');
    }

    if (Object.keys(toolsByServer).length > 0) {
      console.error('[MCP Server Tools]');
      for (const [serverName, tools] of Object.entries(toolsByServer)) {
        console.error(`  ${serverName} (${tools.length} tools)`);
        for (const tool of tools) {
          const toolNameOnly = tool.name.substring(serverName.length + 1);
          console.error(`    • ${toolNameOnly}`);
        }
      }
      console.error('');
    }

    console.error(`[Tools Summary] Total: ${toolsResult.tools.length} tools available\n`);
  }

  let output = '';

  const recentToolCalls = [];

  let continueLoop = true;
  while (continueLoop) {
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
          const text = event.delta.text;
          currentText += text;
          process.stderr.write(text);
          output += text;
        } else if (event.delta.type === 'input_json_delta') {
          const partial = event.delta.partial_json;
          const isFirstChunk = currentToolInputJson.length === 0;
          currentToolInputJson += partial;
          const lastTool = assistantContent[assistantContent.length - 1];
          if (lastTool && lastTool.type === 'tool_use') {
            lastTool.input_json = currentToolInputJson;
            if (isFirstChunk) {
              process.stderr.write(`\n🔧 ${lastTool.name} Input (streaming):\n  `);
            }
            for (let i = 0; i < partial.length; i++) {
              process.stderr.write(partial[i]);
            }
          }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentThinking) {
          console.error(''); 
          assistantContent.push({ type: 'text', text: currentText });
          currentText = '';
          currentThinking = false;
        } else {
          const lastTool = assistantContent[assistantContent.length - 1];
          if (lastTool && lastTool.type === 'tool_use' && lastTool.input_json) {
            try {
              lastTool.input = JSON.parse(lastTool.input_json);
              console.error(''); 
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

    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        const toolName = block.name;
        const toolsToCheckForLoops = [
          'mcp__plugin_glootie-cc_playwright__browser_take_screenshot',
          'mcp__plugin_glootie-cc_playwright__browser_snapshot'
        ];

        if (toolsToCheckForLoops.includes(toolName)) {
          recentToolCalls.push(toolName);
          if (recentToolCalls.length > 5) {
            recentToolCalls.shift();
          }

          if (recentToolCalls.length >= 3) {
            const lastThree = recentToolCalls.slice(-3);
            if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
              console.error(`\n⚠️  Loop detected: ${toolName} called 3 times in a row. Stopping to prevent infinite loop.`);
              continueLoop = false;
              break;
            }
          }
        }

        const shouldLogInput = block.name !== 'execute' || !block.input;
        if (shouldLogInput && block.input && Object.keys(block.input).length > 0) {
          console.error(`\n📥 ${block.name} Input:`);
          for (const [key, value] of Object.entries(block.input)) {
            if (typeof value === 'string' && value.length > 200) {
              console.error(`  ${key}: ${value.substring(0, 200)}...`);
            } else {
              console.error(`  ${key}: ${JSON.stringify(value)}`);
            }
          }
        }
        if (block.input && Object.keys(block.input).length > 0) {
          console.error(`  📋 Input size: ${JSON.stringify(block.input).length} characters`);
        }

        const startTime = Date.now();
        try {
          process.stderr.write(`\n📤 Executing tool...\n`);

          if (block.name === 'mcp__plugin_glootie-cc_playwright__browser_take_screenshot') {
            const args = block.input || {};
            if (args.fullPage && (args.element || args.ref)) {
              if (args.fullPage) {
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

          if (result.content) {
            for (const contentBlock of result.content) {
              if (contentBlock.type === 'text') {
                const text = contentBlock.text;
                process.stderr.write(text);
              }
            }
          }

          process.stderr.write(`\n⏱️  Executed in ${executionTime}ms\n`);

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
          process.stderr.write(`\n❌ Error after ${executionTime}ms: ${error.message}\n`);
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



function setupInteractiveInput(onPromptSubmitted) {
  let currentPrompt = '';
  let promptVisible = false;
  let promptHidden = false; 
  let lastEscTime = 0;
  const escDoubleClickTime = 300; 

  const redisplayPrompt = () => {
    if (currentPrompt.length > 0 && !promptHidden) {
      process.stderr.write('\n🎯 Prompt: ' + currentPrompt);
    }
  };

  const dataHandler = (key) => {
    const char = key.toString();

    if (char === '\u0003') {
      process.stderr.write('\n\n🛑 Alfred AI shutting down (Ctrl-C)...\n');
      if (mcpManager) {
        mcpManager.shutdown();
      }
      process.exit(0);
    }

    if (char === '\u001b') {
      const now = Date.now();
      const isDoubleEsc = (now - lastEscTime) < escDoubleClickTime;
      lastEscTime = now;

      if (isDoubleEsc) {
        currentPrompt = '';
        promptVisible = false;
        promptHidden = false;
        lastEscTime = 0; 
        process.stderr.write('\n🗑️  Prompt cleared\n');
      } else {
        if (promptVisible) {
          promptVisible = false;
          promptHidden = true;
          process.stderr.write('\n👁️  Prompt hidden (type to show again)\n');
        }
      }
      return;
    }

    if (char === '\r' || char === '\n') {
      if (currentPrompt.trim()) {
        const submittedPrompt = currentPrompt;
        currentPrompt = '';
        promptVisible = false;
        promptHidden = false;
        process.stderr.write('\n');

        onPromptSubmitted(submittedPrompt);
      }
      return;
    }

    if (char >= ' ' && char <= '~') {
      currentPrompt += char;
      promptHidden = false; 
      if (!promptVisible) {
        promptVisible = true;
        process.stderr.write('\n🎯 Prompt: ');
      }
      process.stderr.write(char);
    }

    if (char === '\u0008' || char === '\u007F') {
      if (currentPrompt.length > 0) {
        currentPrompt = currentPrompt.slice(0, -1);
        process.stderr.write('\b \b');
      }
    }
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on('data', dataHandler);

  return () => {
    process.stdin.removeListener('data', dataHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };
}


async function runCLIMode(taskPrompt) {
  console.error('📝 Task:');
  console.error(taskPrompt);
  console.error('');

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

  try {
    config = loadConfig();
  } catch (err) {
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

  const hooksPromise = initializeHooks();
  const mcpInitPromise = mcpManager.initialize();

  const mcpServer = new AlfredMCPServer();
  executionManager.mcpManager = mcpManager;

  await Promise.all([hooksPromise, mcpInitPromise]);

  let userPrompt = null;
  const cleanupInteractive = setupInteractiveInput((prompt) => {
    userPrompt = prompt;
    console.error(`📝 Eager prompt queued: ${prompt}`);
    executionManager.queueEagerPrompt('cli_interactive', '💬 User submitted interactive prompt during CLI execution', prompt);
  });

  let currentPrompt = taskPrompt;
  let iterationCount = 0;
  const maxIterations = 20; 

  while (iterationCount < maxIterations) {
    iterationCount++;

    await runAgenticLoop(currentPrompt, mcpServer, apiKey, true, false, historyManager);

    if (typeof executionManager !== 'undefined' && executionManager.getTodoStatus) {
      try {
        const todos = executionManager.getTodoStatus();
        const incompleteTodos = todos.filter(t => t.status !== 'completed');

        if (incompleteTodos.length > 0) {
          console.error(`\n🔄 Found ${incompleteTodos.length} incomplete todo(s). Resuming agent...\n`);

          const todoList = incompleteTodos
            .map((t, i) => `${i + 1}. [${t.status}] ${t.content}`)
            .join('\n');

          currentPrompt = `Continue from where you left off. The following items still need to be completed:\n\n${todoList}\n\nPlease continue working on these incomplete items and complete the task.`;
        } else {
          console.error('\n✅ All todo items completed\n');
          break;
        }
      } catch (e) {
        console.error(`\n❌ Error checking todo status: ${e.message}\n`);
        console.error(`Error details: ${e.stack}\n`);
        console.error('⚠️  Stopping agent loop due to todo check error\n');
        process.exit(1);
      }
    } else {
      console.error('\n✅ Task completed\n');
      break;
    }
  }

  if (iterationCount >= maxIterations) {
    console.error('\n⚠️  Reached maximum iterations. Stopping agent loop.\n');
  }

  cleanupInteractive();

  mcpManager.shutdown();
  process.exit(0);
}


async function runInteractiveMode() {
  console.error('\n🎯 Alfred AI - Interactive Mode');
  console.error('Start typing your prompt (Press ESC to cancel, ENTER to execute):\n');

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

  const cleanupInteractive = setupInteractiveInput((prompt) => {
    console.error(`\n📝 Executing prompt: ${prompt}\n`);

    historyManager.queueEagerPrompt(
      'interactive_prompt',
      '💬 User submitted prompt via interactive mode',
      prompt
    );

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



const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (
  resolve(process.argv[1]) === __filename ||
  process.argv[1].endsWith('alfred-ai.js') ||
  process.argv[1].endsWith('alfred-ai')
);

if (isMainModule) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'interactive') {
    runInteractiveMode().catch(error => {
      console.error('Failed to run interactive mode:', error);
      process.exit(1);
    });
  }
  else if (args.length > 0 && args[0] !== 'mcp') {
    const taskPrompt = args.join(' ');
    runCLIMode(taskPrompt).catch(error => {
      console.error('Failed to run CLI mode:', error);
      process.exit(1);
    });
  }
  else {
    main().catch(error => {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    });
  }
}

export { AlfredMCPServer, MCPManager, HistoryManager, ExecutionManager };