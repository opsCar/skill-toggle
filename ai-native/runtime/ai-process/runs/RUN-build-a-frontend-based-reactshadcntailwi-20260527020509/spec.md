# Spec

## objective
Create a local React + shadcn + Tailwind app that inventories and toggles Claude Code and Codex skills, MCP entries, hooks, and rules.

## scope
- Frontend: filterable inventory list, category/tool filters, selected item detail, and enable/disable switch.
- Backend: Express endpoints for inventory, item detail, and toggle operations.
- Discovery: Claude Code and Codex home/project locations, including skills, rules, hook files, MCP directories, JSON settings, and Codex TOML config.
- Persistence: path-backed items move to backup payload directories; config entries move into JSON backup records and restore into the original config.

## constraints
- Use React, shadcn-style UI components, and Tailwind.
- Keep privileged filesystem access on the server side.
- Avoid mutating unrelated parent repository files.

## implementation_outline
- Add Vite/React/Tailwind project configuration.
- Add shadcn-style button, switch, and scroll area primitives.
- Add server-side inventory and toggle logic.
- Add tests for skill listing/detail, path backup/restore, and MCP config entry backup/restore.

## verification_plan
- `npm test`
- `npm run build`
- Start the server and fetch `/api/inventory` for a runtime smoke check.
