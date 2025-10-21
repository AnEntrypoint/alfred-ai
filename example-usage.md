# Marvin Usage Examples

## Basic Setup

1. Create a `.codemode.json` file:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

2. Start Marvin:
```bash
node marvin.js
```

## Example MCP Commands

### List Tools
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

### Execute JavaScript Code
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "execute",
    "arguments": {
      "code": "console.log('Hello from Marvin!');",
      "runtime": "nodejs"
    }
  }
}
```

### Execute Python Code (Auto-detect)
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "execute",
    "arguments": {
      "code": "print('Hello from Python!')",
      "runtime": "auto"
    }
  }
}
```

### Get System Status
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "marvin_status",
    "arguments": {}
  }
}
```

### Use Filesystem Tool (if configured)
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "filesystem_read_file",
    "arguments": {
      "path": "./package.json"
    }
  }
}
```

## Testing

Run validation tests:
```bash
node validation-test.js
```

Run basic tests:
```bash
node test.js
```