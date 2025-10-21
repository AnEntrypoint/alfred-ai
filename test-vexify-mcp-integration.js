#!/usr/bin/env node

/**
 * Test Vexify MCP server integration with Marvin
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔍 Testing Vexify MCP Server Integration');
console.log('=====================================');

// Create test files for Vexify search
const testFiles = {
  'vexify-test.js': '// Vexify test JavaScript file\nfunction test() { return "vexify works"; }',
  'vexify-test.md': '# Vexify Test\nThis is a test file for Vexify integration.',
  'subdir/': {
    'nested-vexify-test.txt': 'Nested Vexify test content'
  }
};

for (const [path, content] of Object.entries(testFiles)) {
  if (path.endsWith('/')) {
    const { mkdirSync } = require('fs');
    mkdirSync(join(process.cwd(), path), { recursive: true });
  } else {
    const { writeFileSync } = require('fs');
    const filePath = join(process.cwd(), path);
    const dirPath = join(filePath, '..');
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(filePath, content);
  }
}

console.log('✅ Created test files for Vexify search');

const marvin = spawn('node', ['marvin.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd()
});

let buffer = '';
let ready = false;
let toolsFound = false;

marvin.stderr.on('data', (data) => {
  const output = data.toString();
  console.error('Marvin:', output.trim());

  if (output.includes('Marvin ready')) {
    ready = true;
    console.log('✅ Marvin ready, testing Vexify integration...');

    // Request tools list
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    };

    marvin.stdin.write(JSON.stringify(request) + '\n');
  }

  if (output.includes('vexify')) {
    console.log('✅ Vexify server detected in output');
  }
});

marvin.stdout.on('data', (data) => {
  buffer += data.toString();

  try {
    const response = JSON.parse(buffer.trim());
    if (response.result && response.result.tools) {
      toolsFound = true;

      const totalTools = response.result.tools.length;
      const vexifyTools = response.result.tools.filter(t =>
        t.name.toLowerCase().includes('vexify')
      );

      const playwrightTools = response.result.tools.filter(t =>
        t.name.includes('playwright')
      );

      console.log(`✅ Total tools available: ${totalTools}`);
      console.log(`✅ Playwright tools: ${playwrightTools.length}`);
      console.log(`✅ Vexify tools: ${vexifyTools.length}`);

      if (vexifyTools.length > 0) {
        console.log('\n🔍 Vexify tools found:');
        vexifyTools.forEach(tool => {
          console.log(`  - ${tool.name}: ${tool.description}`);
        });

        // Test Vexify search
        console.log('\n🧪 Testing Vexify search...');
        const searchRequest = {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "vexify_search",
            arguments: {
              query: "test",
              path: process.cwd(),
              pattern: "*.js"
            }
          }
        };

        marvin.stdin.write(JSON.stringify(searchRequest) + '\n');

        // Test Vexify indexing
        setTimeout(() => {
          console.log('\n🧪 Testing Vexify indexing...');
          const indexRequest = {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "vexify_index",
              arguments: {
                path: process.cwd(),
                pattern: "*",
                recursive: true
              }
            }
          };

          marvin.stdin.write(JSON.stringify(indexRequest) + '\n');
        }, 1000);

      } else {
        console.log('\n⚠️ No Vexify tools found');
      }

      setTimeout(() => {
        console.log('\n🎉 Vexify MCP integration test completed!');
        marvin.kill();
      }, 3000);
    }
    buffer = '';
  } catch (e) {
    // Try to parse tool call results
    try {
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const response = JSON.parse(line.trim());
          if (response.result && response.result.content) {
            console.log('\n📋 Vexify tool result:');
            console.log(response.result.content[0].text.substring(0, 500) + '...');
          }
        }
      }
    } catch (jsonError) {
      // Ignore JSON parsing errors
    }
  }
});

marvin.on('close', (code) => {
  console.log(`\n🏁 Test completed with code: ${code}`);
  process.exit(code === 0 ? 0 : 1);
});

marvin.on('error', (error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

// Timeout handling
setTimeout(() => {
  if (!ready) {
    console.error('❌ Marvin failed to start within 15 seconds');
    marvin.kill();
    process.exit(1);
  }
}, 15000);