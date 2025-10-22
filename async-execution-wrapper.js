#!/usr/bin/env node

import { spawn } from 'child_process';

class AsyncExecutionWrapper {
  constructor() {
    this.isExecuting = false;
    this.currentExecution = null;
    this.progressCallbacks = [];
  }

  async executeWithAsyncBehavior(executionFn, progressReportInterval = 60000) {
    if (this.isExecuting) {
      throw new Error('Execution already in progress');
    }

    this.isExecuting = true;
    const startTime = Date.now();

    try {
      console.log('⏳ Planning execution (3s initial block)...');

      // Initial 3-second planning block
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log('🚀 Execution starting, will report progress every 60 seconds...');

      // Start progress reporter
      const progressReporter = this.startProgressReporting(progressReportInterval);

      // Execute the actual function asynchronously
      this.currentExecution = executionFn();

      // Wait for execution to complete
      const result = await this.currentExecution;

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
      const report = `⏳ [${new Date().toISOString().slice(11, 19)}] Execution in progress... (${elapsed}s elapsed)`;

      // Clear previous line and show new progress
      if (lastReport) {
        process.stdout.write('\r\x1b[K'); // Clear current line
      }
      process.stdout.write(`${report}`);
      lastReport = report;

      // Add newline every few reports to avoid single line overwrite
      if (elapsed % 180 === 0) { // Every 3 minutes
        process.stdout.write('\n');
      }
    }, interval);
  }

  async executeWithProgressReport(executionFn, taskDescription) {
    console.log(`🎯 Starting task: ${taskDescription}`);
    console.log('⏳ Initial 3-second planning phase...\n');

    // 3-second initial block
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('⚙️  Executing task...');

    // Start the async execution with progress reporting
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

  // Method to cancel current execution
  cancelExecution() {
    if (this.isExecuting && this.currentExecution) {
      console.log('\n🛑 Cancelling execution...');
      this.isExecuting = false;
      // Note: We can't actually cancel the running process in Node.js easily
      // but we can mark it as cancelled and ignore the result
    }
  }
}

export default AsyncExecutionWrapper;