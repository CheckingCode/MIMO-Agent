# MiMo Agent Project Instructions

## Decision Framework

When multiple approaches are possible, evaluate them on (in priority order):
1. **Correctness**: Does it solve the actual problem?
2. **Safety**: What's the worst case if this breaks?
3. **Speed**: How quickly can we ship a working solution?
4. **Elegance**: Is it clean, maintainable, and consistent with the codebase?

Always prefer the approach that scores highest across all dimensions.

## Coding Standards

### Before Any Change
1. Read the file you are about to modify
2. Understand the existing code structure and style
3. Plan the minimal change needed
4. Check: are there existing patterns in the codebase to follow?

### After Every Change
1. Verify syntax: Python (py_compile), JS/TS (compiler/linter)
2. Re-read the modified section to confirm correctness
3. If tests exist, run them
4. Check: did I introduce any new issues?

### File Operations
- **edit_file** for modifications (always preferred)
- **write_file** only for new files or complete rewrites
- Never modify files outside the workspace
- Verify file operations succeeded

### Codebase Respect
- Match the existing code style (indentation, naming, patterns)
- If the codebase uses a specific framework/pattern, follow it
- Don't introduce new patterns without discussing with the user
- When in doubt, grep the codebase for existing patterns

### Command Execution
- Use safe commands (read-only preferred)
- Set appropriate timeouts
- Capture and analyze output
- If it fails, diagnose and retry

### Error Recovery
- If a tool fails, analyze the error and try a different approach
- If syntax checking reveals errors, fix them immediately
- If a dependency is missing, try to install it
- If stuck after 2 attempts, ask the user for guidance

## Communication Protocol

### Style
- Use the same language as the user
- Be concise — no unnecessary explanations
- Show results, not process
- Don't declare "done" until verified

### Progressive Disclosure
- First response: overview + action plan (2-3 sentences)
- During work: progress updates every 3-5 tool calls
- Final response: summary of changes + what to watch for

### When to Escalate
- Before large changes (>20 lines): briefly explain what you're about to do
- After errors: explain what happened, what you tried, and what worked
- When stuck: say so early. "我遇到了一个限制，具体是..."
- When unsure between options: present them and ask

### Proactive Behavior
- After solving a problem, briefly mention related improvements if you noticed any
- If you notice code smell while doing unrelated work, mention it (but don't fix without asking)
- When explaining complex concepts, use analogies for clarity

## Release Hygiene

- When shipping user-visible features, fixes, MCP tools, settings changes, or packaging changes, update the extension version without waiting for a reminder.
- For every release bump, update `package.json`, `package-lock.json`, `README.md`, and `CHANGELOG.md` in the same change.
- Use semantic versioning: patch for fixes, minor for new user-visible capabilities, major only for breaking changes.
- Before packaging a release, run `npm run compile`, then `npm run package`.
- After packaging, place or confirm the generated VSIX under `releases/` with the matching version number.
- Keep root-level project files tidy. Put analysis, audit, comparison, and one-off report Markdown files under `docs/reports/` instead of leaving them in the repository root.
