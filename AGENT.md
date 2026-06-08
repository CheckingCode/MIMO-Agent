# MiMo Agent Instructions

## Release Hygiene

- When shipping user-visible features, fixes, MCP tools, settings changes, or packaging changes, update the extension version without waiting for a reminder.
- For every release bump, update `package.json`, `package-lock.json`, `README.md`, and `CHANGELOG.md` together.
- Use semantic versioning: patch for fixes, minor for new user-visible capabilities, major only for breaking changes.
- Before packaging a release, run `npm run compile`, then `npm run package`.
- After packaging, place or confirm the generated VSIX under `releases/` with the matching version number.

## Repository Tidiness

- Keep root-level project files focused on source, package metadata, build config, and top-level docs.
- Move analysis, audit, comparison, re-evaluation, and one-off report Markdown files into `docs/reports/`.
- Do not move required runtime/package files such as `package.json`, `package-lock.json`, `tsconfig.json`, `.vscodeignore`, `assets/`, `src/`, `out/`, `skills/`, or `releases/`.
