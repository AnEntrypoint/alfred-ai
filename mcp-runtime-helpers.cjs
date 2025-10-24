#!/usr/bin/env node
/**
 * MCP Runtime Helper Functions
 * Provides callable MCP tool functions for code executed via the execute tool.
 * Uses JSON-RPC over stdio to communicate with parent alfred process.
 *
 * ⚠️ AGENTIC INSTRUCTIONS FOR CODE EXECUTION
 *
 * When executing code through this helper, follow these critical patterns:
 *
 * 1. ALWAYS SPECIFY RUNTIME EXPLICITLY
 *    - When calling execute, ALWAYS pass the runtime parameter
 *    - Supported runtimes: 'nodejs', 'python', 'bash'
 *    - Example: execute({ code: "...", runtime: 'nodejs' })
 *    - The runtime parameter is REQUIRED and must be explicit
 *
 * 2. DO NOT SPLIT CODE ACROSS MULTIPLE CALLS
 *    ❌ WRONG: Multiple calls for sequential code
 *       execute({ code: "const fs = require('fs');", runtime: 'nodejs' })
 *       execute({ code: "const data = fs.readFileSync('file.txt');", runtime: 'nodejs' })
 *       execute({ code: "console.log(data);", runtime: 'nodejs' })
 *
 *    ✅ CORRECT: Single call with all code together
 *       execute({
 *         code: `
 *           const fs = require('fs');
 *           const data = fs.readFileSync('file.txt', 'utf8');
 *           console.log(data);
 *         `,
 *         runtime: 'nodejs'
 *       })
 *
 * 3. GROUP RELATED CODE INTO SENSIBLE CHUNKS
 *    - Combine logically related operations
 *    - Keep each execution focused on a single task
 *    - Chunk sizes: 5-20 lines for simple ops, 20-100 for complex workflows
 *
 * 4. ALWAYS INCLUDE ERROR HANDLING
 *    - Wrap code in try-catch blocks
 *    - Validate inputs before operations
 *    - Check return values
 *    - Exit with appropriate codes (0 for success, 1 for error)
 *    - Use clear error messages
 *
 * 5. MCP TOOLS ARE AVAILABLE IN THIS CONTEXT
 *    - Use: await mcp.browser_navigate({ url: '...' })
 *    - Use: await mcp.playwright.<tool>(<args>)
 *    - Tools are automatically injected - no imports needed
 *    - All MCP tool calls are asynchronous (return Promises)
 *
 * 6. MINIMIZE ARTIFICIAL DELAYS
 *    - Execute code immediately without setImmediate or artificial delays
 *    - Operations complete as fast as the runtime allows
 *    - No fake timeouts or delays
 *
 * EXAMPLE - How to write good code for execution:
 *
 *   execute({
 *     code: `
 *       const mcp = require('/tmp/mcp-runtime-helpers.cjs');
 *
 *       async function processData() {
 *         try {
 *           // Validate input
 *           if (!filePath) {
 *             console.error('Error: File path required');
 *             process.exit(1);
 *           }
 *
 *           // Do the work
 *           const fs = require('fs');
 *           const data = fs.readFileSync(filePath, 'utf8');
 *           const result = data.toUpperCase();
 *
 *           // Validate output
 *           if (!result) {
 *             console.error('Error: Processing failed');
 *             process.exit(1);
 *           }
 *
 *           // Return success
 *           console.log('Success:', result);
 *           process.exit(0);
 *         } catch (error) {
 *           console.error('Error:', error.message);
 *           process.exit(1);
 *         }
 *       }
 *
 *       processData();
 *     `,
 *     runtime: 'nodejs'
 *   })
 */

const readline = require('readline');

// Get MCP tools from environment
const MCP_TOOLS_JSON = process.env.ALFRED_MCP_TOOLS || '{}';
let MCP_TOOLS = {};
try {
  MCP_TOOLS = JSON.parse(MCP_TOOLS_JSON);
} catch (e) {
  console.error('[MCP Helper] Failed to parse ALFRED_MCP_TOOLS:', e.message);
}

// JSON-RPC request counter
let requestId = 1;

// Pending requests awaiting responses
const pendingRequests = new Map();

// Setup readline interface for JSON-RPC communication
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Listen for JSON-RPC responses from parent
rl.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    if (response.id && pendingRequests.has(response.id)) {
      const { resolve, reject } = pendingRequests.get(response.id);
      pendingRequests.delete(response.id);

      if (response.error) {
        reject(new Error(response.error.message || 'MCP tool call failed'));
      } else {
        resolve(response.result);
      }
    }
  } catch (e) {
    console.error('[MCP Helper] Failed to parse response:', e.message);
  }
});

/**
 * Call an MCP tool via JSON-RPC
 */
function callMCPTool(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    pendingRequests.set(id, { resolve, reject });

    // Send JSON-RPC request to parent via stdout
    process.stdout.write(JSON.stringify(request) + '\n');

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`MCP tool ${toolName} timed out after 30s`));
      }
    }, 30000);
  });
}

// Build helper object with all MCP tools
const mcp = {};

// Add Playwright tools
if (MCP_TOOLS.playwright) {
  mcp.playwright = {};
  MCP_TOOLS.playwright.forEach(tool => {
    const toolName = `mcp__playwright__${tool.name}`;
    mcp.playwright[tool.name] = (args) => callMCPTool(toolName, args);
    // Also export at top level for convenience
    mcp[tool.name] = mcp.playwright[tool.name];
  });
}

// Add Vexify tools
if (MCP_TOOLS.vexify) {
  mcp.vexify = {};
  MCP_TOOLS.vexify.forEach(tool => {
    const toolName = `mcp__vexify__${tool.name}`;
    mcp.vexify[tool.name] = (args) => callMCPTool(toolName, args);
    // Also export at top level for convenience
    mcp[tool.name] = mcp.vexify[tool.name];
  });
}

// Export the mcp object
module.exports = mcp;
