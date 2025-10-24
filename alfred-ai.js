#!/usr/bin/env node

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


import AuthManager from './auth-manager.js';
import MCPManager from './mcp-manager.js';
import HistoryManager from './history-manager.js';
import ExecutionManager from './execution-manager.js';
import AlfredMCPServer from './alfred-mcp-server.js';

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
    return { config: configData, configDir: dirname(configPath) };
  } catch (error) {
    throw new Error(`BRUTAL ERROR: Failed to load config: ${error.message}`);
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