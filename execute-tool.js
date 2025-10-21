// Execute tool - provides access to ALL MCP tools inline
// Returns progress every 3s initially, then every 60s until completion

const activeExecutions = new Map();

export async function createExecuteTool(mcpManager) {
  return {
    name: 'execute',
    description: `Execute JavaScript code with access to ALL MCP tools. All tools available as async functions. Returns progress every 3s initially, then every 60s.`,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        workingDirectory: { type: 'string', description: 'Working directory' },
        executionId: { type: 'string', description: 'Execution ID to check progress (optional)' },
        kill: { type: 'boolean', description: 'Kill execution with given executionId' }
      },
      required: ['code']
    },
    handler: async ({ code, workingDirectory = process.cwd(), executionId, kill }) => {
      // If kill flag and executionId provided, kill the execution
      if (kill && executionId) {
        const execution = activeExecutions.get(executionId);
        if (!execution) {
          return `Execution ${executionId} not found or already completed`;
        }
        execution.killed = true;
        execution.completed = true;
        execution.error = 'Execution killed by user';
        activeExecutions.delete(executionId);
        return `✗ Execution ${executionId} killed`;
      }

      // If executionId provided, return progress for existing execution
      if (executionId) {
        const execution = activeExecutions.get(executionId);
        if (!execution) {
          return `Execution ${executionId} not found or already completed`;
        }

        const newLogs = execution.output.slice(execution.lastReportedLength);
        execution.lastReportedLength = execution.output.length;

        if (execution.completed) {
          activeExecutions.delete(executionId);
          if (execution.error) {
            return `✗ Execution ${executionId} failed\n\n${newLogs}\n\nError: ${execution.error}`;
          }
          return `✓ Execution ${executionId} completed\n\n${newLogs}${execution.result !== undefined ? '\n\nResult: ' + execution.result : ''}`;
        }

        if (newLogs.length === 0) {
          return `⟳ Execution ${executionId} running... (no new logs)`;
        }

        return `⟳ Execution ${executionId} progress:\n\n${newLogs}`;
      }

      // New execution
      const execId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Build tool proxy objects for each MCP server
      const toolProxies = {};

      for (const [serverName, serverState] of mcpManager.servers) {
        toolProxies[serverName] = {};

        for (const tool of serverState.tools) {
          toolProxies[serverName][tool.name] = async (args = {}) => {
            return await mcpManager.callTool(serverName, tool.name, args);
          };
        }
      }

      // Inject tool proxies into global scope
      for (const [serverName, tools] of Object.entries(toolProxies)) {
        global[serverName] = tools;
      }

      // Add convenience aliases
      if (global.builtInTools) {
        global.Read = async (file_path) => await global.builtInTools.Read({ file_path });
        global.Write = async (file_path, content) => await global.builtInTools.Write({ file_path, content });
        global.Edit = async (file_path, old_string, new_string, replace_all) => await global.builtInTools.Edit({ file_path, old_string, new_string, replace_all });
        global.Bash = async (command, description, timeout) => await global.builtInTools.Bash({ command, description, timeout });
        global.Glob = async (pattern, path) => await global.builtInTools.Glob({ pattern, path });
        global.Grep = async (pattern, path, options) => await global.builtInTools.Grep({ pattern, path, ...options });
        global.LS = async (path) => await global.builtInTools.LS({ path });
      }

      const originalCwd = process.cwd();
      process.chdir(workingDirectory);

      // Track execution state
      const execution = {
        id: execId,
        output: '',
        lastReportedLength: 0,
        completed: false,
        result: null,
        error: null
      };
      activeExecutions.set(execId, execution);

      // Capture console output
      const originalLog = console.log;
      console.log = (...args) => {
        const msg = args.join(' ') + '\n';
        execution.output += msg;
        originalLog(...args);
      };

      // Start execution in background
      (async () => {
        try {
          const result = await eval(`(async () => { ${code} })()`);
          if (!execution.killed) {
            execution.result = result;
            execution.completed = true;
          }
        } catch (error) {
          if (!execution.killed) {
            execution.error = error.message + '\n' + error.stack;
            execution.completed = true;
          }
        } finally {
          console.log = originalLog;
          process.chdir(originalCwd);
        }
      })();

      // Wait 3 seconds for initial progress
      await new Promise(resolve => setTimeout(resolve, 3000));

      const initialProgress = execution.output;
      execution.lastReportedLength = execution.output.length;

      if (execution.completed) {
        activeExecutions.delete(execId);
        console.log = originalLog;
        process.chdir(originalCwd);

        if (execution.error) {
          return `✗ Execution completed in <3s with error\n\n${initialProgress}\n\nError: ${execution.error}`;
        }
        return `✓ Execution completed in <3s\n\n${initialProgress}${execution.result !== undefined ? '\n\nResult: ' + execution.result : ''}`;
      }

      // Hand over to async - return initial progress
      return `⟳ Execution ${execId} handed over to async after 3s\n\n${initialProgress}\n\n(Check progress: execute with executionId: "${execId}" every 60s)`;
    }
  };
}
