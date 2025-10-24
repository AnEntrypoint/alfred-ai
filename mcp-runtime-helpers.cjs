#!/usr/bin/env node
/**
 * MCP Runtime Helper Functions
 * Provides callable MCP tool functions for code executed via the execute tool.
 * Uses JSON-RPC over stdio to communicate with parent alfred process.
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
