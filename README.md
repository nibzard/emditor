# emditor

A small local Markdown desk for macOS. One Rust binary starts a local server and opens the app in your browser.

- **Desk**: every Markdown file in the folder as an A4 thumbnail. Sort by recent, name, or by hand. Stack files together.
- **Workspace**: one to six panes side by side, each on an A4 sheet, in rich text or Markdown source mode.
- **Scroll lock**: scroll one pane, and all panes move by the same distance.
- Rich mode can only make what Markdown can store (CommonMark + GFM tables, task lists, strikethrough).
- Autosave, conflict detection when a file changes on disk, and print to real A4 pages.

## Use

```sh
make build                 # builds web/dist, then target/release/emditor
cd ~/notes && emditor      # serve this folder
emditor draft.md           # open one file (its folder is served)
emditor --port 5000 --no-open
```

The server listens on 127.0.0.1 only and refuses requests from other hosts, origins, and cross-site pages.

## Keys

| Keys | Action |
| --- | --- |
| ⌘K | Find or create a document |
| ⌥0 | Desk or workspace |
| ⌥1 – ⌥7 | Layout: one, two, three, 2×2, one + two, rows, 3×2 |
| ⌃H ⌃J ⌃K ⌃L | Focus pane left, down, up, right (add ⇧ to move the pane) |
| ⌥L | Scroll lock |
| ⌘/ | Rich text or Markdown source |
| ⌥W | Close pane |
| ⌘S | Save all now |
| ⌥/ or ? | All shortcuts |

On the desk: arrows move, ↵ opens (⇧↵ in a new pane), space or ⌘-click selects, G stacks, U unstacks, ⌥+arrows reorder, S changes the sort.

## Develop

```sh
cargo run -- ~/notes --no-open    # API on 127.0.0.1:4747
cd web && npm run dev             # Vite on :5173, forwards /api and /files
make test
```
