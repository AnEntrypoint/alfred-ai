#!/usr/bin/env node

import { spawn } from 'child_process';

class AsyncExecutionWrapper {
  constructor() {
    this.isExecuting = false;
    this.currentExecution = null;
    this.progressCallbacks = [];
    this.activeProcesses = new Map(); // Track all running async processes
    this.nextProcessId = 1;
  }

  async executeWithAsyncBehavior(executionFn, progressReportInterval = 60000) {
    if (this.isExecuting) {
      throw new Error('Execution already in progress');
    }

    this.isExecuting = true;
    const startTime = Date.now();

    try {
      console.log('🚀 Execution starting, will report progress every 60 seconds...');

      // Start progress reporter immediately
      const progressReporter = this.startProgressReporting(progressReportInterval);

      // Execute the actual function and collect output for 3 seconds
      const executionPromise = executionFn();

      // Wait up to 3 seconds to see if execution completes quickly
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('BUFFER_TIMEOUT')), 3000);
      });

      let result;
      try {
        // Try to complete within 3 seconds for immediate output
        result = await Promise.race([executionPromise, timeoutPromise]);
      } catch (error) {
        if (error.message === 'BUFFER_TIMEOUT') {
          // Execution didn't complete in 3 seconds, wait for full completion
          console.log('⏳ Execution continuing beyond initial buffer...');
          result = await executionPromise;
        } else {
          throw error;
        }
      }

      // Stop progress reporting
      if (progressReporter) {
        clearInterval(progressReporter);
      }

      const duration = Date.now() - startTime;
      console.log(`\n✅ Execution completed in ${Math.round(duration / 1000)}s`);

      return result;

    } catch (error) {
      console.error(`❌ Execution failed: ${error.message}`);
      throw error;
    } finally {
      this.isExecuting = false;
      this.currentExecution = null;
    }
  }

  startProgressReporting(interval = 60000) {
    let lastReport = '';
    const startTime = Date.now();

    return setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Report on all active processes
      if (this.activeProcesses.size > 0) {
        process.stdout.write(`\n🔄 [${new Date().toISOString().slice(11, 19)}] Active processes report (${elapsed}s elapsed):`);

        for (const [processId, processInfo] of this.activeProcesses) {
          const processElapsed = Math.round((Date.now() - processInfo.startTime) / 1000);
          process.stdout.write(`\n   📋 Process #${processId}: ${processInfo.description} (running ${processElapsed}s)`);

          // Clear and report accumulated logs if any
          if (processInfo.logs.length > 0) {
            process.stdout.write(`\n   📝 Recent logs: ${processInfo.logs.slice(-3).join(' | ')}`);
            // Clear the logs after reporting
            processInfo.logs = [];
          }
        }
        process.stdout.write(`\n   🤔 Agent: ${this.activeProcesses.size} process(es) running - you may terminate if needed\n`);
      } else {
        const report = `⏳ [${new Date().toISOString().slice(11, 19)}] Execution in progress... (${elapsed}s elapsed)`;
        process.stdout.write(`\n${report}`);
      }

      lastReport = `${new Date().toISOString().slice(11, 19)}`;
    }, interval);
  }

  async executeWithProgressReport(executionFn, taskDescription) {
    console.log(`🎯 Starting task: ${taskDescription}`);
    console.log('⚙️  Executing task...');

    // Start the async execution with progress reporting and 3s output buffer
    return this.executeWithAsyncBehavior(executionFn);
  }

  // Method to update progress from within execution
  updateProgress(message) {
    if (this.isExecuting) {
      process.stdout.write(`\n📝 ${message}\n`);
    }
  }

  // Method to check if execution is running
  isExecutionRunning() {
    return this.isExecuting;
  }

  // Method to register a new async process
  registerAsyncProcess(description, processRef = null) {
    const processId = this.nextProcessId++;
    const processInfo = {
      id: processId,
      description,
      startTime: Date.now(),
      processRef,
      logs: []
    };

    this.activeProcesses.set(processId, processInfo);
    console.log(`🚀 Process #${processId} registered: ${description}`);
    return processId;
  }

  // Method to add logs to a process
  addProcessLog(processId, logMessage) {
    const process = this.activeProcesses.get(processId);
    if (process) {
      const timestamp = new Date().toISOString().slice(11, 19);
      process.logs.push(`[${timestamp}] ${logMessage}`);
      // Keep only last 10 logs to prevent memory buildup
      if (process.logs.length > 10) {
        process.logs.shift();
      }
    }
  }

  // Method to unregister/cancel a process
  unregisterAsyncProcess(processId) {
    const process = this.activeProcesses.get(processId);
    if (process) {
      if (process.processRef && process.processRef.kill) {
        process.processRef.kill();
      }
      this.activeProcesses.delete(processId);
      console.log(`🛑 Process #${processId} terminated: ${process.description}`);
      return true;
    }
    return false;
  }

  // Method to cancel all processes
  cancelAllProcesses() {
    console.log(`🛑 Terminating ${this.activeProcesses.size} active processes...`);
    for (const [processId, processInfo] of this.activeProcesses) {
      if (processInfo.processRef && processInfo.processRef.kill) {
        processInfo.processRef.kill();
      }
    }
    this.activeProcesses.clear();
    console.log('✅ All processes terminated');
  }

  // Method to cancel current execution
  cancelExecution() {
    if (this.isExecuting && this.currentExecution) {
      console.log('\n🛑 Cancelling execution...');
      this.isExecuting = false;
      this.cancelAllProcesses();
      // Note: We can't actually cancel the running process in Node.js easily
      // but we can mark it as cancelled and ignore the result
    }
  }
}

export default AsyncExecutionWrapper;