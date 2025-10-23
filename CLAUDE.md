# Alfred AI - Dual-Mode AI Agent

## Overview
Alfred AI is a powerful AI agent that operates in two modes:
1. **CLI Mode**: Autonomous task executor with full agentic capabilities
2. **MCP Mode**: MCP server with `alfred` tool for integration with other tools

## Modes

### CLI Agent Mode (Default)
Run Alfred as a standalone agent to accomplish complex tasks:

```bash
export ANTHROPIC_API_KEY=your-api-key-here
npx alfred-ai@latest "your task here"
```

**Example:**
```bash
npx alfred-ai@latest "analyze this codebase and create a test suite"
```

### MCP Server Mode
Run as an MCP server by passing the `mcp` argument:

```bash
npx alfred-ai mcp
```

In MCP mode, Alfred exposes an `alfred` tool that other MCP clients can use to delegate complex agentic tasks.

## Authentication
Requires `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

## Core Files
- **alfred-ai.js** - Main entry point with MCP server
- **auth-manager.js** - API key detection and validation
- **built-in-tools-mcp.js** - Built-in MCP tools
- **ast-grep-wrapper.js** - AST pattern matching
- **ast-error-handling.js** - Error handling for AST operations

## Features
✅ API key authentication
✅ MCP tool execution
✅ AST-based code search
✅ NPX compatible
✅ Automatic authentication detection

## Usage

### Direct execution
```bash
node alfred-ai.js "task description"
```

### Via NPX
```bash
npx alfred-ai@latest "task description"
```

### With custom API key source
```bash
source ~/zlaude && npx alfred-ai@latest "task"
```

## Package Configuration
- **Name**: alfred-ai
- **Main**: alfred-ai.js
- **Type**: module (ES6)
- **Bin**: alfred-ai

## Implementation Notes

### Critical Details
1. **Tool Schema Format**: Must use `input_schema` (with underscore) not `inputSchema` for API compatibility
2. **Recursion Prevention**: Alfred tool must be excluded when running within alfred handler to prevent infinite recursion
3. **Authentication**: Supports both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` environment variables
4. **Base URL**: Respects `ANTHROPIC_BASE_URL` for custom API endpoints (e.g., z.ai)
5. **Dual Mode Detection**: Any CLI argument except "mcp" triggers CLI mode

### Key Learnings
- The Anthropic SDK expects `input_schema` in tool definitions, not `inputSchema`
- When running agentic loops within tools, must prevent recursive tool calls
- Authentication can come from multiple sources (API_KEY or AUTH_TOKEN)
- Custom base URLs must be passed to Anthropic SDK constructor
- MCP tools must have consistent schema format across all tool definitions

### Testing Commands
```bash
# Test CLI mode
source ~/zlaude
alfred-ai "list files in current directory"

# Test with custom API
export ANTHROPIC_API_KEY=your-key
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
alfred-ai "your task"

# Test MCP mode
alfred-ai mcp
```

## Status
✅ Production ready
✅ Dual-mode operation (CLI + MCP)
✅ API key authentication working
✅ NPX execution verified
✅ MCP integration functional
✅ Recursion protection implemented
✅ Custom API endpoint support
