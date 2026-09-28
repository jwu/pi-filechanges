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

Pressing the toggle shortcut does the same as `/filechanges` without typing the command.
While the widget is hidden and there are tracked files, a one-line hint stays in its
place (`filechanges hidden · alt+f to expand`) so the collapsed state is discoverable.

## Configuration

Optional. Create `~/.pi/agent/extensions/pi-filechanges.json`:

```json
{
  "toggleKey": "alt+f"
}
```

| Setting | What it does | Default |
|---------|--------------|---------|
| `toggleKey` | Shortcut that shows/hides the changes widget, in Pi keybinding form (`alt+f`, `ctrl+shift+t`). Set `"off"` to register no shortcut. Needs `/reload` to rebind. | `"alt+f"` |

A missing or malformed file falls back to the defaults. `pi-filechanges` only
reads this file — it never writes one.

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
