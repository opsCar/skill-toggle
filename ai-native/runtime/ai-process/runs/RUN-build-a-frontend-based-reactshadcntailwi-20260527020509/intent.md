# Intent

request_summary: Build a React, shadcn, and Tailwind local management app for Claude Code and Codex skills, MCP, hooks, and rules.

requested_outcome: A user can open the app, browse categorized Claude Code and Codex inventory, inspect item details, and enable or disable supported items through backup and restore behavior.

risk_level: medium

complexity: standard

## initial_scope

### in_scope
- Create or update a React + shadcn + Tailwind frontend.
- Add a trusted local Node API for reading Claude Code and Codex home/project locations.
- List skills, MCP entries, hooks, and rules.
- Show item detail from `SKILL.md`, README, markdown, config, or text content.
- Support enable/disable toggles by moving path-backed items and config entries into `~/.claude_bak` or `~/.codex_bak` and restoring them.
- Provide build and test verification.

### out_of_scope
- Creating a real external Jira ticket for this comparison run.
- Browser-only direct filesystem access.
- Deleting user data without a recoverable backup record.

## routing_hints

candidate_flows:
- inventory-discovery
- toggle-backup-restore

candidate_modules:
- app-shell
- async-cli-reference
