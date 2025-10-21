#!/usr/bin/env node

/**
 * Comprehensive test suite for Marvin
 * Tests all functionality including MCP integration, execution, and history management
 */

import { spawn } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// Test configuration
const TEST_TIMEOUT = 30000;
const TEST_CONFIG = {
  "$schema": "https://schemas.modelcontextprotocol.io/0.1.0/mcp.json",
  mcpServers: {
    builtInTools: {
      command: "node",
      args: ["built-in-tools-mcp.js"]
    }
  }
};

class MarvinTester {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.marvinProcess = null;
  }

  addTest(name, testFn) {
    this.tests.push({ name, testFn });
  }

  async runTests() {
    console.log('🧪 Starting Marvin Test Suite');
    console.log('================================');

    // Setup test environment
    await this.setupTestEnvironment();

    // Run all tests
    for (const test of this.tests) {
      try {
        console.log(`\n📋 Running: ${test.name}`);
        await test.testFn();
        this.passed++;
        console.log(`✅ PASSED: ${test.name}`);
      } catch (error) {
        this.failed++;
        console.log(`❌ FAILED: ${test.name}`);
        console.log(`   Error: ${error.message}`);
      }
    }

    // Cleanup
    await this.cleanup();

    // Results
    console.log('\n📊 Test Results');
    console.log('================');
    console.log(`Passed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);
    console.log(`Total:  ${this.tests.length}`);

    if (this.failed > 0) {
      console.log('\n❌ Some tests failed!');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }

  async setupTestEnvironment() {
    console.log('🔧 Setting up test environment...');

    // Create test config file
    const configPath = join(process.cwd(), '.codemode.json');
    writeFileSync(configPath, JSON.stringify(TEST_CONFIG, null, 2));

    // Start Marvin process
    await this.startMarvin();
  }

  async startMarvin() {
    return new Promise((resolve, reject) => {
      console.log('🚀 Starting Marvin server...');

      this.marvinProcess = spawn('node', ['marvin.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let buffer = '';

      this.marvinProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('📝 Marvin:', output.trim());

        if (output.includes('Marvin ready')) {
          console.log('✅ Marvin server is ready');
          resolve();
        }
      });

      this.marvinProcess.on('error', (error) => {
        console.error('❌ Failed to start Marvin:', error.message);
        reject(error);
      });

      this.marvinProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`❌ Marvin exited with code ${code}`);
          reject(new Error(`Marvin process exited with code ${code}`));
        }
      });

      // Timeout if Marvin doesn't start
      setTimeout(() => {
        reject(new Error('Marvin server failed to start within timeout'));
      }, 10000);
    });
  }

  async sendMCPRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      };

      let buffer = '';

      const timeout = setTimeout(() => {
        reject(new Error('MCP request timeout'));
      }, 5000);

      this.marvinProcess.stdout.on('data', function handleResponse(data) {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              clearTimeout(timeout);
              this.marvinProcess.stdout.removeListener('data', handleResponse);

              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve(response.result);
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      });

      this.marvinProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async cleanup() {
    console.log('🧹 Cleaning up test environment...');

    if (this.marvinProcess) {
      console.log('🛑 Stopping Marvin server...');
      this.marvinProcess.kill('SIGTERM');

      // Force kill if it doesn't stop gracefully
      setTimeout(() => {
        if (this.marvinProcess && !this.marvinProcess.killed) {
          this.marvinProcess.kill('SIGKILL');
        }
      }, 2000);
    }

    // Remove test config file
    const configPath = join(process.cwd(), '.codemode.json');
    if (existsSync(configPath)) {
      try {
        unlinkSync(configPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  async assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  async assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  async assertContains(actual, expected, message) {
    if (!actual.includes(expected)) {
      throw new Error(message || `Expected "${actual}" to contain "${expected}"`);
    }
  }
}

// Create test instance
const tester = new MarvinTester();

// Test 1: MCP Connection
tester.addTest('MCP Connection and Initialization', async () => {
  const result = await tester.sendMCPRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });

  tester.assert(result, 'Should receive initialization response');
});

// Test 2: Tools List
tester.addTest('Tools List', async () => {
  const result = await tester.sendMCPRequest('tools/list');

  tester.assert(result.tools, 'Should have tools array');
  tester.assert(result.tools.length > 0, 'Should have at least one tool');

  // Check for required tools
  const toolNames = result.tools.map(t => t.name);
  tester.assert(toolNames.includes('execute'), 'Should have execute tool');
  tester.assert(toolNames.includes('marvin_status'), 'Should have marvin_status tool');
  tester.assert(toolNames.includes('marvin_kill'), 'Should have marvin_kill tool');

  console.log(`  📦 Found ${result.tools.length} tools`);
});

// Test 3: Execute Tool - JavaScript
tester.addTest('Execute JavaScript Code', async () => {
  const result = await tester.sendMCPRequest('tools/call', {
    name: 'execute',
    arguments: {
      code: 'console.log("Hello from Marvin!");',
      runtime: 'nodejs'
    }
  });

  tester.assert(result.content, 'Should have content array');
  tester.assert(result.content[0].text, 'Should have text content');
  tester.assertContains(result.content[0].text, 'Hello from Marvin!', 'Should contain expected output');
  tester.assert(!result.isError, 'Should not be an error');

  console.log(`  ✅ JavaScript execution successful`);
});

// Test 4: Execute Tool - Python
tester.addTest('Execute Python Code', async () => {
  const result = await tester.sendMCPRequest('tools/call', {
    name: 'execute',
    arguments: {
      code: 'print("Hello from Python Marvin!")',
      runtime: 'python'
    }
  });

  tester.assert(result.content, 'Should have content array');
  tester.assert(result.content[0].text, 'Should have text content');

  // Python might not be available, so handle that gracefully
  if (result.isError) {
    tester.assertContains(result.content[0].text, 'not found', 'Should indicate Python not available');
    console.log(`  ⚠️ Python not available, skipping`);
  } else {
    tester.assertContains(result.content[0].text, 'Hello from Python Marvin!', 'Should contain expected output');
    console.log(`  ✅ Python execution successful`);
  }
});

// Test 5: Auto-detect Runtime
tester.addTest('Auto-detect Runtime', async () => {
  const result = await tester.sendMCPRequest('tools/call', {
    name: 'execute',
    arguments: {
      code: 'console.log("Auto-detected!");',
      runtime: 'auto'
    }
  });

  tester.assert(result.content, 'Should have content array');
  tester.assert(!result.isError, 'Should not be an error');
  tester.assertContains(result.content[0].text, 'Auto-detected!', 'Should contain expected output');

  console.log(`  ✅ Auto-detection successful`);
});

// Test 6: Error Handling
tester.addTest('Error Handling', async () => {
  const result = await tester.sendMCPRequest('tools/call', {
    name: 'execute',
    arguments: {
      code: 'invalid syntax !!!',
      runtime: 'nodejs'
    }
  });

  tester.assert(result.content, 'Should have content array');
  tester.assert(result.isError, 'Should be an error');
  tester.assertContains(result.content[0].text, 'Execution failed', 'Should contain error message');

  console.log(`  ✅ Error handling working correctly`);
});

// Test 7: Marvin Status
tester.addTest('Marvin Status', async () => {
  const result = await tester.sendMCPRequest('tools/call', {
    name: 'marvin_status',
    arguments: {}
  });

  tester.assert(result.content, 'Should have content array');
  tester.assert(result.content[0].text, 'Should have text content');
  tester.assertContains(result.content[0].text, 'Marvin System Status', 'Should contain status header');
  tester.assertContains(result.content[0].text, 'History:', 'Should contain history info');
  tester.assertContains(result.content[0].text, 'Available Tools:', 'Should contain tools list');

  console.log(`  ✅ Status command working`);
});

// Test 8: History Management
tester.addTest('History Management', async () => {
  // Execute several commands to build history
  for (let i = 0; i < 5; i++) {
    await tester.sendMCPRequest('tools/call', {
      name: 'execute',
      arguments: {
        code: `console.log("History test ${i}");`,
        runtime: 'nodejs'
      }
    });
  }

  // Check status to see history
  const result = await tester.sendMCPRequest('tools/call', {
    name: 'marvin_status',
    arguments: {}
  });

  tester.assertContains(result.content[0].text, 'executions', 'Should show execution history');
  tester.assertContains(result.content[0].text, 'Tokens Used:', 'Should show token usage');

  console.log(`  ✅ History management working`);
});

// Test 9: Invalid Tool Name
tester.addTest('Invalid Tool Name', async () => {
  try {
    await tester.sendMCPRequest('tools/call', {
      name: 'invalid_tool_name',
      arguments: {}
    });
    tester.assert(false, 'Should have thrown an error');
  } catch (error) {
    tester.assertContains(error.message, 'Unknown tool', 'Should indicate unknown tool');
    console.log(`  ✅ Invalid tool handling working`);
  }
});

// Test 10: Large Code Execution
tester.addTest('Large Code Execution', async () => {
  const largeCode = `
    const result = [];
    for (let i = 0; i < 1000; i++) {
      result.push(i * 2);
    }
    console.log('Array length:', result.length);
    console.log('First item:', result[0]);
    console.log('Last item:', result[result.length - 1]);
  `;

  const result = await tester.sendMCPRequest('tools/call', {
    name: 'execute',
    arguments: {
      code: largeCode,
      runtime: 'nodejs'
    }
  });

  tester.assert(result.content, 'Should have content array');
  tester.assert(!result.isError, 'Should not be an error');
  tester.assertContains(result.content[0].text, 'Array length: 1000', 'Should process large code correctly');

  console.log(`  ✅ Large code execution successful`);
});

// Run all tests
if (import.meta.url === `file://${process.argv[1]}`) {
  tester.runTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

export default MarvinTester;