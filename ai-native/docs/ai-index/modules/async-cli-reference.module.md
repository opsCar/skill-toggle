# Module: async-cli-reference

## Purpose
Captures the existing `async-cli` checkout that ships local CLI, skill, and dashboard examples. It is reference material for local tool conventions, not the primary app surface.

## Owned Paths
- `async-cli/`

## Current Evidence
- `async-cli/README.md`
- `async-cli/file-cli/package.json`
- `async-cli/skills/mms/mms-semantic-analyzer-dashboard/package.json`

## Notes
- Several nested packages already use Vite/TypeScript and may provide useful patterns for local development commands.

## Uncertainty
- This directory appears to be an embedded checkout with its own `.git`; changes for this task should not modify it unless explicitly required.
