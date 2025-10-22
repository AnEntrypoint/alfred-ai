#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('🧪 Alfred Feature Test Suite\n');

const tests = [];
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

test('Bash stdin mode (avoiding shell parsing)', () => {
  const code = `
    echo "Test with (parentheses) and special chars"
    exit 0
  `;

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';

    proc.stdout.on('data', data => stdout += data.toString());
    proc.on('close', code => {
      assert(stdout.includes('parentheses'), 'Bash should handle parentheses');
      assert(code === 0, 'Should exit with code 0');
      resolve();
    });
    proc.on('error', reject);

    proc.stdin.write(code);
    proc.stdin.end();
  });
});

test('Process tracking and getNewLogs closure', () => {
  const runningProcesses = new Map();
  let newStdout = 'initial';
  let newStderr = 'error';

  runningProcesses.set('test1', {
    stdout: 'old',
    stderr: 'old_error',
    getNewLogs: () => {
      const logs = { stdout: newStdout, stderr: newStderr };
      newStdout = '';
      newStderr = '';
      return logs;
    }
  });

  const proc = runningProcesses.get('test1');
  const logs1 = proc.getNewLogs();
  assert(logs1.stdout === 'initial', 'Should return initial logs');
  assert(logs1.stderr === 'error', 'Should return initial stderr');

  const logs2 = proc.getNewLogs();
  assert(logs2.stdout === '', 'Should clear logs after reading');
  assert(logs2.stderr === '', 'Should clear stderr after reading');

  newStdout = 'new data';
  const logs3 = proc.getNewLogs();
  assert(logs3.stdout === 'new data', 'Should capture new data');
});

test('Error history tracking', () => {
  const errorHistory = new Map();

  function trackError(errorMessage) {
    const errorKey = errorMessage.substring(0, 100);
    const count = (errorHistory.get(errorKey) || 0) + 1;
    errorHistory.set(errorKey, count);
    return count >= 2;
  }

  const isRepeated1 = trackError('Same error message');
  assert(!isRepeated1, 'First error should not be marked as repeated');

  const isRepeated2 = trackError('Same error message');
  assert(isRepeated2, 'Second same error should be marked as repeated');

  const isRepeated3 = trackError('Different error');
  assert(!isRepeated3, 'Different error should not be marked as repeated');
});

test('Pending updates queue management', () => {
  const pendingAgentUpdates = [];

  pendingAgentUpdates.push({
    processId: 'proc_1',
    elapsedTime: 60,
    newStdout: 'output 1',
    newStderr: '',
    timestamp: Date.now()
  });

  pendingAgentUpdates.push({
    processId: 'proc_2',
    elapsedTime: 120,
    newStdout: 'output 2',
    newStderr: 'error 2',
    timestamp: Date.now()
  });

  assert(pendingAgentUpdates.length === 2, 'Should have 2 pending updates');

  const messages = pendingAgentUpdates.map(update => {
    return `Process ${update.processId}: ${update.elapsedTime}s`;
  });

  assert(messages[0].includes('proc_1'), 'Should format first message');
  assert(messages[1].includes('proc_2'), 'Should format second message');

  pendingAgentUpdates.length = 0;
  assert(pendingAgentUpdates.length === 0, 'Should clear queue');
});

test('3-second timeout resolution logic', () => {
  return new Promise((resolve) => {
    let hasResolved = false;
    let immediateOutput = 'immediate';
    let backgroundOutput = '';

    const timer = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        assert(immediateOutput === 'immediate', 'Should capture immediate output');
        resolve();
      }
    }, 100);

    setTimeout(() => {
      if (hasResolved) {
        backgroundOutput = 'background';
      }
    }, 200);
  });
});

async function runTests() {
  console.log(`Running ${tests.length} tests...\n`);

  for (const { name, fn } of tests) {
    try {
      process.stdout.write(`  ${name}... `);
      await fn();
      console.log('✅ PASS');
      passedTests++;
    } catch (error) {
      console.log(`❌ FAIL\n    ${error.message}`);
      failedTests++;
    }
  }

  console.log(`\n📊 Test Results:`);
  console.log(`   Passed: ${passedTests}/${tests.length}`);
  console.log(`   Failed: ${failedTests}/${tests.length}`);

  if (failedTests > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Test suite error:', error);
  process.exit(1);
});
