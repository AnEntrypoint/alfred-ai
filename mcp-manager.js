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

    for (const [serverName, serverConfig] of Object.entries(this.config.config.mcpServers)) {
      if (serverName === 'alfred-ai') continue;

      try {
        await this.startServer(serverName, serverConfig);
        console.error(`[MCP] ✓ ${serverName} server started`);
      } catch (error) {
        console.error(`[FATAL] ${serverName} server failed to start: ${error.message}`);
        process.exit(1);
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

    console.error('[MCP] Ready - All servers initialized\n');
  }

  async startServer(serverName, serverConfig) {

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


export default MCPManager;