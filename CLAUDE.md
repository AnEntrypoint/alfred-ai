# Alfred AI - Playwright MCP Integration

## Core Architecture

Alfred AI uses a streamlined architecture with three main components:

### 1. Playwright MCP Integration
- **Server**: `npx @playwright/mcp@latest`
- **Purpose**: Browser automation and web testing
- **Tools**: Page navigation, element interaction, screenshot capture, form filling
- **Integration**: Anthropic Client SDK exposes Playwright tools directly to LLM flows

### 2. Vexify MCP Integration
- **Server**: `npx -y vexify@latest mcp`
- **Purpose**: Enhanced development and testing capabilities
- **Features**: Advanced debugging, code analysis, performance monitoring
- **Integration**: Seamless tool exposure through Anthropic SDK

### 3. Native Execution Capabilities
- **JavaScript**: Direct Node.js execution with `node -e`
- **Bash**: Shell command execution with `bash -c`
- **Environment**: Full access to system tools and Playwright runtime

## Implementation Details

### MCP Server Management
```javascript
// Start Playwright MCP
this.playwrightProcess = spawn('npx', ['@playwright/mcp@latest'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});

// Start Vexify MCP
this.vexifyProcess = spawn('npx', ['-y', 'vexify@latest', 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});
```

### Tool Exposure Pattern
- All MCP tools are exposed through Anthropic Client SDK
- No wrapper functions or abstractions
- Direct tool access for immediate execution
- 3-second buffer for immediate output collection

### Execution Flow
1. User input received
2. LLM processes with available tools
3. Tool execution via MCP servers or native runners
4. Immediate output collection with 3-second buffer
5. Results returned without artificial delays

## Key Features

- **No Planning Delays**: Immediate execution starts
- **3-Second Buffer**: Collects quick output for immediate response
- **Async Processing**: Long-running tasks continue in background
- **Native Playwright**: Available in execution environment
- **MCP Protocol**: Standardized tool communication

## Testing Requirements

- Test client-side functionality with Playwright MCP
- Test server-side with MCP-glootie integration
- Use `/tmp/sandboxbox-vZWAzQ/tmp` for Playwright artifacts
- Always close browser before test completion
- Support `file://` URLs for local testing
- Use `browser_evaluate` for window globals debugging

## Environment Notes

- Git identity auto-inherits from ~/.gitconfig
- Environment variables (TERM, LS_COLORS) transfer through SandboxBox
- No fallbacks, mocks, or simulations - ground truth only
- Buildless approach: prefer CJS over builds, JS over TS