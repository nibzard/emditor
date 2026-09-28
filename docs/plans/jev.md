# Plan: semantic writing rules with TypeSafe Jev

Status: proposal. Nothing in this plan is built yet.

## Goal

Add rules that code cannot check, for example "Avoid LinkedIn voice" or "Do not explain it twice".
Jev (TypeSafe) answers one yes/no question for each rule about a sentence, a passage, or a section.
emditor shows a finding when the probability is at or above the threshold of the rule.

The exact rules (phrases, repeated words, long sentences) do not change. They stay local and immediate.

## Principles

1. **Opt-in.** Jev is off without `TYPESAFE_API_KEY`. Each semantic rule is also off until the writer turns it on, because each check sends text out and costs money.
2. **No fake classifier.** jevditor has a demo classifier for work without a key. emditor does not get one. Without a key, semantic rules are off and the dialog says so.
3. **The key stays on the server.** The browser sends targets to emditor. emditor sends them to Jev.
4. **Correct or nothing.** A result shows only for text that is the same as the text that Jev checked. A failed check shows "checking unavailable", never "no issues".
5. **Decorations only.** Semantic findings never go into the Markdown file, as with the exact findings.
6. **No text in logs.** The server logs the status and the reason of a failure, never the document text.

## The Jev API (from `@typesafe-ai/sdk` 0.6.0, as jevditor uses it)

- `POST {TYPESAFE_BASE_URL}/v1/systemone`. The default base URL is `https://api.typesafe.ai`.
- Headers: `Authorization: Bearer <key>` and `Content-Type: application/json`.
- Body: `{ "model": "<pinned model>", "state": {...}, "questions": { "<name>": { "type": "noul", "instructions": ..., "criteria": { "true": "...", "false": "..." } } } }`.
- A `choice` question has `"type": "choice"` and `criteria` as a map from label to description.
- Answer: `answers.<name>.noul` is a probability from 0 to 1. `answers.<name>.choice` is a label, with `confidence`. The reply also has `model` and `usage.input_tokens`.
- `429` and `Retry-After` are possible. jevditor keeps below 1,000 requests each minute and uses a timeout of 1.5 s.

Rust has no TypeSafe SDK, so emditor calls this HTTP API with `reqwest`, as it does for rewrites.
**Check before step 3:** make sure that the API shape, the current model name, and the rate limits are the same today.
jevditor pins `jev-1.13.0`. Thresholds are only correct for the model that they were tuned against.

## Design

### Rules file

`.emditor/rules.json` gets a `semantic` list. Each entry holds:

- `id`, `enabled`, `sensitivity` (`gentle`, `normal`, `strict`)
- the definition: `name`, `scope` (`sentence`, `passage`, `section`), `question`, `flagWhen`, `allowWhen`, `boundaryCases`, `examples` (`{ text, flag }`), `explanation`, `threshold`

The **version** of a rule is a hash of its definition. It is not a counter.
A change to the definition gives a new hash, so old results and cache entries do not match.
`enabled` and `sensitivity` are not part of the hash, because they only change what shows.
Sensitivity moves the threshold: gentle +0.07, strict −0.15, limited to 0.5–0.99 (as in jevditor).

The four jevditor presets come in with `enabled: false`:
Avoid LinkedIn voice (passage), Not marketing copy (sentence), Concrete over vague (sentence), Do not explain it twice (section).

"Keep this" uses the `kept` list that exists now. "Allow writing like this" adds an allow example to the rule, so the rule gets a new version.

### Targets (web, `web/src/lib/segment.ts`)

Port `segment.ts` from jevditor. It makes sentence, passage, and section targets from the blocks of `docText`, with context before and after.
Each target keeps its ranges as offsets in the plain text, so the marks go on the correct text also when a sentence occurs two times.

The **snapshot** of a target is a hash of: target text, context, scope, rule versions, and model.

### Server (`src/jev.rs`, routes in `src/lib.rs`)

- `GET /api/jev` gives `{ available, model }`.
- `POST /api/jev/check` takes `{ targets: [{ id, scope, text, context }], rules: [definition...] }`, with at most 24 targets and a body of at most 256 KB.
  It sends one `systemone` request for each target, with one `noul` question for each rule of that scope (`r0`, `r1`, ...).
  It gives `{ results: [{ id, status: "ok", probabilities: [...] } | { id, status: "unavailable" }] }`.
- Questions are built as in jevditor `buildQuestions`: the rule, the question, the boundary cases, and the examples in the instructions, and the instruction to treat the document text as data.
- An in-memory LRU cache (for example 5,000 entries), keyed by the hash of model, rule definition, target text, and context. It is not written to disk.
- At most 8 requests at the same time (a semaphore), a timeout of 1.5 s, and no retries in the server. The editor asks again later.
- The server checks each answer: a `noul` value must be a number from 0 to 1, or that target is "unavailable".

The browser applies the threshold and the sensitivity, because they change without a new request.

### Scheduler (web, `web/src/lib/semanticScheduler.ts`)

Port `controller.ts` from jevditor as a class with injected timers, so that tests can drive it with fake time:

- Wait 500 ms after the last edit for sentence and passage rules, and 4 s for section rules.
- Send only the targets whose snapshot has no result yet. Group them into requests of at most 24 targets.
- Cancel requests that are no longer needed. Show a result only when a current target has the same snapshot.
- Keep results by snapshot (at most about 3,000) and remove the oldest first.
- A target that is "unavailable" waits 10 s before it is sent again.
- Do not check while an IME composition is active.

### Editor and UI

- `lintPlugin.ts` shows exact and semantic findings together. A sentence finding marks the sentence. A passage or section finding marks each of its paragraphs with a block style and has a marker at the start.
- The finding card shows the explanation of the rule and gives **Keep this**, **Allow writing like this**, **Rewrite**, and **Rules…**. Rewrites use the rewrite path that exists now, with the rule explanation as the rule.
- The pane header shows a small status: checking, or checking unavailable.
- The rules dialog gets a "Semantic rules" section: turn each rule on or off, set its sensitivity, and edit the definition.
  Without `TYPESAFE_API_KEY` this section says that semantic rules are off, and why.
- Semantic rules work in formatted (rich) mode first. See "Later".

## Steps (one commit each, tests first)

1. **Rule model.** Semantic rules in `lint.ts`: types, parse and write, definition hash, threshold with sensitivity, presets. Vitest tests.
2. **Targets.** `segment.ts` port with its jevditor tests adapted to `docText` blocks. Snapshot hash.
3. **Server.** `src/jev.rs`: config from `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `EMDITOR_JEV_MODEL`; question building; answer checks; cache; semaphore. `tests/api.rs` with a local stand-in for the Jev API: good answers, bad answers, a 429, a timeout, the size limits, and a cache hit.
4. **Scheduler.** `semanticScheduler.ts` with fake-time tests: delay, grouping of requests, stale results not shown, retry after "unavailable".
5. **Editor.** Semantic findings in `lintPlugin.ts`, block marks, the finding card actions, the pane status. Plugin tests like `lintPlugin.test.ts`.
6. **Rules dialog.** The semantic section and "Allow writing like this".
7. **Docs and a real check.** README and CLAUDE.md. A manual check with a real key: the time from a pause to a mark, and the number of requests for a long document.

About 2–3 working sessions for steps 1–6, and one short session with a real key for step 7.

## Later (not in this plan)

- Semantic rules in source mode. The Markdown syntax changes the text, so source mode and rich mode would not share cache entries.
- Phrase narrowing (a `choice` question that picks the part of a sentence) and pattern explanations.
- Rule drafting with a generative model, the playground, and precision/recall evaluation.
- The "same point" check on rewrites.

## Decisions for Nikolodeon

1. Is there a TypeSafe key and a monthly budget? Each pause in typing can send up to 24 targets. A long document with passage and section rules turned on sends many requests.
2. Presets off by default (this plan), or on when a key is set?
3. Is rich mode first acceptable, with source mode later?
