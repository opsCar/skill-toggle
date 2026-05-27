# Flow: inventory-discovery

## Goal
Build an inventory view that reads local Claude Code and Codex items across skills, MCP configuration, hooks, and rules.

## User Outcome
The user can open the app, filter by category/tool, inspect each discovered item, and open detail content when a description, README, or skill metadata exists.

## Modules
- `app-shell`
- `async-cli-reference`

## Evidence
- The task request names Claude Code and Codex as discovery sources.
- The root package is the intended frontend app location.

## Risks
- Some configured paths may not exist on every machine.
- Browser code cannot access arbitrary home-directory files without a backend/API layer.
