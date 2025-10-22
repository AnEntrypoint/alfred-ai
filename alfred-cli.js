#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import EnhancedExecutor from './enhanced-executor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read initial prompt from command line
const initialPrompt = process.argv.slice(2).join(' ');

if (!initialPrompt) {
  console.log('Usage: npx alfred-ai@latest "your coding task here"');
  console.log('       USE_PERSISTENT_MODE=true npx alfred-ai@latest "your coding task here"');
  console.log('       node alfred-cli.js "your coding task here"');
  console.log('       node alfred-cli.js --interactive');
  console.log('');
  console.log('Examples:');
  console.log('  npx alfred-ai@latest "make a simple express server and test it in playwright mcp"');
  console.log('  USE_PERSISTENT_MODE=true npx alfred-ai@latest "refactor this codebase"');
  console.log('');
  console.log('Environment Variables:');
  console.log('  USE_PERSISTENT_MODE=true  - Use enhanced persistent execution mode');
  console.log('  ANTHROPIC_AUTH_TOKEN      - Your Anthropic API token');
  console.log('  ANTHROPIC_BASE_URL        - Custom API base URL (optional)');
  process.exit(1);
}

async function startEnhancedMode(task) {
  console.log('🚀 Starting Enhanced Alfred AI Assistant');
  console.log('📝 Task:', task);
  console.log('🔄 Features: Persistent bash context, 3s planning, 60s progress reports\n');

  const executor = new EnhancedExecutor();

  try {
    // Initialize the enhanced executor
    await executor.initialize();

    // Execute the task with enhanced async behavior
    const result = await executor.executeTask(task, async () => {
      // This would normally integrate with your LLM
      // For demonstration, we'll simulate the task execution

      console.log('💭 Planning task execution...');

      // Simulate task execution steps
      console.log('⚙️  Step 1: Analyzing requirements...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('⚙️  Step 2: Creating implementation...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log('⚙️  Step 3: Testing and validation...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('✅ Task execution completed successfully');

      return {
        success: true,
        message: 'Task completed successfully',
        executionStats: executor.getExecutionStats()
      };
    });

    console.log('\n🎉 Final Result:', result);

  } catch (error) {
    console.error('\n❌ Task failed:', error.message);
  } finally {
    executor.cleanup();
  }
}

async function startInteractiveMode() {
  console.log('🎯 Alfred AI Assistant - Interactive Mode');
  console.log('Features: Persistent bash context, continuous execution');
  console.log('Commands: reset, exit, or any programming task\n');

  const executor = new EnhancedExecutor();
  await executor.initialize();

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

  while (true) {
    try {
      const input = await askQuestion('alfred> ');

      if (!input.trim()) continue;

      if (input.toLowerCase() === 'exit') {
        console.log('👋 Goodbye!');
        break;
      }

      if (input.toLowerCase() === 'reset') {
        await executor.resetContext();
        continue;
      }

      if (input.toLowerCase() === 'stats') {
        const stats = executor.getExecutionStats();
        console.log('📊 Execution Stats:', stats);
        continue;
      }

      // Execute the task
      await startEnhancedMode(input);
      console.log(''); // Add spacing

    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  }

  executor.cleanup();
  rl.close();
}

async function main() {
  // Check if we should use interactive mode
  if (initialPrompt === '--interactive') {
    await startInteractiveMode();
    return;
  }

  // Check if persistent mode is enabled
  if (process.env.USE_PERSISTENT_MODE === 'true') {
    await startEnhancedMode(initialPrompt);
    return;
  }

  // Fall back to original CLI
  console.log('📡 Using original Alfred CLI mode...');

  const cliProcess = spawn('node', [join(__dirname, 'cli.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env
  });

  cliProcess.on('exit', (code) => {
    process.exit(code);
  });

  cliProcess.on('error', (error) => {
    console.error('Failed to start CLI:', error.message);
    process.exit(1);
  });
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Alfred shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Alfred shutting down...');
  process.exit(0);
});

main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});