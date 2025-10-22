#!/usr/bin/env node

import AsyncExecutionWrapper from './async-execution-wrapper.js';
import { spawn } from 'child_process';

class EnhancedExecutor {
  constructor() {
    this.asyncWrapper = new AsyncExecutionWrapper();
    this.persistentBashProcess = null;
    this.mcpServers = new Map();
    this.workingDirectory = process.cwd();
    this.executionCount = 0;
  }

  async initialize() {
    console.log('🔧 Initializing Enhanced Executor...');

    // Initialize persistent bash context
    await this.initializePersistentBash();

    // Initialize MCP servers
    await this.initializeMCPServers();

    console.log('✅ Enhanced Executor initialized with persistent context');
  }

  async initializePersistentBash() {
    return new Promise((resolve, reject) => {
      this.persistentBashProcess = spawn('bash', ['--noprofile', '--norc'], {
        cwd: this.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'dumb', // Disable terminal escape codes
          PS1: '', // Empty prompt to avoid escape sequences
          HISTCONTROL: 'ignoreboth',
          HISTSIZE: '1000'
        }
      });

      // Wait for bash to be ready - use a simple timeout since we're using non-interactive mode
      this.persistentBashProcess.on('error', (error) => {
        console.error('❌ Failed to initialize bash context:', error.message);
        reject(error);
      });

      // Give bash time to initialize
      setTimeout(() => {
        console.log('✅ Persistent bash context initialized');
        resolve();
      }, 1000);
    });
  }

  async initializeMCPServers() {
    // This would initialize MCP servers like in the original CLI
    // For now, we'll keep it simple
    console.log('ℹ️  MCP servers initialization skipped for enhanced mode');
  }

  async executeBash(command) {
    if (!this.persistentBashProcess || this.persistentBashProcess.killed) {
      throw new Error('Persistent bash context not available');
    }

    this.executionCount++;
    console.log(`[Bash #${this.executionCount}] $ ${command}`);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Create bash command with default excludes for common tools
      let enhancedCommand = command;

      // Add default excludes for find commands
      if (command.includes('find ')) {
        enhancedCommand = command.replace(/find(\s+\.)?/, 'find$1 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/coverage/*"');
      }

      // Add default excludes for ls commands
      if (command.includes('ls ') && !command.includes('--ignore')) {
        enhancedCommand = command.replace('ls ', 'ls --ignore=node_modules --ignore=.git --ignore=dist --ignore=build --ignore=coverage ');
      }

      // Create a new bash process for each command in non-interactive mode
      // This maintains environment state but avoids complex parsing
      const bashProcess = spawn('bash', ['--noprofile', '--norc', '-c', enhancedCommand], {
        cwd: this.workingDirectory,
        env: {
          ...process.env,
          TERM: 'dumb',
          // Set up ripgrep ignores if available
          RG_DEFAULTS: '--hidden --follow --glob="!{.git,node_modules,dist,build,coverage}/*"'
        }
      });

      bashProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        process.stdout.write(chunk);
      });

      bashProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        process.stderr.write(chunk);
      });

      bashProcess.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code
        });
      });

      bashProcess.on('error', (error) => {
        reject(error);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!bashProcess.killed) {
          bashProcess.kill();
          resolve({
            stdout: stdout,
            stderr: 'Command timeout after 30s',
            exitCode: 1
          });
        }
      }, 30000);
    });
  }

  async executeJavaScript(code) {
    this.executionCount++;
    console.log(`[JS #${this.executionCount}] Executing JavaScript...`);

    try {
      // Create a wrapper with internal tools for JavaScript execution
      const wrappedCode = `
// Internal tools for JavaScript execution
const Edit = async ({ file_path, old_string, new_string, replace_all = false }) => {
  const fs = await import('fs');
  const content = fs.readFileSync(file_path, 'utf8');
  if (replace_all) {
    fs.writeFileSync(file_path, content.replaceAll(old_string, new_string), 'utf8');
    return 'OK';
  }
  const count = (content.split(old_string).length - 1);
  if (count !== 1) throw new Error(\`old_string appears \${count} times, not unique\`);
  fs.writeFileSync(file_path, content.replace(old_string, new_string), 'utf8');
  return 'OK';
};

const Read = async ({ file_path }) => {
  const fs = await import('fs');
  return fs.readFileSync(file_path, 'utf8');
};

const Write = async ({ file_path, content }) => {
  const fs = await import('fs');
  fs.writeFileSync(file_path, content, 'utf8');
  return 'OK';
};

const Glob = async ({ pattern, path = process.cwd() }) => {
  const fg = await import('fast-glob');
  // Always ignore node_modules and other common excludes
  const ignorePatterns = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'];
  return await fg.default(pattern, {
    cwd: path,
    absolute: true,
    ignore: ignorePatterns,
    dot: false // Ignore hidden files by default
  });
};

const Grep = async ({ pattern, path = process.cwd(), output_mode = 'files_with_matches', glob, type }) => {
  const { spawn } = await import('child_process');
  const args = [pattern, path, '--json', '--no-ignore-vcs']; // Don't ignore .git but ignore node_modules via .rgignore
  if (glob) args.push('--glob', glob);
  if (type) args.push('--type', type);
  if (output_mode === 'files_with_matches') args.push('-l');
  if (output_mode === 'count') args.push('--count');

  // Add common ignores
  args.push('--type-not', 'lock');
  args.push('--type-not', 'log');

  return new Promise((resolve, reject) => {
    const proc = spawn('rg', args);
    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    proc.on('close', () => resolve(stdout));
    proc.on('error', () => {
      // Fallback to basic grep if ripgrep not available
      const { execSync } = require('child_process');
      try {
        const grepCmd = \`grep -r "\${pattern}" \${path} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude="*.log" --exclude="*.lock" 2>/dev/null\`;
        const result = execSync(grepCmd, { encoding: 'utf8' });
        resolve(result);
      } catch (error) {
        resolve('');
      }
    });
  });
};

const Bash = async ({ command, description, timeout = 120000 }) => {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', command], {
      cwd: process.cwd(),
      timeout,
      env: process.env
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => {
      const chunk = d.toString();
      stdout += chunk;
      process.stdout.write(chunk);
    });
    proc.stderr.on('data', d => {
      const chunk = d.toString();
      stderr += chunk;
      process.stderr.write(chunk);
    });
    proc.on('close', code => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code }));
    proc.on('error', reject);
  });
};

const LS = async ({ path = process.cwd() }) => {
  const fs = await import('fs');
  const pathModule = await import('path');
  const entries = fs.readdirSync(path).map(name => {
    const fullPath = pathModule.join(path, name);
    const stat = fs.statSync(fullPath);
    return { name, isDirectory: stat.isDirectory(), size: stat.size };
  }).filter(entry =>
    !entry.name.startsWith('.') && // Hide hidden files
    entry.name !== 'node_modules' && // Hide node_modules
    entry.name !== 'dist' && // Hide dist folders
    entry.name !== 'build' // Hide build folders
  );
  return entries;
};

// User code
(async () => {
  try {
    ${code}
  } catch (error) {
    console.error('[JS Error]:', error.message);
    process.exit(1);
  }
})();`;

      const result = await new Promise((resolve, reject) => {
        const proc = spawn('node', ['--input-type=module', '--eval', wrappedCode], {
          cwd: this.workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          process.stdout.write(chunk);
        });

        proc.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          process.stderr.write(chunk);
        });

        proc.on('close', (code) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
        });

        proc.on('error', (error) => {
          reject(error);
        });
      });

      return result;
    } catch (error) {
      console.error(`[JS #${this.executionCount}] Error: ${error.message}`);
      return {
        stdout: '',
        stderr: error.message,
        exitCode: 1
      };
    }
  }

  async executeTask(task, executionFn) {
    console.log(`🎯 Task: ${task}`);

    return this.asyncWrapper.executeWithProgressReport(
      async () => {
        // Update progress during execution
        this.asyncWrapper.updateProgress(`Executing task: ${task}`);

        // Execute the provided function
        const result = await executionFn();

        this.asyncWrapper.updateProgress('Task completed successfully');

        return result;
      },
      task
    );
  }

  async resetContext() {
    console.log('🔄 Resetting execution context...');

    // Kill persistent bash process
    if (this.persistentBashProcess && !this.persistentBashProcess.killed) {
      this.persistentBashProcess.kill();
      this.persistentBashProcess = null;
    }

    // Cancel any running execution
    this.asyncWrapper.cancelExecution();

    // Reinitialize
    await this.initialize();

    console.log('✅ Context reset complete');
  }

  cleanup() {
    console.log('🧹 Cleaning up enhanced executor...');

    if (this.persistentBashProcess && !this.persistentBashProcess.killed) {
      this.persistentBashProcess.kill();
    }

    this.asyncWrapper.cancelExecution();

    console.log('✅ Cleanup complete');
  }

  getExecutionStats() {
    return {
      executionCount: this.executionCount,
      isExecuting: this.asyncWrapper.isExecutionRunning(),
      bashAlive: this.persistentBashProcess && !this.persistentBashProcess.killed
    };
  }
}

export default EnhancedExecutor;