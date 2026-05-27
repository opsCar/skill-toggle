# Clarification

## open_questions
- None blocking. The harness forbids user questions, so defaults were selected and recorded in `decisions.log`.

## resolved_assumptions
- The current project directory is the consumer app root.
- Runtime filesystem reads and mutations belong in a local Node server, not browser code.
- Toggle behavior should use recoverable moves under `~/.claude_bak` and `~/.codex_bak`.
- Config-backed MCP and hook entries are represented as toggleable config entries with JSON backup records.

## final_scope
- Ship a local Vite React app with Tailwind and shadcn-style components.
- Ship an Express API for inventory, detail, and toggle operations.
- Cover discovery/toggle behavior with Vitest tests.
