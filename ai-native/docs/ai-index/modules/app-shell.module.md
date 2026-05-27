# Module: app-shell

## Purpose
Owns the root `skill-toggle` application package and the React frontend implementation for local skill, MCP, hook, and rule management.

## Owned Paths
- `package.json`
- `src/`
- `components.json`
- `tailwind.config.*`
- `vite.config.*`
- `ai-native/`

## Current Evidence
- `package.json` currently defines the root Node package.
- `ai-native/` contains the AI-Native process binding and runtime knowledge artifacts.

## Notes
- The app should avoid mutating external tool directories from the browser directly. Local filesystem reads and toggle operations need a trusted Node boundary.
- Disable/enable behavior is expected to move files or directories between their source location and `~/.claude_bak` / `~/.codex_bak`.

## Uncertainty
- Exact Claude Code and Codex config path conventions may vary by host installation, so discovery code should support missing directories and expose clear errors.
