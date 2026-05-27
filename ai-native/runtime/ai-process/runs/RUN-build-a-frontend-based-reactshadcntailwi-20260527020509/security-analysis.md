# Security Analysis

## applicable_rules
- Local filesystem mutation must be constrained to Claude Code/Codex roots and their backup roots.
- Backup/restore operations must preserve recoverability and avoid path traversal.
- The browser must not receive privileged filesystem access directly.

## risk_paths
- `server/discovery.ts`: reads local configuration files and moves path-backed items.
- `server/index.ts`: exposes local HTTP endpoints for inventory and toggle operations.

## operational_gates
- Build must pass.
- Unit tests must cover list/detail/toggle behavior.
- Runtime smoke check must confirm `/api/inventory` returns categorized items.

## spec_constraints
- Keep file operations in the Node API.
- Use backup directories `~/.claude_bak` and `~/.codex_bak`.
- Refuse unsafe restore collisions.
