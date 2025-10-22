#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PersistentAgenticExecutor {
  constructor() {
    this.executionContext = null;
    this.bashProcess = null;
    this.isRunning = false;
    this.progressReporter = null;
    this.currentTask = null;
    this.mcpServers = new Map();
    this.workingDirectory = process.cwd();
    this.lastProgressReport = '';
    this.executionCount = 0;
  }

  async initialize() {
    console.log('🚀 Initializing Persistent Agentic Executor...\n');

    // Initialize persistent bash context
    await this.initializeBashContext();

    // Initialize MCP servers
    await this.initializeMCPServers();

    console.log('✅ Persistent context initialized');
    console.log('📝 Available commands: reset, exit, or any programming task');
    console.log('🔄 Context persists between executions\n');
  }

  async initializeBashContext() {
    return new Promise((resolve, reject) => {
      this.bashProcess = spawn('bash', ['-i'], {
        cwd: this.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PS1: 'alfred-bash> ' }
      });

      this.bashProcess.on('error', (error) => {
        console.error('❌ Failed to initialize bash context:', error.message);
        reject(error);
      });

      // Wait for bash to be ready
      setTimeout(() => {
        console.log('✅ Persistent bash context initialized');
        resolve();
      }, 1000);
    });
  }

  async initializeMCPServers() {
    console.log('⏳ Loading MCP servers...');

    try {
      // Start Playwright MCP server
      const playwright = await this.startMCPServer('playwright', 'npx', ['-y', '@playwright/mcp@latest']);
      this.mcpServers.set('playwright', playwright);

      // Try to start vexify MCP server
      try {
        const vexify = await this.startMCPServer('vexify', 'node', [join(__dirname, 'vexify-mcp-server.js')]);
        this.mcpServers.set('vexify', vexify);
        console.log('✅ Vexify MCP server started');
      } catch (error) {
        console.log('⚠️  Vexify MCP server not available');
      }

      console.log(`✅ Loaded ${this.mcpServers.size} MCP servers`);
    } catch (error) {
      console.error('⚠️  Failed to initialize MCP servers:', error.message);
    }
  }

  async startMCPServer(name, command, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        cwd: this.workingDirectory
      });

      let nextId = 1;
      const pendingRequests = new Map();

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line);
            if (response.id && pendingRequests.has(response.id)) {
              const { resolve } = pendingRequests.get(response.id);
              pendingRequests.delete(response.id);
              resolve(response.result);
            }
          } catch (e) {}
        }
      });

      const sendRequest = async (method, params) => {
        return new Promise((resolve) => {
          const id = nextId++;
          pendingRequests.set(id, { resolve });
          proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
          setTimeout(() => {
            if (pendingRequests.has(id)) {
              pendingRequests.delete(id);
              resolve(null);
            }
          }, 30000);
        });
      };

      proc.on('error', reject);

      // Initialize and get tools
      setTimeout(async () => {
        try {
          await sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'alfred-persistent', version: '1.0.0' }
          });

          const toolsList = await sendRequest('tools/list', {});
          resolve({
            proc,
            sendRequest,
            tools: toolsList?.tools || [],
            command,
            args
          });
        } catch (error) {
          reject(error);
        }
      }, 2000);
    });
  }

  async resetContext() {
    console.log('🔄 Resetting execution context...');

    // Stop existing processes
    if (this.bashProcess) {
      this.bashProcess.kill();
    }

    for (const [name, server] of this.mcpServers) {
      server.proc.kill();
    }
    this.mcpServers.clear();

    // Clear progress reporter
    if (this.progressReporter) {
      clearInterval(this.progressReporter);
      this.progressReporter = null;
    }

    // Reinitialize
    await this.initialize();

    console.log('✅ Context reset complete');
  }

  async executeBash(command) {
    if (!this.bashProcess) {
      throw new Error('Bash context not initialized');
    }

    return new Promise((resolve, reject) => {
      // Clear any pending input
      this.bashProcess.stdin.write('\n');

      // Send command
      this.bashProcess.stdin.write(`${command}\n`);

      let output = '';
      let isCollecting = false;
      let commandComplete = false;

      const stdoutHandler = (data) => {
        const chunk = data.toString();
        output += chunk;

        // Detect when command output starts and ends
        if (chunk.includes('alfred-bash>')) {
          if (isCollecting) {
            commandComplete = true;
            this.bashProcess.stdout.off('data', stdoutHandler);
            const result = output.replace(/.*?alfred-bash>\s*/, '').replace(/alfred-bash>.*$/, '').trim();
            resolve({ stdout: result, stderr: '', exitCode: 0 });
          }
        } else {
          isCollecting = true;
          process.stdout.write(chunk);
        }
      };

      this.bashProcess.stdout.on('data', stdoutHandler);

      // Handle errors
      this.bashProcess.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!commandComplete) {
          this.bashProcess.stdout.off('data', stdoutHandler);
          resolve({ stdout: output, stderr: 'Command timeout', exitCode: 1 });
        }
      }, 30000);
    });
  }

  async executeJS(code) {
    // Import the execute function from executor.js
    const { execute } = await import('./executor.js');

    // Generate MCP tool wrappers
    const mcpWrappers = this.generateMCPWrappers();

    try {
      const result = await execute({
        code,
        mcpWrappers,
        workingDirectory: this.workingDirectory
      });

      return result;
    } catch (error) {
      return {
        stdout: '',
        stderr: error.message,
        exitCode: 1
      };
    }
  }

  generateMCPWrappers() {
    const wrappers = [];

    for (const [serverName, server] of this.mcpServers) {
      for (const tool of server.tools) {
        wrappers.push(this.createMCPToolWrapper(tool.name, serverName, server));
      }
    }

    return wrappers.join('\n\n');
  }

  createMCPToolWrapper(toolName, serverName, server) {
    return `const ${toolName} = async (args) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('${server.command}', ${JSON.stringify(server.args)}, {
      stdio: ['pipe', 'pipe', 'ignore'],
      cwd: process.cwd()
    });

    let id = 1;
    const pending = new Map();

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.id && pending.has(resp.id)) {
            pending.get(resp.id).resolve(resp.result);
            pending.delete(resp.id);
          }
        } catch (e) {}
      }
    });

    const sendReq = (method, params) => new Promise((resolve) => {
      const reqId = id++;
      pending.set(reqId, { resolve });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\\n');
      setTimeout(() => {
        if (pending.has(reqId)) {
          pending.delete(reqId);
          resolve(null);
        }
      }, 30000);
    });

    proc.on('error', reject);

    (async () => {
      try {
        await sendReq('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'exec', version: '1.0.0' }
        });
        const result = await sendReq('tools/call', { name: '${toolName}', arguments: args });
        proc.kill();

        if (result && result.content && result.content[0]?.type === 'text') {
          resolve(result.content[0].text);
        } else {
          resolve(result ? JSON.stringify(result) : null);
        }
      } catch (error) {
        proc.kill();
        reject(error);
      }
    })();
  });
};`;
  }

  startProgressReporter() {
    let lastReport = '';

    this.progressReporter = setInterval(() => {
      const report = `[${new Date().toISOString()}] Task in progress: ${this.currentTask || 'Unknown'} (Execution #${this.executionCount})`;

      // Clear previous progress line and show new one
      if (lastReport) {
        process.stdout.write('\r\x1b[K'); // Clear line
      }
      process.stdout.write(`\n${report}\n`);
      lastReport = report;
    }, 60000); // Report every 60 seconds
  }

  stopProgressReporter() {
    if (this.progressReporter) {
      clearInterval(this.progressReporter);
      this.progressReporter = null;
    }
  }

  async executeTask(task) {
    this.currentTask = task;
    this.executionCount++;
    this.isRunning = true;

    console.log(`🎯 Starting task execution #${this.executionCount}`);
    console.log(`📝 Task: ${task}\n`);

    // Start progress reporter
    this.startProgressReporter();

    try {
      // Initial 3-second block to get started
      console.log('⏳ Planning execution (3s)...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Here you would integrate with your LLM of choice
      // For now, simulate execution planning
      const plan = `async function main() {
  try {
    console.log('Executing task: ${task}');

    // Your execution logic here
    // This would be replaced with actual LLM-generated code

    console.log('✅ Task completed successfully');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}`;

      console.log('💭 Execution plan ready');
      console.log('⚙️  Executing...\n');

      // Execute the plan (this would be the LLM-generated code)
      const result = await this.executeJS(plan);

      console.log(`\n📤 OUTPUT:\n${result.stdout}`);
      if (result.stderr) {
        console.log(`⚠️  STDERR:\n${result.stderr}`);
      }

      return result;

    } catch (error) {
      console.error('❌ Task execution failed:', error.message);
      return { stdout: '', stderr: error.message, exitCode: 1 };
    } finally {
      this.isRunning = false;
      this.stopProgressReporter();
      this.currentTask = null;
    }
  }

  async startInteractive() {
    await this.initialize();

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log('🎯 Persistent Agentic Executor Ready!');
    console.log('Commands:');
    console.log('  reset    - Reset execution context and reload MCP tools');
    console.log('  exit     - Exit the executor');
    console.log('  Any text - Execute as a programming task\n');

    while (true) {
      try {
        const input = await askQuestion('alfred> ');

        if (!input.trim()) continue;

        if (input.toLowerCase() === 'exit') {
          console.log('👋 Goodbye!');
          break;
        }

        if (input.toLowerCase() === 'reset') {
          await this.resetContext();
          continue;
        }

        // Execute as task
        await this.executeTask(input);
        console.log(''); // Add spacing

      } catch (error) {
        console.error('❌ Error:', error.message);
      }
    }

    // Cleanup
    this.cleanup();
    rl.close();
  }

  cleanup() {
    console.log('🧹 Cleaning up...');

    if (this.bashProcess) {
      this.bashProcess.kill();
    }

    for (const [name, server] of this.mcpServers) {
      server.proc.kill();
    }

    this.stopProgressReporter();

    console.log('✅ Cleanup complete');
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node persistent-agentic-mode.js "your task here"');
  console.error('   or: node persistent-agentic-mode.js (for interactive mode)');
  process.exit(1);
}

const executor = new PersistentAgenticExecutor();

if (args[0] === '--interactive') {
  executor.startInteractive();
} else {
  // Execute single task
  const task = args.join(' ');
  executor.executeTask(task).then(() => {
    executor.cleanup();
    process.exit(0);
  }).catch((error) => {
    console.error('❌ Execution failed:', error.message);
    executor.cleanup();
    process.exit(1);
  });
}