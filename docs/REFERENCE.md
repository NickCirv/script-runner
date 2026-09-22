# Command reference

Use `node index.js` from the pinned source checkout described in the [README](../README.md). The entries below describe the inspected implementation.

| Command or argument | Behavior |
| --- | --- |
| `(no arguments)` | Open interactive selection for scripts from package.json. |
| `SCRIPT [SCRIPT...]` | Execute the selected package scripts. |
| `-p, --parallel` | Run multiple selected scripts concurrently. |
| `-l, --list` | List package scripts. |
| `-h, --history` | Display run history; -h means history, not help. |
| `-s, --stats` | Display statistics from recorded runs. |

For prerequisites, file writes, external services and known limitations, see [Behavior and limits](../README.md#behavior-and-limits).

Implementation: [index.js](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/index.js); [review evidence](RESEARCH.md).
