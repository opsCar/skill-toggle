# Learn

## what_changed
The project now has a local app pattern for pairing React UI with a privileged Node API for tool configuration management.

## reusable_rules
- Do not access home-directory tool config directly from browser code.
- Backup config-entry values before removing them from active JSON/TOML config.
- Keep path-backed restore operations collision-safe.

## index_updates_needed
- Keep `app-shell` module current as the app grows.
