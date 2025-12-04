---
active: true
iteration: 1
max_iterations: 0
completion_promise: "nothinglefttodo"
started_at: "2025-12-04T08:22:22Z"
---

we want to make this programming agent work as well as possible, the basic principal is to provide its tooling, and mcp tools, through a coding interface rather than plain language, so that it always works by using code, it must be set up to be as efficient as possible as a consequence of that, we also want it to be compatible with claude code settings etc, and it must use anthropic oauth login to get access to the claude code package (using haiku by default), we must use intelligent design to avoid complex character escaping when the llm writes or edits files or the ast tree in some way by having a write tool AND an execute tool, all the other tools must be in execute as callable functions, the documentation from loaded mcp tools must carry over into the system instructions for the code execution, so that potential tool call functions are listed in its description, we must test it continuously via npx in /tmp when theres nothing left todo according to this instruction or our policies output <promise>nothinglefttodo</promise>
