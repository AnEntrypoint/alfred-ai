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

// Extract external package imports from code
function extractImports(code) {
  const imports = [];
  const importRegex = /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const packageName = match[1];
    // Skip built-in Node.js modules and relative imports
    if (!packageName.startsWith('.') && !packageName.startsWith('node:')) {
      imports.push(packageName);
    }
  }

  return [...new Set(imports)]; // Remove duplicates
}

// Install packages and return import wrapper code
async function preparePackages(imports, workingDirectory) {
  if (imports.length === 0) return '';

  const { spawn } = await import('child_process');
  const { promisify } = await import('util');

  try {
    // Install packages in working directory
    const installProcess = spawn('npm', ['install', ...imports], {
      cwd: workingDirectory,
      stdio: 'pipe'
    });

    let stdout = '', stderr = '';
    installProcess.stdout.on('data', (data) => stdout += data);
    installProcess.stderr.on('data', (data) => stderr += data);

    await new Promise((resolve, reject) => {
      installProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install failed with code ${code}. stderr: ${stderr}`));
      });
      installProcess.on('error', reject);
    });

    // Create import wrapper code
    const importStatements = imports.map(pkg => {
      // Handle common packages with their specific import patterns
      if (pkg === 'express') {
        return `import express from '${pkg}';`;
      } else if (pkg === 'axios') {
        return `import axios from '${pkg}';`;
      } else if (pkg === 'lodash') {
        return `import _ from '${pkg}';\nimport * as lodash from '${pkg}';`;
      } else if (pkg === 'fs' || pkg === 'path' || pkg === 'url' || pkg === 'util') {
        return `import ${pkg} from 'node:${pkg}';`;
      } else {
        // Default import for other packages
        const importName = pkg.replace(/[^a-zA-Z0-9]/g, '');
        return `import ${importName} from '${pkg}';`;
      }
    }).join('\n');

    return importStatements;

  } catch (error) {
    console.warn(`Failed to install packages ${imports.join(', ')}: ${error.message}`);
    return '';
  }
}

// The ONE tool exposed: execute
async function execute({ code, mcpWrappers = '', workingDirectory = process.cwd() }) {
  // Extract external imports from the code
  const externalImports = extractImports(code);

  // Install external packages and get import statements
  const importStatements = await preparePackages(externalImports, workingDirectory);

  const wrappedCode = `
// Built-in tools available in execution context
${Object.entries(internalTools).map(([name, fn]) =>
  `const ${name} = ${fn.toString()};`
).join('\n')}

// External package imports
${importStatements}

// MCP tool wrappers
${mcpWrappers}

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
