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
    this.alfredClient = null;
    this.availableTools = new Map();
    this.isRunning = false;
    this.runningProcesses = new Map();
    this.processCounter = 0;
    this.errorHistory = new Map();
    this.pendingAgentUpdates = [];
    this.agentTodoList = [];

    // Interactive prompt management
    this.promptQueue = [];
    this.isAgentBusy = false;
    this.promptVisible = true;
    this.currentInput = '';
    this.lastEscTime = 0;
    this.rl = null;
    this.escSequenceTimeout = null;
  }

  showInteractivePrompt() {
    if (!this.promptVisible && this.rl) {
      this.promptVisible = true;
      this.rl.write(this.currentInput);
      this.rl.prompt();
    }
  }

  hideInteractivePrompt() {
    if (this.promptVisible && this.rl) {
      this.promptVisible = false;
      // Clear current line and hide prompt
      this.rl.write(null, { ctrl: true, name: 'u' }); // Clear line
      process.stdout.write('\x1b[1A\x1b[2K'); // Move up and clear line
    }
  }

  clearCurrentInput() {
    this.currentInput = '';
    if (this.promptVisible && this.rl) {
      this.rl.write(null, { ctrl: true, name: 'u' }); // Clear line
      this.rl.prompt();
    }
  }

  processQueue() {
    if (this.promptQueue.length > 0 && !this.isAgentBusy) {
      const nextRequest = this.promptQueue.shift();
      if (nextRequest) {
        this.runAgenticLoop(nextRequest);
      }
    }
  }

  setupInteractiveHandlers() {
    // Handle raw input for ESC key detection
    process.stdin.setRawMode(true);
    process.stdin.on('data', (key) => {
      const str = key.toString();

      // ESC key detection
      if (str === '\x1b') {
        const currentTime = Date.now();

        if (currentTime - this.lastEscTime < 300) {
          // Double ESC - clear current input
          this.clearCurrentInput();
          console.log('\n🗑️  Prompt cleared');
        } else {
          // Single ESC - toggle visibility
          this.lastEscTime = currentTime;
          if (this.promptVisible) {
            this.hideInteractivePrompt();
            console.log('\n👁️  Prompt hidden (press any key to show, ESC again to clear)');
          } else {
            this.showInteractivePrompt();
          }
        }

        // Clear any existing timeout
        if (this.escSequenceTimeout) {
          clearTimeout(this.escSequenceTimeout);
        }

        // Reset after timeout if no second ESC
        this.escSequenceTimeout = setTimeout(() => {
          this.lastEscTime = 0;
        }, 400);
      } else if (!this.promptVisible) {
        // Any other key while hidden - show prompt
        this.showInteractivePrompt();
        // Forward the key to readline if it's not ESC
        if (str !== '\x1b' && this.rl) {
          this.rl.write(str);
        }
      }
    });

    // Set raw mode back to normal for readline
    process.stdin.setRawMode(false);
  }

  updatePromptStatus(busy) {
    this.isAgentBusy = busy;

    if (busy && this.promptVisible) {
      // Agent is busy, hide prompt to avoid interference
      this.hideInteractivePrompt();
      console.log('\n⏳ Agent busy with current request...');
      console.log('💭 You can type next request (hidden until agent finishes)');
      console.log('👁️  Press ESC to toggle prompt visibility, ESC+ESC to clear');
    } else if (!busy) {
      // Agent is free, show prompt and process queue
      this.showInteractivePrompt();
      this.processQueue();
    }
  }

  async connectToMCPServer(serverCommand, serverName) {
    return new Promise((resolve, reject) => {
      console.log(`🔗 Connecting to ${serverName} MCP server...`);

      const serverProcess = spawn('npx', serverCommand, {
        stdio: ['pipe', 'pipe', 'pipe']
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

      this.alfredClient = await this.connectToMCPServer(
        ['-y', 'alfred-ai@latest', 'mcp'],
        'Alfred'
      );

      for (const [name, tool] of this.playwrightClient.tools) {
        this.availableTools.set(`mcp__plugin_glootie-cc_playwright__${name}`, { ...tool, source: 'playwright' });
      }
      for (const [name, tool] of this.vexifyClient.tools) {
        this.availableTools.set(`mcp__plugin_glootie-cc_glootie__${name}`, { ...tool, source: 'vexify' });
      }
      for (const [name, tool] of this.alfredClient.tools) {
        this.availableTools.set(`mcp__plugin_alfred__${name}`, { ...tool, source: 'alfred' });
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

    const alfredTools = Array.from(this.availableTools.entries())
      .filter(([name]) => name.includes('alfred'))
      .map(([name, tool]) => {
        const shortName = name.replace('mcp__plugin_alfred__', '');
        return `  - ${shortName}(prompt): ${tool.description}`;
      })
      .join('\n');

    return `Execute JavaScript or Bash code in the current working directory (/mnt/c/dev/test123 or equivalent).

🚨 CRITICAL WORKFLOW - FILE CREATION IS MANDATORY:

Your PRIMARY GOAL is to create PERSISTENT FILES in the codebase, NOT just execute temporary code.

MANDATORY WORKFLOW FOR ALL REQUESTS:
1. FIRST: Write code to FILES using bash commands (cat with heredoc, echo, etc.)
2. SECOND: Verify files exist with ls -la
3. THIRD (optional): Test the files by executing them
4. NEVER skip step 1 - files MUST be created before you're done

EXAMPLES OF CORRECT WORKFLOW:

Request: "create an express server"
✅ CORRECT:
  Step 1: execute(bash) - Write server.js using cat > server.js <<'EOF' ... EOF
  Step 2: execute(bash) - Verify with ls -la server.js
  Step 3: execute(bash) - npm init -y and npm install express
  Step 4 (optional): execute(nodejs) - node server.js to test

❌ WRONG:
  execute(nodejs) - Just run express server code without saving to files

Request: "implement xstate compute engine"
✅ CORRECT:
  Step 1: execute(bash) - Write state-machine.js, executor.js, etc. to FILES
  Step 2: execute(bash) - Verify files with ls -la *.js
  Step 3: execute(bash) - npm install xstate
  Step 4 (optional): execute(nodejs) - Run tests to verify

❌ WRONG:
  execute(nodejs) - Just run xstate code without creating persistent files

THE USER NEEDS FILES, NOT TEMPORARY EXECUTION RESULTS.
If you complete a task without creating persistent files, YOU HAVE FAILED.

🔄 EXECUTION MODEL - READ THIS CAREFULLY:

1. IMMEDIATE RESPONSE (0-10 seconds):
   - Code starts executing immediately
   - Quick outputs (console.log, errors, etc.) are captured for 10 seconds
   - After 10 seconds, execution continues in BACKGROUND

2. ASYNC/BACKGROUND EXECUTION (after 10 seconds):
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
   1. execute() creates Express server → goes to background after 10s
   2. wait_for_logs to efficiently wait for startup logs
   3. Use Playwright MCP tools to test the server
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

🎭 PLAYWRIGHT MCP TOOLS (Browser Automation - ONLY in execute(nodejs)):
${playwrightTools}

⚠️  MCP TOOLS - CRITICAL USAGE RULES:
1. PLAYWRIGHT TOOLS ARE ONLY AVAILABLE INSIDE execute(nodejs) BLOCKS
2. They are AUTOMATICALLY INJECTED by the MCP layer when execute() runs
3. You CANNOT import or require them - they just exist in the environment
4. Use FULL QUALIFIED NAME with DASHES: mcp__plugin_glootie-cc_playwright__[tool_name]

✅ CORRECT USAGE - FULL CONCRETE EXAMPLE:
execute(nodejs) with this code:
---
(async () => {
  await mcp__plugin_glootie-cc_playwright__browser_navigate('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  const snapshot = await mcp__plugin_glootie-cc_playwright__browser_snapshot();
  console.log('Page loaded');
})();
---

❌ WRONG - DON'T DO THIS:
- Don't try: const { browser_navigate } = require('@modelcontextprotocol/sdk');
- Don't try: await browser_navigate('http://...');  (missing mcp__ prefix)
- Don't try: await mcp__plugin_glootie_cc_playwright__... (wrong - use DASHES not underscores after glootie)
- Don't try: await mcp__plugin_glootie-cc_playwright__browser_navigate(...) OUTSIDE execute()
- Don't try to use these tools in bash/terminal - they only work in nodejs

🔧 VEXIFY MCP TOOLS (Code Execution & Testing):
${vexifyTools}

🤖 ALFRED MCP TOOLS (Recursive AI Agent):
${alfredTools}

STATE MANAGEMENT:
- MCP tool servers (Playwright, Vexify, Alfred) maintain persistent state between execute() calls
- Browser sessions, processes, and other resources persist across multiple execute() calls
- Each execute() spawns a fresh Node.js/Bash process, but MCP servers remain connected
- Call execute(nodejs) multiple times to interact with same browser session`;
  }

  queuePostCompletionInstructions() {
    const postCompletionPrompt = `
🚨 MANDATORY POST-COMPLETION WORKFLOW:
After completing your user's task, you MUST ALWAYS perform these steps in order:

1. UPDATE README.md:
   - Document what was built, features, installation, and usage
   - Include file structure and dependencies
   - This is NOT optional - do it every single time

2. GIT OPERATIONS (if in git repo):
   - git add .
   - git commit with descriptive commit message
   - git push to remote repository
   - Handle any merge conflicts appropriately

3. DEPLOY (if applicable):
   - If the project is deployable (web app, API, etc.)
   - Deploy to appropriate platform (Vercel, Netlify, Heroku, etc.)
   - Verify deployment success

4. NPM PUBLISH (if npm package):
   - If you created a package.json with name/version
   - Update version number if needed
   - npm publish to make package available

✅ These steps are MANDATORY completion requirements
✅ Always inform the user what post-completion steps you performed
✅ Never skip these steps unless user explicitly tells you to stop

Please perform these post-completion steps now.`;

    this.promptQueue.push(postCompletionPrompt);
    console.log(`\n📋 Post-completion instructions queued for agent\n`);
  }

  async executeCode(code, runtime = 'nodejs', processId = null) {
    processId = processId || `proc_${++this.processCounter}`;

    console.log(`\n⚡ [${processId}] Starting ${runtime} execution...\n`);

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
      }, 10000);

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
    // Set agent as busy
    this.updatePromptStatus(true);
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
        name: 'todo_list',
        description: 'Manage your todo list to track progress on complex tasks. Use this to organize multi-step work and provide visibility into your progress.',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'update', 'list', 'clear'],
              description: 'Action to perform on todo list'
            },
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: {
                    type: 'string',
                    description: 'Description of the task to do'
                  },
                  status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed'],
                    description: 'Current status of the task'
                  },
                  activeForm: {
                    type: 'string',
                    description: 'Present continuous form of the task (e.g., "Creating files", "Testing application")'
                  }
                },
                required: ['content', 'status', 'activeForm']
              },
              description: 'Array of todo items (required for create/update actions)'
            }
          },
          required: ['action']
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

    // Smart prompt history management function
    const manageHistory = (msgArray) => {
      const ONE_KB = 1024;
      const MIN_HISTORY_LENGTH = 4; // Always keep first user message + at least 2 exchanges

      // If we have fewer than 8 messages, keep everything (early conversation)
      if (msgArray.length < 8) {
        return msgArray;
      }

      // If we have more than 20 messages, we need to prune
      if (msgArray.length > 20) {
        const result = [msgArray[0]]; // Keep original user message
        const recentMessages = msgArray.slice(-10); // Keep last 10 messages
        const middleMessages = msgArray.slice(1, -10);

        // Process middle messages - keep short ones, remove long ones
        for (let i = 0; i < middleMessages.length; i += 2) {
          const userMsg = middleMessages[i];
          const assistantMsg = middleMessages[i + 1];

          if (userMsg && userMsg.content) {
            const userSize = JSON.stringify(userMsg.content).length;

            // Keep short user messages (<1KB), skip long ones
            if (userSize < ONE_KB) {
              result.push(userMsg);
              if (assistantMsg) result.push(assistantMsg);
            } else {
              // For long messages, add a summary instead
              result.push({
                role: userMsg.role,
                content: `[Previous long user request (${Math.round(userSize/1024)}KB) - context preserved for long-run intelligence]`
              });
              if (assistantMsg) {
                result.push({
                  role: assistantMsg.role,
                  content: `[Previous assistant response to long request - context preserved for long-run intelligence]`
                });
              }
            }
          }
        }

        return [...result, ...recentMessages];
      }

      return msgArray;
    };

    while (continueLoop) {
      iterationCount++;
      console.log(`\n📝 Agent Iteration ${iterationCount}`);

      if (this.pendingAgentUpdates && this.pendingAgentUpdates.length > 0) {
        console.log(`🔔 Injecting ${this.pendingAgentUpdates.length} background process update(s)`);

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
          system: `You are Alfred, an AI coding assistant. Your PRIMARY GOAL is to create PERSISTENT FILES in the codebase, NOT to execute temporary code.

MANDATORY FILE-FIRST WORKFLOW:
Every request MUST follow this order:
1. FIRST: Write code to FILES using bash (cat > file.js <<'EOF' ... EOF)
2. SECOND: Verify files with ls -la
3. THIRD (optional): Test the files with execute()
4. You have FAILED if you don't create persistent files

CRITICAL RULES - NO EXCEPTIONS:
- NEVER execute code without first saving it to files
- NEVER complete a task without creating .js/.html/.css/etc. files
- NEVER think "the user just wants to see output" - they want FILES
- ALWAYS use execute(bash) with heredoc to write files FIRST
- ALWAYS verify file creation with ls -la SECOND
- ALWAYS use execute() to test files THIRD (optional)

ABOUT PLAYWRIGHT MCP TOOLS FOR BROWSER TESTING:
When asked to "test with Playwright MCP", you have access to browser automation tools ONLY when using execute(nodejs):
- await mcp__plugin_glootie-cc_playwright__browser_navigate('http://...')
- await mcp__plugin_glootie-cc_playwright__browser_click('selector')
- await mcp__plugin_glootie-cc_playwright__browser_screenshot()
- await mcp__plugin_glootie-cc_playwright__browser_snapshot()
These are ONLY available INSIDE execute(nodejs) code. Do NOT try to use them outside execute() or in bash.

EXAMPLES:
Request: "create express server"
  Step 1: execute(bash, "cat > server.js <<'EOF'\n...\nEOF")
  Step 2: execute(bash, "ls -la server.js && cat server.js")
  Step 3: execute(bash, "npm init -y && npm install express")
  Step 4 (optional): execute(nodejs, "node server.js")

Request: "implement xstate engine"
  Step 1: execute(bash, "cat > engine.js <<'EOF'\n...\nEOF")
  Step 2: execute(bash, "ls -la *.js")
  Step 3: execute(bash, "npm install xstate")
  Step 4 (optional): Test execution

PROGRESS TRACKING:
- Use todo_list tool to track complex multi-step tasks
- Helps organize work and provides visibility into progress
- Especially useful for projects with multiple files/steps

THE USER NEEDS PERSISTENT FILES. If you skip file creation, YOU HAVE FAILED THE TASK.

CRITICAL - NO EXTRA SUMMARY FILES ALLOWED:
- NEVER create extra .md files except README.md
- NEVER create docs/ folders or additional documentation files
- NEVER create summary files that just describe what was done
- ALWAYS maintain and update README.md for the project
- ONLY create functional code files (.js, .html, .css, .json, etc.)
- ONLY create files that actually DO something when executed

RULE: README.md is REQUIRED and should be updated with project details
RULE: NO other .md files, documentation, or summaries unless explicitly requested

Focus on the user's immediate task. Do not perform any post-completion steps unless explicitly requested.`,
          tools,
          messages
        });

        console.log(`Agent: ${response.stop_reason}`);

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'tool_use') {
          const toolResults = [];

          for (const block of response.content) {
            if (block.type === 'text') {
              console.log(`Response: ${block.text}\n`);
            } else if (block.type === 'tool_use') {
              console.log(`Tool: ${block.name}`);
              console.log(`Input: ${JSON.stringify(block.input, null, 2)}\n`);

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
              } else if (block.name === 'todo_list') {
                const { action, todos } = block.input;

                if (action === 'create' || action === 'update') {
                  if (!todos || !Array.isArray(todos)) {
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: '❌ Error: todos array is required for create/update actions'
                    });
                    continue;
                  }

                  if (action === 'create') {
                    this.agentTodoList = todos;
                    console.log(`\n📋 Created todo list with ${todos.length} items:\n`);
                    todos.forEach((todo, index) => {
                      const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
                      console.log(`  ${index + 1}. ${icon} ${todo.content} (${todo.status})`);
                    });
                    console.log('');
                  } else if (action === 'update') {
                    this.agentTodoList = todos;
                    console.log(`\n📋 Updated todo list:\n`);
                    todos.forEach((todo, index) => {
                      const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
                      console.log(`  ${index + 1}. ${icon} ${todo.content} (${todo.status})`);
                    });
                    console.log('');
                  }

                  const completedCount = todos.filter(t => t.status === 'completed').length;
                  const inProgressCount = todos.filter(t => t.status === 'in_progress').length;
                  const pendingCount = todos.filter(t => t.status === 'pending').length;

                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `📋 Todo list ${action === 'create' ? 'created' : 'updated'} with ${todos.length} items:\n` +
                      `• ${completedCount} completed ✅\n` +
                      `• ${inProgressCount} in progress 🔄\n` +
                      `• ${pendingCount} pending ⏳\n\n` +
                      `Current todo list:\n` +
                      todos.map((todo, i) => {
                        const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
                        return `${i + 1}. ${icon} ${todo.content}`;
                      }).join('\n')
                  });

                } else if (action === 'list') {
                  console.log(`\n📋 Current todo list (${this.agentTodoList.length} items):\n`);
                  this.agentTodoList.forEach((todo, index) => {
                    const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
                    console.log(`  ${index + 1}. ${icon} ${todo.content} (${todo.status})`);
                  });
                  console.log('');

                  if (this.agentTodoList.length === 0) {
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: '📋 Todo list is empty. Use todo_list with action="create" to start tracking tasks.'
                    });
                  } else {
                    const completedCount = this.agentTodoList.filter(t => t.status === 'completed').length;
                    const inProgressCount = this.agentTodoList.filter(t => t.status === 'in_progress').length;
                    const pendingCount = this.agentTodoList.filter(t => t.status === 'pending').length;

                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: `📋 Current todo list (${this.agentTodoList.length} items):\n` +
                        `• ${completedCount} completed ✅\n` +
                        `• ${inProgressCount} in progress 🔄\n` +
                        `• ${pendingCount} pending ⏳\n\n` +
                        `Tasks:\n` +
                        this.agentTodoList.map((todo, i) => {
                          const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
                          return `${i + 1}. ${icon} ${todo.content}`;
                        }).join('\n')
                    });
                  }

                } else if (action === 'clear') {
                  const count = this.agentTodoList.length;
                  this.agentTodoList = [];
                  console.log(`\n📋 Cleared todo list (${count} items removed)\n`);

                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `📋 Todo list cleared. ${count} items removed.`
                  });
                }
              } else if (block.name === 'wait_for_logs') {
                const { note } = block.input;
                console.log(`\n⏸️  Agent is waiting for logs${note ? `: ${note}` : ''}...`);
                console.log(`⏱️  Will automatically end when all background processes complete or after 60s timeout.\n`);

                const startTime = Date.now();
                const maxWaitTime = 60000; // 60 seconds max
                const checkInterval = 1000; // Check every 1 second

                while (Date.now() - startTime < maxWaitTime) {
                  if (this.runningProcesses.size === 0) {
                    // All processes have completed
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: `All background processes completed after ${elapsed}s.\n\n✅ Ready to continue. No background processes running.`
                    });
                    break;
                  }
                  await new Promise(resolve => setTimeout(resolve, checkInterval));
                }

                // Timeout reached or processes completed
                const runningProcessCount = this.runningProcesses.size;
                if (runningProcessCount > 0) {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: `Waited 60 seconds. ${runningProcessCount} background process(es) still running.\n\nAny new logs from background processes have been cleared and will be delivered in the next message.\n\n✅ Ready to continue. Check for background process updates above.`
                  });
                }
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

          // Eager queue post-completion instructions
          this.queuePostCompletionInstructions();
          continueLoop = false;
        } else {
          console.log(`\n⚠️  Unexpected stop reason: ${response.stop_reason}\n`);
          continueLoop = false;
        }

      } catch (error) {
        console.error(`\n❌ Agent error: ${error.message}\n`);
        continueLoop = false;
      }
    }

    console.log('\n✅ Agent workflow complete\n');

    // Set agent as free and process queue
    this.updatePromptStatus(false);
  }

  async startInteractiveMode() {
    console.log('🤖 Alfred - AI Coding Assistant (Agentic Mode)');
    console.log('📋 Connected to: Playwright MCP + Vexify MCP');
    console.log('🛠️  MCP tools available in execution environment');
    console.log('💡 Type your requests or "exit" to quit');
    console.log('👁️  Press ESC to hide/show prompt, ESC+ESC to clear\n');

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'alfred> '
    });

    this.isRunning = true;
    this.setupInteractiveHandlers();

    // Modified line handler for queuing
    this.rl.on('line', (input) => {
      const trimmed = input.trim();

      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('👋 Goodbye!');
        this.cleanup();
        this.rl.close();
        return;
      }

      if (trimmed) {
        // Store current input for potential ESC+ESC clear
        this.currentInput = trimmed;

        if (this.isAgentBusy) {
          // Add to queue if agent is busy
          this.promptQueue.push(trimmed);
          console.log(`\n💭 Request queued: ${trimmed.substring(0, 50)}${trimmed.length > 50 ? '...' : ''}`);
          console.log(`📊 Queue length: ${this.promptQueue.length}`);
        } else {
          // Process immediately if agent is free
          this.runAgenticLoop(trimmed);
        }
      }
    });

    this.rl.on('close', () => {
      this.cleanup();
      process.exit(0);
    });

    // Show initial prompt
    this.rl.prompt();
  }

  cleanup() {
    console.log('🧹 Cleaning up...');

    for (const [processId, procInfo] of this.runningProcesses.entries()) {
      console.log(`🛑 Stopping background process: ${processId}`);
      try {
        procInfo.process.kill('SIGKILL');
        procInfo.process.stdin?.destroy();
        procInfo.process.stdout?.destroy();
        procInfo.process.stderr?.destroy();
      } catch (e) {}
    }

    if (this.playwrightClient && this.playwrightClient.process) {
      try {
        this.playwrightClient.process.kill('SIGKILL');
        this.playwrightClient.process.stdin?.destroy();
        this.playwrightClient.process.stdout?.destroy();
        this.playwrightClient.process.stderr?.destroy();
      } catch (e) {}
    }

    if (this.vexifyClient && this.vexifyClient.process) {
      try {
        this.vexifyClient.process.kill('SIGKILL');
        this.vexifyClient.process.stdin?.destroy();
        this.vexifyClient.process.stdout?.destroy();
        this.vexifyClient.process.stderr?.destroy();
      } catch (e) {}
    }

    if (this.alfredClient && this.alfredClient.process) {
      try {
        this.alfredClient.process.kill('SIGKILL');
        this.alfredClient.process.stdin?.destroy();
        this.alfredClient.process.stdout?.destroy();
        this.alfredClient.process.stderr?.destroy();
      } catch (e) {}
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
      setTimeout(() => process.exit(1), 100);
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
  alfred mcp               Run as MCP server (stdio transport)
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
  • Quick operations (<10s): Complete synchronously
  • Long operations (>10s): Continue in background, output streams
  • Agent stays informed via console output
  • Can make additional calls while processes run

Authentication:
  🎭 Claude Code OAuth token (auto-detected from logged-in Claude Code)
  🔑 Browser-based authentication (recommended)
  🌍 Environment variables: ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
  💾 Secure local token storage in ~/.alfred/

Examples:
  alfred "create an express server and test it with playwright mcp tools"
  alfred "build a REST API with error handling"
  alfred "analyze this codebase and suggest improvements"

MCP Tools Available in Execute Environment:
  browser_navigate(), browser_click(), browser_snapshot(), browser_screenshot()
  execute() - runs code with access to all MCP tools

MCP Server Mode:
  Run 'alfred mcp' to start Alfred as an MCP server that other systems can call.
  Exposes an 'alfred' tool that accepts prompts and executes them in the current directory.
  Uses stdio transport (JSON-RPC over stdin/stdout) per MCP protocol specification.
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

if (args.includes('mcp')) {
  // MCP Server Mode - provide Alfred as an MCP tool
  let messageBuffer = '';
  let isInitialized = false;

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    messageBuffer += chunk;
    const lines = messageBuffer.split('\n');
    messageBuffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        const response = await handleMCPMessage(message, isInitialized);

        if (message.method === 'initialize') {
          isInitialized = true;
        }

        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (error) {
        console.error('MCP Error:', error.message);
        if (message && message.id) {
          const errorResponse = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error.message
            }
          };
          process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    }
  });

  async function handleMCPMessage(message, isInitialized) {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'alfred-ai',
            version: '5.5.1'
          }
        }
      };
    }

    if (message.method === 'initialized') {
      // Notification - no response needed
      return null;
    }

    if (!isInitialized && message.method !== 'ping') {
      throw new Error('Server not initialized');
    }

    if (message.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [{
            name: 'alfred',
            description: 'Execute an Alfred AI prompt to solve coding problems, create files, build applications, and perform software development tasks in the current working directory.',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The natural language instruction or coding task for Alfred to complete'
                }
              },
              required: ['prompt']
            }
          }]
        }
      };
    }

    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params;

      if (name !== 'alfred') {
        throw new Error(`Unknown tool: ${name}`);
      }

      const prompt = args.prompt;
      if (!prompt) {
        throw new Error('prompt parameter is required');
      }

      // Run Alfred in non-interactive mode
      const alfred = new AlfredMCPClient();
      try {
        await alfred.startMCPClients();
        const apiKey = await alfred.authManager.getAuthentication();
        alfred.anthropic = new Anthropic({ apiKey });

        // Capture output
        let output = '';
        const originalLog = console.log;
        const originalError = console.error;
        console.log = (...args) => { output += args.join(' ') + '\n'; };
        console.error = (...args) => { output += args.join(' ') + '\n'; };

        await alfred.runAgenticLoop(prompt);

        // Restore console
        console.log = originalLog;
        console.error = originalError;

        alfred.cleanup();

        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [{
              type: 'text',
              text: output || 'Alfred completed the task successfully.'
            }],
            isError: false
          }
        };
      } catch (error) {
        alfred.cleanup();
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [{
              type: 'text',
              text: `Alfred encountered an error: ${error.message}`
            }],
            isError: true
          }
        };
      }
    }

    if (message.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {}
      };
    }

    throw new Error(`Unknown method: ${message.method}`);
  }

  // MCP server mode - keep listening, don't run normal client code
} else {
  // Normal client mode
  const alfred = new AlfredMCPClient();
  alfred.run(args).catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

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
