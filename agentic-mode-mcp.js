#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';

const WORKING_DIRECTORY = process.env.CODEMODE_WORKING_DIRECTORY || process.cwd();
console.error('[agentic-mode-mcp] Working directory:', WORKING_DIRECTORY);

const internalTools = {
  Edit: async ({ file_path, old_string, new_string, replace_all = false }) => {
    const content = readFileSync(file_path, 'utf8');
    if (replace_all) {
      writeFileSync(file_path, content.replaceAll(old_string, new_string), 'utf8');
      return 'OK';
    }
    const count = (content.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count !== 1) throw new Error(`old_string appears ${count} times, not unique`);
    writeFileSync(file_path, content.replace(old_string, new_string), 'utf8');
    return 'OK';
  },

  Glob: async ({ pattern, path = WORKING_DIRECTORY }) => {
    return await fg(pattern, { cwd: path, absolute: true });
  },

  Grep: async ({ pattern, path = WORKING_DIRECTORY, output_mode = 'files_with_matches', glob, type }) => {
    const args = [pattern, path, '--json'];
    if (glob) args.push('--glob', glob);
    if (type) args.push('--type', type);
    if (output_mode === 'files_with_matches') args.push('-l');
    if (output_mode === 'count') args.push('--count');

    return new Promise((resolve, reject) => {
      const proc = spawn('rg', args);
      let stdout = '';
      proc.stdout.on('data', d => stdout += d);
      proc.on('close', () => resolve(stdout));
      proc.on('error', reject);
    });
  },

  Bash: async ({ command, description, timeout = 120000 }) => {
    return new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: WORKING_DIRECTORY,
        timeout
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => resolve(`${stdout}${stderr}`));
      proc.on('error', reject);
    });
  },

  LS: async ({ path = WORKING_DIRECTORY }) => {
    const entries = readdirSync(path).map(name => {
      const fullPath = join(path, name);
      const stat = statSync(fullPath);
      return { name, isDirectory: stat.isDirectory(), size: stat.size };
    });
    return JSON.stringify(entries, null, 2);
  },

  Read: async ({ file_path }) => {
    return readFileSync(file_path, 'utf8');
  },

  Write: async ({ file_path, content }) => {
    writeFileSync(file_path, content, 'utf8');
    return 'OK';
  }
};

const server = new Server(
  {
    name: 'agentic-mode',
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
      {
        name: 'execute',
        description: 'Execute JavaScript code with built-in tools (Edit, Glob, Grep, Bash, LS, Read, Write). All tools are available as async functions in the execution context.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript code to execute. Built-in tools are available: Edit, Glob, Grep, Bash, LS, Read, Write'
            },
            workingDirectory: {
              type: 'string',
              description: 'Working directory for execution'
            }
          },
          required: ['code']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'execute') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { code, workingDirectory = WORKING_DIRECTORY } = request.params.arguments;

  const wrappedCode = `
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';

const Edit = async ({ file_path, old_string, new_string, replace_all = false }) => {
  const content = readFileSync(file_path, 'utf8');
  if (replace_all) {
    writeFileSync(file_path, content.replaceAll(old_string, new_string), 'utf8');
    return 'OK';
  }
  const occurrences = content.split(old_string).length - 1;
  if (occurrences !== 1) throw new Error(\`old_string appears \${occurrences} times, not unique\`);
  writeFileSync(file_path, content.replace(old_string, new_string), 'utf8');
  return 'OK';
};

const Glob = async ({ pattern, path = process.cwd() }) => {
  return await fg(pattern, { cwd: path, absolute: true });
};

const Grep = async ({ pattern, path = process.cwd(), output_mode = 'files_with_matches', glob, type }) => {
  const args = [pattern, path, '--json'];
  if (glob) args.push('--glob', glob);
  if (type) args.push('--type', type);
  if (output_mode === 'files_with_matches') args.push('-l');
  if (output_mode === 'count') args.push('--count');

  return new Promise((resolve, reject) => {
    const proc = spawn('rg', args);
    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    proc.on('close', () => resolve(stdout));
    proc.on('error', reject);
  });
};

const Bash = async ({ command, description, timeout = 120000 }) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', command], {
      cwd: process.cwd(),
      timeout
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => resolve(\`\${stdout}\${stderr}\`));
    proc.on('error', reject);
  });
};

const LS = async ({ path = process.cwd() }) => {
  const entries = readdirSync(path).map(name => {
    const fullPath = join(path, name);
    const stat = statSync(fullPath);
    return { name, isDirectory: stat.isDirectory(), size: stat.size };
  });
  return JSON.stringify(entries, null, 2);
};

const Read = async ({ file_path }) => {
  return readFileSync(file_path, 'utf8');
};

const Write = async ({ file_path, content }) => {
  writeFileSync(file_path, content, 'utf8');
  return 'OK';
};

(async () => {
${code}
})();
`;

  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('node', ['--input-type=module', '--eval', wrappedCode], {
        cwd: workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '', stderr = '';
      proc.stdout.on('data', d => {
        stdout += d;
        console.error('[execute output]', d.toString());
      });
      proc.stderr.on('data', d => {
        stderr += d;
        console.error('[execute error]', d.toString());
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve({ stdout, stderr, exitCode: 0 });
        } else {
          reject(new Error(`Execution failed with code ${code}: ${stderr}`));
        }
      });
      proc.on('error', reject);
    });

    return {
      content: [
        {
          type: 'text',
          text: `Execution completed successfully\n\nOutput:\n${result.stdout}\n\nErrors:\n${result.stderr}`
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Execution failed: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Agentic Mode MCP Server running on stdio');
