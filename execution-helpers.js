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

  static async setupTempFile(code, runtime) {
    const extension = this.getFileExtension(runtime, code);
    const tempFile = join(tmpdir(), `alfred-ai-${uuidv4()}${extension}`);
    fs.writeFileSync(tempFile, code);
    return tempFile;
  }

  static async setupMcpHelper() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const cjsSource = join(__dirname, 'mcp-runtime-helpers.cjs');
    const cjsDest = join(tmpdir(), 'mcp-runtime-helpers.cjs');
    try {
      copyFileSync(cjsSource, cjsDest);
      console.error('[execution] ✓ MCP CJS helper copied to', cjsDest);
    } catch (e) {
      throw new Error(`Failed to copy MCP CJS helper: ${e.message}`);
    }

    const mjsSource = join(__dirname, 'mcp-runtime-helpers.mjs');
    const mjsDest = join(tmpdir(), 'mcp-runtime-helpers.mjs');
    try {
      copyFileSync(mjsSource, mjsDest);
      console.error('[execution] ✓ MCP MJS helper copied to', mjsDest);
    } catch (e) {
      throw new Error(`Failed to copy MCP MJS helper: ${e.message}`);
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
