#!/usr/bin/env node

import { spawn } from 'child_process';

const marvin = spawn('node', ['marvin.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd()
});

let buffer = '';

marvin.stdout.on('data', (data) => {
  buffer += data.toString();
});

marvin.stderr.on('data', (data) => {
  console.error('Marvin stderr:', data.toString());
});

marvin.on('close', (code) => {
  console.log('Marvin exited with code:', code);
  console.log('Buffered output:');
  console.log(buffer);
});

// Send the JSON-RPC request
const request = {
  jsonrpc: "2.0",
  id: Date.now(),
  method: "tools/call",
  params: {
    name: "execute",
    arguments: {
      code: 'console.log("validation-test-pass")',
      runtime: "nodejs"
    }
  }
};

marvin.stdin.write(JSON.stringify(request) + '\n');

// Close stdin after 5 seconds
setTimeout(() => {
  marvin.stdin.end();
}, 5000);