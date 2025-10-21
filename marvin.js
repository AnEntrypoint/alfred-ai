#!/usr/bin/env node

/**
 * Marvin - A simplified, SDK-free version of codemode
 * Uses MCP client/server directly without the agent SDK
 * Named after the Hitchhiker's Guide to the Galaxy bot
 */

import { spawn, fork } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import * as fs from 'fs';
import { join, resolve, dirname } from 'path';
import { EventEmitter } from 'events';
import { createExecuteTool } from './execute-tool.js';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Global configuration (loaded after classes are defined)
let config, mcpManager, historyManager, executionManager;

function loadConfig() {
  const configPath = join(process.cwd(), '.codemode.json');

  if (!existsSync(configPath)) {
    // Auto-create config file with paths to node_modules/alfred-ai
    console.error('[Config] Creating .codemode.json with default MCP servers...');
    const defaultConfig = {
      "$schema": "https://schemas.modelcontextprotocol.io/0.1.0/mcp.json",
      "mcpServers": {
        "builtInTools": {
          "command": "node",
          "args": ["node_modules/alfred-ai/built-in-tools-mcp.js"]
        },
        "playwright": {
          "command": "npx",
          "args": ["-y", "@executeautomation/playwright-mcp-server"]
        },
        "vexify": {
          "command": "node",
          "args": ["node_modules/alfred-ai/vexify-mcp-server.js"]
        }
      }
    };

    try {
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.error('[Config] Created .codemode.json successfully');
    } catch (error) {
      throw new Error(`BRUTAL ERROR: Failed to create config file: ${error.message}`);
    }
  }

  try {
    const configData = JSON.parse(readFileSync(configPath, 'utf8'));

    // Support both formats: {mcpServers: ...} and {config: {mcpServers: ...}}
    const actualConfig = configData.config || configData;

    if (!actualConfig.mcpServers) {
      throw new Error('BRUTAL ERROR: mcpServers is undefined in config');
    }
    return {
      config: actualConfig,
      configDir: dirname(configPath)
    };
  } catch (error) {
    throw new Error(`BRUTAL ERROR: Failed to load config: ${error.message}`);
  }
}

// MCP Manager - handles direct MCP communication
class MCPManager extends EventEmitter {
  constructor(configData = null) {
    super();
    this.servers = new Map();
    this.nextId = 0;
    this.config = configData || null; // Allow passing config directly
  }

  async initialize() {
    console.error('[MCP Manager] Initializing servers...');

    // Use passed config or fall back to global config
    const configToUse = this.config || config;
    if (!configToUse || !configToUse.config || !configToUse.config.mcpServers) {
      throw new Error('No configuration provided to MCPManager');
    }

    for (const [serverName, serverConfig] of Object.entries(configToUse.config.mcpServers)) {
      if (serverName === 'marvin') continue;

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

    // Use passed config or fall back to global config
    const configToUse = this.config || config;

    // Resolve relative paths
    const resolvedArgs = serverConfig.args.map(arg => {
      if (arg.endsWith('.js') && !arg.startsWith('-') && !arg.startsWith('/')) {
        const resolved = join(configToUse.configDir, arg);
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
        clientInfo: { name: 'marvin', version: '1.0.0' }
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

    // Store call in history for cleanup (if historyManager exists)
    if (typeof historyManager !== 'undefined') {
      historyManager.recordMcpCall(serverName, toolName, args, result);
    }

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
    this.tokenCount = 0;
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

    // Remove oldest execute inputs/outputs
    if (this.executeInputs.length > 1) {
      this.executeInputs.splice(0, Math.floor(this.executeInputs.length / 2));
    }

    if (this.executeOutputs.length > 1) {
      this.executeOutputs.splice(0, Math.floor(this.executeOutputs.length / 2));
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
  }

  async execute(args) {
    const { code, runtime = 'auto', timeout = 240000 } = args;

    if (!code) {
      throw new Error('Code is required for execution');
    }

    const execId = `exec_${this.nextExecId++}`;
    console.error(`[Execution Manager] Starting execution ${execId}`);

    try {
      const result = await this.executeCode(code, runtime, timeout);

      // Store in history
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
      // Store error in history
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

  async executeCode(code, runtime, timeout) {
    return new Promise((resolve, reject) => {
      let tempFile;

      try {
        // Create temporary file
        // (tmpdir and uuidv4 are now imported at the top)

        const extension = this.getFileExtension(runtime, code);
        tempFile = join(tmpdir(), `marvin-${uuidv4()}${extension}`);

        fs.writeFileSync(tempFile, code);

        // Determine execution command
        const command = this.getExecutionCommand(runtime, tempFile);

        const child = spawn(command.cmd, command.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd()
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Execution timeout after ${timeout}ms`));
        }, timeout);

        child.on('close', (code) => {
          clearTimeout(timer);

          // Cleanup temp file
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // Ignore cleanup errors
          }

          if (code === 0) {
            resolve(stdout || (stderr ? `Warning: ${stderr}` : 'Execution completed successfully'));
          } else {
            reject(new Error(`Execution failed with code ${code}: ${stderr || stdout}`));
          }
        });

        child.on('error', (error) => {
          clearTimeout(timer);

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

  getFileExtension(runtime, code) {
    if (runtime === 'python' || code.includes('import ') && code.includes('print(')) {
      return '.py';
    }
    if (runtime === 'bash' || code.includes('#!/bin/bash') || code.includes('echo ')) {
      return '.sh';
    }
    if (runtime === 'go' || code.includes('package main')) {
      return '.go';
    }
    if (runtime === 'rust' || code.includes('fn main()')) {
      return '.rs';
    }
    if (runtime === 'c' || code.includes('#include <stdio.h>')) {
      return '.c';
    }
    if (runtime === 'cpp' || code.includes('#include <iostream>')) {
      return '.cpp';
    }
    // Default to JavaScript/TypeScript
    return code.includes('import ') || code.includes('export ') ? '.ts' : '.js';
  }

  getExecutionCommand(runtime, filepath) {
    const extension = filepath.split('.').pop();

    switch (extension) {
      case 'py':
        return { cmd: 'python3', args: [filepath] };
      case 'sh':
        return { cmd: 'bash', args: [filepath] };
      case 'go':
        return { cmd: 'go', args: ['run', filepath] };
      case 'rs':
        return { cmd: 'rustc', args: [filepath, '-o', filepath.replace('.rs', '')] };
      case 'c':
        const execFile = filepath.replace('.c', '');
        return { cmd: 'gcc', args: [filepath, '-o', execFile] };
      case 'cpp':
        const cppExecFile = filepath.replace('.cpp', '');
        return { cmd: 'g++', args: [filepath, '-o', cppExecFile] };
      case 'ts':
        return { cmd: 'npx', args: ['ts-node', filepath] };
      default:
        return { cmd: 'node', args: [filepath] };
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
class MarvinMCPServer {
  constructor() {
    this.handlers = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    // Handle tools/list
    this.handlers.set('tools/list', async (request) => {
      const allTools = mcpManager.getAllTools();
      const tools = [];

      // Add execute tool with ALL MCP tools available
      const totalTools = Object.values(allTools).reduce((sum, tools) => sum + tools.length, 0);
      const serverList = Object.keys(allTools).join(', ');

      tools.push({
        name: 'execute',
        description: `Execute JavaScript code with access to ALL ${totalTools} MCP tools from servers: ${serverList}. All tools available as async functions. Example: await builtInTools.Read({file_path: './file.txt'}), await playwright.browser_navigate({url: 'https://example.com'})`,
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript code to execute. All MCP tools available as async functions.'
            },
            workingDirectory: {
              type: 'string',
              description: 'Working directory for execution'
            }
          },
          required: ['code']
        }
      });

      // Add tools from all MCP servers
      for (const [serverName, serverTools] of Object.entries(allTools)) {
        for (const tool of serverTools) {
          tools.push({
            name: `${serverName}_${tool.name}`,
            description: `[${serverName}] ${tool.description}`,
            inputSchema: tool.inputSchema
          });
        }
      }

      // Add management tools
      tools.push({
        name: 'marvin_status',
        description: 'Get Marvin system status and history summary',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      });

      tools.push({
        name: 'marvin_kill',
        description: 'Kill a running execution',
        inputSchema: {
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

      return { tools };
    });

    // Handle tools/call
    this.handlers.set('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'execute') {
          return await this.handleExecute(args);
        } else if (name === 'marvin_status') {
          return await this.handleStatus();
        } else if (name === 'marvin_kill') {
          return await this.handleKill(args);
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
    // Use the new execute tool that provides access to ALL MCP tools
    const executeTool = await createExecuteTool(mcpManager);

    try {
      const result = await executeTool.handler(args);
      return {
        content: [{
          type: 'text',
          text: result
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
    const totalTools = Object.values(allTools).reduce((sum, tools) => sum + tools.length, 0) + 3; // +3 for marvin tools

    return {
      content: [{
        type: 'text',
        text: `Marvin System Status:
- MCP Servers: ${Object.keys(allTools).length}
- Total Tools Available: ${totalTools}
- History: ${historySummary.mcpCalls} MCP calls, ${historySummary.executeInputs} executions
- Estimated Tokens Used: ${historySummary.estimatedTokens}/60000

Active MCP Servers:
${Object.keys(allTools).map(name => `  - ${name}: ${allTools[name].length} tools`).join('\n')}

Available Tools:
  - execute: Execute code with automatic runtime detection
  - marvin_status: Show this status
  - marvin_kill: Kill running executions
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

  async handleRequest(request) {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      throw new Error(`Unknown method: ${request.method}`);
    }

    return await handler(request);
  }
}

// Main server loop
async function main() {
  console.error('Marvin - Simplified CodeMode starting...');

  // Initialize global state
  config = loadConfig();
  mcpManager = new MCPManager();
  historyManager = new HistoryManager();
  executionManager = new ExecutionManager();

  console.error('Config loaded from:', join(process.cwd(), '.codemode.json'));

  const mcpServer = new MarvinMCPServer();

  // Initialize MCP manager
  await mcpManager.initialize();

  // Initialize execution manager
  executionManager.mcpManager = mcpManager;

  console.error('Marvin ready - Accepting MCP requests via stdio');

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
    console.error('\nMarvin shutting down...');
    mcpManager.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('\nMarvin shutting down...');
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

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Failed to start Marvin:', error);
    process.exit(1);
  });
}

export { MarvinMCPServer, MCPManager, HistoryManager, ExecutionManager, loadConfig };