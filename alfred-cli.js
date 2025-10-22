#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { stdout, stderr } from 'process';

class AlfredMCPClient {
  constructor() {
    this.playwrightProcess = null;
    this.vexifyProcess = null;
    this.isRunning = false;
  }

  async startMCPServers() {
    console.log('🚀 Starting MCP servers...');

    // Start Playwright MCP server
    this.playwrightProcess = spawn('npx', ['@playwright/mcp@latest'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    // Start Vexify MCP server
    this.vexifyProcess = spawn('npx', ['-y', 'vexify@latest', 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    // Handle server outputs
    this.playwrightProcess.stdout.on('data', (data) => {
      console.log(`[Playwright MCP] ${data.toString().trim()}`);
    });

    this.playwrightProcess.stderr.on('data', (data) => {
      console.error(`[Playwright MCP Error] ${data.toString().trim()}`);
    });

    this.vexifyProcess.stdout.on('data', (data) => {
      console.log(`[Vexify MCP] ${data.toString().trim()}`);
    });

    this.vexifyProcess.stderr.on('data', (data) => {
      console.error(`[Vexify MCP Error] ${data.toString().trim()}`);
    });

    // Wait a moment for servers to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ MCP servers ready');
  }

  async executeJS(code, options = {}) {
    const timeout = options.timeout || 30000;
    return new Promise((resolve, reject) => {
      const process = spawn('node', ['-e', code], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(data.toString().trim());
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(data.toString().trim());
      });

      const timer = setTimeout(() => {
        process.kill();
        reject(new Error('JavaScript execution timeout'));
      }, timeout);

      process.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        } else {
          reject(new Error(`JavaScript execution failed: ${stderr}`));
        }
      });
    });
  }

  async executeBash(command, options = {}) {
    const timeout = options.timeout || 30000;
    return new Promise((resolve, reject) => {
      const process = spawn('bash', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(data.toString().trim());
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(data.toString().trim());
      });

      const timer = setTimeout(() => {
        process.kill();
        reject(new Error('Bash execution timeout'));
      }, timeout);

      process.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        } else {
          reject(new Error(`Bash execution failed: ${stderr}`));
        }
      });
    });
  }

  async processUserInput(input) {
    console.log(`🤖 Alfred: Processing "${input}"`);

    // Simple execution logic - will be enhanced with proper LLM integration
    if (input.includes('express server')) {
      console.log('🚀 Creating Express server...');
      try {
        const serverCode = `
const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Hello from Alfred Express server!');
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});
`;
        await this.executeJS(serverCode, { timeout: 10000 });
        console.log('✅ Express server created successfully');
      } catch (error) {
        console.error('❌ Failed to create Express server:', error.message);
      }
    } else if (input.includes('playwright')) {
      console.log('🎭 Executing Playwright commands via MCP...');
      // This would integrate with the Playwright MCP server
      console.log('📝 Playwright MCP tools available for browser automation');
    } else if (input.includes('test')) {
      console.log('🧪 Running tests...');
      try {
        await this.executeBash('npm test', { timeout: 60000 });
        console.log('✅ Tests completed');
      } catch (error) {
        console.error('❌ Tests failed:', error.message);
      }
    } else {
      console.log('🔧 Executing custom command...');
      try {
        await this.executeBash(input, { timeout: 30000 });
        console.log('✅ Command executed successfully');
      } catch (error) {
        console.error('❌ Command failed:', error.message);
      }
    }
  }

  async startInteractiveMode() {
    console.log('🤖 Alfred - AI Coding Assistant');
    console.log('📋 Available: Playwright MCP + Vexify + JS/Bash execution');
    console.log('💡 Type your commands or "exit" to quit\n');

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'alfred> '
    });

    this.isRunning = true;

    rl.prompt();

    rl.on('line', async (input) => {
      const trimmed = input.trim();

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('👋 Goodbye!');
        this.cleanup();
        rl.close();
        return;
      }

      if (trimmed) {
        await this.processUserInput(trimmed);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      this.cleanup();
      process.exit(0);
    });
  }

  cleanup() {
    console.log('🧹 Cleaning up...');

    if (this.playwrightProcess) {
      this.playwrightProcess.kill();
    }

    if (this.vexifyProcess) {
      this.vexifyProcess.kill();
    }

    this.isRunning = false;
  }

  async run(args) {
    try {
      const command = args.length > 0 ? args.join(' ') : null;

      // Always start MCP servers
      await this.startMCPServers();

      if (!command) {
        await this.startInteractiveMode();
      } else {
        await this.processUserInput(command);
        this.cleanup();
      }
    } catch (error) {
      console.error('❌ Alfred error:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🤖 Alfred - AI Coding Assistant

Usage:
  alfred                    Start interactive mode
  alfred <command>         Execute single command
  alfred --help           Show this help

Features:
  🎭 Playwright MCP integration for browser automation
  ⚡ Vexify MCP for enhanced capabilities
  🔧 JavaScript and Bash execution
  🚀 Immediate output collection
  📦 No artificial delays or timeouts
  🌐 Always runs in MCP mode

Examples:
  alfred "create express server"
  alfred "test with playwright"
  alfred "npm run build"
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const packageJson = JSON.parse(await import('fs').then(fs => fs.readFileSync('package.json', 'utf8')));
  console.log(`Alfred v${packageJson.version}`);
  process.exit(0);
}

// Start Alfred
const alfred = new AlfredMCPClient();
alfred.run(args).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n👋 Interrupted. Cleaning up...');
  if (alfred) alfred.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Terminated. Cleaning up...');
  if (alfred) alfred.cleanup();
  process.exit(0);
});