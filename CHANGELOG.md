# [1.1.0](https://github.com/jwu/pi-filechanges/compare/v1.0.2...v1.1.0) (2026-05-07)


### Features

* simplify filechanges widget ([b8cd25a](https://github.com/jwu/pi-filechanges/commit/b8cd25a68621fd44dcde339081932702f776eb10))

## [1.0.2](https://github.com/jwu/pi-filechanges/compare/v1.0.1...v1.0.2) (2026-05-07)


### Bug Fixes

* always use cwd-relative path in normalizeToolPath ([4c4e2da](https://github.com/jwu/pi-filechanges/commit/4c4e2da4cfdce31364811da9e2777f0aad76bf4b))

## [1.0.1](https://github.com/jwu/pi-filechanges/compare/v1.0.0...v1.0.1) (2026-05-07)


### Bug Fixes

* add missing dev dependencies and fix TS errors ([2074159](https://github.com/jwu/pi-filechanges/commit/207415928dadbf4bdd35afd5cc50f454af2ddd3c))

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
