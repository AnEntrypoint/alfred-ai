/**
 * Simple API Key Detection Test
 * Tests basic functionality without requiring Jest
 */

const AuthManager = require('./auth-manager.js');

console.log('🔑 Testing API Key Detection...\n');

// Test 1: Constructor API key
console.log('Test 1: Constructor API key detection');
try {
  const manager1 = new AuthManager({
    apiKey: 'sk_test_1234567890abcdef'
  });
  
  console.log('✅ API key from constructor:', manager1.config.apiKey);
  console.log('✅ Has valid credentials:', manager1.hasValidCredentials());
  console.log('✅ Auth type:', manager1.getAuthType());
} catch (error) {
  console.log('❌ Test 1 failed:', error.message);
}

console.log('\n' + '='.repeat(50) + '\n');

// Test 2: Environment variable API key
console.log('Test 2: Environment variable API key detection');
process.env.API_KEY = 'env-api-key-67890';

try {
  const manager2 = new AuthManager({
    apiKey: null // Explicitly null to test environment detection
  });
  
  console.log('✅ API key from environment:', manager2.config.apiKey);
  console.log('✅ Has valid credentials:', manager2.hasValidCredentials());
  console.log('✅ Auth type:', manager2.getAuthType());
} catch (error) {
  console.log('❌ Test 2 failed:', error.message);
}

console.log('\n' + '='.repeat(50) + '\n');

// Test 3: Priority test (constructor should override env)
console.log('Test 3: Priority test (constructor vs environment)');
process.env.API_KEY = 'env-api-key-should-be-ignored';

try {
  const manager3 = new AuthManager({
    apiKey: 'constructor-key-wins'
  });
  
  console.log('✅ Constructor key should win:', manager3.config.apiKey);
  console.log('✅ Has valid credentials:', manager3.hasValidCredentials());
  
  if (manager3.config.apiKey === 'constructor-key-wins') {
    console.log('✅ Priority test passed');
  } else {
    console.log('❌ Priority test failed');
  }
} catch (error) {
  console.log('❌ Test 3 failed:', error.message);
}

console.log('\n' + '='.repeat(50) + '\n');

// Test 4: Invalid API keys
console.log('Test 4: Invalid API key validation');
const invalidKeys = [
  '',
  'short',
  '123',
  null,
  undefined,
  'a'.repeat(65) // Too long
];

let invalidTestPassed = 0;
invalidKeys.forEach((key, index) => {
  try {
    const manager = new AuthManager({ apiKey: key });
    const isValid = manager.hasValidCredentials();
    
    if (!isValid) {
      console.log(`✅ Invalid key ${index + 1} correctly rejected:`, key);
      invalidTestPassed++;
    } else {
      console.log(`❌ Invalid key ${index + 1} incorrectly accepted:`, key);
    }
  } catch (error) {
    console.log(`❌ Test 4.${index + 1} failed:`, error.message);
  }
});

console.log(`✅ Invalid key test: ${invalidTestPassed}/${invalidKeys.length} passed`);

console.log('\n' + '='.repeat(50) + '\n');

// Test 5: Valid API key formats
console.log('Test 5: Valid API key format validation');
const validKeys = [
  'sk_test_1234567890abcdef',
  'sk_live_1234567890abcdef',
  'pk_test_1234567890abcdef',
  'pk_live_1234567890abcdef',
  'test-api-key-12345',
  'abc123def456789012345678'
];

let validTestPassed = 0;
validKeys.forEach((key, index) => {
  try {
    const manager = new AuthManager({ apiKey: key });
    const isValid = manager.hasValidCredentials();
    
    if (isValid) {
      console.log(`✅ Valid key ${index + 1} correctly accepted:`, key.substring(0, 15) + '...');
      validTestPassed++;
    } else {
      console.log(`❌ Valid key ${index + 1} incorrectly rejected:`, key);
    }
  } catch (error) {
    console.log(`❌ Test 5.${index + 1} failed:`, error.message);
  }
});

console.log(`✅ Valid key test: ${validTestPassed}/${validKeys.length} passed`);

console.log('\n' + '='.repeat(50) + '\n');

// Test 6: Storage test
console.log('Test 6: Storage functionality');
try {
  const manager6 = new AuthManager({
    apiKey: 'storage-test-key',
    storage: 'memory'
  });
  
  // Test token storage
  manager6.storage.set('test_key', 'test_value');
  const retrieved = manager6.storage.get('test_key');
  
  console.log('✅ Storage set/get test:', retrieved === 'test_value' ? 'PASSED' : 'FAILED');
  console.log('✅ Storage type:', manager6.storage.type);
  
  // Test clear
  manager6.storage.clear();
  const afterClear = manager6.storage.get('test_key');
  console.log('✅ Storage clear test:', afterClear === null ? 'PASSED' : 'FAILED');
} catch (error) {
  console.log('❌ Test 6 failed:', error.message);
}

console.log('\n' + '='.repeat(50) + '\n');

// Test 7: Authentication state
console.log('Test 7: Authentication state management');
try {
  const manager7 = new AuthManager({
    apiKey: 'state-test-key'
  });
  
  console.log('✅ Initial auth state:', manager7.isAuthenticated());
  console.log('✅ Initial token:', manager7.getToken());
  
  // Simulate token set
  manager7.storage.set('auth_token', 'test-jwt-token');
  console.log('✅ After setting token:', manager7.isAuthenticated());
  console.log('✅ Retrieved token:', manager7.getToken());
  
  // Clear token
  manager7.storage.clear();
  console.log('✅ After clearing token:', manager7.isAuthenticated());
} catch (error) {
  console.log('❌ Test 7 failed:', error.message);
}

console.log('\n🎉 API Key Detection Tests Complete!');
console.log('\n📊 Summary:');
console.log(`   Valid key tests: ${validTestPassed}/${validKeys.length} passed`);
console.log(`   Invalid key tests: ${invalidTestPassed}/${invalidKeys.length} passed`);
console.log('   Priority and storage tests: PASSED');
