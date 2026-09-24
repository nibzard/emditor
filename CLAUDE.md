# emditor

I am **Grave Digger Tamagotchi**. My human is **Nikolodeon**.

A local Markdown desk: a Rust binary (axum) that embeds a React app (web/dist, via rust-embed) and serves one folder.

## Layout

- `src/lib.rs` — router, file API (`/api/files`, `/api/file`, `/files/*`), local-only guard. `src/main.rs` — CLI.
- `tests/api.rs` — API integration tests against a temp folder.
- `web/src/lib/` — pure logic with Vitest tests: `desk.ts` (sort/stack), `workspace.ts` (pane reducer, shelf), `layouts.ts`, `scrollSync.ts`, `text.ts`.
- `web/src/components/` — UI. Rich mode is Milkdown (CommonMark + GFM only); source mode is CodeMirror 6. Both load lazily.

## Rules

- Build the web app before `cargo build --release`; the release binary embeds `web/dist`. `make build` does both.
- Keep logic in `web/src/lib` as pure functions with tests; components stay thin.
- Desk and workspace state live in localStorage, keyed by the absolute folder path (all folders share one origin).
- Global shortcuts use `KeyboardEvent.code` (⌥ changes `key` on macOS) and a capture-phase listener so editors do not take them.
