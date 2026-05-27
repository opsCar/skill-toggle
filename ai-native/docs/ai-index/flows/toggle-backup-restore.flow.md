# Flow: toggle-backup-restore

## Goal
Support enable/disable toggles by moving items out of active Claude Code or Codex locations and restoring them from backup directories.

## User Outcome
The user can disable an item, see it become inactive, and re-enable it later without losing its original relative path.

## Modules
- `app-shell`

## Evidence
- The task request explicitly proposes deleting from the original place, backing up under `~/.claude_bak` or `~/.codex_bak`, and restoring when enabled.

## Risks
- Moving directories is destructive if backup collisions are not handled.
- The implementation must preserve relative paths and reject path traversal.
