# pi-filechanges

Tracks files changed by [pi](https://github.com/badlogic/pi-mono) via the built-in `edit` and `write` tools. Persistent log, diff inspection, and accept/decline support.

Highly inspired by [amosblomqvist/pi-config/extensions/filechanges](https://github.com/amosblomqvist/pi-config/tree/main/extensions/filechanges).

## Install

```bash
pi install npm:pi-filechanges
```

## Commands

| Command | Effect |
|---------|--------|
| `/filechanges` | Inspect diffs for all tracked files |
| `/filechanges-accept` | Accept all changes (keep files, clear log) |
| `/filechanges-accept force` | Accept without interactive confirmation |
| `/filechanges-decline` | Decline all changes (revert files, clear log) |
| `/filechanges-decline force` | Decline without interactive confirmation |

## Development

```bash
# Run tests
bun test

# Release (local, requires GH_TOKEN and NPM_TOKEN)
bun run release
```

This project uses [semantic-release](https://semantic-release.gitbook.io) with [conventional commits](https://www.conventionalcommits.org/).

## License

MIT
