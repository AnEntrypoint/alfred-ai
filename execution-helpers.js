#!/usr/bin/env node

import { spawn } from 'child_process';
import * as fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { copyFileSync, unlinkSync } from 'fs';

export class ExecutionHelpers {
  static getFileExtension(runtime, code = '') {
    switch (runtime) {
      case 'nodejs':
        const hasImport = /^import\s+/m.test(code) || /\nimport\s+/.test(code);
        const hasAwait = /\bawait\s+/i.test(code);
        const hasDynamicImport = /\bimport\s*\(/.test(code);
        const useESM = hasImport || hasAwait || hasDynamicImport;
        return useESM ? '.mjs' : '.cjs';
      case 'deno':
        return '.ts';
      case 'bun':
        return '.js';
      case 'python':
        return '.py';
      case 'bash':
        return '.sh';
      case 'go':
        return '.go';
      case 'rust':
        return '.rs';
      case 'c':
        return '.c';
      case 'cpp':
        return '.cpp';
      default:
        throw new Error(`Invalid runtime: ${runtime}`);
    }
  }

  static getExecutionCommand(runtime, filepath) {
    switch (runtime) {
      case 'nodejs':
        return { cmd: 'node', args: ['--no-deprecation', filepath] };
      case 'deno':
        return { cmd: 'deno', args: ['run', filepath] };
      case 'bun':
        return { cmd: 'bun', args: ['run', filepath] };
      case 'python':
        return { cmd: 'python3', args: [filepath] };
      case 'bash':
        const bashCode = fs.readFileSync(filepath, 'utf8');
        return { cmd: 'bash', args: ['-c', bashCode] };
      case 'go':
        return { cmd: 'go', args: ['run', filepath] };
      case 'rust':
        return { cmd: 'rustc', args: [filepath, '-o', filepath.replace('.rs', '')] };
      case 'c':
        const execFile = filepath.replace('.c', '');
        return { cmd: 'bash', args: ['-c', `gcc "${filepath}" -o "${execFile}" && "${execFile}"`] };
      case 'cpp':
        const cppExecFile = filepath.replace('.cpp', '');
        return { cmd: 'bash', args: ['-c', `g++ "${filepath}" -o "${cppExecFile}" && "${cppExecFile}"`] };
      default:
        throw new Error(`Invalid runtime: ${runtime}`);
    }
  }

  static detectLanguage(code) {
    if (code.includes('def ') || code.includes('import ')) return 'Python';
    if (code.includes('function ') || code.includes('const ')) return 'JavaScript';
    if (code.includes('package main')) return 'Go';
    if (code.includes('fn main()')) return 'Rust';
    if (code.includes('#include')) return 'C/C++';
    if (code.includes('#!/bin/bash')) return 'Bash';
    return 'Unknown';
  }

  static sanitizeCode(code) {
    return this.escapeBackticksInTemplateLiterals(code);
  }

  static escapeBackticksInTemplateLiterals(code) {
    const lines = code.split('\n');
    const result = [];
    let inTemplateLiteral = false;

    for (const line of lines) {
      result.push(this.fixBackticksInLine(line, inTemplateLiteral));
      inTemplateLiteral = this.updateTemplateLiteralState(line, inTemplateLiteral);
    }

    return result.join('\n');
  }

  static updateTemplateLiteralState(line, currentState) {
    let state = currentState;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '`' && (i === 0 || line[i - 1] !== '\\')) {
        state = !state;
      }
    }
    return state;
  }

  static fixBackticksInLine(line, isInsideTemplateLiteral) {
    const unescapedBacktickPositions = [];

    for (let i = 0; i < line.length; i++) {
      if (line[i] === '`' && (i === 0 || line[i - 1] !== '\\')) {
        unescapedBacktickPositions.push(i);
      }
    }

    if (unescapedBacktickPositions.length === 0 || !isInsideTemplateLiteral) {
      return line;
    }

    if (unescapedBacktickPositions.length % 2 === 1) {
      const positionsToEscape = unescapedBacktickPositions.slice(0, -1);
      let modified = line;
      for (let i = positionsToEscape.length - 1; i >= 0; i--) {
        const pos = positionsToEscape[i];
        modified = modified.substring(0, pos) + '\\`' + modified.substring(pos + 1);
      }
      return modified;
    } else {
      let modified = line;
      for (let i = unescapedBacktickPositions.length - 1; i >= 0; i--) {
        const pos = unescapedBacktickPositions[i];
        modified = modified.substring(0, pos) + '\\`' + modified.substring(pos + 1);
      }
      return modified;
    }
  }

  static async setupTempFile(code, runtime) {
    const extension = this.getFileExtension(runtime, code);
    const cleanCode = this.sanitizeCode(code);
    const tempFile = join(tmpdir(), `alfred-ai-${uuidv4()}${extension}`);
    fs.writeFileSync(tempFile, cleanCode);
    return tempFile;
  }

  static async setupMcpHelper() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const cjsDest = join(tmpdir(), 'mcp-runtime-helpers.cjs');
    const mjsDest = join(tmpdir(), 'mcp-runtime-helpers.mjs');

    const cjsSource = join(__dirname, 'mcp-runtime-helpers.cjs');
    try {
      copyFileSync(cjsSource, cjsDest);
      console.error('[execution] ✓ MCP CJS helper copied to', cjsDest);
    } catch (e) {
      console.error('[execution] ⚠ CJS copy failed, creating inline fallback');
      const cjsContent = `#!/usr/bin/env node

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
  console.error('[FATAL] MCP Helper: No MCP tools available');
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
      params: { name: toolName, arguments: args }
    };
    pendingRequests.set(id, { resolve, reject });
    process.stdout.write(JSON.stringify(request) + '\\n');
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(\`MCP tool \${toolName} timed out\`));
      }
    }, 30000);
  });
}

const path = require('path');
const workingDir = process.env.CODEMODE_WORKING_DIRECTORY || process.cwd();
const pathHelper = {
  resolve: (...paths) => {
    const relativePath = path.join(...paths);
    return path.isAbsolute(relativePath) ? relativePath : path.join(workingDir, relativePath);
  },
  cwd: () => workingDir,
  join: (...segments) => path.join(...segments),
  ext: (filepath) => path.extname(filepath),
  dir: (filepath) => path.dirname(filepath),
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

module.exports = Object.assign(mcp, { path: pathHelper, __workingDir: workingDir });
`;
      fs.writeFileSync(cjsDest, cjsContent);
      console.error('[execution] ✓ MCP CJS helper created inline to', cjsDest);
    }

    const mjsSource = join(__dirname, 'mcp-runtime-helpers.mjs');
    try {
      copyFileSync(mjsSource, mjsDest);
      console.error('[execution] ✓ MCP MJS helper copied to', mjsDest);
    } catch (e) {
      console.error('[execution] ⚠ MJS copy failed, creating inline fallback');
      const mjsContent = `#!/usr/bin/env node

import readline from 'readline';

const MCP_TOOLS_JSON = process.env.ALFRED_MCP_TOOLS || '{}';
let MCP_TOOLS = {};
try {
  MCP_TOOLS = JSON.parse(MCP_TOOLS_JSON);
} catch (e) {
  console.error('[MCP Helper] Failed to parse ALFRED_MCP_TOOLS:', e.message);
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
      params: { name: toolName, arguments: args }
    };
    pendingRequests.set(id, { resolve, reject });
    process.stdout.write(JSON.stringify(request) + '\\n');
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(\`MCP tool \${toolName} timed out\`));
      }
    }, 30000);
  });
}

import path from 'path';
const workingDir = process.env.CODEMODE_WORKING_DIRECTORY || process.cwd();
const pathHelper = {
  resolve: (...paths) => {
    const relativePath = path.join(...paths);
    return path.isAbsolute(relativePath) ? relativePath : path.join(workingDir, relativePath);
  },
  cwd: () => workingDir,
  join: (...segments) => path.join(...segments),
  ext: (filepath) => path.extname(filepath),
  dir: (filepath) => path.dirname(filepath),
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

const exportObj = Object.assign({}, mcp, { path: pathHelper, __workingDir: workingDir });
export default exportObj;
`;
      fs.writeFileSync(mjsDest, mjsContent);
      console.error('[execution] ✓ MCP MJS helper created inline to', mjsDest);
    }
  }

  static cleanupTempFile(tempFile) {
    try {
      unlinkSync(tempFile);
    } catch (e) {
    }
  }

  static buildChildEnv(mcpManager, originalCwd) {
    const nodePath = [originalCwd, process.env.NODE_PATH].filter(Boolean).join(':');
    return {
      ...process.env,
      ALFRED_MCP_TOOLS: JSON.stringify(mcpManager ? mcpManager.getAllTools() : {}),
      CODEMODE_WORKING_DIRECTORY: originalCwd,
      NODE_PATH: nodePath
    };
  }

  static spawnProcess(command, originalCwd, childEnv) {
    return spawn(command.cmd, command.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: originalCwd,
      env: childEnv
    });
  }
}

export default ExecutionHelpers;
