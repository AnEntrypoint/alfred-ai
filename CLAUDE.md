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

## Code Execution Best Practices

### ⚠️ Critical Agent Instructions

When executing code, you MUST follow these patterns to minimize errors:

#### 1. **DO NOT Split Code Per Call**
❌ WRONG - Multiple calls for sequential code:
```javascript
execute({ code: "const fs = require('fs');", runtime: 'nodejs' })
execute({ code: "const data = fs.readFileSync('file.txt');", runtime: 'nodejs' })
execute({ code: "console.log(data);", runtime: 'nodejs' })
```

#### 2. **DO Group Into Sensible Chunks**
✅ CORRECT - Single call with error handling:
```javascript
execute({
  code: `
    try {
      const fs = require('fs');
      const data = fs.readFileSync('file.txt', 'utf8');

      if (!data) {
        console.error('Error: File is empty');
        process.exit(1);
      }

      console.log('Success:', data.length, 'bytes');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  `,
  runtime: 'nodejs'
})
```

#### 3. **Always Include Error Handling**
Every code execution should have:
- Try-catch or equivalent error handling
- Input validation before operations
- Return value checks
- Clear error messages with exit codes
- Proper exception handling for edge cases

#### 4. **Chunk Sizing Guidelines**
- **Small chunks**: 5-20 lines for simple operations
- **Medium chunks**: 20-50 lines for workflows
- **Large chunks**: 50-100 lines for complex multi-step processes
- Never split related code just to reduce line count

#### 5. **When to Split Into Multiple Calls**
Only split code when:
- Different runtimes are needed (Python → Bash → Node)
- Major state changes occur
- One operation must finish before verifying before next step
- You need to debug and isolate specific failures

#### 6. **Error Control Flow Patterns**

**Python:**
```python
try:
    result = operation()
    if not result:
        print("Error: Operation failed")
        exit(1)
    print("Success:", result)
except Exception as e:
    print("Error:", e)
    exit(1)
```

**JavaScript:**
```javascript
try {
  const result = operation();
  if (!result) {
    console.error('Error: Operation failed');
    process.exit(1);
  }
  console.log('Success:', result);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
```

**Bash:**
```bash
#!/bin/bash
set -e
if ! result=$(operation); then
  echo "Error: Operation failed" >&2
  exit 1
fi
echo "Success: $result"
```

#### 7. **Timing Information**
After execution completes, you'll see:
- `Time: 0.45s` for quick operations
- `Time: 2.33min` for longer tasks

Use this to optimize slow code.

#### 8. **Progress Monitoring**
For operations over 60 seconds:
- You'll get a progress notification
- Long operations may take several minutes
- Monitor the logs for output

### Benefits of Proper Chunking
✅ Fewer execution errors
✅ Better error messages
✅ Easier debugging
✅ Clearer execution flow
✅ More reliable results

See `EXECUTION_GUIDE.md` for detailed examples and patterns.

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

## Status
✅ Production ready
✅ Dual-mode operation (CLI + MCP)
✅ API key authentication working
✅ NPX execution verified
✅ MCP integration functional
✅ Recursion protection implemented
✅ Custom API endpoint support
✅ Code execution best practices documented
