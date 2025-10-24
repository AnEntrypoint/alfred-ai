#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isAstGrepAvailable } from './ast-grep-wrapper.js';

export class ASTModificationHelper {
  constructor(workingDirectory = process.cwd()) {
    this.workingDirectory = workingDirectory;
  }

  async parseCode(code, language) {
    if (!(await isAstGrepAvailable())) {
      throw new Error('AST functionality not available');
    }
    const { parse } = await import('./ast-grep-wrapper.js');
    return await parse(language, code);
  }

  async searchPatternInFile(filePath, pattern, options = {}) {
    const {
      language = null,
      maxMatches = 100,
      includeContext = false
    } = options;

    try {
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      if (!language) {
        return { success: false, error: 'Language parameter is required for code parsing' };
      }

      const content = readFileSync(filePath, 'utf8');
      const root = await this.parseCode(content, language);
      if (!root) {
        return { success: false, error: 'Failed to parse code' };
      }

      const rootNode = root.root();
      const matches = rootNode.findAll(pattern);

      const results = matches.slice(0, maxMatches).map(match => {
        const range = match.range();
        const result = {
          file: filePath,
          line: range.start.line,
          column: range.start.column,
          text: match.text(),
          start: range.start.index,
          end: range.end.index
        };

        if (includeContext) {
          const lines = content.split('\n');
          const contextStart = Math.max(0, range.start.line - 2);
          const contextEnd = Math.min(lines.length - 1, range.start.line + 2);
          result.context = lines.slice(contextStart, contextEnd + 1).map((line, idx) => ({
            line: contextStart + idx + 1,
            content: line,
            isMatch: contextStart + idx === range.start.line
          }));
        }

        return result;
      });

      return {
        success: true,
        results,
        totalMatches: matches.length,
        truncated: matches.length > maxMatches
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async searchPatternInDirectory(dirPath, pattern, options = {}) {
    const {
      recursive = true,
      extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs'],
      maxFiles = 100,
      maxMatchesPerFile = 50,
      language = null
    } = options;

    const allResults = [];
    let filesProcessed = 0;

    const processDirectory = async (currentDir, depth = 0) => {
      if (depth > 5 || filesProcessed >= maxFiles) return;

      try {
        const entries = readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (filesProcessed >= maxFiles) break;

          const fullPath = join(currentDir, entry.name);

          if (entry.isDirectory() && recursive) {
            if (!['node_modules', '.git', '.vscode', '.idea', 'dist', 'build', 'coverage'].includes(entry.name)) {
              await processDirectory(fullPath, depth + 1);
            }
          } else if (entry.isFile() && extensions.some(ext => fullPath.endsWith(ext))) {
            filesProcessed++;
            const result = await this.searchPatternInFile(fullPath, pattern, {
              language,
              maxMatches: maxMatchesPerFile,
              includeContext: options.includeContext
            });

            if (result.success && result.results.length > 0) {
              allResults.push(...result.results);
            }
          }
        }
      } catch (error) {
      }
    };

    await processDirectory(dirPath);

    return {
      success: true,
      results: allResults,
      filesProcessed,
      totalMatches: allResults.length
    };
  }

  async replacePatternInFile(filePath, pattern, replacement, options = {}) {
    const { language = null, dryRun = false } = options;

    try {
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      if (!language) {
        return { success: false, error: 'Language parameter is required for code parsing' };
      }

      const content = readFileSync(filePath, 'utf8');
      const root = await this.parseCode(content, language);
      if (!root) {
        return { success: false, error: 'Failed to parse code' };
      }

      const rootNode = root.root();
      const matches = rootNode.findAll(pattern);

      if (matches.length === 0) {
        return {
          success: true,
          modified: false,
          matchesFound: 0,
          message: 'No matches found for pattern'
        };
      }

      const sortedMatches = matches.sort((a, b) => b.range().start.index - a.range().start.index);
      let modifiedContent = content;
      let totalOffset = 0;

      const changes = [];

      for (const match of sortedMatches) {
        const range = match.range();
        const before = modifiedContent.substring(0, range.start.index + totalOffset);
        const after = modifiedContent.substring(range.end.index + totalOffset);

        modifiedContent = before + replacement + after;
        totalOffset += replacement.length - (range.end.index - range.start.index);

        changes.push({
          line: range.start.line,
          column: range.start.column,
          original: match.text(),
          replacement: replacement
        });
      }

      if (!dryRun && modifiedContent !== content) {
        writeFileSync(filePath, modifiedContent);
      }

      return {
        success: true,
        modified: modifiedContent !== content,
        matchesFound: matches.length,
        changes,
        dryRun,
        message: dryRun ?
          `Dry run: Would make ${matches.length} changes` :
          `Successfully applied ${matches.length} changes`
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async replacePatternInDirectory(dirPath, pattern, replacement, options = {}) {
    const {
      recursive = true,
      extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs'],
      maxFiles = 50,
      language = null,
      dryRun = false
    } = options;

    const allResults = [];
    let filesProcessed = 0;
    let filesModified = 0;

    const processDirectory = async (currentDir, depth = 0) => {
      if (depth > 5 || filesProcessed >= maxFiles) return;

      try {
        const entries = readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (filesProcessed >= maxFiles) break;

          const fullPath = join(currentDir, entry.name);

          if (entry.isDirectory() && recursive) {
            if (!['node_modules', '.git', '.vscode', '.idea', 'dist', 'build', 'coverage'].includes(entry.name)) {
              await processDirectory(fullPath, depth + 1);
            }
          } else if (entry.isFile() && extensions.some(ext => fullPath.endsWith(ext))) {
            filesProcessed++;
            const result = await this.replacePatternInFile(fullPath, pattern, replacement, {
              language,
              dryRun
            });

            if (result.success) {
              allResults.push({
                file: fullPath,
                ...result
              });

              if (result.modified) {
                filesModified++;
              }
            }
          }
        }
      } catch (error) {
      }
    };

    await processDirectory(dirPath);

    return {
      success: true,
      results: allResults,
      filesProcessed,
      filesModified,
      totalChanges: allResults.reduce((sum, r) => sum + r.matchesFound, 0),
      dryRun
    };
  }

  generateASTInsights(results, operation, pattern, replacement = null) {
    const insights = [];

    if (operation === 'search') {
      insights.push(`AST search found ${results.length} matches for pattern: "${pattern}"`);

      const uniqueFiles = new Set(results.map(r => r.file));
      if (uniqueFiles.size > 1) {
        insights.push(`Pattern found in ${uniqueFiles.size} different files`);
      }

      if (pattern.includes('$') || pattern.includes('has')) {
        insights.push('Complex pattern search - results show structural code relationships');
      }

      const fileTypes = new Set(results.map(r => r.file.split('.').pop()));
      if (fileTypes.size > 1) {
        insights.push(`Pattern spans ${fileTypes.size} file types: ${Array.from(fileTypes).join(', ')}`);
      }

    } else if (operation === 'replace') {
      if (replacement) {
        insights.push(`Pattern replacement: "${pattern}" → "${replacement}"`);
      }

      const totalChanges = results.reduce((sum, r) => sum + (r.matchesFound || 0), 0);
      insights.push(`Total changes: ${totalChanges} across ${results.length} files`);

      if (totalChanges > 10) {
        insights.push('Large-scale change - consider testing and verification');
      }
    }

    if (pattern.includes('console.')) {
      insights.push('Console operation pattern detected');
    }

    if (pattern.includes('debugger')) {
      insights.push('Debugger statement pattern detected');
    }

    if (pattern.includes('var ')) {
      insights.push('Var declaration pattern detected - consider modernizing to const/let');
    }

    if (pattern.includes('TODO') || pattern.includes('FIXME')) {
      insights.push('Task comment pattern detected');
    }

    if (results.length === 0) {
      insights.push('No matches found - pattern may be too specific or not present');
    } else if (results.length > 50) {
      insights.push('Many matches found - consider more specific pattern');
    }

    return insights;
  }
}

export default ASTModificationHelper;
