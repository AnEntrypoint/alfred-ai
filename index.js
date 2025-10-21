#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { execute } from './agentic-mode.js';

// Start MCP servers
const mcpServers = new Map();

async function startMCPServer(name, command, args) {
  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
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

  proc.stderr.on('data', (data) => {
    console.error(`[${name}]`, data.toString().trim());
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
    clientInfo: { name: 'alfred-ai', version: '3.0.1' }
  });

  const toolsList = await sendRequest('tools/list', {});
  const tools = toolsList?.tools || [];

  mcpServers.set(name, { proc, sendRequest, tools, command, args });
  console.error(`[Alfred] Loaded ${name}: ${tools.length} tools`);

  return tools;
}

// Start all MCP servers
const vexifyTools = await startMCPServer('vexify', 'node', [new URL('./vexify-mcp-server.js', import.meta.url).pathname]);
const playwrightTools = await startMCPServer('playwright', 'npx', ['-y', '@executeautomation/playwright-mcp-server']);

const allMcpTools = [...vexifyTools, ...playwrightTools];

console.error(`[Alfred] Total MCP tools loaded: ${allMcpTools.length}`);

// Create wrapper code generator for MCP tools
function createMCPToolWrapper(toolName, serverName) {
  const server = mcpServers.get(serverName);
  return `const ${toolName} = async (args) => {
  const { spawn } = await import('child_process');
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

  await sendReq('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'exec', version: '1.0.0' } });
  const result = await sendReq('tools/call', { name: '${toolName}', arguments: args });
  proc.kill();

  if (result && result.content && result.content[0]?.type === 'text') {
    return result.content[0].text;
  }
  return result ? JSON.stringify(result) : null;
};`;
}

// Create MCP server
const server = new Server({
  name: 'alfred-ai',
  version: '3.0.1'
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'execute',
    description: `Execute JavaScript code with ${7 + allMcpTools.length} tools: Edit, Glob, Grep, Bash, LS, Read, Write + ${allMcpTools.map(t => t.name).join(', ')}`,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        workingDirectory: { type: 'string', description: 'Working directory path' }
      },
      required: ['code']
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'execute') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { code, workingDirectory = process.cwd() } = request.params.arguments;

  // Add MCP tool wrappers to the code
  const mcpWrappers = [
    ...vexifyTools.map(t => createMCPToolWrapper(t.name, 'vexify')),
    ...playwrightTools.map(t => createMCPToolWrapper(t.name, 'playwright'))
  ].join('\n\n');

  const enhancedCode = `
${mcpWrappers}

${code}
`;

  try {
    const result = await execute({ code: enhancedCode, workingDirectory });
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }]
    };
  } catch (error) {
    throw new Error(`Execution failed: ${error.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[Alfred] Ready - ${7 + allMcpTools.length} tools available`);
