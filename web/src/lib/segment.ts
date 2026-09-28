// ABOUTME: Cuts the plain text of a document into the targets of semantic rules: sentences, passages, and sections.
// ABOUTME: Each target keeps exact offsets and some context, and has a snapshot id of all that Jev sees.

import { hash64 } from './hash'
import { splitSentences, type TextBlock } from './lint'
import { ruleVersion, type SemanticRule, type SemanticScope } from './semantic'

/** Limits that keep each request small. */
export const PASSAGE_MAX_BLOCKS = 3
export const PASSAGE_MAX_CHARS = 1500
export const SECTION_MAX_CHARS = 8000
const CONTEXT_MAX_CHARS = 600

type Span = { from: number; to: number }

/** A part of the document that Jev checks, with its offsets in the plain text. */
export interface Target {
  scope: SemanticScope
  /** One range for a sentence; one range for each paragraph of a passage or section. */
  ranges: Span[]
  text: string
  context: string
}

function clip(text: string, fromEnd: boolean): string {
  if (text.length <= CONTEXT_MAX_CHARS) return text
  return fromEnd ? '…' + text.slice(-CONTEXT_MAX_CHARS) : text.slice(0, CONTEXT_MAX_CHARS) + '…'
}

function contextFor(before: string, after: string): string {
  const parts: string[] = []
  if (before.trim()) parts.push(`[before] ${clip(before.trim(), true)}`)
  if (after.trim()) parts.push(`[after] ${clip(after.trim(), false)}`)
  return parts.join('\n')
}

const blockText = (text: string, b: TextBlock) => text.slice(b.from, b.to)

/** Sentence targets in all prose blocks. */
export function sentenceTargets(text: string, blocks: readonly TextBlock[]): Target[] {
  const flat: (Span & { text: string })[] = []
  for (const b of blocks) {
    if (b.kind !== 'prose') continue
    const body = blockText(text, b)
    for (const s of splitSentences(body)) flat.push({ from: b.from + s.start, to: b.from + s.end, text: body.slice(s.start, s.end) })
  }
  return flat.map((s, i) => ({
    scope: 'sentence',
    ranges: [{ from: s.from, to: s.to }],
    text: s.text,
    context: contextFor(flat[i - 1]?.text ?? '', flat[i + 1]?.text ?? ''),
  }))
}

/** Runs of prose blocks with text. An empty paragraph does not end a run; a heading or code block does. */
function proseRuns(text: string, blocks: readonly TextBlock[]): number[][] {
  const runs: number[][] = []
  let run: number[] = []
  blocks.forEach((b, i) => {
    if (b.kind === 'prose') {
      if (blockText(text, b).trim()) run.push(i)
      return
    }
    if (run.length) runs.push(run)
    run = []
  })
  if (run.length) runs.push(run)
  return runs
}

/**
 * Passage targets: short windows of paragraphs. Paragraphs are joined with a blank line,
 * so that a pattern over several short paragraphs stays visible.
 */
export function passageTargets(text: string, blocks: readonly TextBlock[]): Target[] {
  const out: Target[] = []
  for (const run of proseRuns(text, blocks)) {
    let chunk: number[] = []
    let size = 0
    const flush = () => {
      if (!chunk.length) return
      const first = chunk[0]
      const last = chunk[chunk.length - 1]
      out.push({
        scope: 'passage',
        ranges: chunk.map((i) => ({ from: blocks[i].from, to: blocks[i].to })),
        text: chunk.map((i) => blockText(text, blocks[i]).trim()).join('\n\n'),
        context: contextFor(first > 0 ? blockText(text, blocks[first - 1]) : '', last + 1 < blocks.length ? blockText(text, blocks[last + 1]) : ''),
      })
      chunk = []
      size = 0
    }
    for (const i of run) {
      const length = blocks[i].to - blocks[i].from
      if (chunk.length && (chunk.length >= PASSAGE_MAX_BLOCKS || size + length > PASSAGE_MAX_CHARS)) flush()
      chunk.push(i)
      size += length
    }
    flush()
  }
  return out
}

/** Section targets: the prose under each heading, for rules about the whole section, such as repetition. */
export function sectionTargets(text: string, blocks: readonly TextBlock[]): Target[] {
  const out: Target[] = []
  let heading = ''
  let chunk: number[] = []
  let size = 0
  const flush = () => {
    if (chunk.length >= 2) {
      out.push({
        scope: 'section',
        ranges: chunk.map((i) => ({ from: blocks[i].from, to: blocks[i].to })),
        text: chunk.map((i) => blockText(text, blocks[i]).trim()).join('\n\n'),
        context: heading ? `[section heading] ${heading}` : '',
      })
    }
    chunk = []
    size = 0
  }
  blocks.forEach((b, i) => {
    if (b.kind === 'heading') {
      flush()
      heading = blockText(text, b).trim()
      return
    }
    if (b.kind !== 'prose' || !blockText(text, b).trim()) return
    if (size + (b.to - b.from) > SECTION_MAX_CHARS) flush()
    chunk.push(i)
    size += b.to - b.from
  })
  flush()
  return out
}

export function targetsFor(text: string, blocks: readonly TextBlock[], scope: SemanticScope): Target[] {
  switch (scope) {
    case 'sentence': return sentenceTargets(text, blocks)
    case 'passage': return passageTargets(text, blocks)
    case 'section': return sectionTargets(text, blocks)
  }
}

/**
 * The identity of all that can change an answer: the target, its context, the versions of the rules
 * that are asked about it, and the model. A result shows only while a current target has the same snapshot.
 */
export function snapshotId(target: Pick<Target, 'scope' | 'text' | 'context'>, rules: readonly SemanticRule[], model: string): string {
  const versions = rules.map((r) => `${r.id}@${ruleVersion(r)}`).sort()
  return hash64(JSON.stringify([target.scope, target.text, target.context, versions, model]))
}
