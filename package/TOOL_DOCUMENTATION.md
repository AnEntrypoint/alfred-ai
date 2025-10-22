# Alfred AI - Available Tools Documentation

## 📁 File System Tools

### Glob - Pattern Matching
**Description**: Find files using glob patterns with intelligent ignores
**Ignores**: `node_modules`, `dist`, `build`, `.git`, `coverage`, hidden files (by default)
**Usage**:
```javascript
await Glob({ pattern: '**/*.js' }); // All JS files (excludes node_modules)
await Glob({ pattern: '**/*', path: './src' }); // All files in src
```

**To bypass ignores**: Use bash directly
```javascript
await Bash({ command: 'find . -name "*.js"' }); // Includes node_modules
```

### Grep - Text Search
**Description**: Search for text patterns in files using ripgrep with smart excludes
**Ignores**: `node_modules`, `.git`, `dist`, `build`, `*.log`, `*.lock` files
**Usage**:
```javascript
await Grep({ pattern: 'function', output_mode: 'files_with_matches' });
await Grep({ pattern: 'TODO', path: './src' });
await Grep({ pattern: 'import.*express', type: 'js' });
```

**To bypass ignores**: Use bash directly
```javascript
await Bash({ command: 'grep -r "pattern" .' }); // Searches all directories
await Bash({ command: 'rg "pattern" --no-ignore' }); // Ripgrep without ignores
```

### LS - Directory Listing
**Description**: List directory contents with filtered output
**Ignores**: Hidden files, `node_modules`, `dist`, `build` directories
**Usage**:
```javascript
await LS(); // Current directory (cleaned)
await LS({ path: './src' }); // Specific directory
```

**To bypass ignores**: Use bash directly
```javascript
await Bash({ command: 'ls -la' }); // Shows all files including node_modules
await Bash({ command: 'find . -maxdepth 1 -type f' }); // All files in current dir
```

## ✏️ File Operations

### Read - File Reading
**Description**: Read file contents as text
**No ignores applied** - Reads any specified file path
**Usage**:
```javascript
const content = await Read({ file_path: 'package.json' });
```

### Write - File Writing
**Description**: Write text content to files (creates/overwrites)
**No ignores applied** - Writes to any specified file path
**Usage**:
```javascript
await Write({ file_path: 'output.txt', content: 'Hello World' });
```

### Edit - File Editing
**Description**: Replace text in files with safety checks
**No ignores applied** - Edits any specified file path
**Usage**:
```javascript
await Edit({
  file_path: 'config.js',
  old_string: 'old value',
  new_string: 'new value'
});
```

## 💻 System Operations

### Bash - Command Execution
**Description**: Execute shell commands with enhanced defaults
**Auto-enhancements**:
- `find` commands get `-not -path "*/node_modules/*"` etc.
- `ls` commands get `--ignore=node_modules --ignore=.git` etc.
- Ripgrep environment set up with sensible defaults
**Usage**:
```javascript
await Bash({ command: 'npm test' });
await Bash({ command: 'ls -la' }); // Automatically enhanced
```

**To bypass auto-enhancements**: Use raw commands or specify flags
```javascript
await Bash({ command: 'find . -name "*.js" -not -path "*/node_modules/*"' }); // Manual control
await Bash({ command: 'ls --ignore=""' }); // Override default ignores
```

## 🔧 Default Ignore Patterns

### Always Ignored (JavaScript tools):
- `**/node_modules/**`
- `**/dist/**`
- `**/build/**`
- `**/.git/**`
- `**/coverage/**`
- Hidden files (dot files)
- `*.log` files
- `*.lock` files

### Bash Auto-Enhancements:
- `find` → `find -not -path "*/node_modules/*" -not -path "*/.git/*" ...`
- `ls` → `ls --ignore=node_modules --ignore=.git --ignore=dist ...`
- Ripgrep environment: `RG_DEFAULTS="--hidden --follow --glob=!{.git,node_modules,dist,build,coverage}/*"`

## 🎯 Best Practices

### Use JavaScript tools when:
- Working with source code files
- Need structured data (arrays/objects)
- Want automatic node_modules filtering
- Processing multiple files

### Use Bash directly when:
- Need to search through node_modules
- Working with system files
- Need specific command-line tools
- Want to bypass all ignores

### Override ignores when:
```javascript
// Search in node_modules specifically
await Bash({ command: 'rg "dependency" node_modules/' });

// Include hidden files in glob (via bash)
await Bash({ command: 'find . -name ".*" -type f' });

// List all directories including build artifacts
await Bash({ command: 'find . -type d' });
```

## 🚫 Override Examples

### Search node_modules:
```javascript
// JavaScript tool (ignores node_modules)
const files = await Grep({ pattern: 'express' }); // Won't search node_modules

// Bash direct (includes node_modules)
await Bash({ command: 'grep -r "express" node_modules/' });
```

### List all files:
```javascript
// JavaScript tool (filtered)
const clean = await LS(); // No node_modules, no hidden files

// Bash direct (everything)
await Bash({ command: 'ls -la' }); // All files including node_modules
```

### Find with custom patterns:
```javascript
// JavaScript tool (smart defaults)
const jsFiles = await Glob({ pattern: '**/*.js' }); // Excludes node_modules

// Bash direct (custom control)
await Bash({ command: 'find . -name "*.js" -o -path "*/node_modules/*" -prune' });
```

---

**Note**: The automatic ignores are designed to keep output focused on your source code and avoid noise from dependencies and build artifacts. Use Bash directly when you need to work with these filtered directories.