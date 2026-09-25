# emditor

I am **Grave Digger Tamagotchi**. My human is **Nikolodeon**.

A local Markdown desk: a Rust binary (axum) that embeds a React app (web/dist, via rust-embed) and serves one folder.

## Layouts

- `src/lib.rs` — router, file API (`/api/files`, `/api/file`, `/files/*`), notes API (`/api/notes`, sidecar files in `.emditor/notes/<path>.json`), rules API (`/api/rules`, `.emditor/rules.json` for the folder), rewrite API (`/api/rewrite`), local-only guard. `src/rewrite.rs` — rewrite call to the Anthropic Messages API or the OpenAI Responses API; on only with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. `src/main.rs` — CLI.
- `tests/api.rs` — API integration tests against a temp folder; rewrite tests use local stand-ins for the provider APIs.
- `web/src/lib/` — pure logic with Vitest tests: `desk.ts` (sort/stack), `workspace.ts` (pane reducer, shelf), `layouts.ts`, `scrollSync.ts`, `text.ts`, `annotations.ts` (text-quote anchors, notes file, rewrite diffs, margin layout), `proseText.ts` (plain text and blocks of a ProseMirror doc), `lint.ts` (writing rules: exact checks, Markdown blocks, kept occurrences, rules file).
- `web/src/hooks/documentStore.ts` — folder-scoped document data, per-path draft and save status, retry/conflict recovery, local draft backup. `hooks/notesStore.ts` — notes per document, delayed saves, merge after conflict. `hooks/rulesStore.ts` — folder rules; replays its changes after a conflict. `useDocument.tsx` exposes the stores and rewrite availability through context to panes.
- `web/src/components/` — UI. Rich mode is Milkdown (CommonMark + GFM only); source mode is CodeMirror 6. Both load lazily. Lint marks are decorations only: `lintPlugin.ts` (rich) and `sourceLint.ts` (source).

## Rules

- Build the web app before `cargo build --release`; the release binary embeds `web/dist`. `make build` does both.
- `npm run dev` at the repository root runs the Rust API and Vite together; pass a folder after `--` to serve it. The launcher stops both on Ctrl+C.
- Keep logic in `web/src/lib` as pure functions with tests; components stay thin.
- Desk, workspace, and draft backups live in localStorage, keyed by the absolute folder path (all folders share one origin).
- Global shortcuts use `KeyboardEvent.code` (⌥ changes `key` on macOS) and a capture-phase listener so editors do not take them.
