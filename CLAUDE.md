# Alfred AI - MCP Server with API Key Authentication

## Overview
Alfred AI is a simplified MCP (Model Context Protocol) server that provides direct client/server communication without the SDK overhead.

## Authentication
Simple API key authentication via environment variable.

### Setup
```bash
export ANTHROPIC_API_KEY=your-api-key-here
npx alfred-ai "your task here"
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
