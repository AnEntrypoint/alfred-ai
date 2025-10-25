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
✅ Integrated MCP servers: Playwright, Vexify, Playread

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
6. **Entry Point Detection**: Uses `fileURLToPath()` and `resolve()` for robust main module detection - required for npx compatibility

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

## Code Execution & Tool Selection

### Language-Agnostic Tool Selection
**CRITICAL: Choose execution language/tools based on the TASK, not the codebase language.**

The codebase is JavaScript, but when editing/analyzing code:
- Use **glootie-cc AST tools** (via nodejs execution) for code search, pattern matching, and structural edits
- Use **playwright/browser tools** for testing/debugging UI code or running live browser tests
- Use **bash/python** for system operations, file processing, or data transformation
- Use **nodejs** for JavaScript execution, but also for running AST analysis via glootie-cc

Example: Even in a JavaScript codebase, if you need to verify regex patterns or test complex transformations, use **python** execution for clearer syntax. Don't force JavaScript just because it's a JS project.

### Runtime Selection Rules
1. **Pick the tool that gives you the best capabilities for the task**
   - Searching code patterns? → glootie-cc AST (nodejs)
   - Testing UI components? → playwright (browser tools)
   - Processing files? → bash or python
   - Complex logic testing? → Use language that makes testing clearest

2. **Always specify runtime explicitly**
   - Provide `runtime` parameter in execute calls
   - Options: nodejs, python, bash, deno, bun, go, rust, c, cpp

3. **No splitting across calls**
   - Complete logic in single execution
   - Include proper error handling
   - Use MCP tools available in execution context

### Code Execution Implementation
**Code execution is powered by `mcp-runtime-helpers.cjs`** - the runtime helper module that provides access to MCP tools from executed code. Best practices:
- Always specify runtime explicitly
- Not splitting code across multiple calls
- Including proper error handling
- Using MCP tools that are available in the execution context

## Todo List Management - CRITICAL

### ⚠️ You MUST Maintain a Todo List During Execution

A task is **NOT finished** until the todo list is consolidated and all items are marked complete.

### Todo List Workflow

1. **At Task Start**: Create a todo list with all planned steps
2. **During Execution**:
   - Mark tasks as `in_progress` BEFORE starting them
   - Mark tasks as `completed` IMMEDIATELY after finishing
   - Update the list continuously - don't batch updates
3. **Task Completion**: Update todo list to reflect final state
4. **End Condition**: Task is COMPLETE only when:
   - All todo items are marked as `completed`
   - Todo list shows final consolidated state
   - No pending or in_progress items remain

### Todo States
- `pending` - Task not yet started
- `in_progress` - Currently working on (only ONE at a time)
- `completed` - Task finished successfully

### Example Workflow

```
Initial Task: "Implement dark mode feature"

[1] pending   - Design dark mode system
[2] pending   - Create CSS variables
[3] pending   - Update React components
[4] pending   - Test across browsers
[5] pending   - Publish changes

(Start work)

[1] in_progress - Design dark mode system
     (finish design)
[1] completed   - Design dark mode system

[2] in_progress - Create CSS variables
     (finish CSS)
[2] completed   - Create CSS variables

[3] in_progress - Update React components
     (finish components)
[3] completed   - Update React components

[4] in_progress - Test across browsers
     (finish testing)
[4] completed   - Test across browsers

[5] in_progress - Publish changes
     (finish publishing)
[5] completed   - Publish changes

TASK COMPLETE - All items consolidated to completed state
```

### Key Rules

1. **Create todo BEFORE starting work**
   - Don't start without a todo list
   - Break complex tasks into discrete steps

2. **Update IMMEDIATELY**
   - Mark `in_progress` as soon as you start
   - Mark `completed` as soon as you finish
   - Don't batch multiple completions

3. **Keep ONE task in_progress**
   - Never have multiple tasks in_progress
   - Sequential workflow for clarity

4. **Consolidate at completion**
   - Show final todo state when done
   - All items must be `completed`
   - No pending or in_progress items

5. **Task is FINISHED only when:**
   - Todo list shows all items as `completed`
   - No more work needs to be done
   - All subtasks are consolidated
   - List state matches actual completion

### Real-World Example

User: "Create a new API endpoint and add tests"

Your response:
```
Creating todo list:
1. Design endpoint schema
2. Implement GET handler
3. Add validation middleware
4. Write unit tests
5. Write integration tests
6. Document API endpoint
7. Commit and publish changes

Starting with task 1...
```

(Work through each step, updating todo after each one)

Final response:
```
Final todo list:
[1] completed - Design endpoint schema
[2] completed - Implement GET handler
[3] completed - Add validation middleware
[4] completed - Write unit tests
[5] completed - Write integration tests
[6] completed - Document API endpoint
[7] completed - Commit and publish changes

✅ Task complete - All items consolidated
```

### Anti-Patterns to Avoid

❌ **DON'T**: Create todo but never update it
❌ **DON'T**: Update multiple items at once
❌ **DON'T**: Leave items as `in_progress` after finishing
❌ **DON'T**: Have multiple items `in_progress`
❌ **DON'T**: Skip the todo consolidation step
❌ **DON'T**: Say "task done" without showing final todo state

### Benefits of Real-Time Todo Management
✅ Clear progress visibility
✅ Prevents forgotten subtasks
✅ Shows completion status
✅ Tracks what was accomplished
✅ Enables checkpoint/resume capability

## Recent Fixes (Session: Clean Codebase)

### Critical Fixes
- ✅ Fixed duplicate shebangs in alfred-ai.js (syntax error)
- ✅ Removed duplicate import statements
- ✅ Cleaned up ephemeral documentation files (EXECUTION_GUIDE.md, MULTI_SERVER_SETUP.md)
- ✅ All 14 JS files passing syntax validation

### Refactoring Summary (Previous Session)
- Extracted 4 new focused modules (execution-helpers, tool-schema-builder, ast-modification-helper, linting-rules)
- Reduced monolithic classes: ExecutionManager (411→337), AlfredMCPServer (317→200), built-in-tools-mcp (1398→1068)
- Removed 320+ comment lines per code rules
- Fixed all ground truth violations (no fallbacks, no estimates)

### Architecture Status
- 5 files fully compliant with 200-line limit
- 3 files approaching limit (200-300 lines)
- 4 files over limit (core functionality, architectural necessity)
- Total codebase: 4,341 lines across 14 files

## Recent Fixes (Session: ES Module Support & Playwright Integration)

### Critical Execution Fixes
- ✅ Fixed ES module vs CommonJS conflict in code execution
- ✅ Added automatic module type detection (.cjs for require, .mjs for import)
- ✅ Created mcp-runtime-helpers.mjs for ES module support
- ✅ Updated execution-helpers.js to auto-detect module syntax
- ✅ Both CommonJS and ES modules now supported in execute tool
- ✅ Updated tool instructions to show both import methods
- ✅ Fixed MCP tool name parsing (split approach vs regex)
- ✅ Playwright MCP tools verified working in code execution
- ✅ Updated package.json to include mcp-runtime-helpers.mjs
- ✅ Removed timeout-test.js from package files list (doesn't exist)

### Module Detection Logic
The execution system now automatically detects whether code uses `import` or `require`:
- If code contains `import` statements → creates `.mjs` file (ES module)
- If code contains `require()` → creates `.cjs` file (CommonJS)
- Helper modules available in both formats in /tmp

### MCP Tool Name Parsing
Tool names follow the format `mcp__plugin_glootie-cc_playwright__browser_navigate`
- Regex approach failed due to hyphens in plugin name
- Solution: Split on `__` and take last part
- Works for any MCP server naming convention

### Verified Working
**Test**: Agent searched web for peanut cake recipe and saved to peanut.md
- ✅ Playwright browser automation working
- ✅ Web navigation and content extraction working
- ✅ File writing from executed code working
- ✅ Complete end-to-end integration verified

### Runtime Selection Philosophy
- Agent should choose runtime based on TASK, not codebase language
- Python: Best for data processing, regex, file operations
- Node.js: Best for async, MCP tools (browser/search), JSON
- Bash: Best for system operations, command chaining
- Use whatever language makes the next step clearest

### Interactive Prompting Fix (v5.20.22)
**Issue**: Double typing when entering prompts after task completion
**Root Cause**: Two readline interfaces active simultaneously
  1. Line 675: Eager prompting during initial task execution
  2. Line 738: Post-completion interactive prompting
**Solution**: Call `cleanupInteractive()` at line 723 before setting up new interface
**Result**: Single, clean readline interface for post-task prompting

### Module Detection Enhancement (v5.20.23)
**Issue**: Code with top-level await saved as .cjs causing "await is only valid in async functions" error
**Root Cause**: Detection only checked for `import` statements, not top-level `await` or dynamic imports
**Solution**: Enhanced detection in execution-helpers.js:15-20
  - Detects static `import` statements
  - Detects top-level `await` (requires ES modules)
  - Detects dynamic `import()` combined with top-level await
  - If `require()` present, defaults to .cjs for safety
**Result**: All module patterns correctly detected, 7/7 test cases passing

### Auto-Execute Code Blocks (v5.20.26)
**Problem**: JSON tool calls require escaping code, causing corruption/truncation
**Solution**: LLM writes code directly in text output using special syntax

**Syntax:**
\`\`\`execute:nodejs
const data = { "key": "value" };
console.log('No escaping needed!');
\`\`\`

**Benefits:**
- No JSON wrapper = no corruption
- Quotes, backticks, newlines preserved exactly
- Large code works perfectly
- Natural code generation

**Critical Rules:**
- NEVER use regular code blocks (\`\`\`javascript)
- ONLY use \`\`\`execute:runtime for code
- No code examples - describe in text instead

### Eager Prompt Mechanism (v5.20.25)
**Purpose**: Allow background processes to immediately notify the agent when they complete
**Implementation**:
- ExecutionManager queues eager prompts when background processes complete
- Eager prompts immediately invoke the active prompt handler via `setImmediate()`
- Agent receives formatted prompt with completion message and logs
- Enables agent to react to long-running background executions

**Flow**:
1. Background process times out (>timeout) or completes
2. `queueEagerPrompt()` called with execId, message, logs
3. Handler immediately invoked with formatted prompt
4. Agent processes the completion and can take action

### Default MCP Servers
Alfred AI includes these MCP servers by default:

1. **Playwright** (`@playwright/mcp`)
   - Browser automation and testing
   - 21 functions: navigate, click, type, screenshot, etc.

2. **Vexify** (`vexify@latest`)
   - Semantic code search
   - 1 function: search_code

3. **Playread** (`playread@latest`) - Added in v5.20.24
   - Web fetching and search
   - 2 functions: fetch, google-search

All tools are available in code execution environment via `mcp.function_name()`.

## Status
✅ Production ready
✅ Dual-mode operation (CLI + MCP)
✅ API key authentication working
✅ NPX execution verified
✅ MCP integration functional
✅ Recursion protection implemented
✅ Custom API endpoint support
✅ Code execution best practices documented
✅ All syntax errors fixed
✅ Codebase clean and validated
✅ ES module and CommonJS both supported in execution
