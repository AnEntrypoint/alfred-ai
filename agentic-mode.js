#!/usr/bin/env node

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';

// Internal tools available inside execute()
const internalTools = {
  Edit: async ({ file_path, old_string, new_string, replace_all = false }) => {
    const { readFileSync, writeFileSync } = await import('fs');
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

  Glob: async ({ pattern, path = process.cwd() }) => {
    const fg = (await import('fast-glob')).default;
    return await fg(pattern, { cwd: path, absolute: true });
  },

  Grep: async ({ pattern, path = process.cwd(), output_mode = 'files_with_matches', glob, type }) => {
    const { spawn } = await import('child_process');
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
    const { spawn } = await import('child_process');
    return new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: process.cwd(),
        timeout
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => resolve(`${stdout}${stderr}`));
      proc.on('error', reject);
    });
  },

  LS: async ({ path = process.cwd() }) => {
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');
    const entries = readdirSync(path).map(name => {
      const fullPath = join(path, name);
      const stat = statSync(fullPath);
      return { name, isDirectory: stat.isDirectory(), size: stat.size };
    });
    return entries;
  },

  Read: async ({ file_path }) => {
    const { readFileSync } = await import('fs');
    return readFileSync(file_path, 'utf8');
  },

  Write: async ({ file_path, content }) => {
    const { writeFileSync } = await import('fs');
    writeFileSync(file_path, content, 'utf8');
    return 'OK';
  }
};

// The ONE tool exposed: execute
async function execute({ code, workingDirectory = process.cwd() }) {
  const wrappedCode = `
// Built-in tools available in execution context
${Object.entries(internalTools).map(([name, fn]) =>
  `const ${name} = ${fn.toString()};`
).join('\n')}

// User code
(async () => {
${code}
})();
`;

  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['--input-type=module', '--eval', wrappedCode], {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 });
      } else {
        reject(new Error(`Execution failed: ${stderr}`));
      }
    });
    proc.on('error', reject);
  });
}

export { execute };
