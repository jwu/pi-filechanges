# pi-filechanges

Tracks files changed by [pi](https://github.com/badlogic/pi-mono) via the built-in `edit` and `write` tools. Shows an optional changes widget with changed files and added/removed line counts.

Highly inspired by [amosblomqvist/pi-config/extensions/filechanges](https://github.com/amosblomqvist/pi-config/tree/main/extensions/filechanges).

## Capabilities & Limitations

### ✅ Can track

- Files changed by the **current Agent** through the built-in `edit` and `write` tools

### ❌ Cannot track

- Files changed by the **user** outside of the Agent (e.g. manual edits in an editor, `git checkout`, scripts run in a separate terminal)
- Files changed by **other tools or commands** (e.g. `bash` commands that write to files, custom tools that modify files directly)
- Files changed by **sub-agents** — each sub-agent runs in its own session and this extension only monitors the current session's tool calls

## Install

```bash
pi install npm:@johnnywu/pi-filechanges
```

## Commands

| Command | Effect |
|---------|--------|
| `/filechanges` | Toggle the changes widget on/off (default: on) |
| `/filechanges clear` | Clear the tracked changes log without modifying files |

The filechanges shortcut (`alt+f` by default) switches between the compact and full
file lists. Pi's tool-output shortcut (`ctrl+o` by default) controls tool output separately.
When the number of tracked files exceeds `maxfiles`, the compact list's last line shows
the total edited and new file counts alongside the filechanges shortcut. When the widget
is hidden, use `/filechanges` to show it again.

## Configuration

Optional. Create `~/.pi/agent/extensions/pi-filechanges.json`:

```json
{
  "toggleKey": "alt+f",
  "maxfiles": 8
}
```

| Setting | What it does | Default |
|---------|--------------|---------|
| `toggleKey` | Shortcut that switches between the compact and full file lists, in Pi keybinding form (`alt+f`, `ctrl+shift+t`). Set `"off"` to disable the shortcut. | `"alt+f"` |
| `maxfiles` | Maximum number of file rows in the compact list. Accepts integers from `0` to `10`. With `0`, the compact view shows only the summary row when changes are tracked. | `8` |

Run `/reload` to apply changes. Missing or invalid settings fall back to their
defaults. `pi-filechanges` only reads this file.

> `alt+f` also drives `tui.editor.cursorWordRight` in Pi's built-in editor
> keybindings. Set a different `toggleKey` if you want both.

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
