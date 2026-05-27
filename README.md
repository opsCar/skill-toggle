# Skill Toggle

Local dashboard for inspecting and toggling Claude and Codex extensions, including skills, MCP entries, hooks, rules, agents, and plugins.

Skill Toggle scans the current project and your home-directory tool config, shows what is enabled, lets you inspect item details, and can disable or restore file-backed items by moving them through provider-specific backup folders.

## Features

- Browse Claude and Codex skills, MCP entries, hooks, rules, agents, and plugins.
- Toggle supported items on or off.
- Inspect item contents and config-entry details.
- View rough context-size estimates and usage/startup probes.
- Export and import selected items as `.tar.gz` archives.

## Requirements

- Node.js 22 or newer is recommended.
- npm.

## Setup

```sh
npm install
```

## Development

Run the API server and Vite app together:

```sh
npm run dev
```

The app runs through Vite at:

```text
http://127.0.0.1:5173
```

The API server listens on:

```text
http://127.0.0.1:4127
```

Set `PORT` or `SKILL_TOGGLE_API_PORT` to change the API port.

## Production

Build the frontend and TypeScript project:

```sh
npm run build
```

Start the production server:

```sh
npm start
```

## Tests

```sh
npm test
```

## Safety Notes

Skill Toggle works on local tool configuration under paths such as `~/.claude`, `~/.codex`, project `.claude`, and project `.codex`. Disabling file-backed items moves them into backup roots such as `~/.claude_bak` and `~/.codex_bak` so they can be restored later.

Review item details before toggling anything you rely on in active Claude or Codex sessions.
