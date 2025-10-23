# Alfred AI - Code Execution Guide for Agents

## Overview
This guide instructs agents on proper code execution patterns, error handling, and chunking strategies to minimize errors and improve reliability.

## Core Principle
**Group related code into sensible chunks, not individual lines or tiny statements.**

## Code Chunking Strategy

### ❌ WRONG - Splitting code per call
```javascript
// DON'T do this - splits single task into 5 calls:
execute({ code: "const fs = require('fs');", runtime: 'nodejs' })
execute({ code: "const data = fs.readFileSync('file.txt', 'utf8');", runtime: 'nodejs' })
execute({ code: "const lines = data.split('\\n');", runtime: 'nodejs' })
execute({ code: "const count = lines.length;", runtime: 'nodejs' })
execute({ code: "console.log(count);", runtime: 'nodejs' })
```

### ✅ CORRECT - Sensible chunks with error handling
```javascript
// DO this - single call with proper error handling:
execute({
  code: `
    try {
      const fs = require('fs');
      const data = fs.readFileSync('file.txt', 'utf8');
      const lines = data.split('\\n');
      const count = lines.length;
      console.log('Line count:', count);
    } catch (error) {
      console.error('Error reading file:', error.message);
      process.exit(1);
    }
  `,
  runtime: 'nodejs'
})
```

## Error Control Flow Patterns

### Python Pattern
```python
try:
    # Main operation
    result = perform_operation()

    if not result:
        print("Error: Operation returned empty result")
        exit(1)

    # Process result
    processed = process_result(result)
    print(f"Success: {processed}")

except FileNotFoundError as e:
    print(f"Error: File not found - {e}")
    exit(1)
except ValueError as e:
    print(f"Error: Invalid value - {e}")
    exit(1)
except Exception as e:
    print(f"Unexpected error: {e}")
    exit(1)
```

### JavaScript/Node Pattern
```javascript
try {
  // Main operation with validation
  const data = readData();

  if (!data || data.length === 0) {
    console.error('Error: No data available');
    process.exit(1);
  }

  // Process with error checking
  const result = processData(data);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log(`Success: ${result.message}`);

} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
}
```

### Bash Pattern
```bash
#!/bin/bash
set -e  # Exit on any error

# Check prerequisites
if [ ! -f "config.txt" ]; then
  echo "Error: config.txt not found" >&2
  exit 1
fi

# Main operation
if ! result=$(process_data); then
  echo "Error: Failed to process data" >&2
  exit 1
fi

# Validate result
if [ -z "$result" ]; then
  echo "Error: Processing returned empty result" >&2
  exit 1
fi

echo "Success: $result"
```

## Chunking Guidelines

### 1. Group Related Operations
**Single logical unit = Single call**

Group operations that:
- Depend on each other
- Are part of the same task
- Share error handling

### 2. Sensible Chunk Sizes
- **Small**: 5-20 lines for simple operations
- **Medium**: 20-50 lines for complex workflows
- **Large**: 50-100+ lines for multi-step processes

Keep chunks under 100 lines for readability.

### 3. Error Validation Patterns

**Check Return Values:**
```python
result = operation()
if not result:
    print("Error: Operation failed")
    exit(1)
```

**Check File Existence:**
```bash
if [ ! -f "$file" ]; then
    echo "Error: File not found: $file"
    exit 1
fi
```

**Check Command Success:**
```javascript
try {
  const output = execSync('command', { encoding: 'utf8' });
  console.log(output);
} catch (error) {
  console.error(`Command failed: ${error.message}`);
  process.exit(1);
}
```

## When to Split Code

### ✅ Split code WHEN:
1. **Different tools needed**: One chunk uses Python, another uses Bash
2. **Long-running operations**: Main operation then check results
3. **Major state changes**: Initialization, then work with state
4. **Debugging needed**: Break into smaller chunks to isolate issues

### ❌ DON'T split code WHEN:
1. Code operates on same data
2. Related operations that depend on each other
3. Error handling is needed
4. Logical flow is sequential

## Execution Checklist

Before calling execute(), ensure your code has:

- [ ] Try-catch or equivalent error handling
- [ ] Input validation
- [ ] Return value checks
- [ ] Clear error messages
- [ ] Proper exit codes
- [ ] Related operations grouped together
- [ ] No unnecessary splitting

## Real-World Examples

### Example 1: Data Processing Pipeline
**✅ CORRECT - Single call with validation:**
```python
execute({
  code: `
try:
    # Read input file
    with open('data.csv', 'r') as f:
        lines = f.readlines()

    if not lines:
        print("Error: CSV file is empty")
        exit(1)

    # Process each line
    results = []
    for line in lines:
        cleaned = line.strip()
        if cleaned:
            results.append(cleaned)

    if not results:
        print("Error: No valid data found")
        exit(1)

    # Write output
    with open('output.csv', 'w') as f:
        f.write('\\n'.join(results))

    print(f"Success: Processed {len(results)} lines")

except FileNotFoundError as e:
    print(f"Error: File not found - {e}")
    exit(1)
except Exception as e:
    print(f"Unexpected error: {e}")
    exit(1)
  `,
  runtime: 'python'
})
```

### Example 2: Multi-Step Workflow
**✅ CORRECT - Logical chunks with error handling:**

Call 1 - Setup and validation:
```javascript
execute({
  code: `
try {
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

  if (!config.apiKey) {
    console.error('Error: API key not configured');
    process.exit(1);
  }

  console.log('Configuration valid');
} catch (error) {
  console.error('Error: Failed to load config -', error.message);
  process.exit(1);
}
  `,
  runtime: 'nodejs'
})
```

Call 2 - Main operation (after verification):
```javascript
execute({
  code: `
try {
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

  // Use validated config
  const result = performOperation(config);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  console.log('Operation complete:', result.message);
} catch (error) {
  console.error('Unexpected error:', error.message);
  process.exit(1);
}
  `,
  runtime: 'nodejs'
})
```

## Timing Expectations

Agents will receive timing information after execution:
- Short tasks: `Time: 0.23s`
- Medium tasks: `Time: 5.67s`
- Long tasks: `Time: 1.33min`

Use this to understand if code is efficient or needs optimization.

## Progress Notifications

For executions over 60 seconds:
- You'll receive a progress notification
- Keep monitoring for completion
- Long operations may take several minutes

## Error Recovery Strategy

1. **Run code with error handling**
2. **Check exit code and output**
3. **If failed**: Analyze error message
4. **Fix and retry**: Don't split up working chunks
5. **If repeated failures**: Break into smaller chunks for debugging

## Summary

✅ **DO:**
- Group related code together
- Use proper error handling
- Validate inputs and outputs
- Check return values
- Exit with proper codes
- Keep chunks 5-100 lines

❌ **DON'T:**
- Split code per statement
- Ignore error cases
- Skip validation
- Over-chunk working code
- Run code without error handling

This approach reduces errors, improves reliability, and lets agents understand execution flow better.
