import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

class HybridExecutor {
  constructor() {
    this.executionCount = 0;
    this.supportedLangs = ['js', 'bash', 'sh'];
  }

  async executeCommand(command, language = 'js', options = {}) {
    const executionId = ++this.executionCount;
    const startTime = Date.now();
    
    console.log(`[${executionId}] Starting execution (Language: ${language})`);
    console.log(`[${executionId}] Command: ${command}`);
    console.log('---');

    try {
      let result;
      
      if (language === 'js' || language === 'javascript') {
        result = await this.executeJS(command, executionId);
      } else if (language === 'bash' || language === 'sh') {
        result = await this.executeBash(command, executionId);
      } else {
        throw new Error(`Unsupported language: ${language}`);
      }

      const duration = Date.now() - startTime;
      console.log(`[${executionId}] Execution completed in ${duration}ms`);
      console.log(`[${executionId}] Exit code: ${result.code}`);
      if (result.error) {
        console.log(`[${executionId}] Error: ${result.error}`);
      }
      console.log('===\n');

      return {
        id: executionId,
        language,
        command,
        ...result,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`[${executionId}] Execution FAILED in ${duration}ms`);
      console.log(`[${executionId}] Error: ${error.message}`);
      console.log('===\n');

      return {
        id: executionId,
        language,
        command,
        success: false,
        error: error.message,
        duration
      };
    }
  }

  async executeJS(jsCode, executionId) {
    return new Promise((resolve) => {
      // Create temporary JS file
      const tempFile = `temp_execution_${executionId}.js`;
      const wrappedCode = `
// Auto-generated execution wrapper
try {
  (async () => {
    ${jsCode}
  })().then(() => {
    console.log('[JS] Execution completed successfully');
    process.exit(0);
  }).catch((error) => {
    console.error('[JS Error]:', error.message);
    process.exit(1);
  });
} catch (error) {
  console.error('[JS Error]:', error.message);
  process.exit(1);
}
`;

      const child = spawn('node', ['-e', wrappedCode], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output);
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        process.stderr.write(output);
      });

      child.on('close', (code) => {
        // Cleanup temp file
        fs.unlink(tempFile).catch(() => {});
        
        resolve({
          success: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          code: -1,
          error: error.message
        });
      });
    });
  }

  async executeBash(bashCommand, executionId) {
    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', bashCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output);
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        process.stderr.write(output);
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          code: -1,
          error: error.message
        });
      });
    });
  }

  // Batch execution support
  async executeBatch(commands) {
    console.log(`Starting batch execution of ${commands.length} commands\n`);
    const results = [];
    
    for (const { command, language = 'js' } of commands) {
      const result = await this.executeCommand(command, language);
      results.push(result);
    }
    
    console.log(`Batch execution completed. Total: ${results.length} commands`);
    return results;
  }

  // Interactive mode
  async startInteractive() {
    console.log('🚀 Starting Hybrid Executor Interactive Mode');
    console.log('Supported languages: js, bash, sh');
    console.log('Type "exit" to quit, "help" for commands\n');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

    while (true) {
      try {
        const input = await askQuestion('executor> ');
        
        if (input.toLowerCase() === 'exit') {
          console.log('Goodbye! 👋');
          break;
        }
        
        if (input.toLowerCase() === 'help') {
          console.log('Commands:');
          console.log('  js <code>     - Execute JavaScript');
          console.log('  bash <cmd>    - Execute Bash command');
          console.log('  sh <cmd>      - Execute Shell command');
          console.log('  exit          - Exit interactive mode');
          console.log('  help          - Show this help');
          continue;
        }

        if (!input.trim()) continue;

        // Parse language prefix
        let language = 'js';
        let command = input;

        const jsMatch = input.match(/^(js|javascript)\s+(.+)$/i);
        const bashMatch = input.match(/^(bash|sh)\s+(.+)$/i);

        if (jsMatch) {
          language = 'js';
          command = jsMatch[2];
        } else if (bashMatch) {
          language = 'bash';
          command = bashMatch[2];
        }

        await this.executeCommand(command, language);

      } catch (error) {
        console.error('Interactive mode error:', error.message);
      }
    }

    rl.close();
  }
}

// Export for use as module
export default HybridExecutor;

// If running directly, start interactive mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const executor = new HybridExecutor();
  executor.startInteractive();
}
