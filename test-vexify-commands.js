#!/usr/bin/env node

/**
 * Test different ways to run Vexify as MCP server
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔍 Testing Vexify MCP Server Commands');
console.log('========================================');

const testCommands = [
  ['npx', '-y', 'vexify@latest', 'mcp'],
  ['npx', '-y', 'vexify@latest', '--mcp'],
  ['npx', '-y', 'vexify@latest', 'server'],
  ['npx', '-y', 'vexify@latest'],
];

async function testCommand(command, description) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`Command: ${command.join(' ')}`);

  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      resolve({ success: false, error: 'Timeout after 5 seconds' });
    }, 5000);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!timedOut) {
        console.log(`Exit code: ${code}`);
        if (stdout.trim()) {
          console.log(`Stdout: ${stdout.trim().substring(0, 200)}...`);
        }
        if (stderr.trim()) {
          console.log(`Stderr: ${stderr.trim().substring(0, 200)}...`);
        }

        // Check if this looks like an MCP server
        const isMCP = stdout.includes('jsonrpc') ||
                     stderr.includes('jsonrpc') ||
                     stdout.includes('MCP') ||
                     stderr.includes('MCP') ||
                     code === 0;

        resolve({
          success: isMCP,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`Error: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
  });
}

async function runTests() {
  const results = [];

  for (let i = 0; i < testCommands.length; i++) {
    const [command, ...args] = testCommands[i];
    const description = `Test ${i + 1}: ${command} ${args.join(' ')}`;

    const result = await testCommand(testCommands[i], description);
    results.push({ command: testCommands[i], ...result });
  }

  console.log('\n📊 Test Results Summary:');
  console.log('=========================');

  const workingCommand = results.find(r => r.success);
  if (workingCommand) {
    console.log('✅ Found working Vexify MCP command:');
    console.log(`   ${workingCommand.command.join(' ')}`);

    // Update the marvin config with working command
    const config = {
      "$schema": "https://schemas.modelcontextprotocol.io/0.1.0/mcp.json",
      "mcpServers": {
        "builtInTools": {
          "command": "node",
          "args": ["built-in-tools-mcp.js"]
        },
        "playwright": {
          "command": "npx",
          "args": [
            "-y",
            "@executeautomation/playwright-mcp-server"
          ]
        },
        "vexify": {
          "command": workingCommand.command[0],
          "args": workingCommand.command.slice(1)
        }
      }
    };

    writeFileSync('./.codemode.json', JSON.stringify(config, null, 2));
    console.log('✅ Updated .codemode.json with working Vexify command');

  } else {
    console.log('❌ No working Vexify MCP command found');
    console.log('\nAll results:');
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.command.join(' ')}: ${r.success ? '✅' : '❌'}`);
      if (r.error) {
        console.log(`   Error: ${r.error}`);
      }
    });
  }
}

runTests().catch(console.error);