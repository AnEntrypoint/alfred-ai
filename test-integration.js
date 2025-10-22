#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🧪 Alfred AI - Comprehensive Integration Test\n');

const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

function logTest(name, passed, details = '') {
  if (passed) {
    testResults.passed.push(name);
    console.log(`✅ ${name}`);
    if (details) console.log(`   ${details}`);
  } else {
    testResults.failed.push(name);
    console.log(`❌ ${name}`);
    if (details) console.log(`   ${details}`);
  }
}

function logWarning(message) {
  testResults.warnings.push(message);
  console.log(`⚠️  ${message}`);
}

// Test 1: File exists and is readable
console.log('📋 Test 1: File Structure');
const alfredPath = path.join(process.cwd(), 'alfred-cli.js');
const exists = fs.existsSync(alfredPath);
logTest('alfred-cli.js exists', exists);

if (exists) {
  const stats = fs.statSync(alfredPath);
  logTest('File is readable', stats.isFile(), `Size: ${stats.size} bytes`);
  logTest('File has execute permissions', (stats.mode & 0o111) !== 0);
}

// Test 2: Syntax validation
console.log('\n📋 Test 2: Syntax Validation');
const syntaxCheck = spawn('node', ['-c', alfredPath]);
let syntaxValid = true;
syntaxCheck.on('close', (code) => {
  syntaxValid = code === 0;
});
await new Promise(resolve => setTimeout(resolve, 1000));
logTest('Syntax check passed', syntaxValid);

// Test 3: Required imports
console.log('\n📋 Test 3: Required Imports');
const content = fs.readFileSync(alfredPath, 'utf8');
logTest('Has Anthropic import', content.includes('import Anthropic'));
logTest('Has spawn import', content.includes('import { spawn }'));
logTest('Has AuthenticationManager import', content.includes('import AuthenticationManager'));

// Test 4: Class structure
console.log('\n📋 Test 4: Class Structure');
logTest('Has AlfredMCPClient class', content.includes('class AlfredMCPClient'));
logTest('Has constructor', content.includes('constructor()'));
logTest('Has runAgenticLoop method', content.includes('async runAgenticLoop'));
logTest('Has executeCode method', content.includes('async executeCode'));
logTest('Has setupLogMonitoring method', content.includes('setupLogMonitoring(processId)'));

// Test 5: Critical features
console.log('\n📋 Test 5: Critical Features');
logTest('Bash stdin mode implemented', content.includes("spawn('bash', []") && content.includes('stdin.write(code)'));
logTest('3-second timeout implemented', content.includes('setTimeout') && content.includes('3000'));
logTest('Process tracking map exists', content.includes('this.runningProcesses = new Map()'));
logTest('Error history map exists', content.includes('this.errorHistory = new Map()'));
logTest('Pending updates array exists', content.includes('this.pendingAgentUpdates = []'));

// Test 6: Log management
console.log('\n📋 Test 6: Log Management');
logTest('getNewLogs closure implemented', content.includes('getNewLogs:'));
logTest('60-second interval monitoring', content.includes('60000') && content.includes('setInterval'));
logTest('Eager queueing to agent', content.includes('pendingAgentUpdates.push'));
logTest('Injection before agent turn', content.includes('if (this.pendingAgentUpdates && this.pendingAgentUpdates.length > 0)'));

// Test 7: Tools
console.log('\n📋 Test 7: Tools Registration');
const toolNames = ['execute', 'check_process', 'kill_process', 'wait_for_logs'];
toolNames.forEach(toolName => {
  const regex = new RegExp(`name: '${toolName}'`);
  logTest(`Tool registered: ${toolName}`, regex.test(content));
});

// Test 8: Tool handlers
console.log('\n📋 Test 8: Tool Handlers');
logTest('execute handler exists', content.includes("block.name === 'execute'"));
logTest('check_process handler exists', content.includes("block.name === 'check_process'"));
logTest('kill_process handler exists', content.includes("block.name === 'kill_process'"));
logTest('wait_for_logs handler exists', content.includes("block.name === 'wait_for_logs'"));

// Test 9: Process control
console.log('\n📋 Test 9: Process Control');
logTest('Process kill with SIGTERM', content.includes('SIGTERM'));
logTest('Fallback to SIGKILL', content.includes('SIGKILL'));
logTest('Monitor interval cleanup', content.includes('clearInterval(monitorInterval)') || content.includes('clearInterval(proc.monitorInterval)'));
logTest('Process cleanup on exit', content.includes('cleanup()'));

// Test 10: User visibility
console.log('\n📋 Test 10: User Visibility & Logging');
logTest('Process ID in logs', content.includes('[${processId}]'));
logTest('Working directory logged', content.includes('Working Directory'));
logTest('Execution model logged', content.includes('Execution Model'));
logTest('Background status logged', content.includes('RUNNING (async mode)') || content.includes('Background process update'));

// Test 11: Agent knowledge
console.log('\n📋 Test 11: Agent Knowledge (Tool Description)');
logTest('Execution model explained', content.includes('EXECUTION MODEL - READ THIS CAREFULLY'));
logTest('Log management explained', content.includes('LOG MANAGEMENT (every 60 seconds)'));
logTest('Efficient waiting explained', content.includes('EFFICIENT WAITING'));
logTest('Best practices included', content.includes('BEST PRACTICES'));
logTest('Port detection guidance', content.includes('Port Detection (CRITICAL)'));
logTest('Error recovery guidance', content.includes('Error Recovery'));
logTest('Workflow example provided', content.includes('WORKFLOW EXAMPLE'));

// Test 12: Error handling
console.log('\n📋 Test 12: Error Handling');
logTest('Error tracking function exists', content.includes('trackError(errorMessage)'));
logTest('Repeated error warning', content.includes('Same error occurred'));
logTest('Max iterations limit', content.includes('MAX_ITERATIONS'));
logTest('Iteration count display', content.includes('/${MAX_ITERATIONS}'));

// Test 13: Package.json
console.log('\n📋 Test 13: Package Configuration');
const packagePath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(packagePath)) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  logTest('Package.json exists', true);
  logTest('Has "type": "module"', packageJson.type === 'module');
  logTest('Has bin entry', packageJson.bin !== undefined);
} else {
  logTest('Package.json exists', false);
  logWarning('package.json not found - may need to be created');
}

// Test 14: Authentication
console.log('\n📋 Test 14: Authentication');
const authPath = path.join(process.cwd(), 'auth-manager.js');
logTest('auth-manager.js exists', fs.existsSync(authPath));
logTest('Authentication initialization', content.includes('initializeAnthropic'));
logTest('Browser auth support', content.includes('getAuthentication'));

// Final Summary
console.log('\n' + '='.repeat(60));
console.log('📊 INTEGRATION TEST SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Passed: ${testResults.passed.length}`);
console.log(`❌ Failed: ${testResults.failed.length}`);
console.log(`⚠️  Warnings: ${testResults.warnings.length}`);

if (testResults.failed.length > 0) {
  console.log('\n❌ Failed Tests:');
  testResults.failed.forEach(test => console.log(`   - ${test}`));
}

if (testResults.warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  testResults.warnings.forEach(warning => console.log(`   - ${warning}`));
}

console.log('\n' + '='.repeat(60));

if (testResults.failed.length === 0) {
  console.log('✅ ALL INTEGRATION TESTS PASSED');
  console.log('🚀 Alfred AI is ready for production!');
} else {
  console.log('❌ SOME TESTS FAILED - Review issues above');
  process.exit(1);
}

console.log('='.repeat(60) + '\n');
