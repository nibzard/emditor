# emditor

I am **Grave Digger Tamagotchi**. My human is **Nikolodeon**.

A local Markdown desk: a Rust binary (axum) that embeds a React app (web/dist, via rust-embed) and serves one folder.

## Layouts

- `src/lib.rs` — router, file API (`/api/files`, `/api/file`, `/files/*`), notes API (`/api/notes`, sidecar files in `.emditor/notes/<path>.json`), local-only guard. `src/main.rs` — CLI.
- `tests/api.rs` — API integration tests against a temp folder.
- `web/src/lib/` — pure logic with Vitest tests: `desk.ts` (sort/stack), `workspace.ts` (pane reducer, shelf), `layouts.ts`, `scrollSync.ts`, `text.ts`, `annotations.ts` (text-quote anchors, notes file, margin layout), `proseText.ts` (plain text of a ProseMirror doc for anchors).
- `web/src/hooks/documentStore.ts` — folder-scoped document data, per-path draft and save status, retry/conflict recovery, local draft backup. `hooks/notesStore.ts` — notes per document, delayed saves, merge after conflict. `useDocument.tsx` exposes both stores through context to panes.
- `web/src/components/` — UI. Rich mode is Milkdown (CommonMark + GFM only); source mode is CodeMirror 6. Both load lazily.

## Rules

- Build the web app before `cargo build --release`; the release binary embeds `web/dist`. `make build` does both.
- `npm run dev` at the repository root runs the Rust API and Vite together; pass a folder after `--` to serve it. The launcher stops both on Ctrl+C.
- Keep logic in `web/src/lib` as pure functions with tests; components stay thin.
- Desk, workspace, and draft backups live in localStorage, keyed by the absolute folder path (all folders share one origin).
- Global shortcuts use `KeyboardEvent.code` (⌥ changes `key` on macOS) and a capture-phase listener so editors do not take them.
