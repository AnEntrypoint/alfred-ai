#!/usr/bin/env node

export class SystemPromptBuilder {
  static buildCodeExecutionPrompt(tools, mcpToolDocs = {}) {
    const basePrompt = `You are an intelligent coding agent that accomplishes tasks through code execution. Your core principle is to solve problems by writing and executing code rather than using plain language tool calls.

## Execution Model

You have access to an Execute tool that provides a comprehensive programming interface:
- Runtime support: nodejs, python, bash, deno, bun, go, rust, c, cpp
- Direct access to all available functions through code execution
- MCP tools available as callable functions within your execution environment
- File I/O and system operations through code

## Writing Code

When solving tasks, write clean, focused code that:
1. Uses the Execute tool to run code with your chosen runtime
2. Calls available functions directly (no tool calls from code)
3. Handles errors appropriately
4. Returns results that advance your task

Example workflow:
\`\`\`
1. Analyze the task requirement
2. Write code to solve it using Execute
3. Review the output
4. Refine or continue based on results
\`\`\

## Tool Functions Available

All tools are available as callable functions within the Execute environment. Here are the available functions:
`;

    const toolSections = [];

    toolSections.push(`### Built-in Tools
These tools are always available:
- **Read(filepath)** - Read file contents
- **Write(filepath, content)** - Write/create files
- **Edit(filepath, oldString, newString, replaceAll?)** - Precise string replacements
- **Bash(command, description?, timeout?)** - Execute shell commands
- **Glob(pattern, path?)** - Find files matching patterns
- **Grep(pattern, path?, options?)** - Search file contents
- **TodoWrite(todos)** - Manage task lists
- **WebFetch(url, prompt)** - Fetch and analyze web content
- **ASTLint(path, recursive?, extensions?, maxFiles?, groupBy?)** - Lint code
- **ASTSearch(pattern, path?, language?)** - Search code with AST patterns
- **ASTReplace(pattern, replacement, path?, language?)** - Replace code patterns
- **ASTModify(path, operations, language?, validate?)** - Modify code structure
- **LS(path, showHidden?, recursive?, asArray?)** - List directory contents`);

    if (Object.keys(mcpToolDocs).length > 0) {
      for (const [serverName, serverTools] of Object.entries(mcpToolDocs)) {
        if (serverTools.length > 0) {
          toolSections.push(`\n### ${serverName} Server Tools`);
          for (const tool of serverTools) {
            const desc = tool.description || 'No description';
            toolSections.push(`- **${tool.name}(${tool.params || ''})** - ${desc}`);
          }
        }
      }
    }

    const toolsSection = toolSections.join('\n');

    return basePrompt + toolsSection + `

## Code Execution Examples

### Execute JavaScript
\`\`\`javascript
const { Read, Write, Bash } = await import('/tmp/mcp-runtime-helpers.mjs');
const content = await Read('/path/to/file.js');
console.log('File length:', content.length);
await Write('/path/to/output.js', 'modified content');
\`\`\`

### Execute Python
\`\`\`python
import json
import subprocess

# Use functions from runtime helpers
result = subprocess.run(['ls', '-la'], capture_output=True, text=True)
print(result.stdout)
\`\`\`

### Execute Bash
\`\`\`bash
#!/bin/bash
find . -name "*.js" -type f | wc -l
\`\`\`

## Key Principles

1. **Code-First**: Use Execute to accomplish tasks, not plain tool descriptions
2. **Direct Access**: Call functions directly within your code
3. **Error Handling**: Catch and handle errors appropriately in your code
4. **Clarity**: Write readable code that clearly shows what you're doing
5. **Efficiency**: Complete tasks in minimal code with good error handling
`;
  }

  static extractMCPToolDocs(tools) {
    const mcpDocs = {};
    const builtInNames = new Set(['Edit', 'Glob', 'Grep', 'Bash', 'LS', 'TodoWrite', 'WebFetch', 'ASTLint', 'ASTSearch', 'ASTReplace', 'ASTModify']);

    for (const tool of tools) {
      if (builtInNames.has(tool.name)) continue;

      const parts = tool.name.split('_');
      const serverName = parts[0];

      if (!mcpDocs[serverName]) {
        mcpDocs[serverName] = [];
      }

      const toolNameOnly = tool.name.substring(serverName.length + 1);
      const params = tool.inputSchema && tool.inputSchema.properties
        ? Object.keys(tool.inputSchema.properties).join(', ')
        : '';

      mcpDocs[serverName].push({
        name: toolNameOnly,
        description: tool.description,
        params
      });
    }

    return mcpDocs;
  }
}

export default SystemPromptBuilder;
