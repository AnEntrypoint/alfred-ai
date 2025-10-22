#!/usr/bin/env node

// Simple entry point that bypasses any potential conflicts
try {
  // Import and run the enhanced CLI directly
  import('./alfred-cli.js').catch(err => {
    console.error('Failed to load enhanced CLI:', err.message);
    process.exit(1);
  });
} catch (err) {
  console.error('Entry point error:', err.message);
  process.exit(1);
}
