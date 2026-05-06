# Changelog

## [1.0.0] - 2026-05-06

### Added
- Track files changed by pi via `edit` and `write` tools
- Persistent session log with baseline snapshots
- Status line and widget showing changed files
- `/filechanges` command to inspect diffs interactively
- `/filechanges-accept` command to accept changes and clear log
- `/filechanges-decline` command to revert changes and restore originals
- Non-interactive mode support with `force` flag for accept/decline
