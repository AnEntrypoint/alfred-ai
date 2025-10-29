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



class MCPManager extends EventEmitter {
  constructor(config = null, originalCwd = null) {
    super();
    this.servers = new Map();
    this.nextId = 0;
    this.playwrightServers = [];
    this.playwrightServerUsage = new Map();
    this.config = config;
    this.originalCwd = originalCwd || process.cwd();
  }

  async initialize() {
    console.error('[MCP] Initializing servers...');
    if (!this.config || !this.config.config || !this.config.config.mcpServers) {
      console.error('[FATAL] No MCP servers configured - set mcpServers in config');
      process.exit(1);
    }

    const serverNames = Object.keys(this.config.config.mcpServers).filter(s => s !== 'alfred-ai');
    console.error(`[MCP] Starting ${serverNames.length} configured servers: ${serverNames.join(', ')}`);

    const failedServers = [];

    for (const [serverName, serverConfig] of Object.entries(this.config.config.mcpServers)) {
      if (serverName === 'alfred-ai') continue;

      try {
        await this.startServer(serverName, serverConfig);
        console.error(`[MCP] ✓ ${serverName} server started`);
      } catch (error) {
        console.error(`[MCP] ✗ ${serverName} server failed: ${error.message}`);
        failedServers.push(serverName);
        this.servers.delete(serverName);
      }
    }

    // Register virtual builtInTools server after all real servers initialized
    if (!this.servers.has('builtInTools')) {
      this.servers.set('builtInTools', {
        process: null,
        tools: [],
        nextId: 0,
        buffer: '',
        pendingCalls: new Map(),
        isVirtual: true
      });
      console.error('[MCP] ✓ Registered virtual builtInTools server');
    }

    const successCount = serverNames.length - failedServers.length;
    if (successCount === 0) {
      console.error('[WARNING] No MCP servers initialized, using built-in tools only');
    } else {
      console.error(`[MCP] Ready - ${successCount} of ${serverNames.length} servers initialized`);
    }
    if (failedServers.length > 0) {
      console.error(`[MCP] Failed servers: ${failedServers.join(', ')}`);
    }
    console.error('[MCP] Continuing with available servers\n');
  }

  async startServer(serverName, serverConfig) {
    console.error(`[${serverName}] Starting server with: ${serverConfig.command} ${serverConfig.args.join(' ')}`);

    const resolvedArgs = serverConfig.args.map(arg => {
      if (arg.endsWith('.js') && !arg.startsWith('-') && !arg.startsWith('/')) {
        const resolved = join(this.config.configDir, arg);
        return resolved;
      }
      return arg;
    });

    const proc = spawn(serverConfig.command, resolvedArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.originalCwd
    });

    const serverState = {
      process: proc,
      tools: [],
      nextId: 0,
      buffer: '',
      pendingCalls: new Map(),
      lastActivity: Date.now()
    };

    this.servers.set(serverName, serverState);

    let hasError = false;
    let errorMessage = '';

    proc.stdout.on('data', (data) => {
      serverState.lastActivity = Date.now();
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
      const errText = data.toString();
      if (errText.includes('error') || errText.includes('Error') || errText.includes('ENOENT')) {
        hasError = true;
        errorMessage += errText;
      }
    });

    proc.on('error', (err) => {
      console.error(`[${serverName}] Process error: ${err.message}`);
      hasError = true;
      errorMessage = err.message;
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        hasError = true;
        errorMessage = `Process exited with code ${code}`;
      }
    });

    try {
      console.error(`[${serverName}] Sending initialize request...`);
      await this.sendRequestWithTimeout(serverName, {
        jsonrpc: '2.0',
        id: serverState.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'alfred-ai', version: '1.0.0' }
        }
      }, 30000);

      console.error(`[${serverName}] Requesting tools list...`);
      const toolsResult = await this.sendRequestWithTimeout(serverName, {
        jsonrpc: '2.0',
        id: serverState.nextId++,
        method: 'tools/list'
      }, 30000);

      if (!toolsResult || !toolsResult.tools) {
        throw new Error(`Invalid tools response: ${JSON.stringify(toolsResult)}`);
      }

      serverState.tools = toolsResult.tools;
      console.error(`[${serverName}] ✓ Server ready with ${serverState.tools.length} tools`);

      if (serverState.tools.length > 0) {
        const toolNames = serverState.tools.map(t => t.name).join(', ');
        console.error(`[${serverName}] Tools: ${toolNames.substring(0, 200)}`);
      }

      if (serverName.startsWith('playwright')) {
        this.playwrightServers.push(serverName);
        this.playwrightServerUsage.set(serverName, 0);
      }
    } catch (error) {
      proc.kill('SIGTERM');
      throw new Error(`${serverName} initialization failed: ${error.message}${errorMessage ? ` (stderr: ${errorMessage.substring(0, 200)})` : ''}`);
    }
  }

  async sendRequestWithTimeout(serverName, request, timeoutMs = 30000) {
    const serverState = this.servers.get(serverName);
    if (!serverState) {
      throw new Error(`MCP server ${serverName} not found`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverState.pendingCalls.delete(request.id);
        reject(new Error(`MCP request timeout (${timeoutMs}ms) for ${serverName}`));
      }, timeoutMs);

      serverState.pendingCalls.set(request.id, {
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });

      try {
        serverState.process.stdin.write(JSON.stringify(request) + '\n');
      } catch (error) {
        clearTimeout(timeout);
        serverState.pendingCalls.delete(request.id);
        reject(new Error(`Failed to send request to ${serverName}: ${error.message}`));
      }
    });
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
      }, 120000);

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


export default MCPManager;