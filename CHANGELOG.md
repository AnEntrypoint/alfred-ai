# Changelog

## [5.20.27] - 2025-10-25

### Fixed
- **CRITICAL**: Fixed MCP tool calls from execution environment
- Changed `mcpManager.handleToolCall` to `this.mcpManager.handleToolCall` in execution-manager.js:178
- MCP tools (Playwright, etc.) now work correctly from executed code
- Eliminates "Cannot read properties of undefined (reading 'handleToolCall')" error

## [5.20.26] - 2025-10-25

### Added
- Auto-execute code blocks: LLM can now write code in text output using \`\`\`execute:runtime syntax
- Code blocks are detected and executed automatically without JSON tool calls
- Eliminates JSON escaping issues, truncation problems, and quote/newline corruption

### Changed
- Updated tool instructions to explain auto-execute code block syntax
- Added warnings to ONLY use \`\`\`execute: blocks, never regular code blocks
- LLM must output executable code directly, no code examples

### Benefits
- No JSON wrapper = no corruption from escaping
- Natural code generation without string escaping
- Large code blocks work perfectly
- Quotes, backticks, newlines all preserved exactly

## [5.20.25] - 2025-10-25

### Fixed
- Fixed eager prompt mechanism to actually trigger agent continuation
- Eager prompts from background processes now immediately invoke the prompt handler
- Agent now responds to completed background executions with exit code failures

### Changed
- Added `setEagerPromptHandler()` method to ExecutionManager
- Eager prompts now use `setImmediate()` to queue handler invocation
- Both CLI and interactive modes now register eager prompt handlers

## [5.20.24] - 2025-10-25

### Added
- Added Playread MCP server to default configuration
- Web fetching and Google search now available in execution environment
- New MCP tools: `mcp.fetch()`, `mcp.google_search()`

### Changed
- Updated .codemode.json with playread server configuration
- Updated default MCP servers in alfred-ai.js for CLI mode

## [5.20.23] - 2025-10-25

### Fixed
- Enhanced module type detection to handle top-level await
- Added detection for dynamic import() with await expressions
- Code with top-level await now correctly uses .mjs extension
- Mixed import/require statements default to .cjs for safety

### Details
- Detects: `await import()`, top-level `await`, static `import` statements
- Priority: If `require()` is present alongside ESM features, uses .cjs
- Prevents "await is only valid in async functions" errors

## [5.20.22] - 2025-10-25

### Fixed
- Fixed double typing issue in interactive prompting mode
- Cleaned up first readline interface before setting up post-completion interface
- Prevented duplicate stdin listeners from causing character echo

## [5.20.21] - 2025-10-25

### Added
- Agent now stays open for interactive prompting after task completion
- Added continuous prompt handling in both CLI and interactive modes
- Shows "💬 Ready for next prompt. Press Ctrl+C to exit." message

### Changed
- CLI mode no longer exits after completing initial task
- Interactive mode uses Promise-based lifecycle management
- Only exits on explicit SIGINT (Ctrl+C)

## [5.20.20] - 2025-10-25

### Fixed
- Fixed dependency injection for mcpManager in ExecutionManager
- MCP tools now properly available in code execution environment
- ALFRED_MCP_TOOLS environment variable now correctly populated

## [5.20.19] - 2025-10-25

### Fixed
- Fixed MCP tool name parsing in runtime helpers
- Tool names now correctly extract short names from full MCP format
- Changed from regex pattern to simple split approach for reliability

### Verified
- ✅ Playwright MCP tools working from code execution environment
- ✅ Agent successfully searched web and saved peanut cake recipe to peanut.md
- ✅ Both CommonJS and ES module formats working correctly

## [5.20.18] - 2025-10-25

### Fixed
- Updated MCP runtime helpers to dynamically load all tools
- Fixed tool name mapping to support any MCP server format

## [5.20.17] - 2025-10-25

### Fixed
- Fixed ES module vs CommonJS conflict in code execution
- Code execution now automatically detects module type and creates appropriate file extensions
- CommonJS code (using `require`) → `.cjs` files
- ES module code (using `import`) → `.mjs` files

### Added
- Created `mcp-runtime-helpers.mjs` for ES module support
- Both CommonJS and ES module syntax now work in execute tool
- Updated tool instructions to document both import methods
- Added automatic module type detection in execution-helpers.js

### Changed
- Updated runtime selection guidance to emphasize task-based choice over codebase language
- Updated package.json to include mcp-runtime-helpers.mjs
- Removed non-existent timeout-test.js from package files list

## [5.20.16] - Previous

### Fixed
- Fixed critical dependency injection issues across all managers
- Fixed broken test script reference in package.json
