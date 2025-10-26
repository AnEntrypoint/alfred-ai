#!/usr/bin/env node



import ToolSchemaBuilder from './tool-schema-builder.js';
import { runAgenticLoop } from './alfred-ai.js';


let config, mcpManager, historyManager, executionManager, authManager;



class AlfredMCPServer {
  constructor(mcpManager = null, executionManager = null, authManager = null) {
    this.mcpManager = mcpManager;
    this.executionManager = executionManager;
    this.authManager = authManager;
    this.handlers = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    this.handlers.set('tools/list', async (request) => {
      const tools = ToolSchemaBuilder.buildToolsList(this.mcpManager);
      return { tools };
    });

    this.handlers.set('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'execute') {
          return await this.handleExecute(args);
        } else if (name === 'alfred_kill') {
          return await this.handleKill(args);
        } else if (name === 'alfred') {
          return await this.handleAlfred(args);
        } else if (['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'todo'].includes(name)) {
          const result = await this.mcpManager.callTool('builtInTools', name, args);
          return {
            content: [{ type: 'text', text: result }]
          };
        } else {
          const allTools = this.mcpManager.getAllTools();

          for (const [serverName, tools] of Object.entries(allTools)) {
            if (Array.isArray(tools) && tools.some(t => t.name === name)) {
              const result = await this.mcpManager.callTool(serverName, name, args);
              return {
                content: [{ type: 'text', text: result }]
              };
            }
          }

          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        throw error; 
      }
    });
  }

  async handleExecute(args) {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: arguments must be an object');
    }

    if (args.code === undefined || args.code === null || typeof args.code !== 'string') {
      throw new Error('Invalid arguments: "code" parameter is required and must be a string');
    }

    if (args.runtime === undefined || args.runtime === null || typeof args.runtime !== 'string') {
      throw new Error('Invalid arguments: "runtime" parameter is required and must be a string');
    }

    if (args.code.trim() === '') {
      return {
        content: [{
          type: 'text',
          text: 'Execution failed: No code to execute'
        }],
        isError: true
      };
    }

    const allowedParams = ['code', 'runtime', 'timeout'];
    const providedParams = Object.keys(args);
    const invalidParams = providedParams.filter(param => !allowedParams.includes(param));

    if (invalidParams.length > 0) {
      throw new Error(`Invalid arguments: unknown parameter(s): ${invalidParams.join(', ')}`);
    }

    if (!['nodejs', 'deno', 'bun', 'python', 'bash', 'go', 'rust', 'c', 'cpp'].includes(args.runtime)) {
      throw new Error(`Invalid arguments: "runtime" must be one of: nodejs, deno, bun, python, bash, go, rust, c, cpp`);
    }

    if (args.timeout && (typeof args.timeout !== 'number' || args.timeout <= 0)) {
      throw new Error('Invalid arguments: "timeout" must be a positive number');
    }

    try {
      const result = await this.executionManager.execute(args);

      return {
        content: [{
          type: 'text',
          text: result.success
            ? `Execution completed successfully:\n${result.result}`
            : `Execution failed: ${result.error}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Execution error: ${error.message}`
        }]
      };
    }
  }

  async handleKill(args) {
    try {
      const result = this.executionManager.kill(args.execId);
      return {
        content: [{
          type: 'text',
          text: result.message
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async handleAlfred(args) {
    try {
      const { prompt } = args;
      if (!prompt) {
        throw new Error('prompt parameter is required');
      }

      const apiKey = this.authManager ? this.authManager.getApiKey() : null;
      if (!apiKey) {
        throw new Error('No API key available for Alfred agent');
      }

      if (!this.executionManager) {
        throw new Error('No execution manager available');
      }

      this.executionManager.resetFinalPromptFlag();

      const output = await runAgenticLoop(prompt, this, apiKey, true, true);

      const subAgentId = `alfred_${Date.now()}`;
      const summarizedOutput = output ? output.substring(0, 500) : 'No output';
      this.executionManager.queueEagerPrompt(
        subAgentId,
        `✅ Sub-agent Alfred completed: ${summarizedOutput}${output && output.length > 500 ? '...' : ''}`,
        output || ''
      );

      return {
        content: [{
          type: 'text',
          text: output || 'Alfred completed the task successfully.'
        }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Alfred Error: ${error.message}`
        }],
        isError: true
      };
    }
  }

  async handleRequest(request) {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      throw new Error(`Unknown method: ${request.method}`);
    }

    return await handler(request);
  }
}


export default AlfredMCPServer;