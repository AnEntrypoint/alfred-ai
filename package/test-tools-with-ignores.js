#!/usr/bin/env node

import EnhancedExecutor from './enhanced-executor.js';

async function testToolsWithIgnores() {
  console.log('🧪 Testing Tools with Smart Ignores\n');

  const executor = new EnhancedExecutor();
  await executor.initialize();

  try {
    // Test 1: Glob should ignore node_modules
    console.log('📁 Test 1: Glob with default ignores');
    await executor.executeJavaScript(`
      console.log('Finding all JS files (should exclude node_modules):');
      const files = await Glob({ pattern: '**/*.js' });
      console.log('Found JS files:', files.length);
      files.slice(0, 5).forEach(f => console.log('  -', f));
      if (files.length > 5) console.log('  ... and', files.length - 5, 'more');

      // Verify node_modules is excluded
      const hasNodeModules = files.some(f => f.includes('node_modules'));
      console.log('Contains node_modules:', hasNodeModules ? '❌ YES (bad)' : '✅ NO (good)');
    `);

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Grep should ignore node_modules
    console.log('🔍 Test 2: Grep with default ignores');
    await executor.executeJavaScript(`
      console.log('Searching for "require" (should exclude node_modules):');
      const matches = await Grep({ pattern: 'require', output_mode: 'files_with_matches' });
      console.log('Files with "require":', matches ? matches.split('\n').filter(l => l.trim()).length : 0);

      if (matches) {
        const files = matches.split('\n').filter(l => l.trim());
        files.slice(0, 3).forEach(f => console.log('  -', f));
        if (files.length > 3) console.log('  ... and', files.length - 3, 'more');

        // Verify node_modules is excluded
        const hasNodeModules = files.some(f => f.includes('node_modules'));
        console.log('Contains node_modules:', hasNodeModules ? '❌ YES (bad)' : '✅ NO (good)');
      }
    `);

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: LS should ignore node_modules
    console.log('📂 Test 3: LS with default ignores');
    await executor.executeJavaScript(`
      console.log('Listing current directory (should exclude node_modules):');
      const entries = await LS();
      console.log('Directory entries:', entries.length);
      entries.forEach(e => console.log('  -', e.name, e.isDirectory ? '(dir)' : ''));

      // Verify node_modules is excluded
      const hasNodeModules = entries.some(e => e.name === 'node_modules');
      console.log('Contains node_modules:', hasNodeModules ? '❌ YES (bad)' : '✅ NO (good)');
    `);

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 4: Bash auto-enhancement for find
    console.log('💻 Test 4: Bash auto-enhancement for find');
    await executor.executeBash('echo "Finding JS files with bash (should auto-exclude node_modules):" && find . -name "*.js" | head -5');

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 5: Bash auto-enhancement for ls
    console.log('💻 Test 5: Bash auto-enhancement for ls');
    await executor.executeBash('echo "LS with bash (should auto-ignore common dirs):" && ls | head -10');

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 6: Override ignores with direct bash
    console.log('💻 Test 6: Override ignores - Direct bash to node_modules');
    await executor.executeBash('echo "Direct access to node_modules (should work):" && ls node_modules | head -5 2>/dev/null || echo "node_modules not found or accessible"');

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 7: Search in node_modules explicitly
    console.log('💻 Test 7: Explicit search in node_modules');
    await executor.executeBash('echo "Searching in node_modules explicitly:" && find node_modules -name "*.json" | head -3 2>/dev/null || echo "No JSON files found in node_modules"');

    // Show final stats
    const stats = executor.getExecutionStats();
    console.log('\n📊 Final Execution Stats:', stats);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    executor.cleanup();
  }
}

testToolsWithIgnores();