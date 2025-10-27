#!/usr/bin/env node


const readline = require('readline');


const MCP_TOOLS_JSON = process.env.ALFRED_MCP_TOOLS || '{}';
let MCP_TOOLS = {};
try {
  MCP_TOOLS = JSON.parse(MCP_TOOLS_JSON);
} catch (e) {
  console.error('[FATAL] MCP Helper: Failed to parse ALFRED_MCP_TOOLS:', e.message);
  process.exit(1);
}

if (Object.keys(MCP_TOOLS).length === 0) {
  console.error('[FATAL] MCP Helper: No MCP tools available - ALFRED_MCP_TOOLS is empty or not set');
  console.error('[FATAL] MCP Helper: Check that all required MCP servers started successfully');
  process.exit(1);
}


let requestId = 1;


const pendingRequests = new Map();


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});


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

    process.stdout.write(JSON.stringify(request) + '\n');

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`MCP tool ${toolName} timed out after 30s`));
      }
    }, 30000);
  });
}


const path = require('path');

// Get working directory from environment or use current
const workingDir = process.env.CODEMODE_WORKING_DIRECTORY || process.cwd();

// Helper for path resolution in project context
const pathHelper = {
  // Resolve path relative to working directory
  resolve: (...paths) => {
    const relativePath = path.join(...paths);
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.join(workingDir, relativePath);
  },

  // Get working directory
  cwd: () => workingDir,

  // Join paths
  join: (...segments) => path.join(...segments),

  // Get file extension
  ext: (filepath) => path.extname(filepath),

  // Get directory name
  dir: (filepath) => path.dirname(filepath),

  // Get file name
  basename: (filepath) => path.basename(filepath)
};

const mcp = {};

for (const [serverName, tools] of Object.entries(MCP_TOOLS)) {
  if (!Array.isArray(tools)) continue;

  mcp[serverName] = {};

  tools.forEach(tool => {
    const parts = tool.name.split('__');
    const shortName = parts[parts.length - 1];
    mcp[serverName][shortName] = (args) => callMCPTool(tool.name, args);
    mcp[shortName] = mcp[serverName][shortName];
  });
}

// Export MCP tools and path utilities
module.exports = Object.assign(mcp, { path: pathHelper, __workingDir: workingDir });
