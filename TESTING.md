# Alfred AI - Complete Testing Guide

## Quick Start

### 1. Setup OAuth (Max Plan Access)

```bash
cd /home/user/marvin
npm run login
```

The system will:
- Auto-detect Claude Code credentials if available
- Offer to import them (recommended)
- Or guide you through manual OAuth setup
- Cache token securely in ~/.anthropic/oauth-token

### 2. Verify Setup

```bash
node oauth-login.js --check
# Output: ✅ OAuth token is cached
```

### 3. Run Tests

```bash
npm run test
# Verifies: Auth, System Prompt, LLM Provider, Code Execution
```

## Testing Infrastructure

### Downloaded Boilerplates

Located in `/tmp/alfred-test/`:
- **React App**: `/tmp/alfred-test/react-app` (facebook/create-react-app)
- **Express API**: `/tmp/alfred-test/express-api` (expressjs/express)

### Test Scripts

- **Integration Test**: `npm run test` - Validates core system
- **Automated Tests**: `/tmp/run-alfred-tests.sh` - Full test suite
- **OAuth Tests**: `node oauth-test.js` - OAuth functionality
- **Manual Tests**: Below

## Manual Testing Procedures

### Test 1: File Analysis (React)

```bash
cd /tmp/alfred-test/react-app
export ALFRED_MODEL=claude-haiku-4-5-20251001
npx /home/user/marvin "show me the package.json file and list the main dependencies"
```

**Expected Output:**
- File contents displayed
- Dependencies listed
- Clear description of each

### Test 2: Project Structure (Express)

```bash
cd /tmp/alfred-test/express-api
npx /home/user/marvin "analyze the directory structure and describe what this project is"
```

**Expected Output:**
- Directory layout explained
- Project type identified
- Key technologies mentioned

### Test 3: Code Execution

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "count all JavaScript files in this directory and list the top 10"
```

**Expected Output:**
- JavaScript file count
- List of files
- File paths

### Test 4: File Operations

```bash
cd /tmp/alfred-test/express-api
npx /home/user/marvin "create a file called ANALYSIS.md documenting this project"
```

**Expected Output:**
- New file created: express-api/ANALYSIS.md
- Markdown format
- Project documentation

### Test 5: Code Understanding

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "read package.json and explain what scripts are available and what they do"
```

**Expected Output:**
- Script names listed
- Purpose of each script explained
- Usage instructions if applicable

## Testing with Different Models

### Fast Testing (Haiku 4.5)

```bash
export ALFRED_MODEL=claude-haiku-4-5-20251001
export ALFRED_MAX_TOKENS=2000
cd /tmp/alfred-test/react-app
time npx /home/user/marvin "list files" 2>&1 | head -50
# Expected: < 10 seconds
```

### Balanced Testing (Sonnet)

```bash
export ALFRED_MODEL=claude-sonnet-4-20250514
export ALFRED_MAX_TOKENS=8000
cd /tmp/alfred-test/react-app
time npx /home/user/marvin "analyze project structure" 2>&1 | head -50
# Expected: 10-20 seconds
```

### Powerful Testing (Opus)

```bash
export ALFRED_MODEL=claude-opus-4-20250805
export ALFRED_MAX_TOKENS=16000
cd /tmp/alfred-test/react-app
time npx /home/user/marvin "provide comprehensive analysis of the entire project" 2>&1 | head -50
# Expected: 20-30 seconds
```

## Testing File Operations

### Create Files

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "create a file called TODO.md with a list of what needs to be done to deploy this app"
# Verify: ls -la TODO.md
```

### Edit Files

```bash
cd /tmp/alfred-test/express-api
npx /home/user/marvin "find the README.md file and add a 'Quick Start' section to it"
# Verify: grep -i "quick start" README.md
```

### Multi-File Operations

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "create a new directory called docs, then create a setup.md file in it with installation instructions"
# Verify: ls -la docs/setup.md
```

## Testing Code Execution Modes

### Node.js Execution

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "write and execute a node script that counts all json files in this directory"
```

### Python Execution

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "use python to analyze the project structure and show me the results"
```

### Bash Execution

```bash
cd /tmp/alfred-test/express-api
npx /home/user/marvin "use bash to find all test files and count them"
```

## Testing MCP Tool Access

### Built-in Tools

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "use the Read tool to read package.json and summarize the dependencies"
```

### Execute Tool with MCP Functions

```bash
cd /tmp/alfred-test/react-app
npx /home/user/marvin "write code using the Execute tool that reads files and counts them"
```

## Debugging & Troubleshooting

### Check Authentication

```bash
# Verify OAuth token
node oauth-login.js --check

# Check environment variables
echo "API Key: $ANTHROPIC_API_KEY"
echo "OAuth Token: $ANTHROPIC_OAUTH_TOKEN"
```

### Check Model Configuration

```bash
echo "Model: ${ALFRED_MODEL:-claude-opus-4-20250805}"
echo "Max Tokens: ${ALFRED_MAX_TOKENS:-8000}"
```

### Check Boilerplate State

```bash
ls -la /tmp/alfred-test/react-app/
ls -la /tmp/alfred-test/express-api/
```

### Run Integration Tests

```bash
npm run test
# Should output: ✅ All integration tests passed!
```

## Performance Benchmarks

### Expected Response Times

| Task | Model | Expected Time |
|------|-------|---------------|
| List files | Haiku | 5-8s |
| Analyze project | Haiku | 8-12s |
| Create file | Haiku | 6-10s |
| Code analysis | Sonnet | 12-18s |
| Comprehensive review | Opus | 20-30s |

### Network Timing

```bash
# Test API connectivity
curl -s -o /dev/null -w "%{time_total}\n" https://api.anthropic.com/v1/messages

# Test with real API call
time npx /home/user/marvin "count files"
```

## Success Criteria

✅ **Authentication**: OAuth token cached in ~/.anthropic/oauth-token
✅ **File Operations**: New files created and modified in boilerplate dirs
✅ **Code Execution**: Scripts run without errors
✅ **Response Quality**: Clear, relevant answers to prompts
✅ **Performance**: Response times < 30s for Haiku model
✅ **File Persistence**: Changes persist after execution
✅ **Error Handling**: Clear error messages when issues occur

## Cleaning Up

### Reset Test Environment

```bash
rm -rf /tmp/alfred-test
mkdir /tmp/alfred-test
cd /tmp/alfred-test
git clone --depth 1 https://github.com/facebook/create-react-app.git react-app
git clone --depth 1 https://github.com/expressjs/express.git express-api
```

### Clear OAuth Token

```bash
node oauth-login.js --clear
# or
rm ~/.anthropic/oauth-token
```

### Clear All Test Artifacts

```bash
rm -rf /tmp/alfred-test /tmp/*.sh /tmp/*.js /tmp/TESTING-GUIDE.md
```

## Reporting Results

When testing Alfred AI, report:

1. **Model Used**: `echo $ALFRED_MODEL`
2. **Test Command**: Exact command run
3. **Result**: Pass/Fail with output
4. **Time**: How long it took
5. **Environment**: OS, Node version, API key type

Example:

```
Model: claude-haiku-4-5-20251001
Command: npx /home/user/marvin "list files"
Result: ✓ Files listed successfully
Time: 7.2s
Environment: Linux, Node 18.x, OAuth token
```

## Further Testing

For additional testing scenarios:
- Test with large files (>10MB)
- Test with complex code analysis
- Test with multiple simultaneous requests
- Test error recovery and edge cases
- Test with different network conditions

See OAUTH-SETUP.md for authentication details.
See README.md for general Alfred AI documentation.
