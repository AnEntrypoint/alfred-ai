/**
 * Authentication Flow Test Suite
 * Tests the complete authentication process using auth-manager.js
 */

const AuthManager = require('./auth-manager.js');

// Mock fetch for testing
global.fetch = jest.fn();

describe('Authentication Flow Tests', () => {
  let authManager;
  let consoleSpy;

  beforeEach(() => {
    // Clear environment variables
    delete process.env.API_KEY;
    delete process.env.AUTH_TOKEN;
    
    // Clear localStorage mock
    localStorage.clear();
    
    // Reset fetch mock
    fetch.mockClear();
    
    // Create new AuthManager instance
    authManager = new AuthManager({
      apiKey: null,
      storage: 'memory',
      endpoints: {
        login: 'http://localhost:3001/api/auth/login',
        validate: 'http://localhost:3001/api/auth/validate',
        refresh: 'http://localhost:3001/api/auth/refresh',
        logout: 'http://localhost:3001/api/auth/logout'
      }
    });

    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation()
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('API Key Detection', () => {
    test('should detect API key from constructor options', () => {
      const manager = new AuthManager({
        apiKey: 'test-api-key-12345'
      });

      expect(manager.config.apiKey).toBe('test-api-key-12345');
      expect(manager.hasValidCredentials()).toBe(true);
    });

    test('should detect API key from environment variable', () => {
      process.env.API_KEY = 'env-api-key-67890';
      
      const manager = new AuthManager({
        apiKey: null
      });

      expect(manager.config.apiKey).toBe('env-api-key-67890');
      expect(manager.hasValidCredentials()).toBe(true);
    });

    test('should prioritize constructor API key over environment variable', () => {
      process.env.API_KEY = 'env-api-key-67890';
      
      const manager = new AuthManager({
        apiKey: 'constructor-key-override'
      });

      expect(manager.config.apiKey).toBe('constructor-key-override');
      expect(manager.hasValidCredentials()).toBe(true);
    });

    test('should handle missing API key gracefully', () => {
      const manager = new AuthManager({
        apiKey: null
      });

      expect(manager.config.apiKey).toBeNull();
      expect(manager.hasValidCredentials()).toBe(false);
    });

    test('should validate API key format', () => {
      const validKeys = [
        'sk-test1234567890abcdef',
        'pk_live_1234567890abcdef',
        'abc123def456789012345678'
      ];

      const invalidKeys = [
        '',
        'short',
        '123',
        'a'.repeat(65), // Too long
        null,
        undefined
      ];

      validKeys.forEach(key => {
        const manager = new AuthManager({ apiKey: key });
        expect(manager.hasValidCredentials()).toBe(true);
      });

      invalidKeys.forEach(key => {
        const manager = new AuthManager({ apiKey: key });
        expect(manager.hasValidCredentials()).toBe(false);
      });
    });
  });

  describe('Token-based Authentication Flow', () => {
    test('should handle successful login flow', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            token: 'jwt-token-12345',
            refreshToken: 'refresh-token-67890',
            user: { id: 1, email: 'test@example.com' }
          }
        })
      };

      fetch.mockResolvedValue(mockResponse);

      const result = await authManager.login('test@example.com', 'password123');

      expect(result.success).toBe(true);
      expect(result.data.token).toBe('jwt-token-12345');
      expect(authManager.isAuthenticated()).toBe(true);
      expect(authManager.getToken()).toBe('jwt-token-12345');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123'
          })
        })
      );
    });

    test('should handle login failure', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: 'Invalid credentials'
        })
      };

      fetch.mockResolvedValue(mockResponse);

      const result = await authManager.login('test@example.com', 'wrongpassword');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
      expect(authManager.isAuthenticated()).toBe(false);
      expect(authManager.getToken()).toBeNull();
    });

    test('should handle token validation', async () => {
      // First, set a token
      authManager.storage.set('auth_token', 'valid-jwt-token');

      const mockResponse = {
        ok: true,
        json: async () => ({
          success: true,
          data: { valid: true, user: { id: 1 } }
        })
      };

      fetch.mockResolvedValue(mockResponse);

      const result = await authManager.validateToken();

      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(true);
      expect(authManager.isAuthenticated()).toBe(true);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/auth/validate',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-jwt-token'
          })
        })
      );
    });

    test('should handle token refresh', async () => {
      authManager.storage.set('auth_token', 'expired-token');
      authManager.storage.set('refresh_token', 'valid-refresh-token');

      const mockResponse = {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            token: 'new-jwt-token',
            refreshToken: 'new-refresh-token'
          }
        })
      };

      fetch.mockResolvedValue(mockResponse);

      const result = await authManager.refreshToken();

      expect(result.success).toBe(true);
      expect(result.data.token).toBe('new-jwt-token');
      expect(authManager.getToken()).toBe('new-jwt-token');
    });

    test('should handle logout flow', async () => {
      // Set up authenticated state
      authManager.storage.set('auth_token', 'valid-token');
      authManager.storage.set('refresh_token', 'refresh-token');

      const mockResponse = {
        ok: true,
        json: async () => ({ success: true })
      };

      fetch.mockResolvedValue(mockResponse);

      await authManager.logout();

      expect(authManager.isAuthenticated()).toBe(false);
      expect(authManager.getToken()).toBeNull();
      expect(authManager.getRefreshToken()).toBeNull();

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-token'
          })
        })
      );
    });
  });

  describe('Automatic Token Refresh', () => {
    test('should automatically refresh expired token', async () => {
      // Set up expired token
      authManager.storage.set('auth_token', 'expired-token');
      authManager.storage.set('refresh_token', 'valid-refresh-token');

      // Mock failed validation (401) and successful refresh
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Token expired' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              token: 'new-token-after-refresh',
              refreshToken: 'new-refresh-after-refresh'
            }
          })
        });

      const result = await authManager.validateToken();

      expect(result.success).toBe(true);
      expect(authManager.getToken()).toBe('new-token-after-refresh');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('should handle refresh token failure', async () => {
      authManager.storage.set('auth_token', 'expired-token');
      authManager.storage.set('refresh_token', 'invalid-refresh-token');

      // Mock both validation and refresh failures
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Token expired' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Refresh token invalid' })
        });

      const result = await authManager.validateToken();

      expect(result.success).toBe(false);
      expect(authManager.isAuthenticated()).toBe(false);
      expect(authManager.getToken()).toBeNull();
      expect(authManager.getRefreshToken()).toBeNull();
    });
  });

  describe('Request Interception', () => {
    test('should add Authorization header to requests when authenticated', async () => {
      authManager.storage.set('auth_token', 'valid-jwt-token');

      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      fetch.mockResolvedValue(mockResponse);

      await authManager.makeAuthenticatedRequest('http://localhost:3001/api/data');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-jwt-token'
          })
        })
      );
    });

    test('should add API key header when using API key auth', async () => {
      const manager = new AuthManager({
        apiKey: 'test-api-key-12345',
        endpoints: {
          validate: 'http://localhost:3001/api/data'
        }
      });

      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      fetch.mockResolvedValue(mockResponse);

      await manager.makeAuthenticatedRequest('http://localhost:3001/api/data');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key-12345'
          })
        })
      );
    });

    test('should retry failed requests after token refresh', async () => {
      authManager.storage.set('auth_token', 'expired-token');
      authManager.storage.set('refresh_token', 'valid-refresh-token');

      // Mock 401 on first request, successful refresh, then successful retry
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ success: false, error: 'Token expired' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: { token: 'new-token', refreshToken: 'new-refresh' }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: 'protected-data' })
        });

      const result = await authManager.makeAuthenticatedRequest('http://localhost:3001/api/protected');

      expect(result.success).toBe(true);
      expect(result.data).toBe('protected-data');
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Storage Management', () => {
    test('should use memory storage by default', () => {
      const manager = new AuthManager({ storage: 'memory' });
      expect(manager.storage.type).toBe('memory');
    });

    test('should use localStorage when available', () => {
      // Mock localStorage
      global.localStorage = {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn()
      };

      const manager = new AuthManager({ storage: 'localStorage' });
      expect(manager.storage.type).toBe('localStorage');
    });

    test('should persist tokens across manager instances', () => {
      // First instance saves token
      const manager1 = new AuthManager({ storage: 'memory' });
      manager1.storage.set('auth_token', 'persistent-token');

      // Second instance should retrieve token
      const manager2 = new AuthManager({ storage: 'memory' });
      expect(manager2.getToken()).toBe('persistent-token');
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      fetch.mockRejectedValue(new Error('Network error'));

      const result = await authManager.login('test@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    test('should handle malformed responses', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        }
      });

      const result = await authManager.login('test@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    test('should handle timeout errors', async () => {
      fetch.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 100);
      }));

      const result = await authManager.login('test@example.com', 'password', { timeout: 50 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });
});

// Mock localStorage for testing
const localStorage = {
  data: {},
  getItem: function(key) { return this.data[key] || null; },
  setItem: function(key, value) { this.data[key] = value; },
  removeItem: function(key) { delete this.data[key]; },
  clear: function() { this.data = {}; }
};

global.localStorage = localStorage;
global.btoa = (str) => Buffer.from(str).toString('base64');
global.atob = (b64) => Buffer.from(b64, 'base64').toString();

console.log('✅ Authentication flow test suite created');
