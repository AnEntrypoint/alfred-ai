#!/usr/bin/env node

import { execute } from './agentic-mode.js';
import { spawn } from 'child_process';

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

async function callLLM({ baseURL, authToken, model, messages, system, maxTokens }) {
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

  console.log('⏳ Starting MCP servers...\n');

  // Start Playwright MCP server without custom args for now
  const playwright = await startMCPServer('playwright', 'npx', ['-y', '@microsoft/playwright-mcp']);
  mcpServers.set('playwright', { ...playwright, command: 'npx', args: ['-y', '@microsoft/playwright-mcp'] });

  const mcpWrappers = [
    ...playwright.tools.map(t => createMCPToolWrapper(t.name, 'playwright', mcpServers))
  ].join('\n\n');

  console.log(`✅ Loaded ${playwright.tools.length} MCP tools\n`);
  console.log(`🤖 Using model: ${models.sonnet}\n`);
  console.log(`🚀 Starting agentic loop...\n`);

  const systemPrompt = `You are Alfred, an autonomous coding assistant. You execute coding tasks by writing JavaScript code that uses available tools.

AVAILABLE TOOLS (pre-imported and ready to use):
- Edit, Glob, Grep, Bash, LS, Read, Write
${playwright.tools.map(t => `- ${t.name}`).join('\n')}

CRITICAL: ALL TOOLS ARE ALREADY AVAILABLE AS FUNCTIONS - NO IMPORTS NEEDED!

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
3. NEVER use background processes (& operator) - they cause hanging
4. Start directly with async/await code
5. Use await for all tool calls
6. Install dependencies with Bash({ command: 'npm install package-name' })
7. For web servers: start with timeout, wait, then stop with pkill
8. Always close browser with playwright_close()
9. Use console.log() for progress
10. Handle errors with try/catch
11. Respond to user interruptions by adapting your approach

EXAMPLE:
async function main() {
  try {
    await Write({ file_path: 'server.js', content: \`import express from 'express';
const app = express();
app.listen(3000, () => console.log('Server running'));\` });
    await Bash({ command: 'npm install express' });
    await Bash({ command: 'timeout 5 node server.js' }); // Start with timeout
    console.log('Server created successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}
main();

Return ONLY executable JavaScript code, no explanations.`;

  let iteration = 0;
  const maxIterations = 10;
  let conversationHistory = [
    { role: 'user', content: initialPrompt }
  ];

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n🔄 Iteration ${iteration}/${maxIterations}\n`);

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
      });

      const code = result;
      console.log(`💭 Alfred's plan:\n${code}\n`);
      console.log(`⚙️  Executing...\n`);

      const execResult = await execute({ code, mcpWrappers, workingDirectory: process.cwd() });

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

      conversationHistory.push(
        { role: 'assistant', content: code },
        { role: 'user', content: `Execution result:\nstdout: ${execResult.stdout}\nstderr: ${execResult.stderr}\nexit code: ${execResult.exitCode}\n\nContinue with next step or fix any errors.` }
      );

    } catch (error) {
      console.error(`\n❌ Error in iteration ${iteration}:`, error.message);

      conversationHistory.push(
        { role: 'user', content: `Error occurred: ${error.message}\n\nPlease fix this and try again.` }
      );
    }
  }

  playwright.proc.kill();

  if (iteration >= maxIterations) {
    console.log(`\n⚠️  Reached maximum iterations (${maxIterations}). Task may be incomplete.`);
    process.exit(1);
  }

  process.exit(0);
}

main();
