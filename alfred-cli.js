#!/usr/bin/env node

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { stdout, stderr } from 'process';
import AuthenticationManager from './auth-manager.js';

class AlfredMCPClient {
  constructor() {
    this.anthropic = null;
    this.authManager = new AuthenticationManager();
    this.playwrightClient = null;
    this.vexifyClient = null;
    this.availableTools = new Map();
    this.isRunning = false;
    this.runningProcesses = new Map();
    this.processCounter = 0;
    this.errorHistory = new Map();
    this.pendingAgentUpdates = [];
  }

  async connectToMCPServer(serverCommand, serverName) {
    return new Promise((resolve, reject) => {
      console.log(`🔗 Connecting to ${serverName} MCP server...`);

      const serverProcess = spawn('npx', serverCommand, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      serverProcess.on('error', (error) => {
        console.error(`❌ Failed to start ${serverName} server:`, error.message);
        reject(error);
      });

      serverProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output && !output.includes('Starting code repository crawl')) {
          console.error(`[${serverName}] ${output}`);
        }
      });

      const mockClient = {
        process: serverProcess,
        tools: new Map(),

        async initialize() {
          if (serverName === 'Playwright') {
            this.tools.set('browser_navigate', {
              description: 'Navigate to a URL in the browser',
              inputSchema: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'URL to navigate to' }
                },
                required: ['url']
              }
            });
            this.tools.set('browser_click', {
              description: 'Click an element on the page',
              inputSchema: {
                type: 'object',
                properties: {
                  element: { type: 'string', description: 'Human-readable element description' },
                  ref: { type: 'string', description: 'Element reference from snapshot' }
                },
                required: ['element', 'ref']
              }
            });
            this.tools.set('browser_snapshot', {
              description: 'Capture accessibility snapshot of the current page',
              inputSchema: { type: 'object', properties: {} }
            });
            this.tools.set('browser_screenshot', {
              description: 'Take a screenshot of the page or element',
              inputSchema: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: 'Filename for screenshot' }
                }
              }
            });
          } else if (serverName === 'Vexify') {
            this.tools.set('execute', {
              description: 'Execute code in various languages (nodejs, deno, bash, go, rust, python, c, cpp)',
              inputSchema: {
                type: 'object',
                properties: {
                  code: { type: 'string', description: 'Code to execute' },
                  runtime: { type: 'string', description: 'Runtime: nodejs, deno, bash, go, rust, python, c, cpp, auto' },
                  workingDirectory: { type: 'string', description: 'Working directory path' }
                },
                required: ['workingDirectory']
              }
            });
          }
        }
      };

      setTimeout(async () => {
        try {
          await mockClient.initialize();
          console.log(`✅ ${serverName} MCP client connected`);
          resolve(mockClient);
        } catch (error) {
          reject(error);
        }
      }, 2000);
    });
  }

  async startMCPClients() {
    try {
      this.playwrightClient = await this.connectToMCPServer(
        ['@playwright/mcp@latest'],
        'Playwright'
      );

      this.vexifyClient = await this.connectToMCPServer(
        ['-y', 'vexify@latest', 'mcp'],
        'Vexify'
      );

      for (const [name, tool] of this.playwrightClient.tools) {
        this.availableTools.set(`mcp__plugin_glootie-cc_playwright__${name}`, { ...tool, source: 'playwright' });
      }
      for (const [name, tool] of this.vexifyClient.tools) {
        this.availableTools.set(`mcp__plugin_glootie-cc_glootie__${name}`, { ...tool, source: 'vexify' });
      }

      console.log(`🛠️  Loaded ${this.availableTools.size} MCP tools for execution environment`);
    } catch (error) {
      console.error('❌ Failed to connect to MCP servers:', error.message);
      throw error;
    }
  }

  async initializeAnthropic() {
    try {
      const apiKey = await this.authManager.getAuthentication();
      this.anthropic = new Anthropic({ apiKey });
      console.log('✅ Anthropic client initialized');
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      throw error;
    }
  }

  buildExecuteToolDescription() {
    const playwrightTools = Array.from(this.availableTools.entries())
      .filter(([name]) => name.includes('playwright'))
      .map(([name, tool]) => {
        const shortName = name.replace('mcp__plugin_glootie-cc_playwright__', '');
        return `  - ${shortName}(): ${tool.description}`;
      })
      .join('\n');

    const vexifyTools = Array.from(this.availableTools.entries())
      .filter(([name]) => name.includes('glootie'))
      .map(([name, tool]) => {
        const shortName = name.replace('mcp__plugin_glootie-cc_glootie__', '');
        return `  - ${shortName}(): ${tool.description}`;
      })
      .join('\n');

    return `Execute JavaScript or Bash code in the current working directory (/mnt/c/dev/test123 or equivalent).

🔄 EXECUTION MODEL - READ THIS CAREFULLY:

1. IMMEDIATE RESPONSE (0-3 seconds):
   - Code starts executing immediately
   - Quick outputs (console.log, errors, etc.) are captured for 3 seconds
   - After 3 seconds, execution continues in BACKGROUND

2. ASYNC/BACKGROUND EXECUTION (after 3 seconds):
   - Long-running processes (servers, builds, tests) continue running
   - You receive a process ID to track them
   - You can continue making other tool calls immediately
   - Processes run independently - make as many calls as needed

3. LOG MANAGEMENT (every 60 seconds):
   - Background process logs are collected every 60 seconds
   - Logs are CLEARED after collection to prevent repetition
   - Fresh logs are EAGERLY QUEUED and injected into your next turn
   - You NEVER see the same log output twice
   - All output also streams to user's console in real-time

4. EFFICIENT WAITING:
   - DON'T use execute() with sleep commands to wait
   - USE wait_for_logs tool instead - waits 60s and delivers queued logs
   - Agent stays responsive while processes run
   - Logs automatically delivered when you wake up

5. PROCESS CONTROL:
   - check_process: Check current status of background process
   - kill_process: Stop process and receive ALL remaining logs
   - wait_for_logs: Efficiently wait for log updates (60s)

🎯 WORKFLOW EXAMPLE:
   1. execute() creates Express server → goes to background after 3s
   2. wait_for_logs to efficiently wait for startup logs
   3. execute() tests the server with Playwright
   4. kill_process to stop server and get final logs

🛠️ BEST PRACTICES:

1. Port Detection (CRITICAL):
   - ALWAYS check if ports are available FIRST
   - Use: bash -c "lsof -i :3000 || echo 'Port 3000 available'"
   - Start with uncommon ports (4000-9000) to avoid conflicts
   - If you get "Cannot GET /endpoint" errors, port has different server

2. Error Recovery:
   - If same error occurs twice, try completely different approach
   - Playwright timeouts (30s): Switch to browser_evaluate or API testing
   - JSON parse errors: Check response.status and Content-Type first
   - Syntax errors in bash: Use stdin approach instead of -c flag

3. Response Validation:
   const res = await fetch('/api/endpoint');
   if (!res.ok) {
     const text = await res.text();
     console.log('Error response:', text);
     return;
   }
   const data = await res.json(); // Only parse if OK

4. File Operations:
   - Use bash heredoc for multi-line file writes
   - Escape special characters properly
   - Always verify file creation: ls -la filename

Available MCP Tool Functions (call these directly in your code):

Playwright MCP Tools:
${playwrightTools}

Vexify MCP Tools:
${vexifyTools}

IMPORTANT: Each execute() call spawns a fresh process. Variables/state don't persist between calls.
For multi-step operations, write all logic in a single execute() call.`;
  }

  async executeCode(code, runtime = 'nodejs', processId = null) {
    processId = processId || `proc_${++this.processCounter}`;

    console.log(`\n⚡ [${processId}] Starting ${runtime} execution...`);
    console.log(`📂 Working Directory: ${process.cwd()}`);
    console.log(`⏱️  Execution Model: Immediate (0-3s) → Background (if needed)\n`);

    return new Promise((resolve) => {
      let childProcess;

      if (runtime === 'nodejs') {
        console.log(`🟢 [${processId}] Spawning: node -e <code>`);
        childProcess = spawn('node', ['-e', code], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, NODE_OPTIONS: '--no-warnings' },
          cwd: process.cwd()
        });
      } else {
        console.log(`🟢 [${processId}] Spawning: bash (stdin mode to avoid shell parsing)`);
        childProcess = spawn('bash', [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd()
        });
        childProcess.stdin.write(code);
        childProcess.stdin.end();
      }

      let stdout = '';
      let stderr = '';
      let hasResolved = false;
      let newStdoutSinceReport = '';
      let newStderrSinceReport = '';

      childProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        newStdoutSinceReport += output;
        process.stdout.write(`[${processId}] ${output}`);
      });

      childProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        newStderrSinceReport += output;
        process.stderr.write(`[${processId}] ${output}`);
      });

      const timer = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          console.log(`\n⏰ [${processId}] 3-second buffer complete. Process continues in background...`);
          console.log(`🔄 [${processId}] Status: RUNNING (async mode)`);
          console.log(`📊 [${processId}] Captured output so far:\n`);

          this.runningProcesses.set(processId, {
            process: childProcess,
            stdout,
            stderr,
            startTime: Date.now(),
            lastReportTime: Date.now(),
            getNewLogs: () => {
              const logs = { stdout: newStdoutSinceReport, stderr: newStderrSinceReport };
              newStdoutSinceReport = '';
              newStderrSinceReport = '';
              return logs;
            }
          });

          this.setupLogMonitoring(processId);

          resolve({
            processId,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            status: 'running',
            message: `Process ${processId} is running in background. Output continues streaming to console.`,
            exitCode: null
          });
        }
      }, 3000);

      childProcess.on('close', (code) => {
        clearTimeout(timer);

        console.log(`\n✅ [${processId}] Process exited with code: ${code}`);

        const procInfo = this.runningProcesses.get(processId);
        if (procInfo && procInfo.monitorInterval) {
          clearInterval(procInfo.monitorInterval);
        }
        this.runningProcesses.delete(processId);

        if (!hasResolved) {
          hasResolved = true;
          resolve({
            processId,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            status: 'completed',
            exitCode: code
          });
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timer);
        console.error(`\n❌ [${processId}] Process error:`, error.message);

        if (!hasResolved) {
          hasResolved = true;
          resolve({
            processId,
            stdout: stdout.trim(),
            stderr: stderr.trim() + `\nProcess error: ${error.message}`,
            status: 'error',
            exitCode: 1
          });
        }
      });
    });
  }

  setupLogMonitoring(processId) {
    const procInfo = this.runningProcesses.get(processId);
    if (!procInfo) return;

    const monitorInterval = setInterval(() => {
      const proc = this.runningProcesses.get(processId);
      if (!proc) {
        clearInterval(monitorInterval);
        return;
      }

      const newLogs = proc.getNewLogs();

      if (newLogs.stdout || newLogs.stderr) {
        const elapsedTime = Math.floor((Date.now() - proc.startTime) / 1000);
        console.log(`\n📊 [${processId}] Background process update (${elapsedTime}s elapsed)`);
        console.log(`📝 New output since last report:\n`);

        if (newLogs.stdout) {
          console.log(`Stdout:\n${newLogs.stdout}`);
        }
        if (newLogs.stderr) {
          console.log(`Stderr:\n${newLogs.stderr}`);
        }

        this.pendingAgentUpdates.push({
          processId,
          elapsedTime,
          newStdout: newLogs.stdout,
          newStderr: newLogs.stderr,
          timestamp: Date.now()
        });

        proc.lastReportTime = Date.now();

        console.log(`\n✅ [${processId}] Logs cleared and queued for agent\n`);
      }
    }, 60000);

    procInfo.monitorInterval = monitorInterval;
  }

  trackError(errorMessage) {
    const errorKey = errorMessage.substring(0, 100);
    const count = (this.errorHistory.get(errorKey) || 0) + 1;
    this.errorHistory.set(errorKey, count);

    if (count >= 2) {
      console.log(`\n⚠️  WARNING: Same error occurred ${count} times!`);
      console.log(`⚠️  Consider trying a completely different approach.\n`);
      return true;
    }
    return false;
  }

  async runAgenticLoop(userMessage) {
    console.log('\n🤖 Alfred Agent: Starting to process your request...\n');

    const tools = [
      {
        name: 'execute',
        description: this.buildExecuteToolDescription(),
        input_schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript or Bash code to execute. MCP tool functions are available in the execution environment.'
            },
            runtime: {
              type: 'string',
              enum: ['nodejs', 'bash', 'auto'],
              description: 'Runtime to use for execution (default: nodejs)'
            }
          },
          required: ['code']
        }
      },
      {
        name: 'check_process',
        description: 'Check status of a background process by its ID',
        input_schema: {
          type: 'object',
          properties: {
            processId: {
              type: 'string',
              description: 'Process ID returned from execute tool'
            }
          },
          required: ['processId']
        }
      },
      {
        name: 'kill_process',
        description: 'Kill a background process and receive all remaining logs. Use this to stop long-running processes.',
        input_schema: {
          type: 'object',
          properties: {
            processId: {
              type: 'string',
              description: 'Process ID to kill'
            }
          },
          required: ['processId']
        }
      },
      {
        name: 'wait_for_logs',
        description: 'Wait for 60 seconds to receive logs from background processes. Use this instead of sleep when waiting for process output. Logs will be automatically queued and delivered when you wake up.',
        input_schema: {
          type: 'object',
          properties: {
            note: {
              type: 'string',
              description: 'Optional note about what you\'re waiting for'
            }
          }
        }
      }
    ];

    const messages = [{ role: 'user', content: userMessage }];
    let continueLoop = true;
    let iterationCount = 0;
    const MAX_ITERATIONS = 20;

    while (continueLoop && iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      console.log(`\n📝 Agent Iteration ${iterationCount}/${MAX_ITERATIONS}\n`);

      if (this.pendingAgentUpdates && this.pendingAgentUpdates.length > 0) {
        console.log(`\n🔔 Injecting ${this.pendingAgentUpdates.length} background process update(s) to agent...\n`);

        const updateMessages = this.pendingAgentUpdates.map(update => {
          const message = `📊 Background Process Update: ${update.processId}\n` +
            `⏱️  Elapsed Time: ${update.elapsedTime}s\n` +
            `📝 New Output (cleared after 60s to avoid repetition):\n\n` +
            (update.newStdout ? `Stdout:\n${update.newStdout}\n\n` : '') +
            (update.newStderr ? `Stderr:\n${update.newStderr}\n\n` : '') +
            `✅ Process is still running. This is fresh output since last report.`;
          return message;
        }).join('\n\n---\n\n');

        messages.push({
          role: 'user',
          content: updateMessages
        });

        this.pendingAgentUpdates = [];
      }

      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          tools,
          messages
        });

        console.log(`💭 Agent: ${response.stop_reason}\n`);

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
          const toolResults = [];

          for (const block of response.content) {
            if (block.type === 'text') {
              console.log(`🗣️  ${block.text}\n`);
            } else if (block.type === 'tool_use') {
              console.log(`🔧 Tool: ${block.name}`);
              console.log(`📋 Input: ${JSON.stringify(block.input, null, 2)}\n`);

              if (block.name === 'execute') {
                const { code, runtime = 'nodejs' } = block.input;

                try {
                  const result = await this.executeCode(code, runtime);

                  let resultMessage = '';
                  if (result.status === 'running') {
                    resultMessage = `Process ${result.processId} started and captured initial output (3-second buffer).\n\nStatus: RUNNING IN BACKGROUND\n\nInitial Output:\nStdout:\n${result.stdout}\n\nStderr:\n${result.stderr}\n\nThe process continues running. All output streams to console in real-time.`;
                  } else {
                    resultMessage = `Process ${result.processId} completed.\n\nExit code: ${result.exitCode}\n\nStdout:\n${result.stdout}\n\nStderr:\n${result.stderr}`;

                    if (result.stderr) {
                      const isRepeatedError = this.trackError(result.stderr);
                      if (isRepeatedError) {
                        resultMessage += '\n\n⚠️ CRITICAL: This error has occurred multiple times. Try a completely different approach.';
                      }
                    }
                  }

                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: resultMessage
                  });

                } catch (error) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `Execution error: ${error.message}`,
                    is_error: true
                  });
                  console.log(`\n❌ Execution failed: ${error.message}\n`);
                }
              } else if (block.name === 'check_process') {
                const { processId } = block.input;
                const proc = this.runningProcesses.get(processId);

                if (proc) {
                  const runningTime = Math.floor((Date.now() - proc.startTime) / 1000);
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `Process ${processId} is still running (${runningTime}s elapsed).\n\nCaptured output:\nStdout:\n${proc.stdout}\n\nStderr:\n${proc.stderr}\n\nNote: Output continues streaming to console in real-time. Use wait_for_logs to efficiently wait for updates.`
                  });
                } else {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `Process ${processId} not found. It may have completed. Check console output for final results.`
                  });
                }
              } else if (block.name === 'kill_process') {
                const { processId } = block.input;
                const proc = this.runningProcesses.get(processId);

                if (proc) {
                  console.log(`\n🛑 [${processId}] Killing process by agent request...`);

                  if (proc.monitorInterval) {
                    clearInterval(proc.monitorInterval);
                  }

                  const remainingLogs = proc.getNewLogs();
                  const finalStdout = proc.stdout + (remainingLogs.stdout || '');
                  const finalStderr = proc.stderr + (remainingLogs.stderr || '');

                  proc.process.kill('SIGTERM');

                  await new Promise(resolve => setTimeout(resolve, 1000));

                  if (!proc.process.killed) {
                    console.log(`\n⚠️  [${processId}] Process didn't respond to SIGTERM, sending SIGKILL...`);
                    proc.process.kill('SIGKILL');
                  }

                  this.runningProcesses.delete(processId);

                  console.log(`\n✅ [${processId}] Process killed successfully`);

                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `Process ${processId} killed successfully.\n\nFinal captured output:\n\nStdout:\n${finalStdout}\n\nStderr:\n${finalStderr}\n\n✅ Process terminated and all remaining logs delivered.`
                  });
                } else {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `Process ${processId} not found. It may have already completed.`
                  });
                }
              } else if (block.name === 'wait_for_logs') {
                const { note } = block.input;
                console.log(`\n⏸️  Agent is waiting for logs (60s)${note ? `: ${note}` : ''}...`);
                console.log(`⏱️  Background processes will continue running and logs will be delivered automatically.\n`);

                await new Promise(resolve => setTimeout(resolve, 60000));

                const runningProcessCount = this.runningProcesses.size;
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Waited 60 seconds. ${runningProcessCount} background process(es) still running.\n\nAny new logs from background processes have been cleared and will be delivered in the next message.\n\n✅ Ready to continue. Check for background process updates above.`
                });
              }
            }
          }

          if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults });
          }
        } else if (response.stop_reason === 'end_turn') {
          for (const block of response.content) {
            if (block.type === 'text') {
              console.log(`\n✨ ${block.text}\n`);
            }
          }
          continueLoop = false;
        } else {
          console.log(`\n⚠️  Unexpected stop reason: ${response.stop_reason}\n`);
          continueLoop = false;
        }

        if (iterationCount >= MAX_ITERATIONS) {
          console.log(`\n⚠️  Reached maximum iterations (${MAX_ITERATIONS}). Ending workflow.\n`);
          continueLoop = false;
        }

      } catch (error) {
        console.error(`\n❌ Agent error: ${error.message}\n`);
        continueLoop = false;
      }
    }

    console.log('\n✅ Agent workflow complete\n');
  }

  async startInteractiveMode() {
    console.log('🤖 Alfred - AI Coding Assistant (Agentic Mode)');
    console.log('📋 Connected to: Playwright MCP + Vexify MCP');
    console.log('🛠️  MCP tools available in execution environment');
    console.log('💡 Type your requests or "exit" to quit\n');

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
        await this.runAgenticLoop(trimmed);
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

    for (const [processId, procInfo] of this.runningProcesses.entries()) {
      console.log(`🛑 Stopping background process: ${processId}`);
      procInfo.process.kill();
    }

    if (this.playwrightClient && this.playwrightClient.process) {
      this.playwrightClient.process.kill();
    }

    if (this.vexifyClient && this.vexifyClient.process) {
      this.vexifyClient.process.kill();
    }

    this.isRunning = false;
  }

  async run(args) {
    try {
      await this.startMCPClients();
      await this.initializeAnthropic();

      const command = args.length > 0 ? args.join(' ') : null;

      if (!command) {
        await this.startInteractiveMode();
      } else {
        await this.runAgenticLoop(command);
        this.cleanup();
      }
    } catch (error) {
      console.error('❌ Alfred error:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🤖 Alfred - AI Coding Assistant (Agentic Programmer)

Usage:
  alfred                    Start interactive mode
  alfred <request>         Process single request
  alfred --help           Show this help
  alfred --logout          Clear stored authentication
  alfred --version        Show version

Features:
  🎭 Playwright MCP tools available in execution environment
  ⚡ Vexify MCP tools available in execution environment
  🔧 LLM-driven code generation and execution
  🚀 Agentic workflow like Claude Code
  🔐 Browser-based authentication with secure token storage
  📦 No hardcoded functionality - agent writes all code
  ⏱️  3-second buffer → async execution model
  📊 Real-time output streaming to console

Execution Model:
  • Code executes immediately in working directory
  • Quick operations (<3s): Complete synchronously
  • Long operations (>3s): Continue in background, output streams
  • Agent stays informed via console output
  • Can make additional calls while processes run

Authentication:
  🎭 Claude Code OAuth token (auto-detected from logged-in Claude Code)
  🔑 Browser-based authentication (recommended)
  🌍 Environment variables: ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
  💾 Secure local token storage in ~/.alfred/

Examples:
  alfred "create an express server and test it in playwright"
  alfred "build a REST API with error handling"
  alfred "analyze this codebase and suggest improvements"

MCP Tools Available in Execute Environment:
  browser_navigate(), browser_click(), browser_snapshot(), browser_screenshot()
  execute() - runs code with access to all MCP tools
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const packageJson = await import('fs').then(fs => fs.promises.readFile('package.json', 'utf8').then(JSON.parse));
  console.log(`Alfred v${packageJson.version}`);
  process.exit(0);
}

if (args.includes('--logout')) {
  const authManager = new AuthenticationManager();
  await authManager.logout();
  process.exit(0);
}

const alfred = new AlfredMCPClient();
alfred.run(args).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

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
