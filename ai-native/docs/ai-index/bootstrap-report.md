# Knowledge Bootstrap Report

Generated: 2026-05-27T02:02:33Z

## Scope
Full repository scope for `/Users/petershi/SideProject/skill-toggle`, limited to this project directory and excluding unrelated parent repository siblings.

## Signals Reviewed
- Root `package.json`
- `ai-native/` process binding and starter artifacts
- Embedded `async-cli/` checkout and nested package manifests
- Existing empty `local/20260527-100309-skill-toggle-app` planning files

## Modules Created
- `app-shell`: root application and AI-Native process artifacts
- `async-cli-reference`: embedded CLI/reference checkout

## Flows Created
- `inventory-discovery`: list local Claude Code and Codex skills, MCP, hooks, and rules
- `toggle-backup-restore`: disable/enable items through backup and restore moves

## Uncertainty
- Exact host-specific config locations must be handled defensively at runtime.
- The embedded `async-cli` checkout appears independent and should remain untouched for this task.

## Validation
Run:
- `AI_NATIVE_REPO_ROOT=/Users/petershi/SideProject/skill-toggle/ai-native python3 /Users/petershi/.cursor/skills/ai-process-core/scripts/ai_index/validate_manifest.py`
- `AI_NATIVE_REPO_ROOT=/Users/petershi/SideProject/skill-toggle/ai-native python3 /Users/petershi/.cursor/skills/ai-process-core/scripts/ai_index/refresh_semantic_index.py --check`
