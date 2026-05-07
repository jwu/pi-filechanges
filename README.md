# pi-filechanges

Tracks files changed by [pi](https://github.com/badlogic/pi-mono) via the built-in `edit` and `write` tools. Shows an optional changes widget with changed files and added/removed line counts.

Highly inspired by [amosblomqvist/pi-config/extensions/filechanges](https://github.com/amosblomqvist/pi-config/tree/main/extensions/filechanges).

## Install

```bash
pi install npm:@johnnywu/pi-filechanges
```

## Commands

| Command | Effect |
|---------|--------|
| `/filechanges` | Toggle the changes widget on/off (default: on) |
| `/filechanges clear` | Clear the tracked changes log without modifying files |

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
