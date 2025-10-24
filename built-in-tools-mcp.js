#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve as resolvePath, dirname, basename } from 'path';
import fg from 'fast-glob';
import { Readability } from '@mozilla/readability';
import fetch from 'node-fetch';
import ASTLinter, { isAstGrepAvailable } from './ast-grep-wrapper.js';
import ASTModificationHelper from './ast-modification-helper.js';
import {
  ToolError,
  ValidationError,
  ExecutionError,
  SearchError,
  ASTError,
  PatternError,
  ToolErrorHandler,
  ASTPatternValidator
} from './ast-error-handling.js';

const WORKING_DIRECTORY = process.env.CODEMODE_WORKING_DIRECTORY || process.cwd();
console.error('[built-in-tools-mcp] Working directory:', WORKING_DIRECTORY);

const server = new Server(
  {
    name: 'codemode-built-in-tools',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Built-in tools that mirror Claude's internal tools
      // Note: Read and Write are now exposed directly to the agent, not via builtInTools
      // They're still available INSIDE the execute environment via code-mode.js
      {
        name: 'Edit',
        description: 'Perform exact string replacements in files',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute path to file' },
            old_string: { type: 'string', description: 'Text to replace' },
            new_string: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences' }
          },
          required: ['file_path', 'old_string', 'new_string']
        }
      },
      {
        name: 'Glob',
        description: 'Fast file pattern matching',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.js")' },
            path: { type: 'string', description: 'Directory to search' },
            as_array: { type: 'boolean', description: 'Return as JSON array' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'Grep',
        description: 'Powerful content search using ripgrep',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regular expression pattern' },
            path: { type: 'string', description: 'File/directory to search' },
            options: { type: 'object', description: 'Search options (glob, type, output_mode, etc.)' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'Bash',
        description: 'Execute shell commands',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            description: { type: 'string', description: 'Clear description of command' },
            timeout: { type: 'number', description: 'Timeout in milliseconds' }
          },
          required: ['command']
        }
      },
      {
        name: 'LS',
        description: 'List directory contents',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to list' },
            show_hidden: { type: 'boolean', description: 'Show hidden files' },
            recursive: { type: 'boolean', description: 'Recursive listing' },
            as_array: { type: 'boolean', description: 'Return as JSON array' }
          }
        }
      },
      {
        name: 'TodoWrite',
        description: 'Create and manage structured task lists',
        inputSchema: {
          type: 'object',
          properties: {
            todos: { type: 'array', description: 'Array of todo objects' }
          },
          required: ['todos']
        }
      },
      {
        name: 'WebFetch',
        description: 'Retrieve and analyze web content',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' }
          },
          required: ['url']
        }
      },
      {
        name: 'ASTLint',
        description: 'AST-based code linting',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File or directory path' },
            recursive: { type: 'boolean', description: 'Recursive search' },
            extensions: { type: 'array', description: 'File extensions to lint' },
            maxFiles: { type: 'number', description: 'Maximum files to lint' },
            groupBy: { type: 'string', description: 'Group results by severity' }
          },
          required: ['path']
        }
      },
      {
        name: 'ASTSearch',
        description: 'AST pattern matching for code search',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File or directory path' },
            pattern: { type: 'string', description: 'AST pattern to search' },
            language: { type: 'string', description: 'Programming language' },
            recursive: { type: 'boolean', description: 'Recursive search' },
            maxFiles: { type: 'number', description: 'Maximum files to search' },
            maxMatches: { type: 'number', description: 'Maximum matches per file' },
            includeContext: { type: 'boolean', description: 'Include surrounding context' }
          },
          required: ['path', 'pattern']
        }
      },
      {
        name: 'ASTReplace',
        description: 'AST-based code replacement',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File or directory path' },
            pattern: { type: 'string', description: 'AST pattern to replace' },
            replacement: { type: 'string', description: 'Replacement text' },
            language: { type: 'string', description: 'Programming language' },
            recursive: { type: 'boolean', description: 'Recursive search' },
            maxFiles: { type: 'number', description: 'Maximum files to modify' },
            dryRun: { type: 'boolean', description: 'Dry run mode' }
          },
          required: ['path', 'pattern', 'replacement']
        }
      },
      {
        name: 'ASTModify',
        description: 'Multiple AST transformations',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File or directory path' },
            transformations: { type: 'array', description: 'Array of transformation objects' },
            language: { type: 'string', description: 'Programming language' },
            dryRun: { type: 'boolean', description: 'Dry run mode' },
            recursive: { type: 'boolean', description: 'Recursive search' },
            maxFiles: { type: 'number', description: 'Maximum files to modify' }
          },
          required: ['path', 'transformations']
        }
      }
    ]
  };
});

// Automatic linting for file operations
async function runAutoLint(args, operation) {
  // Only run linting for file modification operations
  if (!['Write', 'Edit'].includes(operation)) {
    return null;
  }

  try {
    if (!(await isAstGrepAvailable())) {
      return null;
    }

    const filePath = args.file_path;
    if (!filePath) {
      return null;
    }

    const targetPath = resolvePath(WORKING_DIRECTORY, filePath);

    if (!existsSync(targetPath)) {
      return null;
    }

    const linter = new ASTLinter(WORKING_DIRECTORY);
    const result = await linter.lintFile(targetPath);

    if (!result.available || !result.issues || result.issues.length === 0) {
      return null; // No issues found
    }

    const formattedOutput = linter.formatIssues(result.issues, {
      groupBy: 'severity',
      includePattern: false
    });

    return `\n\n🔍 Auto-lint Results (${operation} operation):
${formattedOutput}`;

  } catch (error) {
    // Silently fail linting - don't break the main operation
    return null;
  }
}

// Project-wide linting after any execution
async function runProjectWideLint() {
  try {
    if (!(await isAstGrepAvailable())) {
      return null;
    }

    const linter = new ASTLinter(WORKING_DIRECTORY);
    const result = await linter.lintProjectWide();

    if (!result.available) {
      return null;
    }

    // Only report if there are issues
    if (!result.mostProblematicFile) {
      return null; // No issues found across the project
    }

    const report = linter.formatMostProblematicFileReport(result.mostProblematicFile, result.summary);

    return `\n\n${report}`;

  } catch (error) {
    // Silently fail project-wide linting
    return null;
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'Read':
        result = await handleRead(args);
        break;
      case 'Write':
        result = await handleWrite(args);
        break;
      case 'Edit':
        result = await handleEdit(args);
        break;
      case 'Glob':
        result = await handleGlob(args);
        break;
      case 'Grep':
        result = await handleGrep(args);
        break;
      case 'Bash':
        result = await handleBash(args);
        break;
      case 'LS':
        result = await handleLS(args);
        break;
      case 'TodoWrite':
        result = await handleTodoWrite(args);
        break;
      case 'WebFetch':
        result = await handleWebFetch(args);
        break;
      case 'ASTLint':
        result = await handleASTLint(args);
        break;
      case 'ASTSearch':
        result = await handleASTSearch(args);
        break;
      case 'ASTReplace':
        result = await handleASTReplace(args);
        break;
      case 'ASTModify':
        result = await handleASTModify(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Run automatic linting for file operations
    const lintResult = await runAutoLint(args, name);
    if (lintResult) {
      result += lintResult;
    }

    // Run project-wide linting after any execution
    const projectLintResult = await runProjectWideLint();
    if (projectLintResult) {
      result += projectLintResult;
    }

    return {
      content: [{
        type: 'text',
        text: result
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

async function handleRead(args) {
  const { file_path, offset, limit } = args;
  const absPath = resolvePath(WORKING_DIRECTORY, file_path);

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  let content = readFileSync(absPath, 'utf8');
  if (content === '') {
    return `<system-reminder>File exists but has empty contents: ${absPath}</system-reminder>`;
  }

  const lines = content.split('\n');
  const start = offset || 0;
  const defaultLimit = 2000;
  const end = limit ? start + limit : Math.min(start + defaultLimit, lines.length);
  const selectedLines = lines.slice(start, end);

  const numberedLines = selectedLines.map((line, index) => {
    const lineNum = start + index + 1;
    const truncatedLine = line.length > 2000 ? line.substring(0, 2000) : line;
    return `${lineNum.toString().padStart(5)}→${truncatedLine}`;
  });

  let result = numberedLines.join('\n');
  if (result.length > 30000) {
    result = result.substring(0, 30000);
  }

  return result;
}

async function handleWrite(args) {
  const { file_path, content } = args;
  const absPath = resolvePath(WORKING_DIRECTORY, file_path);
  const fileExists = existsSync(absPath);

  if (fileExists) {
    const existingContent = readFileSync(absPath, 'utf8');
    if (existingContent === content) {
      return `File unchanged: ${absPath} (content is identical)`;
    }
  }

  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // ESCAPE-SAFE: Apply MCP corruption protection
  const safeContent = applyEscapeSafeTransformation(content);
  writeFileSync(absPath, safeContent, 'utf8');

  const action = fileExists ? 'overwrote' : 'created';
  const corruptionProtection = safeContent !== content ? ' with MCP corruption protection' : '';
  return `Successfully ${action} file: ${absPath}${corruptionProtection}`;
}

// ESCAPE-SAFE: Transformation function to prevent MCP corruption
function applyEscapeSafeTransformation(content) {
  let safeContent = content;
  let transformationsApplied = [];

  // Replace vulnerable regex literals with RegExp constructors
  if (safeContent.match(/\/.*\\`.*\/g/)) {
    safeContent = safeContent.replace(/\/([^/]*\\`[^/]*)\/g/g, (match, pattern) => {
      const safePattern = pattern.replace(/\\`/g, '\\\\`');
      transformationsApplied.push('regex-literal-to-constructor');
      return `new RegExp('${safePattern}', 'g')`;
    });
  }

  // Replace vulnerable template literals with safe alternatives
  if (safeContent.includes('\\`')) {
    // Convert template literals with escaped backticks to safer patterns
    safeContent = safeContent.replace(/`([^`]*\\`[^`]*)`/g, (match, innerContent) => {
      const safeContent = innerContent.replace(/\\`/g, '\\\\`');
      if (safeContent.includes('${')) {
        // Keep template literal but fix escapes
        transformationsApplied.push('template-literal-escape-fix');
        return `\`${safeContent}\``;
      } else {
        // Convert to regular string
        transformationsApplied.push('template-to-string');
        return `'${safeContent}'`;
      }
    });
  }

  // Fix nested escape sequences
  if (safeContent.includes('\\\\\\`')) {
    safeContent = safeContent.replace(/\\\\\\`/g, '\\\\`');
    transformationsApplied.push('nested-escape-fix');
  }

  // Store transformation info for debugging
  if (transformationsApplied.length > 0) {
    console.warn(`[MCP Corruption Protection] Applied transformations: ${transformationsApplied.join(', ')}`);
  }

  return safeContent;
}

async function handleEdit(args) {
  const { file_path, old_string, new_string, replace_all = false } = args;
  const absPath = resolvePath(WORKING_DIRECTORY, file_path);

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  if (old_string === new_string) {
    return 'No changes made: old_string and new_string are identical';
  }

  let content = readFileSync(absPath, 'utf8');
  const originalContent = content;

  // ESCAPE-SAFE: Apply corruption protection to new_string
  const safeNewString = applyEscapeSafeTransformation(new_string);

  if (replace_all) {
    if (!content.includes(old_string)) {
      throw new Error(`String not found in file: ${old_string}`);
    }
    content = content.split(old_string).join(safeNewString);
  } else {
    const index = content.indexOf(old_string);
    if (index === -1) {
      throw new Error(`String not found in file: ${old_string}`);
    }
    content = content.substring(0, index) + safeNewString + content.substring(index + old_string.length);
  }

  if (content !== originalContent) {
    writeFileSync(absPath, content, 'utf8');
  }

  const action = replace_all ? 'replaced all occurrences' : 'replaced';
  return `Successfully ${action} in file: ${absPath}`;
}

async function handleGlob(args) {
  const { pattern, path, as_array = false } = args;
  const cwd = path ? resolvePath(WORKING_DIRECTORY, path) : WORKING_DIRECTORY;

  const files = await fg(pattern, {
    cwd,
    absolute: false,
    dot: true,
    onlyFiles: true,
    stats: true
  });

  const sortedFiles = files
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
    .map(entry => typeof entry === 'string' ? entry : entry.path);

  if (as_array) {
    // Return JSON array for programmatic use
    return JSON.stringify(sortedFiles.slice(0, 1000));
  } else {
    // Return string representation (original behavior)
    let result = sortedFiles.length > 0 ? sortedFiles.join('\n') : 'No files matched';
    if (result.length > 30000) {
      result = result.substring(0, 30000);
    }
    return result;
  }
}

async function handleGrep(args) {
  const { pattern, path = '.', options = {} } = args;

  return new Promise((resolve, reject) => {
    // Handle null or undefined path by defaulting to current directory
    const safePath = path && typeof path === 'string' ? path : '.';
    const searchPath = resolvePath(WORKING_DIRECTORY, safePath);
    const rgArgs = [pattern, searchPath];

    if (options.glob) rgArgs.push('--glob', options.glob);
    if (options.type) rgArgs.push('--type', options.type);
    if (options['-i']) rgArgs.push('--ignore-case');
    if (options['-n']) rgArgs.push('--line-number');
    if (options.multiline) rgArgs.push('--multiline');
    if (options['-B']) rgArgs.push('--before-context', options['-B'].toString());
    if (options['-A']) rgArgs.push('--after-context', options['-A'].toString());
    if (options['-C']) rgArgs.push('--context', options['-C'].toString());

    const output_mode = options.output_mode || 'files_with_matches';
    if (output_mode === 'files_with_matches') {
      rgArgs.push('--files-with-matches');
    } else if (output_mode === 'count') {
      rgArgs.push('--count');
    }

    const child = spawn('rg', rgArgs);
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { errorOutput += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0 && errorOutput && !errorOutput.includes('No matches found')) {
        reject(new Error(`Grep search error: ${errorOutput}`));
        return;
      }

      let result = output.trim();
      if (options.head_limit) {
        const lines = result.split('\n');
        result = lines.slice(0, options.head_limit).join('\n');
      }
      if (result.length > 30000) {
        result = result.substring(0, 30000);
      }

      resolve(result || 'No matches found');
    });
  });
}

async function handleBash(args) {
  const { command, description, timeout = 120000 } = args;

  return new Promise((resolve, reject) => {
    if (timeout > 600000) {
      reject(new Error('Timeout cannot exceed 600000ms (10 minutes)'));
      return;
    }

    if (command.includes('rm -rf /') || command.includes('sudo rm')) {
      reject(new Error('Dangerous command detected'));
      return;
    }

    const child = spawn(command, [], {
      shell: true,
      timeout,
      cwd: WORKING_DIRECTORY,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      let output = stdout || stderr;
      const prefix = description ? `[${description}] ` : '';

      if (output.length > 30000) {
        output = output.substring(0, 30000);
      }

      if (code === 0) {
        resolve(`${prefix}${output}`);
      } else {
        reject(new Error(`${prefix}${output}`));
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Command execution error: ${error.message}`));
    });
  });
}

async function handleLS(args) {
  const { path = '.', show_hidden = false, recursive = false, as_array = false } = args;
  const absPath = resolvePath(WORKING_DIRECTORY, path);

  if (!existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  const stats = statSync(absPath);
  if (!stats.isDirectory()) {
    return `${basename(absPath)} (${stats.size} bytes)`;
  }

  function listDirectory(dirPath, prefix = '') {
    const entries = readdirSync(dirPath);
    const result = [];

    for (const entry of entries) {
      if (!show_hidden && entry.startsWith('.')) {
        continue;
      }

      const fullPath = join(dirPath, entry);
      const stats = statSync(fullPath);
      const isDir = stats.isDirectory();
      const size = isDir ? '' : ` (${stats.size} bytes)`;
      const type = isDir ? '/' : '';
      result.push(`${prefix}${entry}${type}${size}`);

      if (recursive && isDir) {
        result.push(...listDirectory(fullPath, prefix + '  '));
      }
    }

    return result;
  }

  const listing = listDirectory(absPath);

  if (as_array) {
    // Return array of file names (strings) for compatibility with agent code
    const fileArray = listing.map(item => {
      // Extract just the file/directory name without size info
      return item.replace(/\/.*$/, '').replace(/\s*\(\d+ bytes\)$/, '').trim();
    });
    // Return JSON string so it can be properly transmitted via MCP and parsed on the other end
    return JSON.stringify(fileArray.slice(0, 1000));
  } else {
    // Return string representation (original behavior)
    let result = listing.length > 0 ? listing.join('\n') : 'Empty directory';
    if (result.length > 30000) {
      result = result.substring(0, 30000);
    }
    return result;
  }
}

async function handleTodoWrite(args) {
  const { todos } = args;
  return `TodoWrite: ${JSON.stringify(todos, null, 2)}`;
}

async function handleWebFetch(args) {
  const { url } = args;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Dynamically import JSDOM to avoid startup issues
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return `WebFetch: Could not extract article content from ${url}. The page may not contain readable content.`;
    }

    const result = `WebFetch Results for ${url}:\n\nTitle: ${article.title}\nByline: ${article.byline || 'N/A'}\nExcerpt: ${article.excerpt || 'N/A'}\nLength: ${article.length} characters\n\nPlain Text Content:\n${article.textContent}`;

    if (result.length > 30000) {
      return result.substring(0, 30000) + '\n\n[Content truncated due to length]';
    }

    return result;

  } catch (error) {
    return `WebFetch error: ${error.message}`;
  }
}

async function handleASTLint(args) {
  const { path, recursive = true, extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs'], maxFiles = 100, groupBy = 'severity' } = args;

  try {
    if (!(await isAstGrepAvailable())) {
      return 'ASTLint: AST functionality is not available on this system. The @ast-grep/napi native binding could not be loaded.';
    }

    const targetPath = resolvePath(WORKING_DIRECTORY, path);

    if (!existsSync(targetPath)) {
      return `ASTLint: Path not found: ${targetPath}`;
    }

    const linter = new ASTLinter(WORKING_DIRECTORY);

    let result;

    if (statSync(targetPath).isDirectory()) {
      // Use project-wide linting for directories
      result = await linter.lintProjectWide({
        maxFiles,
        extensions,
        workingDirectory: targetPath
      });
    } else {
      result = await linter.lintFile(targetPath);
      // Normalize format for consistency
      if (result.issues) {
        result = {
          available: result.available,
          totalIssues: result.issues.length,
          errors: result.issues.filter(i => i.severity === 'error').length,
          warnings: result.issues.filter(i => i.severity === 'warning').length,
          info: result.issues.filter(i => i.severity === 'info').length,
          files: [targetPath],
          issues: result.issues
        };
      }
    }

    if (!result.available) {
      return 'ASTLint: AST linting is not available on this system.';
    }

    // Handle project-wide linting result format
    if (result.mostProblematicFile || result.summary !== undefined) {
      // Project-wide linting result
      return linter.formatMostProblematicFileReport(result.mostProblematicFile, result.summary);
    }

    // Single file linting result format
    if (result.totalIssues === 0) {
      return '✅ ASTLint: No linting issues found';
    }

    const formattedOutput = linter.formatIssues(result.issues, {
      groupBy,
      includePattern: false
    });

    const summary = `🔍 AST Linting Results:
📁 Path: ${targetPath}
📄 Files scanned: ${result.files.length}
🚨 Errors: ${result.errors}
⚠️  Warnings: ${result.warnings}
ℹ️  Info: ${result.info}
📊 Total issues: ${result.totalIssues}

`;

    return summary + formattedOutput;

  } catch (error) {
    return `ASTLint error: ${error.message}`;
  }
}

async function handleASTSearch(args) {
  try {
    const { path, pattern, language, recursive = true, maxFiles = 100, maxMatches = 50, includeContext = false } = args;

    if (!(await isAstGrepAvailable())) {
      return 'ASTSearch: AST functionality is not available on this system.';
    }

    const targetPath = resolvePath(WORKING_DIRECTORY, path);

    if (!existsSync(targetPath)) {
      return `ASTSearch: Path not found: ${targetPath}`;
    }

    const helper = new ASTModificationHelper(WORKING_DIRECTORY);

    let result;
    if (statSync(targetPath).isDirectory()) {
      result = await helper.searchPatternInDirectory(targetPath, pattern, {
        recursive,
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.py', '.go', '.rs', '.c', '.cpp'],
        maxFiles,
        maxMatchesPerFile: maxMatches,
        language,
        includeContext
      });
    } else {
      result = await helper.searchPatternInFile(targetPath, pattern, {
        language,
        maxMatches,
        includeContext
      });
    }

    if (!result.success) {
      return `ASTSearch error: ${result.error}`;
    }

    const insights = helper.generateASTInsights(result.results, 'search', pattern);

    let output = `🔍 AST Search Results:\n`;
    output += `📁 Path: ${targetPath}\n`;
    output += `🔍 Pattern: "${pattern}"\n`;
    output += `📊 Total matches: ${result.totalMatches}\n`;
    if (result.filesProcessed) {
      output += `📄 Files processed: ${result.filesProcessed}\n`;
    }
    output += `\n`;

    if (result.results.length === 0) {
      output += `No matches found for pattern "${pattern}"`;
    } else {
      output += `Found ${result.results.length} matches:\n\n`;

      result.results.forEach((match, index) => {
        output += `${index + 1}. ${match.file}:${match.line}:${match.column}\n`;
        output += `   ${match.text}\n`;

        if (includeContext && match.context) {
          output += `   Context:\n`;
          match.context.forEach(ctx => {
            const prefix = ctx.isMatch ? '→' : ' ';
            output += `   ${prefix} ${ctx.line}:${ctx.content}\n`;
          });
        }
        output += '\n';
      });
    }

    if (insights.length > 0) {
      output += `💡 Insights:\n`;
      insights.forEach(insight => {
        output += `• ${insight}\n`;
      });
    }

    return output.trim();

  } catch (error) {
    return `ASTSearch error: ${error.message}`;
  }
}

async function handleASTReplace(args) {
  try {
    const { path, pattern, replacement, language, recursive = true, maxFiles = 50, dryRun = false } = args;

    if (!(await isAstGrepAvailable())) {
      return 'ASTReplace: AST functionality is not available on this system.';
    }

    const targetPath = resolvePath(WORKING_DIRECTORY, path);

    if (!existsSync(targetPath)) {
      return `ASTReplace: Path not found: ${targetPath}`;
    }

    const helper = new ASTModificationHelper(WORKING_DIRECTORY);

    let result;
    if (statSync(targetPath).isDirectory()) {
      result = await helper.replacePatternInDirectory(targetPath, pattern, replacement, {
        recursive,
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs'],
        maxFiles,
        language,
        dryRun
      });
    } else {
      result = await helper.replacePatternInFile(targetPath, pattern, replacement, {
        language,
        dryRun
      });
    }

    if (!result.success) {
      return `ASTReplace error: ${result.error}`;
    }

    const insights = helper.generateASTInsights(result.results || [result], 'replace', pattern, replacement);

    let output = `🔄 AST Replacement Results:\n`;
    output += `📁 Path: ${targetPath}\n`;
    output += `🔍 Pattern: "${pattern}"\n`;
    output += `✏️  Replacement: "${replacement}"\n`;
    output += `${dryRun ? '🔍 DRY RUN - No files modified' : '✅ Files Modified'}\n`;
    output += `\n`;

    if (result.filesProcessed) {
      output += `📊 Summary:\n`;
      output += `• Files processed: ${result.filesProcessed}\n`;
      output += `• Files modified: ${result.filesModified}\n`;
      output += `• Total changes: ${result.totalChanges}\n\n`;
    } else {
      output += `📊 Summary:\n`;
      output += `• Matches found: ${result.matchesFound}\n`;
      output += `• Modified: ${result.modified ? 'Yes' : 'No'}\n`;
      output += `• Changes: ${result.changes ? result.changes.length : 0}\n\n`;
    }

    if (result.results && result.results.length > 0) {
      output += `📋 Changes Details:\n`;
      result.results.forEach(fileResult => {
        if (fileResult.matchesFound > 0) {
          output += `\n📄 ${fileResult.file}\n`;
          output += `   • Changes: ${fileResult.matchesFound}\n`;
          output += `   • Status: ${fileResult.modified ? 'Modified' : 'No changes needed'}\n`;
        }
      });
    } else if (result.changes && result.changes.length > 0) {
      output += `📋 Changes:\n`;
      result.changes.forEach((change, index) => {
        output += `${index + 1}. Line ${change.line}:${change.column}\n`;
        output += `   - Original: ${change.original}\n`;
        output += `   + Replacement: ${change.replacement}\n\n`;
      });
    }

    if (insights.length > 0) {
      output += `💡 Insights:\n`;
      insights.forEach(insight => {
        output += `• ${insight}\n`;
      });
    }

    return output.trim();

  } catch (error) {
    return `ASTReplace error: ${error.message}`;
  }
}

async function handleASTModify(args) {
  try {
    const { path, transformations, language, dryRun = false, recursive = true, maxFiles = 50 } = args;

    if (!(await isAstGrepAvailable())) {
      return 'ASTModify: AST functionality is not available on this system.';
    }

    const targetPath = resolvePath(WORKING_DIRECTORY, path);

    if (!existsSync(targetPath)) {
      return `ASTModify: Path not found: ${targetPath}`;
    }

    const helper = new ASTModificationHelper(WORKING_DIRECTORY);

    let totalChanges = 0;
    let totalFilesModified = 0;
    let allResults = [];

    let output = `🔧 AST Modification Results:\n`;
    output += `📁 Path: ${targetPath}\n`;
    output += `🔍 Transformations: ${transformations.length}\n`;
    output += `${dryRun ? '🔍 DRY RUN - No files modified' : '✅ Files Modified'}\n\n`;

    for (let i = 0; i < transformations.length; i++) {
      const { pattern, replacement, description } = transformations[i];

      output += `Transformation ${i + 1}: ${description || pattern}\n`;
      output += `Pattern: "${pattern}" → "${replacement}"\n`;

      let result;
      if (statSync(targetPath).isDirectory()) {
        result = await helper.replacePatternInDirectory(targetPath, pattern, replacement, {
          recursive,
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs'],
          maxFiles,
          language,
          dryRun
        });
      } else {
        result = await helper.replacePatternInFile(targetPath, pattern, replacement, {
          language,
          dryRun
        });
      }

      if (!result.success) {
        output += `❌ Error: ${result.error}\n\n`;
        continue;
      }

      if (result.filesProcessed) {
        output += `   • Files processed: ${result.filesProcessed}\n`;
        output += `   • Files modified: ${result.filesModified}\n`;
        output += `   • Changes: ${result.totalChanges}\n`;
        totalFilesModified += result.filesModified;
        totalChanges += result.totalChanges;
      } else {
        output += `   • Matches found: ${result.matchesFound}\n`;
        output += `   • Modified: ${result.modified ? 'Yes' : 'No'}\n`;
        if (result.changes) {
          output += `   • Changes: ${result.changes.length}\n`;
          totalChanges += result.changes.length;
        }
        if (result.modified) {
          totalFilesModified++;
        }
      }

      allResults.push(result);
      output += `\n`;
    }

    output += `📊 Overall Summary:\n`;
    output += `• Total transformations: ${transformations.length}\n`;
    output += `• Total files modified: ${totalFilesModified}\n`;
    output += `• Total changes: ${totalChanges}\n`;

    return output.trim();

  } catch (error) {
    return `ASTModify error: ${error.message}`;
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Built-in Tools MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
