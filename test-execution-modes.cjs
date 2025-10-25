const mcp = require('/tmp/mcp-runtime-helpers.cjs');

async function testCommonJS() {
  console.log('Testing CommonJS module loading...');
  console.log('MCP helper loaded:', typeof mcp);
  console.log('Available functions:', Object.keys(mcp).length);

  if (typeof mcp.browser_navigate === 'function') {
    console.log('✓ browser_navigate function available');
  } else {
    console.log('✗ browser_navigate function NOT available');
  }

  console.log('\n✓ CommonJS test passed');
}

testCommonJS().catch(err => {
  console.error('✗ CommonJS test failed:', err.message);
  process.exit(1);
});
