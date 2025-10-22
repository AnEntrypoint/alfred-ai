# Alfred AI - Your Autonomous Coding Assistant

**Alfred** is an intelligent, agentic CLI coding assistant that takes natural language instructions and autonomously executes them using code. Named after Batman's trusted butler, Alfred helps you get things done with minimal fuss and maximum reliability.

## Key Features

- **Agentic AI**: Takes natural language instructions and figures out how to complete them
- **Multi-Provider LLM**: Uses Vercel AI SDK to support multiple LLM providers (starts with Anthropic Claude)
- **Direct Tool Execution**: Built-in tools (Edit, Glob, Grep, Bash, LS, Read, Write) plus MCP tool integration
- **Autonomous Operation**: Automatically installs dependencies, manages servers, handles errors
- **Playwright Integration**: Built-in browser automation for testing and web interactions
- **SDK-Free Architecture**: Clean, minimal dependencies

## Installation

```bash
npm install -g alfred-ai
```

Or use directly with npx:

```bash
npx alfred-ai "your task here"
```

## Quick Start

```bash
# Set your authentication token
export ANTHROPIC_AUTH_TOKEN=your-token-here

# Optional: Set custom API endpoint
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic

# Run Alfred with a task
npx alfred "create an express server on port 3000"

# Or more complex tasks
npx alfred "create an express server, add a /api/hello endpoint, and test it with playwright"
```

## Usage

Alfred takes natural language instructions and autonomously figures out how to complete them:

```bash
# Simple file operations
alfred "create a README with project documentation"

# Install dependencies and create code
alfred "install express and create a REST API with CRUD endpoints"

# Web development with testing
alfred "create a React component with tests and build it"

# Browser automation
alfred "start a web server and take screenshots of the homepage"
```

### Available Tools

Alfred has access to these tools when executing tasks:

**Built-in Tools:**
- `Edit({ file_path, old_string, new_string, replace_all })` - Edit files
- `Glob({ pattern, path })` - Find files by pattern
- `Grep({ pattern, path, output_mode, glob, type })` - Search file contents
- `Bash({ command, description, timeout })` - Execute shell commands
- `LS({ path })` - List directory contents
- `Read({ file_path })` - Read file contents
- `Write({ file_path, content })` - Write/create files

**Playwright MCP Tools:**
- `browser_navigate({ url })` - Navigate to URL
- `browser_snapshot()` - Take page snapshot
- `browser_click({ selector })` - Click element
- `browser_fill({ selector, value })` - Fill form field
- `browser_evaluate({ script })` - Execute JavaScript in browser
- `browser_close()` - Close browser

**Vexify Tools:** (Additional MCP tools from vexify-mcp-server)

## How It Works

1. You provide a natural language task
2. Alfred starts necessary MCP servers (Playwright, Vexify)
3. Alfred calls an LLM (Claude) with your task and available tools
4. The LLM writes JavaScript code using the tools
5. Alfred executes the code in a sandboxed environment
6. Results are fed back to the LLM
7. The process continues until the task is complete (max 10 iterations)

## Architecture

### Components

1. **cli.js**: Agentic CLI entry point with LLM loop
2. **index.js**: MCP server mode (for integration with other MCP clients)
3. **agentic-mode.js**: Code execution environment with tool injection
4. **vexify-mcp-server.js**: Additional MCP tools
5. **built-in-tools-mcp.js**: Built-in tool definitions

### Key Features

- **Agentic Loop**: Autonomous task completion with LLM decision-making
- **Multi-Provider Support**: Uses Vercel AI SDK for provider flexibility
- **Tool Injection**: All tools available as async functions in execution context
- **MCP Integration**: Spawns and manages MCP server processes
- **Error Handling**: Automatic retry with error feedback to LLM
- **Iteration Limiting**: Prevents infinite loops (max 10 iterations)

## Configuration

### Environment Variables

**Authentication:**
- `ANTHROPIC_AUTH_TOKEN` (required): Your Anthropic API authentication token
- `ANTHROPIC_API_KEY` (alternative): Standard Anthropic API key (fallback if AUTH_TOKEN not set)
- `ANTHROPIC_BASE_URL` (optional): Custom API endpoint (e.g., `https://api.z.ai/api/anthropic`)

**Model Selection:**
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` (optional): Override default Haiku model (default: `claude-haiku-4-5-20251001`)
- `ANTHROPIC_DEFAULT_SONNET_MODEL` (optional): Override default Sonnet model (default: `claude-sonnet-4-5-20250929`)
- `ANTHROPIC_DEFAULT_OPUS_MODEL` (optional): Override default Opus model (default: `claude-opus-4-1-20250805`)

**Example:**
```bash
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
export ANTHROPIC_AUTH_TOKEN=your-token-here
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-5-20250929
```

### MCP Servers

Alfred automatically starts these MCP servers:
- **Vexify**: Custom MCP tools (bundled)
- **Playwright**: Browser automation via `@executeautomation/playwright-mcp-server`

## Examples

### Create and Test Express Server

```bash
alfred "install express, create a server with /api/users endpoint, start it on port 3000, and test it with playwright"
```

Alfred will:
1. Run `npm install express`
2. Create `server.js` with Express app
3. Start the server in the background
4. Navigate to `http://localhost:3000/api/users` with Playwright
5. Verify the endpoint works
6. Report success

### Build a Project

```bash
alfred "create a package.json, install dependencies, and run the build"
```

Alfred will:
1. Create `package.json` with appropriate config
2. Run `npm install`
3. Execute build command
4. Report any errors and fix them

### File Operations

```bash
alfred "find all JavaScript files, search for TODO comments, and create a summary"
```

Alfred will:
1. Use `Glob` to find all `.js` files
2. Use `Grep` to search for TODO comments
3. Use `Write` to create `TODO_SUMMARY.md`

## Best Practices

1. **Be specific**: Clearer instructions lead to better results
2. **Set authentication**: Always set `ANTHROPIC_AUTH_TOKEN` before running
3. **Monitor output**: Alfred logs all its actions and reasoning
4. **Background servers**: Alfred can start and manage background processes
5. **Iteration limits**: If a task needs more than 10 iterations, break it into smaller tasks

## Troubleshooting

### Authentication Not Set
```bash
export ANTHROPIC_AUTH_TOKEN=your-token-here
# Or for standard API key:
export ANTHROPIC_API_KEY=your-key-here
```

### Playwright Issues
Alfred automatically installs Playwright browsers when needed. If you see browser-related errors, ensure you have sufficient disk space.

### Execution Timeouts
For long-running tasks, Alfred uses appropriate timeouts. If a task times out, try breaking it into smaller steps.

## Development

### Run Locally

```bash
git clone <repo>
cd marvin
npm install

# Run CLI
node cli.js "your task"

# Run MCP server mode
node index.js
```

### Testing

```bash
npm test
```

## Dependencies

- `ai` - Vercel AI SDK for multi-provider LLM support
- `@ai-sdk/anthropic` - Anthropic provider for Vercel AI SDK
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `fast-glob` - Fast file pattern matching
- `@mozilla/readability` - Web content extraction
- `node-fetch` - HTTP requests

## License

MIT

## Acknowledgments

- Uses [Anthropic Claude](https://anthropic.com) for AI capabilities
- Built on [Model Context Protocol](https://modelcontextprotocol.io)
- Playwright integration via [@executeautomation/playwright-mcp-server](https://www.npmjs.com/package/@executeautomation/playwright-mcp-server)
- Multi-provider support via [Vercel AI SDK](https://sdk.vercel.ai)

---

**Alfred: "Your trusted coding assistant, at your service."**
