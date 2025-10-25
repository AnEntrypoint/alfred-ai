import mcp from '/tmp/mcp-runtime-helpers.mjs';

async function testESModule() {
  console.log('Testing ES Module loading...');
  console.log('MCP helper loaded:', typeof mcp);
  console.log('Available functions:', Object.keys(mcp).length);

  if (typeof mcp.browser_navigate === 'function') {
    console.log('✓ browser_navigate function available');
  } else {
    console.log('✗ browser_navigate function NOT available');
  }

  console.log('\n✓ ES Module test passed');
}

testESModule().catch(err => {
  console.error('✗ ES Module test failed:', err.message);
  process.exit(1);
});
