# Acceptance Summary

- Given Claude/Codex project and home locations exist, when the dashboard loads, then it groups discovered items into skills, MCP, hooks, and rules.
- Given an item has `SKILL.md`, `README.md`, or config text, when the user selects it, then the detail panel shows description and readable content.
- Given a file-backed active item, when the user disables it, then the API moves it from its original location into `~/.claude_bak` or `~/.codex_bak` while preserving a restorable relative path.
- Given a disabled backed-up item, when the user enables it, then the API restores it to the original path and refreshes the list.
- Given the repository is checked, when verification commands run, then tests or build provide an explicit pass/fail path.
