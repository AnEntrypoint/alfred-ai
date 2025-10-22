#!/usr/bin/env node

import { execute } from './agentic-mode.js';
import { spawn } from 'child_process';
import { join } from 'path';

// Read initial prompt from command line
const initialPrompt = process.argv.slice(2).join(' ');

if (!initialPrompt) {
  console.log('Usage: npx alfred "your coding task here"');
  console.log('Example: npx alfred "create an express server on port 3000"');
  console.log('');
  console.log('Additional prompts can be provided via stdin:');
  console.log('echo "add more features" | npx alfred "create server"');
  process.exit(1);
}

// Buffer for additional prompts from stdin
let pendingInterruptions = [];
let stdinComplete = false;

// Setup stdin reader for additional prompts
if (!process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', (data) => {
    buffer += data;
    const lines = buffer.split(/[\r\n]+/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        pendingInterruptions.push({
          type: 'user_interruption',
          content: line.trim(),
          timestamp: Date.now()
        });
        console.log(`\n📝 Additional prompt received: ${line.trim()}\n`);
      }
    }
  });

  process.stdin.on('end', () => {
    if (buffer.trim()) {
      pendingInterruptions.push({
        type: 'user_interruption',
        content: buffer.trim(),
        timestamp: Date.now()
      });
    }
    stdinComplete = true;
  });

  // Set a timeout for stdin in case it hangs
  setTimeout(() => {
    if (!stdinComplete) {
      stdinComplete = true;
    }
  }, 5000);
} else {
  stdinComplete = true;
}

console.log(`\n🤖 Alfred: Executing task...\n`);
console.log(`📝 Initial task: ${initialPrompt}\n`);

// Log when additional prompts are received
if (!process.stdin.isTTY) {
  console.log(`📝 Listening for additional prompts via stdin...\n`);
}

async function startMCPServer(name, command, args) {
  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'ignore'],
    cwd: process.cwd()
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

  async function sendRequest(method, params) {
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
  }

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'alfred-cli', version: '1.0.0' }
  });

  const toolsList = await sendRequest('tools/list', {});
  const tools = toolsList?.tools || [];

  return { proc, sendRequest, tools };
}

function createMCPToolWrapper(toolName, serverName, servers) {
  const server = servers.get(serverName);
  return `const ${toolName} = async (args) => {
  const { spawn } = await import('child_process');
  const { cwd } = await import('process');
  const proc = spawn('${server.command}', ${JSON.stringify(server.args)}, {
    stdio: ['pipe', 'pipe', 'ignore'],
    cwd: cwd()
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

  await sendReq('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'exec', version: '1.0.0' } });
  const result = await sendReq('tools/call', { name: '${toolName}', arguments: args });
  proc.kill();

  if (result && result.content && result.content[0]?.type === 'text') {
    return result.content[0].text;
  }
  return result ? JSON.stringify(result) : null;
};`;
}

async function callLLM({ baseURL, authToken, model, messages, system, maxTokens }, tokenTracker) {
  const url = baseURL
    ? `${baseURL}/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };

  const body = {
    model,
    max_tokens: maxTokens,
    messages,
    system
  };

  // Calculate and display input token count
  const inputText = JSON.stringify({ system, messages });
  const inputTokens = Math.ceil(inputText.length / 4); // Rough estimate: 1 token ≈ 4 characters
  console.log(`📊 Input tokens: ~${inputTokens.toLocaleString()}`);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${response.status} ${error}`);
  }

  const result = await response.json();

  if (!result.content || !result.content[0]?.text) {
    throw new Error('Invalid response format from API');
  }

  // Display output token count
  const outputTokens = result.usage?.output_tokens || Math.ceil(result.content[0].text.length / 4);
  const actualInputTokens = result.usage?.input_tokens || inputTokens;

  console.log(`📊 Output tokens: ${outputTokens.toLocaleString()}`);

  // Display total tokens if available
  if (result.usage?.input_tokens) {
    console.log(`📊 Actual input tokens: ${result.usage.input_tokens.toLocaleString()}`);
  }

  const callTotalTokens = actualInputTokens + outputTokens;
  tokenTracker.totalTokensUsed += callTotalTokens;

  console.log(`📊 Call total: ${callTotalTokens.toLocaleString()} tokens`);
  console.log(`📊 Session total: ${tokenTracker.totalTokensUsed.toLocaleString()} tokens`);

  let code = result.content[0].text;

  // Remove markdown code blocks if present
  code = code.replace(/```javascript\s*/g, '').replace(/```\s*$/g, '').trim();

  // Remove any leading explanatory text before code
  const lines = code.split('\n');
  let codeStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('import ') ||
        line.startsWith('//') ||
        line.startsWith('/*') ||
        line.startsWith('async') ||
        line.startsWith('const') ||
        line.startsWith('let') ||
        line.startsWith('var') ||
        line.includes('import ') ||
        line.match(/^(async\s+)?function/)) {
      codeStartIndex = i;
      break;
    }
  }

  if (codeStartIndex > 0) {
    code = lines.slice(codeStartIndex).join('\n');
  }

  // Remove any trailing explanatory text after the code
  const codeLines = code.split('\n');
  let codeEndIndex = codeLines.length;

  for (let i = codeLines.length - 1; i >= 0; i--) {
    const line = codeLines[i].trim();
    if (line === '' ||
        line.startsWith('}') ||
        line.startsWith('])') ||
        line.startsWith(']);') ||
        line.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/)) {
      codeEndIndex = i + 1;
      break;
    }
  }

  if (codeEndIndex < codeLines.length) {
    code = codeLines.slice(0, codeEndIndex).join('\n');
  }

  // Convert CommonJS require() statements to ES module imports
  code = convertCommonJSToESM(code);

  return code.trim();
}

// Convert CommonJS require() statements to ES module imports
function convertCommonJSToESM(code) {
  const imports = new Set();
  const convertedCode = code.replace(/const\s+(\{[^}]+\})\s*=\s*require\(['"]([^'"]+)['"]\)/g, (match, destructured, module) => {
    imports.add(`import ${destructured} from '${module}';`);
    return ''; // Remove the require statement
  });

  const convertedCode2 = convertedCode.replace(/const\s+([^=]+)\s*=\s*require\(['"]([^'"]+)['"]\)/g, (match, varName, module) => {
    const cleanVarName = varName.trim();
    // Handle default imports
    if (cleanVarName && !cleanVarName.includes('{')) {
      imports.add(`import ${cleanVarName} from '${module}';`);
      return ''; // Remove the require statement
    }
    return match; // Keep original if we can't convert it
  });

  // Convert bare require() calls
  const convertedCode3 = convertedCode2.replace(/require\(['"]([^'"]+)['"]\)/g, (match, module) => {
    // This is harder to convert automatically, so we'll leave it for now
    // In a full implementation, we'd need to track the usage context
    return match;
  });

  // Combine imports at the top
  const importStatements = Array.from(imports).join('\n');

  if (importStatements) {
    const lines = convertedCode3.split('\n');
    const firstNonEmptyLine = lines.findIndex(line => line.trim() && !line.trim().startsWith('//'));

    if (firstNonEmptyLine >= 0) {
      lines.splice(firstNonEmptyLine, 0, importStatements);
      return lines.join('\n');
    } else {
      return importStatements + '\n' + convertedCode3;
    }
  }

  return convertedCode3;
}

async function main() {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  const defaultModels = {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-5-20250929',
    opus: 'claude-opus-4-1-20250805'
  };

  const models = {
    haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || defaultModels.haiku,
    sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || defaultModels.sonnet,
    opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || defaultModels.opus
  };

  if (!authToken) {
    console.error('❌ Error: ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY environment variable not set');
    console.error('Please set it with: export ANTHROPIC_AUTH_TOKEN=your-token-here');
    process.exit(1);
  }

  const mcpServers = new Map();

  console.log('⏳ Loading CLI tools...\n');

  // Load additional tool documentation and hooks (like codemode)
  let additionalTools = '';
  let startMd = '';
  let mcpThorns = '';
  let wfgyHook = '';

  try {
    const { execSync } = await import('child_process');
    console.log('   ├─ Fetching glootie-cc documentation...');
    try {
      startMd = execSync('curl -s https://raw.githubusercontent.com/AnEntrypoint/glootie-cc/refs/heads/master/start.md', { encoding: 'utf8', timeout: 5000 });
      console.log('   ✓ glootie-cc documentation loaded');
    } catch (error) {
      console.log('   ⚠ Warning: Failed to fetch glootie-cc:', error.message);
    }

    console.log('   ├─ Loading mcp-thorns...');
    try {
      mcpThorns = execSync('npx -y mcp-thorns@latest', { encoding: 'utf8', timeout: 10000 });
      console.log('   ✓ mcp-thorns loaded');
    } catch (error) {
      console.log('   ⚠ Warning: Failed to load mcp-thorns:', error.message);
    }

    console.log('   ├─ Loading wfgy hooks...');
    try {
      wfgyHook = execSync('npx -y wfgy@latest hook', { encoding: 'utf8', timeout: 10000 });
      console.log('   ✓ wfgy hooks loaded');
    } catch (error) {
      console.log('   ⚠ Warning: Failed to load wfgy:', error.message);
    }

    additionalTools = `\n\n# Additional Tool Documentation\n\n${startMd}\n\n${wfgyHook}\n\n`;
  } catch (error) {
    console.log('   ⚠ Warning: Failed to load additional tools:', error.message);
    additionalTools = '';
  }

  console.log('⏳ Starting MCP servers...\n');

  // Start Playwright MCP server
  const playwright = await startMCPServer('playwright', 'npx', ['-y', '@playwright/mcp@latest']);
  mcpServers.set('playwright', { ...playwright, command: 'npx', args: ['-y', '@playwright/mcp@latest'] });

  // Try to start vexify MCP server (optional)
  let vexify = null;
  try {
    vexify = await startMCPServer('vexify', 'node', [join(process.cwd(), 'vexify-mcp-server.js')]);
    mcpServers.set('vexify', { ...vexify, command: 'node', args: [join(process.cwd(), 'vexify-mcp-server.js')] });
    console.log('✅ Vexify MCP server started successfully\n');
  } catch (error) {
    console.log('⚠️  Vexify MCP server not available (will use fallbacks)\n');
    vexify = { tools: [] }; // Empty fallback
  }

  const mcpWrappers = [
    ...(vexify?.tools || []).map(t => createMCPToolWrapper(t.name, 'vexify', mcpServers)),
    ...playwright.tools.map(t => createMCPToolWrapper(t.name, 'playwright', mcpServers))
  ].join('\n\n');

  console.log(`✅ Loaded ${(vexify?.tools?.length || 0) + playwright.tools.length} MCP tools\n`);
  console.log(`🤖 Using model: ${models.sonnet}\n`);
  console.log(`🚀 Starting agentic loop...\n`);

  const systemPrompt = `You are Alfred, an autonomous coding assistant. You execute coding tasks by writing JavaScript code that uses available tools.

AVAILABLE TOOLS (pre-imported and ready to use):
- Edit, Glob, Grep, Bash, LS, Read, Write
${vexify?.tools ? vexify.tools.map(t => `- ${t.name}`).join('\n') : ''}
${playwright.tools.map(t => `- ${t.name}`).join('\n')}

CRITICAL: ALL TOOLS ARE ALREADY AVAILABLE AS FUNCTIONS - NO IMPORTS NEEDED FOR TOOLS!
For built-in Node.js modules in FILES: use import statements (import http from 'http')

EXECUTION STRATEGY:
- Break complex tasks into smaller, testable steps
- Run multiple code executions to build incrementally
- Test each step before proceeding to the next
- Use console.log() to show progress between steps
- Keep executing until the task is fully complete

USER INTERRUPTIONS:
- Additional prompts may arrive during execution as "[User interruption]: message"
- Treat these as immediate priority changes or additional requirements
- Incorporate interruption content into your current workflow naturally
- Continue working on the overall task while accommodating the new requirements

EXECUTION ENVIRONMENT: Node.js ES Modules (type: "module")

WORKING WITH EXTERNAL PACKAGES (express, axios, etc):
OPTION 1 - Write files with import statements (RECOMMENDED):
await Write({ file_path: 'server.js', content: \`import express from 'express';
const app = express();
// your server code\` });

OPTION 2 - Use Bash to install packages first:
await Bash({ command: 'npm install express' });

REQUIREMENTS:
1. NEVER use import statements directly in evaluation code - write them in files instead
2. NEVER use require() - this is ES modules only
3. For built-in Node.js modules: Write import statements in files (import http from 'http')
4. For external packages (express, axios): Write import statements in files, not in evaluation code
5. NEVER use background processes (& operator) - they cause hanging
6. Start directly with async/await code
7. Use await for all tool calls
8. Install dependencies with Bash({ command: 'npm install package-name' })
9. For web servers: start with timeout, wait, then stop with pkill
10. Always close browser with playwright_close()
11. Use console.log() for progress
12. Handle errors with try/catch
13. Run as many executions as needed to complete the task
14. Test each step before building the next

BASH EXECUTION CONTEXT:
- You can execute bash commands alongside JavaScript code
- Use Bash({ command: 'your command here' }) for shell operations
- Bash context is useful for: npm operations, file system tasks, process management
- JavaScript context is for: logic, file operations with tools, web requests
- Choose the appropriate context for each task

EXAMPLE (multi-step approach):
async function main() {
  try {
    // Step 1: Create basic server
    await Write({ file_path: 'server.js', content: \`import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3000);\` });
    console.log('Server file created');

    // Step 2: Install dependencies
    await Bash({ command: 'npm install express' });
    console.log('Dependencies installed');

    // Step 3: Test server briefly
    await Bash({ command: 'timeout 5 node server.js' });
    console.log('Server tested successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}
main();

IMPORTANT CONTEXT AWARENESS:
- You are likely continuing an existing project - analyze the current codebase first
- Check for existing files, dependencies, and project structure using Read and Glob tools
- Build upon what already exists rather than starting from scratch
- Read existing configuration files (package.json, etc.) to understand the project
- Consider the current working directory context in your decisions
- Use Glob to find relevant files: Glob({ pattern: '**/*.js' }) or Glob({ pattern: 'package.json' })

SUCCESS DETECTION:
- Stop when you see clear indicators: Task completed, successfully created/deployed/tested, done, finished
- If no success indicators, continue with next iteration
- Maximum 10 iterations - stop if task incomplete

${additionalTools}

Return ONLY executable JavaScript code, no explanations.`;

  let iteration = 0;
  const maxIterations = 10;
  let conversationHistory = [
    { role: 'user', content: initialPrompt }
  ];
  let executionHistory = []; // Track code executions and their outputs
  const tokenTracker = { totalTokensUsed: 0 }; // Track cumulative token usage

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n🔄 Iteration ${iteration}/${maxIterations}\n`);

    // Clean up old execution outputs (remove outputs older than 5 executions)
    executionHistory = executionHistory.filter(exec => iteration - exec.iteration <= 5);

    // Clean up old conversation inputs (remove inputs older than 2 executions)
    const userMessages = conversationHistory.filter(m => m.role === 'user');
    conversationHistory = conversationHistory.filter(msg => {
      if (msg.role === 'user') {
        const userMsgIndex = userMessages.indexOf(msg);
        return userMsgIndex === -1 || userMsgIndex >= userMessages.length - 2;
      }
      return true; // Keep all non-user messages
    });

    // Check for pending interruptions and add them to conversation
    if (pendingInterruptions.length > 0) {
      console.log(`📝 Processing ${pendingInterruptions.length} additional prompt(s)...\n`);

      for (const interruption of pendingInterruptions) {
        conversationHistory.push({
          role: 'user',
          content: `[User interruption]: ${interruption.content}`
        });
      }
      pendingInterruptions = []; // Clear processed interruptions
    }

    try {
      console.log(`🌐 API Base URL: ${baseURL || 'default'}`);
      console.log(`🔑 Using auth token: ${authToken.substring(0, 10)}...`);

      const result = await callLLM({
        baseURL,
        authToken,
        model: models.sonnet,
        messages: conversationHistory,
        system: systemPrompt,
        maxTokens: 4096
      }, tokenTracker);

      const code = result;
      console.log(`💭 Alfred's plan:\n${code}\n`);
      console.log(`⚙️  Executing...\n`);

      const execResult = await execute({ code, mcpWrappers, workingDirectory: process.cwd() });

      // Track this execution
      executionHistory.push({
        iteration,
        code,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        timestamp: Date.now()
      });

      console.log(`📤 OUTPUT:\n${execResult.stdout}`);
      if (execResult.stderr) {
        console.log(`⚠️  STDERR:\n${execResult.stderr}`);
      }
      console.log(`\nExit code: ${execResult.exitCode}`);

      const taskKeywords = ['successfully', 'created', 'completed', 'done', 'finished', '✅'];
      const isSuccess = execResult.exitCode === 0 && taskKeywords.some(keyword =>
        execResult.stdout.toLowerCase().includes(keyword.toLowerCase())
      );

      if (isSuccess) {
        console.log(`\n✅ Task completed successfully!\n`);
        break;
      }

      // Only add to conversation history if it contains meaningful output (not just empty or trivial)
      if (execResult.stdout.trim().length > 50 || execResult.stderr.trim().length > 0 || execResult.exitCode !== 0) {
        conversationHistory.push(
          { role: 'assistant', content: code },
          { role: 'user', content: `Execution result (iteration ${iteration}):\nstdout: ${execResult.stdout}\nstderr: ${execResult.stderr}\nexit code: ${execResult.exitCode}\n\nContinue with next step or fix any errors.` }
        );
      }

    } catch (error) {
      console.error(`\n❌ Error in iteration ${iteration}:`, error.message);

      conversationHistory.push(
        { role: 'user', content: `Error occurred: ${error.message}\n\nPlease fix this and try again.` }
      );
    }
  }

  if (vexify?.proc) vexify.proc.kill();
  playwright.proc.kill();

  if (iteration >= maxIterations) {
    console.log(`\n⚠️  Reached maximum iterations (${maxIterations}). Task may be incomplete.`);
  }

  // Display final token usage summary
  console.log(`\n📊 Final token usage summary:`);
  console.log(`   Total tokens used: ${tokenTracker.totalTokensUsed.toLocaleString()}`);
  console.log(`   Total API calls: ${iteration}`);
  if (iteration > 0) {
    console.log(`   Average tokens per call: ${Math.round(tokenTracker.totalTokensUsed / iteration).toLocaleString()}`);
  }

  process.exit(0);
}

main();
