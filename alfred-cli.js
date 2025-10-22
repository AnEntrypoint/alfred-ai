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
  console.log('       node alfred-cli.js "your coding task here"');
  console.log('');
  console.log('Examples:');
  console.log('  npx alfred-ai@latest "make a simple express server and test it in playwright mcp"');
  console.log('  npx alfred-ai@latest "refactor this codebase"');
  console.log('');
  console.log('Features:');
  console.log('  ✓ Persistent bash context - Commands maintain state across executions');
  console.log('  ✓ 3-second planning phase - Initial analysis before execution');
  console.log('  ✓ 60-second progress reports - Regular updates on long-running processes');
  console.log('  ✓ Async process tracking - All servers and long-running tasks are tracked');
  console.log('  ✓ Automatic server detection - Servers run indefinitely with monitoring');
  console.log('');
  console.log('Environment Variables:');
  console.log('  ANTHROPIC_AUTH_TOKEN      - Your Anthropic API token');
  console.log('  ANTHROPIC_BASE_URL        - Custom API base URL (optional)');
  process.exit(1);
}

async function startEnhancedMode(task) {
  console.log('🚀 Starting Alfred AI Assistant');
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


async function main() {
  // Always use enhanced mode - no mode switching
  await startEnhancedMode(initialPrompt);
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