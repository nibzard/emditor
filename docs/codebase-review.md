Codebase review — 2026-09-25, commit `ef367f4`

Read all first-party application code, tests, styles, CLI and development tooling, configuration, project documentation, and the HTML design prototype. Generated bundles and third-party dependencies were not reviewed exhaustively; the installed Milkdown listener implementation was inspected to verify its behavior. Production code was not changed.

The main risks are lost edits and unsafe file replacement. There are no apparent production mock backends or abandoned application modules. Most removable leftovers are CSS and unused component options.

P1 means a security or significant data-loss risk to address first. P2 means a functional or recovery bug.

1. **P1 — Saving can follow a temporary-file symlink outside the served folder.** [src/lib.rs:468](src/lib.rs#L468)

   `write_atomic` opens a predictable `.<name>.emditor-tmp` path without exclusive creation or checking whether it is a symlink. The normal document path validation does not cover this temporary path. Reproduction: inside a disposable served folder, point `.guard.md.emditor-tmp` at a dummy file outside that folder, then save `guard.md`. The request returned 200, overwrote the outside file, and replaced the document with the symlink. Both Markdown and notes use this helper.

   Fix: create a unique temporary file exclusively in the destination directory, retain its file handle through the write, and rename that file into place. Never follow or reuse an existing temporary pathname.

2. **P1 — Concurrent saves bypass conflict protection and interfere with each other's writes.** [src/lib.rs:179](src/lib.rs#L179), [src/lib.rs:259](src/lib.rs#L259)

   Checking `baseModified` and replacing the file are separate operations, and every writer shares the same temporary filename. Sixteen simultaneous Markdown saves with the same base produced **2 successful writes, 11 unexpected 404s, and 3 conflicts**. The same notes experiment also produced multiple successes and unexpected errors. One request can rename another request's temporary content. Serializing writes in one browser's store does not protect against another tab or API client.

   Fix: serialize the revision check and replacement per canonical document/sidecar path, use unique temporary files, and use a revision token stronger than millisecond modification time. Read content and metadata from the same opened file so they describe one version.

3. **P1 — Switching editor modes quickly loses the most recent rich-text edit.** [RichEditor.tsx:249](web/src/components/RichEditor.tsx#L249), [RichEditor.tsx:281](web/src/components/RichEditor.tsx#L281)

   The only rich-text publication path is Milkdown's `markdownUpdated` listener. The installed listener debounces for 200 ms and cancels that callback when the editor is destroyed. Typing a marker and immediately pressing ⌘/ reproduced a source editor without the marker. The document store and local draft backup never received it. Closing/replacing a pane exposes the same lifetime problem.

   Fix: publish draft changes independently of the delayed save, or provide a synchronous flush before editor teardown, mode changes, explicit saves, and unload. Add an actual editor lifecycle regression test; store-only tests cannot catch this.

4. **P1 — Notes conflict merging loses unrelated remote edits and resurrects remote deletions.** [annotations.ts:142](web/src/lib/annotations.ts#L142), [notesStore.ts:148](web/src/hooks/notesStore.ts#L148)

   `mergeNotes` treats every cached local note as authoritative, including notes that were never edited locally. Reproduction: load notes A and B; edit B locally and A through another writer; save B. A reverts to its old body. Deleting A through the other writer and then editing B locally brings A back. Both cases were reproduced against the store.

   Fix: retain a base snapshot and merge actual local changes, with explicit deletion handling. A remote edit to an untouched local note should survive; a remote deletion should not be undone by saving another note.

5. **P1 — One tab can erase another tab's unsaved draft backup.** [documentStore.ts:59](web/src/hooks/documentStore.ts#L59)

   Each store loads a private copy of the folder's draft map and replaces or removes the entire shared localStorage entry. Reproduction with two stores and shared storage: tab A edits `a.md`; tab B edits and saves `b.md`. Tab B removes the storage entry while tab A still reports an unsaved draft. A subsequent crash/reload loses A's recovery copy.

   Fix: give drafts independent storage identities and coordinate multiple tabs. Include tab identity or an explicit conflict policy when two tabs edit the same path; merely reading and rewriting the folder-wide map still permits races.

6. **P1 — Raw HTML files execute with the application's file API permissions.** [src/lib.rs:270](src/lib.rs#L270)

   `/files/*` serves arbitrary folder content with its inferred MIME type on the application origin, without a sandbox. If the folder contains untrusted HTML, navigating to it executes its scripts as emditor. A harmless HTML reproduction successfully read `draft.md` through `/api/file`. The same origin also exposes the write endpoints, so the host/origin guard does not contain this case.

   Fix: isolate document assets from the privileged app origin, sandbox active document responses, or download active file types instead of displaying them as executable pages. Preserve ordinary image rendering.

7. **P2 — Loading the disk version discards edits made while the read is pending.** [documentStore.ts:237](web/src/hooks/documentStore.ts#L237)

   `reload()` waits for the existing save chain, reads the file, and unconditionally calls `acceptDisk`. Unlike `refresh()`, it does not check whether a new edit occurred during the request. A deferred read reproduced a newly typed draft being replaced by the disk copy and `hasUnsettled()` becoming false.

   Fix: capture and check the revision, or temporarily prevent editing while the confirmed replacement is in progress. Coordinate pending save timers as part of the replacement operation.

8. **P2 — A malformed notes file is treated as a valid empty file and overwritten.** [annotations.ts:172](web/src/lib/annotations.ts#L172), [notesStore.ts:65](web/src/hooks/notesStore.ts#L65)

   Parsing errors return `[]`, and the store marks that result as successfully loaded. With a truncated notes file, adding one new note replaced the existing file with just that new note. The format's `version` is also not validated. Empty, malformed, and unsupported input currently share the same behavior.

   Fix: distinguish an absent/empty sidecar from an unreadable or unsupported one. Surface a load error and preserve the original file until an explicit recovery action.

9. **P2 — An initial notes load failure cannot recover within the session and its error is hidden.** [notesStore.ts:168](web/src/hooks/notesStore.ts#L168), [Pane.tsx:61](web/src/components/Pane.tsx#L61)

   A failed initial read leaves `loaded=false`. Refresh skips unloaded entries, subscribing again reuses the failed entry, and the retry hook calls `save`, which does not reload it. Additionally, the shelf containing the error/retry UI only renders when notes are loaded. A one-time simulated read failure followed by refresh, save, and resubscription resulted in exactly one read and a permanently unloaded store.

   Fix: make initial loads retryable and render their errors independently of `notes.loaded` and note visibility.

10. **P2 — An annotation can jump to another occurrence after its original text is deleted.** [annotations.ts:75](web/src/lib/annotations.ts#L75), [notesPlugin.ts:83](web/src/components/notesPlugin.ts#L83)

    The plugin searches again after each document change and accepts any remaining exact match, even if its context disagrees. In `The cat sat. The cat slept.`, annotating the first `cat` and deleting it attaches the annotation to the second `cat`, instead of placing it on the detached shelf. Suggested cuts can therefore move onto unrelated text.

    Fix: map anchors through editor transactions for live edits, distinguish deletion from movement, and use context-based recovery cautiously when reopening or importing an external change.

11. **P2 — Saving replaces the original file permissions.** [src/lib.rs:469](src/lib.rs#L469)

    The newly created temporary file gets default permissions and replaces the original inode. A disposable Markdown file with mode `0600` became `0644` after one successful save in this environment.

    Fix: preserve the destination's permissions when creating its replacement. Verify other file metadata that the app intends to preserve. This belongs in the atomic-write repair.

12. **P2 — Already encoded relative image URLs are encoded twice; query strings and fragments become filename text.** [text.ts:39](web/src/lib/text.ts#L39)

    `resolveAsset('notes/a.md', 'my%20image.png#fragment')` returns `/files/notes/my%2520image.png%23fragment`. That requests a different file instead of `my image.png`. The same helper is used by rich images and desk previews.

    Fix: resolve URLs with their pathname, query, and fragment kept separate, and encode each pathname component once. Add coverage for encoded spaces, Unicode, queries, and SVG fragments.

13. **P2 — The finder has no visible active-result highlight.** [Palette.tsx:39](web/src/components/Palette.tsx#L39), [styles.css:1398](web/src/styles.css#L1398)

    Arrow keys update `aria-selected` and `data-active`, but no CSS styles either state. The old `.palette-hl` element is no longer rendered. Browser inspection confirmed identical transparent backgrounds for the active and inactive rows, leaving keyboard users without a visible indication of what Enter will open.

    Fix: style the active row directly and remove the obsolete highlight selector.

14. **P2 — Stack details and the finder can open as overlapping modal dialogs.** [Desk.tsx:44](web/src/components/Desk.tsx#L44), [App.tsx:181](web/src/App.tsx#L181)

    The stack dialog is local to `Desk`, while global modal state lives in `Main`. Open stack details and press ⌘K: browser inspection found both “2 documents in stack” and “Find a document” dialogs present, each with its own focus trap and Escape listener.

    Fix: use one modal state that includes stack details, so opening one dialog replaces or closes the current dialog.

15. **P2 — Print cleanup is overridden by later highlight and cut styles.** [styles.css:2212](web/src/styles.css#L2212), [styles.css:2253](web/src/styles.css#L2253)

    The print rules remove annotation decoration, but later rules of equal specificity restore it. Under Chromium's print media, highlights retained their gradient and cuts retained `line-through` and muted text. This conflicts with the existing print cleanup's intended behavior.

    Fix: scope decorative styles to screen media, or put final print overrides after them with specificity that also covers active marks. Long source documents were also checked: the final paragraph was present in print, so source virtualization is not reported as a bug.

16. **P2 — Overlapping cuts double-count removed words.** [annotations.ts:197](web/src/lib/annotations.ts#L197)

    `wordsAfterCuts` subtracts each quote's word count independently. Cutting `one two` and `two three` from `one two three four` reports zero words remaining; accepting the union of those cuts leaves `four`.

    Fix: calculate the remaining count from the current document and the union of the actual cut ranges. This also avoids counting stale quote text.

**Simplification and unused-code opportunities**

| Opportunity | Evidence and suggested change |
| --- | --- |
| Remove obsolete styles | `.header-action`, `.qmark`, `.palette-hl`, and `.palette-create` have no current producers. `.card[data-drop='stack']` cannot match the current `DropZone = 'before' \| 'after'`. See [styles.css:184](web/src/styles.css#L184), [styles.css:1267](web/src/styles.css#L1267). |
| Trim `Segmented` | Its only consumer is desk sorting. The unused `small` prop and `.seg-sm` rules can go, `pillSpring` can be private, and the comment describing three consumers is stale. [Segmented.tsx:9](web/src/components/Segmented.tsx#L9) |
| Centralize the pane limit | The reducer uses `MAX_PANES`; `App` and `StackDetails` repeat literal `6` checks and messages. Derive those from the same value. [App.tsx:127](web/src/App.tsx#L127), [StackDetails.tsx:28](web/src/components/StackDetails.tsx#L28) |
| Remove mutable preview context | `renderPreview` sets module-global `currentDoc` for an image renderer. The parser is synchronous today, but a renderer closed over the document path would make this helper self-contained. [preview.ts:10](web/src/lib/preview.ts#L10) |
| Separate anchor calculation from hover decoration | Every note highlight/hover metadata change rebuilds the document text map and searches all notes. Cache anchor resolution until the document or quotes change; update active decoration separately. No performance benchmark was run. [notesPlugin.ts:18](web/src/components/notesPlugin.ts#L18) |
| Validate persisted state once | `readStored<T>` asserts a type without checking it; startup only validates the workspace's `panes` array before using `shelf` and other fields. Small versioned parsers for workspace/desk/preferences would remove scattered assumptions and make old storage recoverable. [useStoredState.ts:6](web/src/hooks/useStoredState.ts#L6), [App.tsx:51](web/src/App.tsx#L51) |
| Trim unused API surface | `FileEntry.size` is produced and typed but never consumed by production UI; `useDocument().save` is returned but unused; exports such as `newPane` and `pillSpring` have no external consumers. These are small cleanups, subject to any intended external API compatibility. [api.ts:4](web/src/api.ts#L4), [useDocument.tsx:63](web/src/hooks/useDocument.tsx#L63) |
| Decide whether to retain the design prototype | [plans/emditor-simplification.html](plans/emditor-simplification.html) contains sample documents and simulated creation. It is an isolated design artifact, not bundled production functionality. Archive/delete it if it no longer serves a design purpose. |

All 14 declared runtime frontend dependencies have source imports. The package lock's direct dependency declarations match the manifest. Test mocks are confined to tests; no production fake data source was found. A dependency vulnerability audit was not part of this review.

**Verification**

| Check | Result |
| --- | --- |
| `cargo test` | 18 API tests passed. |
| `cd web && npm test` | 103 tests across 12 files passed. |
| `cd web && npm run build` | Type checking and production build passed. |
| `cargo clippy --all-targets -- -D warnings` | Passed. |
| `cargo fmt --all -- --check` | Failed on existing formatting in `src/lib.rs`, `src/main.rs`, and `tests/api.rs`. |
| Additional probes | Real HTTP requests against disposable files, direct store/helper reproductions, and headless Chromium lifecycle, modal, styling, and active-content checks. |

The existing tests cover useful reducer, helper, and single-client save behavior. They do not cover the editor teardown window, multiple tabs sharing backups, concurrent API writes, or changes to different notes by different writers. Those are the highest-value regression tests to add while fixing the corresponding issues.

Recommended order: repair atomic file replacement and raw-file isolation; fix rich-editor publication and draft ownership; fix notes merging/loading and document reload races; then address UI bugs and remove the small unused-code remnants. Browser verification here used Chromium; Safari was not tested.
