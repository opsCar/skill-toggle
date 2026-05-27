# Requirement: Claude and Codex Skill Toggle Dashboard

## Why
Developers using Claude Code and Codex often accumulate skills, MCP server definitions, hooks, and rules across project-level and user-level configuration directories. It is hard to see what is active, inspect the source material behind an item, or temporarily disable something without losing track of how to restore it.

This work provides a local dashboard for auditing and toggling those AI-assistant extensions while preserving disabled items in predictable backup locations.

## What
As a developer using Claude Code and Codex, I want a React dashboard that lists skills, MCP servers, hooks, and rules from both tools, so that I can understand the active configuration surface from one place.

As a developer, I want to select an item and read its description, README, or relevant source content, so that I can decide whether it should stay enabled.

As a developer, I want to toggle an item off and back on with backup/restore behavior, so that I can temporarily remove skills, MCP entries, hooks, or rule files without manually moving files.

## In Scope
- Create a React + Tailwind + shadcn-style frontend for browsing categorized Claude Code and Codex items.
- Add a local Node API that scans project and home Claude/Codex locations for skills, MCP config, hook config, and rule documents.
- Show details for selected items, including extracted skill descriptions and README/SKILL.md content when available.
- Provide enable/disable actions that move file-backed entries to `~/.claude_bak` or `~/.codex_bak` and restore them to their original paths.
- Provide command-line verification via tests and build.

## Out of Scope
- Cloud-hosted deployment or remote multi-user access.
- Editing skill contents, MCP JSON/TOML values, hook definitions, or rule text inline.
- Supporting arbitrary assistant tools beyond Claude Code and Codex.
- Automatically resolving conflicting duplicate skills across sources.

## User Constraints
- Disabled Claude-backed items must be backed up under `~/.claude_bak`.
- Disabled Codex-backed items must be backed up under `~/.codex_bak`.
