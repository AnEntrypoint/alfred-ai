import HybridExecutor from './executor.js';

async function runDemo() {
  const executor = new HybridExecutor();
  
  console.log('🎯 Testing Hybrid Executor with mixed JS and Bash commands\n');

  // Test JavaScript execution
  await executor.executeCommand(
    'console.log("Hello from JavaScript!"); console.log("Current time:", new Date().toLocaleTimeString());',
    'js'
  );

  // Test Bash execution
  await executor.executeCommand('echo "Hello from Bash!" && date', 'bash');

  // Test JavaScript with error handling
  await executor.executeCommand(
    'try { console.log("Testing error handling"); throw new Error("Test error"); } catch(e) { console.log("Caught:", e.message); }',
    'js'
  );

  // Test Bash with commands that produce output
  await executor.executeCommand('ls -la | head -5', 'bash');

  // Test batch execution
  console.log('\n📦 Testing batch execution...');
  const batchResults = await executor.executeBatch([
    { command: 'console.log("Batch item 1 - JS");', language: 'js' },
    { command: 'echo "Batch item 2 - Bash"', language: 'bash' },
    { command: 'console.log("Batch item 3 - JS again");', language: 'js' }
  ]);

  console.log('\n📊 Batch execution summary:');
  batchResults.forEach((result, i) => {
    console.log(`  ${i + 1}. ${result.language.toUpperCase()}: ${result.success ? '✅' : '❌'} (${result.duration}ms)`);
  });
}

runDemo().catch(console.error);
