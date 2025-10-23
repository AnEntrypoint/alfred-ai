/**
 * API Key Detection Test Suite
 * Specifically tests API key detection and validation functionality
 */

const AuthManager = require('./auth-manager.js');

describe('API Key Detection Tests', () => {
  let originalEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };
    
    // Clear API key related environment variables
    delete process.env.API_KEY;
    delete process.env.AUTH_TOKEN;
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Basic API Key Detection', () => {
    test('should detect API key in constructor options', () => {
      const testApiKey = 'sk_test_1234567890abcdef';
      const authManager = new AuthManager({
        apiKey: testApiKey
      });

      expect(authManager.config.apiKey).toBe(testApiKey);
      expect(authManager.hasValidCredentials()).toBe(true);
      expect(authManager.getAuthType()).toBe('apiKey');
    });

    test('should detect API key from environment variable API_KEY', () => {
      const envApiKey = 'pk_live_abcdef1234567890';
      process.env.API_KEY = envApiKey;

      const authManager = new AuthManager({
        apiKey: null // Explicitly null to test environment detection
      });

      expect(authManager.config.apiKey).toBe(envApiKey);
      expect(authManager.hasValidCredentials()).toBe(true);
      expect(authManager.getAuthType()).toBe('apiKey');
    });

    test('should detect API key from environment variable AUTH_TOKEN', () => {
      const authToken = 'token_1234567890abcdef';
      process.env.AUTH_TOKEN = authToken;

      const authManager = new AuthManager({
        apiKey: null
      });

      expect(authManager.config.apiKey).toBe(authToken);
      expect(authManager.hasValidCredentials()).toBe(true);
    });

    test('should prioritize API_KEY over AUTH_TOKEN', () => {
      process.env.API_KEY = 'api-key-from-env';
      process.env.AUTH_TOKEN = 'auth-token-from-env';

      const authManager = new AuthManager({
        apiKey: null
      });

      expect(authManager.config.apiKey).toBe('api-key-from-env');
      expect(authManager.hasValidCredentials()).toBe(true);
    });

    test('should prioritize constructor API key over environment variables', () => {
      process.env.API_KEY = 'env-api-key';
      process.env.AUTH_TOKEN = 'env-auth-token';

      const constructorKey = 'constructor-api-key';
      const authManager = new AuthManager({
        apiKey: constructorKey
      });

      expect(authManager.config.apiKey).toBe(constructorKey);
      expect(authManager.hasValidCredentials()).toBe(true);
    });
  });

  describe('API Key Format Validation', () => {
    test('should validate standard API key formats', () => {
      const validKeys = [
        'sk_test_1234567890abcdef',
        'sk_live_1234567890abcdef',
        'pk_test_1234567890abcdef',
        'pk_live_1234567890abcdef',
        'token_1234567890abcdef',
        'api_key_1234567890abcdef',
        '1234567890abcdef1234567890abcdef', // 32 character hex
        'abc123def456789012345678', // 24 character alphanumeric
        'sk-1234567890abcdef', // Stripe-like format
        'Bearer token1234567890', // Bearer token format
        'JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' // JWT prefix
      ];

      validKeys.forEach(apiKey => {
        const authManager = new AuthManager({ apiKey });
        expect(authManager.hasValidCredentials(), `Key "${apiKey}" should be valid`).toBe(true);
      });
    });

    test('should reject invalid API key formats', () => {
      const invalidKeys = [
        '',
        '   ', // whitespace only
        'short', // too short
        '123', // numeric only, too short
        'a'.repeat(65), // too long (>64 chars)
        null,
        undefined,
        'inv@lid#char$', // special characters
        'new line\nkey', // contains newline
        'tab\tkey', // contains tab
        '   spaced key   ', // leading/trailing spaces
        '\n\r\t', // control characters only
        '0'.repeat(10) // all zeros, suspicious
      ];

      invalidKeys.forEach(apiKey => {
        const authManager = new AuthManager({ apiKey });
        expect(authManager.hasValidCredentials(), `Key "${apiKey}" should be invalid`).toBe(false);
      });
    });

    test('should validate key length requirements', () => {
      const testCases = [
        { key: 'a'.repeat(8), expected: false, reason: 'too short (8 chars)' },
        { key: 'a'.repeat(16), expected: true, reason: 'minimum length (16 chars)' },
        { key: 'a'.repeat(32), expected: true, reason: 'good length (32 chars)' },
        { key: 'a'.repeat(64), expected: true, reason: 'maximum length (64 chars)' },
        { key: 'a'.repeat(128), expected: false, reason: 'too long (128 chars)' }
      ];

      testCases.forEach(({ key, expected, reason }) => {
        const authManager = new AuthManager({ apiKey: key });
        expect(authManager.hasValidCredentials(), reason).toBe(expected);
      });
    });

    test('should validate key character composition', () => {
      const validPatterns = [
        /^[a-zA-Z0-9_]+$/, // alphanumeric with underscores
        /^[a-zA-Z0-9-_]+$/, // alphanumeric with dashes and underscores
        /^[a-z0-9]+_/, // lowercase with underscore prefix
        /^[A-Z0-9]+-/ // uppercase with dash prefix
      ];

      validPatterns.forEach(pattern => {
        const testKey = 'test1234567890abcdef'; // valid test key
        expect(pattern.test(testKey)).toBe(true);
        
        const authManager = new AuthManager({ apiKey: testKey });
        expect(authManager.hasValidCredentials()).toBe(true);
      });
    });
  });

  describe('API Key Source Priority', () => {
    test('should follow correct priority order: constructor > API_KEY > AUTH_TOKEN', () => {
      // Set up environment variables
      process.env.API_KEY = 'env-api-key';
      process.env.AUTH_TOKEN = 'env-auth-token';

      // Test 1: Constructor should win
      const manager1 = new AuthManager({ apiKey: 'constructor-key' });
      expect(manager1.config.apiKey).toBe('constructor-key');

      // Test 2: API_KEY should win over AUTH_TOKEN
      const manager2 = new AuthManager({ apiKey: null });
      expect(manager2.config.apiKey).toBe('env-api-key');

      // Test 3: AUTH_TOKEN should be used if API_KEY is not set
      delete process.env.API_KEY;
      const manager3 = new AuthManager({ apiKey: null });
      expect(manager3.config.apiKey).toBe('env-auth-token');
    });

    test('should handle undefined/null values in detection chain', () => {
      process.env.API_KEY = '';
      process.env.AUTH_TOKEN = null;

      const authManager = new AuthManager({ apiKey: undefined });
      expect(authManager.config.apiKey).toBeNull();
      expect(authManager.hasValidCredentials()).toBe(false);
    });

    test('should trim whitespace from detected API keys', () => {
      process.env.API_KEY = '  spaced-api-key-123  ';

      const authManager = new AuthManager({ apiKey: null });
      expect(authManager.config.apiKey).toBe('spaced-api-key-123');
      expect(authManager.hasValidCredentials()).toBe(true);
    });
  });

  describe('API Key Usage in Requests', () => {
    // Mock fetch for testing
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      if (global.fetch) {
        global.fetch.mockClear();
      }
    });

    test('should include API key in X-API-Key header by default', async () => {
      const testApiKey = 'test-api-key-12345';
      const authManager = new AuthManager({ apiKey: testApiKey });

      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      fetch.mockResolvedValue(mockResponse);

      await authManager.makeAuthenticatedRequest('https://api.example.com/data');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': testApiKey
          })
        })
      );
    });

    test('should include API key in Authorization header when configured', async () => {
      const testApiKey = 'bearer-token-12345';
      const authManager = new AuthManager({
        apiKey: testApiKey,
        authType: 'apiKey',
        apiKeyHeader: 'Authorization'
      });

      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      fetch.mockResolvedValue(mockResponse);

      await authManager.makeAuthenticatedRequest('https://api.example.com/data');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': testApiKey
          })
        })
      );
    });

    test('should include Bearer prefix in Authorization header when configured', async () => {
      const testToken = 'jwt-token-12345';
      const authManager = new AuthManager({
        apiKey: testToken,
        authType: 'apiKey',
        apiKeyHeader: 'Authorization',
        apiKeyPrefix: 'Bearer '
      });

      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      fetch.mockResolvedValue(mockResponse);

      await authManager.makeAuthenticatedRequest('https://api.example.com/data');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer jwt-token-12345'
          })
        })
      );
    });

    test('should not add authentication headers when no valid API key', async () => {
      const authManager = new AuthManager({ apiKey: 'invalid' }); // Too short, will be invalid

      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      fetch.mockResolvedValue(mockResponse);

      await authManager.makeAuthenticatedRequest('https://api.example.com/data');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'X-API-Key': expect.any(String),
            'Authorization': expect.any(String)
          })
        })
      );
    });
  });

  describe('API Key Security', () => {
    test('should not log API keys in console output', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const testApiKey = 'secret-api-key-12345';
      const authManager = new AuthManager({ apiKey: testApiKey });
      
      // Call various methods that might log
      authManager.hasValidCredentials();
      authManager.getAuthType();
      authManager.isAuthenticated();
      
      const loggedOutput = consoleSpy.mock.calls.flat().join(' ');
      expect(loggedOutput).not.toContain(testApiKey);
      
      consoleSpy.mockRestore();
    });

    test('should mask API keys in error messages', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      global.fetch = jest.fn().mockRejectedValue(new Error('Invalid API key'));
      
      const testApiKey = 'secret-api-key-12345';
      const authManager = new AuthManager({ apiKey: testApiKey });
      
      try {
        await authManager.makeAuthenticatedRequest('https://api.example.com/data');
      } catch (error) {
        // Expected to fail
      }
      
      const loggedOutput = consoleSpy.mock.calls.flat().join(' ');
      expect(loggedOutput).not.toContain(testApiKey);
      
      consoleSpy.mockRestore();
    });

    test('should handle API key rotation gracefully', () => {
      const oldKey = 'old-api-key-12345';
      const newKey = 'new-api-key-67890';
      
      const authManager = new AuthManager({ apiKey: oldKey });
      expect(authManager.config.apiKey).toBe(oldKey);
      expect(authManager.hasValidCredentials()).toBe(true);
      
      // Simulate key rotation
      authManager.config.apiKey = newKey;
      expect(authManager.config.apiKey).toBe(newKey);
      expect(authManager.hasValidCredentials()).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty string API key', () => {
      const authManager = new AuthManager({ apiKey: '' });
      expect(authManager.config.apiKey).toBe('');
      expect(authManager.hasValidCredentials()).toBe(false);
    });

    test('should handle whitespace-only API key', () => {
      const authManager = new AuthManager({ apiKey: '   \t\n   ' });
      expect(authManager.hasValidCredentials()).toBe(false);
    });

    test('should handle API key with URL encoding characters', () => {
      const urlEncodedKey = 'api-key%20with%20spaces';
      const authManager = new AuthManager({ apiKey: urlEncodedKey });
      expect(authManager.hasValidCredentials()).toBe(false); // Should reject encoded chars
    });

    test('should handle API key with Unicode characters', () => {
      const unicodeKey = '🔑api-key-12345';
      const authManager = new AuthManager({ apiKey: unicodeKey });
      expect(authManager.hasValidCredentials()).toBe(false); // Should reject Unicode
    });

    test('should handle extremely long valid keys', () => {
      const longKey = 'a'.repeat(64); // Maximum allowed length
      const authManager = new AuthManager({ apiKey: longKey });
      expect(authManager.hasValidCredentials()).toBe(true);
    });
  });
});

console.log('✅ API key detection test suite created');
