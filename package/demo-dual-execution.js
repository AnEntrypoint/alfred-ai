#!/usr/bin/env node

import EnhancedExecutor from './enhanced-executor.js';

async function demoDualExecution() {
  console.log('🎯 Demonstrating Dual Execution Capabilities\n');

  const executor = new EnhancedExecutor();
  await executor.initialize();

  try {
    // 1. JavaScript Execution
    console.log('📝 JavaScript Execution Example:');
    await executor.executeJavaScript(`
      console.log('Hello from JavaScript!');
      console.log('Current time:', new Date().toLocaleTimeString());
      console.log('Node.js version:', process.version);

      // Demonstrate file operations
      const fs = await import('fs');
      const files = fs.readdirSync('.');
      console.log('Files in current directory:', files.slice(0, 5).join(', '), '...');
    `);

    console.log('\n' + '='.repeat(50) + '\n');

    // 2. Bash Execution
    console.log('💻 Bash Execution Example:');
    await executor.executeBash('echo "Hello from Bash!" && pwd && ls -la | head -5');

    console.log('\n' + '='.repeat(50) + '\n');

    // 3. Demonstrate persistent bash state
    console.log('🔄 Persistent Bash State Example:');

    // Set a variable in bash
    await executor.executeBash('export MY_VAR="persistent_value" && echo "Set MY_VAR=$MY_VAR"');

    // Check if variable persists
    await executor.executeBash('echo "MY_VAR is still: $MY_VAR"');

    // Create a file with bash
    await executor.executeBash('echo "Created by bash" > test-bash.txt && cat test-bash.txt');

    console.log('\n' + '='.repeat(50) + '\n');

    // 4. JavaScript reading the file created by bash
    console.log('🔗 Cross-Context Example (JS reading bash-created file):');
    await executor.executeJavaScript(`
      const fs = await import('fs');
      const content = fs.readFileSync('test-bash.txt', 'utf8');
      console.log('JavaScript read from bash file:', content.trim());

      // Create another file
      fs.writeFileSync('test-js.txt', 'Created by JavaScript');
      console.log('JavaScript created test-js.txt');
    `);

    console.log('\n' + '='.repeat(50) + '\n');

    // 5. Bash reading the file created by JavaScript
    console.log('🔗 Cross-Context Example (Bash reading JS-created file):');
    await executor.executeBash('echo "Bash read from JS file:" && cat test-js.txt');

    console.log('\n' + '='.repeat(50) + '\n');

    // 6. Cleanup with both contexts
    console.log('🧹 Cleanup Example:');
    await executor.executeBash('rm test-bash.txt test-js.txt && echo "Cleaned up test files"');

    // Show execution stats
    const stats = executor.getExecutionStats();
    console.log('\n📊 Final Execution Stats:', stats);

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  } finally {
    executor.cleanup();
  }
}

demoDualExecution();