#!/usr/bin/env node



import { spawn } from 'child_process';
import * as fs from 'fs';
import { tmpdir } from 'os';
import ExecutionHelpers from './execution-helpers.js';


let config, mcpManager, historyManager, executionManager, authManager;



class ExecutionManager {
  constructor() {
    this.nextExecId = 0;
    this.runningExecutions = new Map();
    this.finalPromptCalled = false;
    this.eagerPrompts = [];
  }

  queueEagerPrompt(execId, message, logs) {
    const prompt = {
      execId,
      message,
      logs,
      timestamp: Date.now()
    };
    this.eagerPrompts.push(prompt);
    console.error(`[Eager Prompt Queued] ${execId}: ${message}`);
  }

  getQueuedPrompts() {
    const prompts = this.eagerPrompts;
    this.eagerPrompts = [];
    return prompts;
  }

  callFinalPrompt() {
    if (this.finalPromptCalled) {
      console.error('[Final Prompt] Already called - preventing infinite loop');
      return false;
    }
    this.finalPromptCalled = true;
    return true;
  }

  resetFinalPromptFlag() {
    this.finalPromptCalled = false;
  }

  getTodoStatus() {
    if (typeof historyManager !== 'undefined' && historyManager.getTodos) {
      try {
        const todos = historyManager.getTodos();
        if (!Array.isArray(todos)) {
          throw new Error(`Expected getTodos() to return array, got ${typeof todos}`);
        }
        return todos;
      } catch (e) {
        console.error(`❌ Error retrieving todos from history: ${e.message}`);
        throw e; 
      }
    }
    return [];
  }

  async execute(args) {
    const { code, runtime, timeout = 10000 } = args;

    if (!code) {
      throw new Error('Code is required for execution');
    }

    if (!runtime) {
      throw new Error('Runtime parameter is required (nodejs, deno, bun, python, bash, go, rust, c, cpp)');
    }

    if (code.includes('pkill')) {
      throw new Error('Execution rejected: pkill command is not allowed');
    }

    const execId = `exec_${this.nextExecId++}`;

    try {
      const result = await this.executeCode(code, runtime, timeout, execId);

      historyManager.recordExecute(
        { code: this.compactCode(code), runtime },
        { success: true, result: this.compactData(result) }
      );


      return {
        success: true,
        result,
        execId
      };
    } catch (error) {
      historyManager.recordExecute(
        { code: this.compactCode(code), runtime },
        { success: false, error: error.message }
      );


      return {
        success: false,
        error: error.message,
        execId
      };
    }
  }

  async executeCode(code, runtime, timeout, execId) {
    return new Promise((resolve, reject) => {
      let tempFile;
      const startTime = Date.now();
      let timeoutTriggered = false;
      let promiseResolved = false;
      let lastLogSize = 0;
      let accumulatedStdout = '';
      let accumulatedStderr = '';

      try {
        tempFile = ExecutionHelpers.setupTempFile(code, runtime);

        ExecutionHelpers.setupMcpHelper();

        const command = ExecutionHelpers.getExecutionCommand(runtime, tempFile);

        console.error(`[execution] Spawning ${command.cmd} with args: ${JSON.stringify(command.args, null, 2)}`);

        const childEnv = ExecutionHelpers.buildChildEnv(mcpManager, ORIGINAL_CWD);

        const child = ExecutionHelpers.spawnProcess(command, ORIGINAL_CWD, childEnv);

        console.error(`[child process hook] PID: ${child.pid}, Command: ${command.cmd}`);

        let stdout = '';
        let stderr = '';
        let stdoutBuffer = ''; 

        child.stdout.on('data', async (data) => {
          const output = data.toString();
          stdoutBuffer += output;

          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop() || ''; 

          for (const line of lines) {
            let isJsonRpc = false;
            try {
              const parsed = JSON.parse(line);
              if (parsed.jsonrpc === '2.0' && parsed.method === 'tools/call') {
                isJsonRpc = true;
                const { id, params } = parsed;
                const { name: toolName, arguments: toolArgs } = params;


                try {
                  const result = await mcpManager.handleToolCall(toolName, toolArgs);


                  const response = {
                    jsonrpc: '2.0',
                    id,
                    result
                  };
                  child.stdin.write(JSON.stringify(response) + '\n');
                } catch (error) {

                  const response = {
                    jsonrpc: '2.0',
                    id,
                    error: {
                      code: -32603,
                      message: error.message
                    }
                  };
                  child.stdin.write(JSON.stringify(response) + '\n');
                }
              }
            } catch (e) {
            }

            if (!isJsonRpc) {
              stdout += line + '\n';
              accumulatedStdout += line + '\n';
              process.stderr.write(line + '\n');
            }
          }
        });

        child.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          accumulatedStderr += output;
          process.stderr.write(output);
        });

        const timer = setTimeout(() => {
          timeoutTriggered = true;
          console.error(`[timeout] Execution timeout after ${timeout}ms - process continues in background (PID ${child.pid})`);

          const logs = `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`;
          const timeoutMessage = `⏱️ Execution timeout after ${timeout}ms. Process (PID ${child.pid}) continues in background. Logs below. Updates every 60s.`;

          this.queueEagerPrompt(execId, timeoutMessage, logs);

          if (!promiseResolved) {
            promiseResolved = true;
            const elapsedMs = Math.max(0, Date.now() - startTime);
            const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
            resolve(`${timeoutMessage}\n\n${logs}\n\nTime: ${elapsedSeconds}s`);
          }

          lastLogSize = 0;
          accumulatedStdout = '';
          accumulatedStderr = '';

          const progressTimer = setInterval(() => {
            if (!child.exitCode && !child.killed) {
              const newLogs = `${accumulatedStdout}${accumulatedStderr ? '\nSTDERR:\n' + accumulatedStderr : ''}`;
              if (newLogs.length > lastLogSize) {
                this.queueEagerPrompt(
                  execId,
                  `📊 Background process (PID ${child.pid}) still running. New output received.`,
                  newLogs
                );
                lastLogSize = newLogs.length;
                accumulatedStdout = '';
                accumulatedStderr = '';
              }
            } else {
              clearInterval(progressTimer);
              this.queueEagerPrompt(
                execId,
                `✅ Background process (PID ${child.pid}) completed.`,
                `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`
              );
            }
          }, 60000);

          child._progressTimer = progressTimer;

        }, timeout);

        child.on('close', (code) => {
          clearTimeout(timer);
          if (child._progressTimer) {
            clearInterval(child._progressTimer);
          }

          const endTime = Date.now();
          const duration = endTime - startTime;
          const validDuration = typeof duration === 'number' && !isNaN(duration) && duration >= 0 ? duration : 0;
          const seconds = (validDuration / 1000).toFixed(2);
          const minutes = (validDuration / 60000).toFixed(2);
          const timeDisplay = validDuration > 60000 ? `${minutes}min` : `${seconds}s`;

          console.error(`[close hook] Process exited with code: ${code}`);
          console.error(`[execution complete] Time: ${timeDisplay}`);

          ExecutionHelpers.cleanupTempFile(tempFile);

          const result = stdout || (stderr ? `Warning: ${stderr}` : 'Execution completed successfully');
          const resultWithTiming = `${result}\n\nTime: ${timeDisplay}`;

          if (timeoutTriggered) {
            console.error(`[process end] Final logs being handed to agent`);
            this.queueEagerPrompt(
              execId,
              `✅ Background process (PID ${child.pid}) completed with exit code ${code}. Final logs below.`,
              `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`
            );
            return;
          }

          if (!promiseResolved) {
            promiseResolved = true;
            if (code === 0) {
              resolve(resultWithTiming);
            } else {
              reject(new Error(`Execution failed with code ${code}: ${stderr || stdout}\n\nTime: ${timeDisplay}`));
            }
          }
        });

        child.on('error', (error) => {
          clearTimeout(timer);
          if (child._progressTimer) {
            clearInterval(child._progressTimer);
          }

          ExecutionHelpers.cleanupTempFile(tempFile);
          reject(error);
        });

      } catch (error) {
        if (tempFile) {
          try {
            unlinkSync(tempFile);
          } catch (e) {
          }
        }

        reject(error);
      }
    });
  }

  compactCode(code) {
    if (code.length > 200) {
      const lines = code.split('\n').length;
      const language = ExecutionHelpers.detectLanguage(code);
      return `${language} code (${lines} lines): ${code.substring(0, 100)}...`;
    }
    return code;
  }

  compactData(data) {
    return historyManager.compactData(data);
  }

  kill(execId) {
    const execution = this.runningExecutions.get(execId);
    if (execution) {
      execution.process.kill('SIGKILL');
      this.runningExecutions.delete(execId);
      return { success: true, message: `Execution ${execId} killed` };
    }
    return { success: false, message: `Execution ${execId} not found` };
  }
}


export default ExecutionManager;