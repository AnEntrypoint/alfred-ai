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

## Status
✅ Production ready
✅ API key authentication working
✅ NPX execution verified
✅ MCP integration functional
