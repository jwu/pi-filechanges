# 1.0.0 (2026-05-06)


### Bug Fixes

* 修正仓库 URL (johnnywu → jwu) ([1d0d542](https://github.com/jwu/pi-filechanges/commit/1d0d542deff125b31fe89554d479203c9bf00ff6))


### Features

* initial commit — pi-filechanges extension ([48989b2](https://github.com/jwu/pi-filechanges/commit/48989b24544b4618176583b1ec06ae771ffd2ab2))

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
