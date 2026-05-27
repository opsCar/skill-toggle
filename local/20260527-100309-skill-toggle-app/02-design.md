# Design: Claude and Codex Skill Toggle Dashboard

## Architecture
- A Vite React app renders the dashboard. Tailwind provides layout and visual styling, with local shadcn-style primitives in `src/components/ui`.
- A local Express server exposes `/api/items`, `/api/items/:id`, and `/api/items/:id/toggle`. The browser never reads the filesystem directly.
- Shared scan/toggle logic lives in `server/registry.ts` so API behavior and unit tests use the same implementation.

## Discovery Model
- Skills are directories containing `SKILL.md` under project `.claude/skills`, project `.codex/skills`, home `~/.claude/skills`, and home `~/.codex/skills`.
- MCP servers are parsed from Claude JSON settings and Codex TOML config when those files exist.
- Hooks are parsed from Claude settings JSON and any Codex hook-like config keys if present.
- Rules are Markdown rule/config documents such as `CLAUDE.md`, `AGENTS.md`, and command/rule Markdown files under `.claude` and `.codex`.
- Disabled file-backed entries are discovered from `~/.claude_bak` and `~/.codex_bak` and retain the original target path from the backup layout.

## Toggle Model
- File-backed items can be toggled.
- Disable moves the original file or directory to the provider backup root while preserving `home/...` or `project/...` scope in the relative backup path.
- Enable moves the backup path back to its original target path and recreates missing parent directories.
- Config subentries such as individual MCP servers and hooks are listed and inspectable, but not toggled unless they map to a whole backing file. This avoids lossy partial TOML/JSON rewrites.

## UI
- The first screen is the operational dashboard, not a landing page.
- A category sidebar filters skills, MCP, hooks, and rules.
- The main table shows name, provider, scope, status, source path, and a toggle.
- The detail panel shows description, source metadata, and readable detail content.

## Verification
- Unit tests cover scanning, metadata extraction, and backup/restore moves with temporary home/project directories.
- `npm run build` verifies the React + Tailwind app and TypeScript compile path.
