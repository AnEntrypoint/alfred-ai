/**
 * Test Runner for Authentication Manager Tests
 * Runs all test suites with mock server
 */

const { spawn } = require('child_process');
const http = require('http');

// Test configuration
const MOCK_SERVER_PORT = 3001;
const MOCK_SERVER_URL = `http://localhost:${MOCK_SERVER_PORT}`;

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Logger utility
const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  test: (msg) => console.log(`${colors.magenta}🧪${colors.reset} ${msg}`)
};

// Check if server is running
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(`${MOCK_SERVER_URL}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          log.success(`Mock server is healthy: ${health.message}`);
          resolve(true);
        } catch (error) {
          log.error('Invalid health check response');
          resolve(false);
        }
      });
    });

    req.on('error', () => {
      log.error('Mock server is not running');
      resolve(false);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      log.error('Health check timeout');
      resolve(false);
    });
  });
}

// Start mock server
function startMockServer() {
  return new Promise((resolve, reject) => {
    log.info('Starting mock authentication server...');
    
    const server = spawn('node', ['mock-auth-server.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverOutput = '';
    let serverError = '';

    server.stdout.on('data', (data) => {
      const output = data.toString();
      serverOutput += output;
      console.log(`[SERVER] ${output.trim()}`);
      
      if (output.includes('Mock Auth Server running')) {
        log.success('Mock server started successfully');
        setTimeout(() => resolve(server), 1000); // Give it time to fully start
      }
    });

    server.stderr.on('data', (data) => {
      const error = data.toString();
      serverError += error;
      console.error(`[SERVER ERROR] ${error.trim()}`);
    });

    server.on('error', (error) => {
      log.error(`Failed to start server: ${error.message}`);
      reject(error);
    });

    server.on('exit', (code) => {
      if (code !== 0) {
        log.error(`Server exited with code ${code}`);
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!serverOutput.includes('Mock Auth Server running')) {
        server.kill();
        reject(new Error('Server startup timeout'));
      }
    }, 10000);
  });
}

// Run test file
function runTestFile(testFile, description) {
  return new Promise((resolve, reject) => {
    log.test(`Running ${description}...`);
    
    // Set environment variables for testing
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      API_KEY: 'env-api-key-67890',
      AUTH_TOKEN: 'env-auth-token-12345'
    };

    const test = spawn('node', [testFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
    });

    let testOutput = '';
    let testError = '';

    test.stdout.on('data', (data) => {
      const output = data.toString();
      testOutput += output;
      console.log(`[TEST] ${output.trim()}`);
    });

    test.stderr.on('data', (data) => {
      const error = data.toString();
      testError += error;
      console.error(`[TEST ERROR] ${error.trim()}`);
    });

    test.on('error', (error) => {
      log.error(`Failed to run test: ${error.message}`);
      reject(error);
    });

    test.on('close', (code) => {
      if (code === 0) {
        log.success(`${description} completed successfully`);
        resolve({ success: true, output: testOutput, error: testError });
      } else {
        log.error(`${description} failed with exit code ${code}`);
        resolve({ success: false, output: testOutput, error: testError, code });
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      test.kill();
      reject(new Error(`Test timeout: ${description}`));
    }, 30000);
  });
}

// Main test execution
async function runTests() {
  console.log(`${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════════╗
║                    Authentication Test Suite                ║
║                     Testing auth-manager.js                ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  let serverProcess = null;
  const testResults = [];

  try {
    // Check if server is already running
    const serverRunning = await checkServer();
    
    if (!serverRunning) {
      // Start the mock server
      serverProcess = await startMockServer();
    }

    // Wait a bit for server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Run test suites
    const testSuites = [
      {
        file: 'test-api-key-detection.js',
        description: 'API Key Detection Tests',
        required: true
      },
      {
        file: 'test-auth-flow.js', 
        description: 'Authentication Flow Tests',
        required: true
      }
    ];

    for (const suite of testSuites) {
      try {
        const result = await runTestFile(suite.file, suite.description);
        testResults.push({
          suite: suite.description,
          ...result
        });
      } catch (error) {
        log.error(`Failed to run ${suite.description}: ${error.message}`);
        testResults.push({
          suite: suite.description,
          success: false,
          error: error.message
        });

        if (suite.required) {
          throw error;
        }
      }
    }

    // Print summary
    console.log(`\n${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════════╗
║                         Test Summary                         ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}`);

    let totalTests = testResults.length;
    let passedTests = testResults.filter(r => r.success).length;

    testResults.forEach(result => {
      const status = result.success ? 
        `${colors.green}PASSED${colors.reset}` : 
        `${colors.red}FAILED${colors.reset}`;
      console.log(`${status} ${result.suite}`);
      
      if (!result.success && result.error) {
        console.log(`   ${colors.yellow}Error: ${result.error}${colors.reset}`);
      }
    });

    console.log(`\n${colors.bright}Total: ${passedTests}/${totalTests} test suites passed${colors.reset}`);

    if (passedTests === totalTests) {
      log.success('All test suites completed successfully! 🎉');
      process.exit(0);
    } else {
      log.error('Some test suites failed');
      process.exit(1);
    }

  } catch (error) {
    log.error(`Test execution failed: ${error.message}`);
    process.exit(1);
  } finally {
    // Clean up server if we started it
    if (serverProcess) {
      log.info('Shutting down mock server...');
      serverProcess.kill('SIGTERM');
      
      // Force kill if it doesn't shut down gracefully
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }
}

// Handle process interruption
process.on('SIGINT', () => {
  console.log('\n🛑 Test execution interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Test execution terminated');
  process.exit(1);
});

// Run the tests
if (require.main === module) {
  runTests().catch(error => {
    log.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runTests, checkServer, startMockServer };
