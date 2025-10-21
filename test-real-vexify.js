#!/usr/bin/env node

/**
 * Test real Vexify MCP integration via npx -y vexify@latest mcp
 */

import { spawn } from 'child_process';

console.log('🔍 Testing Real Vexify MCP Integration');
console.log('========================================');

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
    console.log('✅ Marvin ready, checking for Vexify tools...');

    // Request tools list to check for Vexify
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    };

    marvin.stdin.write(JSON.stringify(request) + '\n');
  }

  // Check for Vexify server startup
  if (output.includes('vexify')) {
    console.log('✅ Vexify server starting...');
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
        t.name.toLowerCase().includes('vexify') ||
        t.description.toLowerCase().includes('vexify') ||
        t.name.toLowerCase().includes('search') ||
        t.name.toLowerCase().includes('folder')
      );

      const playwrightTools = response.result.tools.filter(t =>
        t.name.includes('playwright')
      );

      console.log(`✅ Total tools available: ${totalTools}`);
      console.log(`✅ Playwright tools: ${playwrightTools.length}`);
      console.log(`✅ Potential Vexify tools: ${vexifyTools.length}`);

      if (vexifyTools.length > 0) {
        console.log('\n🔍 Vexify-like tools found:');
        vexifyTools.forEach(tool => {
          console.log(`  - ${tool.name}: ${tool.description}`);
        });

        // Test a Vexify tool if available
        const searchTool = vexifyTools.find(t =>
          t.name.toLowerCase().includes('search') ||
          t.name.toLowerCase().includes('folder')
        );

        if (searchTool) {
          console.log(`\n🧪 Testing Vexify tool: ${searchTool.name}`);

          const testRequest = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: searchTool.name,
              arguments: {
                pattern: "*.js",
                path: process.cwd()
              }
            }
          };

          marvin.stdin.write(JSON.stringify(testRequest) + '\n');
        }
      } else {
        console.log('\n⚠️ No explicit Vexify tools found, but basic search should work via built-in tools');
      }

      setTimeout(() => {
        console.log('\n🎉 Vexify integration test completed!');
        marvin.kill();
      }, 3000);
    }
    buffer = '';
  } catch (e) {
    // Ignore JSON parsing errors
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
    console.error('❌ Marvin failed to start within 20 seconds');
    marvin.kill();
    process.exit(1);
  }
}, 20000);