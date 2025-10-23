/**
 * Mock Authentication Server
 * Provides endpoints for testing auth-manager.js functionality
 */

const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Mock user database
const users = [
  {
    id: 1,
    email: 'test@example.com',
    password: 'password123',
    role: 'user'
  },
  {
    id: 2,
    email: 'admin@example.com',
    password: 'admin123',
    role: 'admin'
  }
];

// Mock token store (in production, use JWT)
const tokens = new Map();
const refreshTokens = new Map();

// Utility functions
const generateToken = (user) => {
  const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const tokenData = {
    token,
    userId: user.id,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour
  };
  tokens.set(token, tokenData);
  return tokenData;
};

const generateRefreshToken = (userId) => {
  const refreshToken = `refresh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const refreshData = {
    refreshToken,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  };
  refreshTokens.set(refreshToken, refreshData);
  return refreshData;
};

const validateToken = (token) => {
  const tokenData = tokens.get(token);
  if (!tokenData) return null;
  
  if (Date.now() > tokenData.expiresAt) {
    tokens.delete(token);
    return null;
  }
  
  return tokenData;
};

const validateRefreshToken = (refreshToken) => {
  const refreshData = refreshTokens.get(refreshToken);
  if (!refreshData) return null;
  
  if (Date.now() > refreshData.expiresAt) {
    refreshTokens.delete(refreshToken);
    return null;
  }
  
  return refreshData;
};

// Mock valid API keys for testing
const validApiKeys = [
  'sk_test_1234567890abcdef',
  'sk_live_1234567890abcdef',
  'pk_test_1234567890abcdef',
  'pk_live_1234567890abcdef',
  'test-api-key-12345',
  'env-api-key-67890',
  'constructor-key-override'
];

// Authentication endpoints
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  console.log(`🔐 Login attempt for: ${email}`);
  
  const user = users.find(u => u.email === email && u.password === password);
  
  if (!user) {
    console.log(`❌ Login failed for: ${email}`);
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
  }
  
  const tokenData = generateToken(user);
  const refreshData = generateRefreshToken(user.id);
  
  console.log(`✅ Login successful for: ${email}`);
  
  res.json({
    success: true,
    data: {
      token: tokenData.token,
      refreshToken: refreshData.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      },
      expiresIn: 3600
    }
  });
});

app.get('/api/auth/validate', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }
  
  const token = authHeader.substring(7);
  const tokenData = validateToken(token);
  
  if (!tokenData) {
    console.log(`❌ Token validation failed: ${token.substring(0, 20)}...`);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
  
  console.log(`✅ Token validation successful for user: ${tokenData.email}`);
  
  res.json({
    success: true,
    data: {
      valid: true,
      user: {
        id: tokenData.userId,
        email: tokenData.email,
        role: tokenData.role
      },
      expiresAt: tokenData.expiresAt
    }
  });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: 'Refresh token required'
    });
  }
  
  const refreshData = validateRefreshToken(refreshToken);
  
  if (!refreshData) {
    console.log(`❌ Refresh token validation failed`);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired refresh token'
    });
  }
  
  const user = users.find(u => u.id === refreshData.userId);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'User not found'
    });
  }
  
  // Generate new tokens
  const tokenData = generateToken(user);
  const newRefreshData = generateRefreshToken(user.id);
  
  // Invalidate old refresh token
  refreshTokens.delete(refreshToken);
  
  console.log(`🔄 Token refreshed for user: ${user.email}`);
  
  res.json({
    success: true,
    data: {
      token: tokenData.token,
      refreshToken: newRefreshData.refreshToken,
      expiresIn: 3600
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    tokens.delete(token);
    console.log(`🚪 User logged out, token invalidated`);
  }
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// API key protected endpoints
app.get('/api/data', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required'
    });
  }
  
  if (!validApiKeys.includes(apiKey)) {
    console.log(`❌ Invalid API key: ${apiKey.substring(0, 10)}...`);
    return res.status(401).json({
      success: false,
      error: 'Invalid API key'
    });
  }
  
  console.log(`✅ API key validated: ${apiKey.substring(0, 10)}...`);
  
  res.json({
    success: true,
    data: {
      message: 'Data accessed successfully with API key',
      timestamp: Date.now(),
      apiKey: `${apiKey.substring(0, 8)}...` // Masked for logging
    }
  });
});

app.get('/api/protected', (req, res) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  
  // Accept either Bearer token or API key
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const tokenData = validateToken(token);
    
    if (!tokenData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    console.log(`✅ Protected data accessed via token by: ${tokenData.email}`);
    
    res.json({
      success: true,
      data: {
        message: 'Protected data accessed successfully',
        user: tokenData.email,
        role: tokenData.role,
        authMethod: 'token'
      }
    });
  } else if (apiKey && validApiKeys.includes(apiKey)) {
    console.log(`✅ Protected data accessed via API key: ${apiKey.substring(0, 10)}...`);
    
    res.json({
      success: true,
      data: {
        message: 'Protected data accessed successfully',
        authMethod: 'apiKey',
        apiKey: `${apiKey.substring(0, 8)}...`
      }
    });
  } else {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
});

// Test endpoints for various scenarios
app.get('/api/test/expired-token', (req, res) => {
  res.status(401).json({
    success: false,
    error: 'Token expired'
  });
});

app.get('/api/test/network-error', (req, res) => {
  // Simulate network error by destroying the socket
  req.socket.destroy();
});

app.get('/api/test/timeout', (req, res) => {
  // Never respond to simulate timeout
  setTimeout(() => {
    res.json({
      success: true,
      message: 'This response is too late'
    });
  }, 10000); // 10 second delay
});

app.post('/api/test/invalid-json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send('{"invalid": json}'); // Invalid JSON
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Mock auth server is running',
    timestamp: Date.now(),
    stats: {
      activeTokens: tokens.size,
      activeRefreshTokens: refreshTokens.size,
      validApiKeys: validApiKeys.length
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Mock Auth Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Endpoints available:`);
  console.log(`   POST /api/auth/login - User login`);
  console.log(`   GET  /api/auth/validate - Token validation`);
  console.log(`   POST /api/auth/refresh - Token refresh`);
  console.log(`   POST /api/auth/logout - User logout`);
  console.log(`   GET  /api/data - API key protected data`);
  console.log(`   GET  /api/protected - Token or API key protected data`);
  console.log(`   GET  /api/test/* - Test endpoints for error scenarios`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down mock auth server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down mock auth server...');
  process.exit(0);
});

module.exports = app;
