# Multi-Server Playwright MCP Setup (v5.20.5+)

## Overview

Alfred AI now implements **multi-server Playwright MCP** to eliminate phantom tabs and interference during parallel execution. This ensures clean browser isolation across concurrent agent operations.

## The Problem

Before v5.20.5, all concurrent executions shared a single Playwright MCP instance. When multiple agents ran in parallel:
- They competed for the same browser resources
- Navigation commands collided, creating phantom tabs
- Page state changes interfered with other executions
- Unpredictable behavior in parallel scenarios

## The Solution: Multi-Server Architecture

Alfred AI now launches **3 independent Playwright MCP servers**, each with isolated user data directories:

```
playwright       → /tmp/playwright-mcp-primary
playwright-secondary → /tmp/playwright-mcp-secondary
playwright-tertiary  → /tmp/playwright-mcp-tertiary
```

Each server is completely independent:
- Separate browser instances
- Isolated cookies and session data
- Unique user profiles
- No interference between executions

## How It Works

### 1. Smart Server Selection

When a Playwright tool is called, Alfred's MCPManager automatically selects the **least-used server**:

```javascript
const serverName = mcpManager.getPlaywrightServer();
// Returns: 'playwright', 'playwright-secondary', or 'playwright-tertiary'
// (whichever has the lowest current usage count)
```

### 2. Load Balancing

The system tracks server usage in real-time:
- Each call increments the server's usage counter
- Execution completion decrements the counter
- New executions always get the least-loaded server
- Prevents any single server from being overwhelmed

### 3. Session Persistence

Because each server uses a unique user-data-dir:
- Login sessions persist within each server's directory
- Cookies and local storage are preserved
- Multiple sessions can run in parallel without conflicts

## Configuration

The multi-server setup is configured in `.codemode.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--user-data-dir", "/tmp/playwright-mcp-primary"]
    },
    "playwright-secondary": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--user-data-dir", "/tmp/playwright-mcp-secondary"]
    },
    "playwright-tertiary": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--user-data-dir", "/tmp/playwright-mcp-tertiary"]
    }
  }
}
```

### Customizing Server Count

To add more servers (for higher parallelism):

```json
{
  "playwright-quaternary": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp", "--user-data-dir", "/tmp/playwright-mcp-quaternary"]
  },
  "playwright-quinary": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp", "--user-data-dir", "/tmp/playwright-mcp-quinary"]
  }
}
```

Alfred automatically detects and registers any server starting with "playwright".

### Custom User Data Directories

You can change where persistent data is stored:

```json
{
  "playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp", "--user-data-dir", "/path/to/custom/profile-1"]
  }
}
```

## Usage in Executed Code

Playwright tools work exactly as before - the server selection is transparent:

```javascript
const mcp = require('/tmp/mcp-runtime-helpers.cjs');

async function test() {
  // Both of these automatically use load-balanced server selection
  await mcp.browser_navigate({url: 'https://example.com'});
  const screenshot = await mcp.browser_take_screenshot({});

  // No need to specify which server - Alfred handles it automatically
}
```

## Benefits

✅ **No Phantom Tabs** - Each execution uses its own isolated browser
✅ **True Parallelism** - Multiple agents can run simultaneously without interference
✅ **Session Persistence** - Login states persist within each server profile
✅ **Load Balanced** - Automatic distribution across available servers
✅ **Backward Compatible** - Existing code works without changes
✅ **Scalable** - Easy to add more servers for higher concurrency

## Monitoring

Alfred logs server selection for debugging:

```
[MCP Manager] Registered Playwright server: playwright (total: 1)
[MCP Manager] Registered Playwright server: playwright-secondary (total: 2)
[MCP Manager] Registered Playwright server: playwright-tertiary (total: 3)

[MCP Manager] Selected Playwright server: playwright (usage: 1)
[MCP Manager] Selected Playwright server: playwright-secondary (usage: 1)
[MCP Manager] Selected Playwright server: playwright-tertiary (usage: 1)
```

## Parallel Execution Example

```javascript
// These run in parallel with ZERO interference:
Promise.all([
  agent1.execute('test user flow on playwright'),
  agent2.execute('test admin flow on playwright-secondary'),
  agent3.execute('test api on playwright-tertiary')
]);
```

Each agent gets its own isolated Playwright server with:
- Separate browser instances
- Independent user profiles
- No shared state
- Persistent session data

## Performance Impact

- **Memory**: ~15-20% overhead per additional server (each is a Chromium instance)
- **CPU**: Minimal overhead (server selection is O(n) where n=3)
- **Disk**: ~100-200MB per user-data-dir for browser cache

## Troubleshooting

### Server Not Starting
Check that the user-data-dir path exists or is writable:
```bash
mkdir -p /tmp/playwright-mcp-primary
chmod 755 /tmp/playwright-mcp-primary
```

### All Servers Getting Same Traffic
This is normal during non-parallel execution. Usage balancing works within parallel scenarios.

### Persistent Data Loss
Ensure the user-data-dir paths are on persistent storage, not tmpfs or mount points that clear.

## Migration from Single-Server Setup

Existing Alfred AI deployments automatically get multi-server support in v5.20.5+:

1. Update Alfred: `npm install -g alfred-ai@latest`
2. Your `.codemode.json` is automatically updated with multi-server configuration
3. All existing code continues to work unchanged
4. Parallel execution now works without phantom tabs

## Architecture Details

### MCPManager Enhancements

- `playwrightServers`: Array of registered Playwright server names
- `playwrightServerUsage`: Map tracking current usage per server
- `getPlaywrightServer()`: Returns least-used server and increments usage
- `releasePlaywrightServer()`: Decrements usage when execution completes

### Server Selection Algorithm

```
for each playwright tool call:
  1. Find server with minimum usage count
  2. Increment that server's usage counter
  3. Route tool call to selected server
  4. On completion, decrement usage counter
```

Time Complexity: O(n) where n = number of Playwright servers (typically 3)

## Future Enhancements

Potential improvements for v5.21+:
- Dynamic server provisioning based on load
- Server health checks and auto-recovery
- Cross-server session cloning for fail-over
- Metrics dashboard for server utilization
- Cost-based server selection for cloud deployments

## Related Issues

- Fixes: Phantom tabs in parallel execution
- Fixes: Race conditions in concurrent Playwright operations
- Enables: True multi-agent parallel execution without interference

## Changelog

### v5.20.5
- Initial multi-server Playwright MCP implementation
- Load-balanced server selection
- Session persistence per server
- Automatic server registration and tracking
