#!/usr/bin/env node

export class ToolSchemaBuilder {
  static buildToolsList(mcpManager) {
    const allTools = mcpManager.getAllTools();
    const tools = [];

    let executeDescription = `Execute code in the specified runtime with EXCLUSIVE access to MCP tool functions via JSON-RPC stdio.

⚠️ CRITICAL INSTRUCTIONS FOR MCP TOOL USAGE:
- You MUST use MCP tools ONLY through the JSON-RPC helper in executed code
- You MUST NOT use any CLI versions of these tools (e.g., no 'playwright' command, no browser CLIs)
- ALL MCP tool interactions must happen via require('/tmp/mcp-runtime-helpers.cjs') in nodejs
- Every task involving testing/browsing/searching MUST use these MCP functions
- Write your code as pure JavaScript/Python/Bash that calls the MCP tools via the helper

CODE EXECUTION RULES:
- Provide pure source code (NOT shell commands or invocations)
- For nodejs runtime: Pure JavaScript code (like you'd put in a .js file)
- For python runtime: Pure Python code (like you'd put in a .py file)
- For bash runtime: Bash script code (like you'd put in a .sh file)

DO NOT:
- Use CLI tools like 'playwright', 'npx playwright', 'python -m pytest' etc.
- Mix syntax from different languages (e.g., # comments in JavaScript)
- Include shell commands like "node -e" or "python -c" - just provide raw source code
- Try to access Playwright/other tools except through the JSON-RPC helper

Preference order: python > nodejs > bash

MCP TOOLS AVAILABLE via JSON-RPC stdio (REQUIRED FOR TESTING):
To use MCP tools from Node.js code, require the helper module from /tmp:
  const mcp = require('/tmp/mcp-runtime-helpers.cjs');

  const result = await mcp.browser_navigate({url: 'https://example.com'});
  const screenshot = await mcp.browser_take_screenshot({});
  const snapshot = await mcp.browser_snapshot({});

Available MCP functions:
`;

    const playwrightTools = allTools['playwright'] || [];
    if (playwrightTools.length > 0) {
      executeDescription += `\nPlaywright Browser Automation (${playwrightTools.length} functions):\n`;
      playwrightTools.forEach(tool => {
        const params = Object.keys(tool.input_schema?.properties || {}).join(', ');
        executeDescription += `  - mcp.${tool.name}({${params}}): ${tool.description}\n`;
      });
    }

    const vexifyTools = allTools['vexify'] || [];
    if (vexifyTools.length > 0) {
      executeDescription += `\nCode Search (${vexifyTools.length} functions):\n`;
      vexifyTools.forEach(tool => {
        const params = Object.keys(tool.input_schema?.properties || {}).join(', ');
        executeDescription += `  - mcp.${tool.name}({${params}}): ${tool.description}\n`;
      });
    }

    executeDescription += `\nEnvironment variables:
- ALFRED_MCP_TOOLS: JSON string of all available MCP tools with full schemas
- CODEMODE_WORKING_DIRECTORY: Current working directory`;

    tools.push({
      name: 'execute',
      description: executeDescription,
      input_schema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Source code to execute (NOT shell commands). For nodejs: pure JavaScript code. For python: pure Python code. For bash: bash script code. Do NOT include shell invocations like "node -e" or "python -c" - just provide the raw source code for the runtime.'
          },
          runtime: {
            type: 'string',
            enum: ['python', 'nodejs', 'bash', 'deno', 'bun', 'go', 'rust', 'c', 'cpp'],
            description: 'Runtime to execute the code in. Preference order: python > nodejs > bash. Available: nodejs, deno, bun, python, bash, go, rust, c, cpp'
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 240000)',
            default: 240000
          }
        },
        required: ['code', 'runtime']
      }
    });

    const builtInTools = allTools['builtInTools'] || [];
    const builtInToolNames = ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'todo'];

    for (const toolName of builtInToolNames) {
      const mcpTool = builtInTools.find(t => t.name === toolName);
      if (mcpTool) {
        tools.push({
          name: toolName,
          description: mcpTool.description,
          input_schema: mcpTool.input_schema || mcpTool.inputSchema
        });
      }
    }

    tools.push({
      name: 'alfred_kill',
      description: 'Kill a running execution',
      input_schema: {
        type: 'object',
        properties: {
          execId: {
            type: 'string',
            description: 'Execution ID to kill'
          }
        },
        required: ['execId']
      }
    });

    tools.push({
      name: 'alfred',
      description: 'Run Alfred AI agent with full agentic capabilities to accomplish complex tasks. Alfred can use all available tools in an autonomous loop to complete your request.',
      input_schema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The task or request for Alfred to accomplish'
          }
        },
        required: ['prompt']
      }
    });

    return tools;
  }
}

export default ToolSchemaBuilder;
