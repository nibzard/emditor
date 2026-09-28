// ABOUTME: Tests for the targets of semantic rules: sentences, passages, and sections with exact offsets and context.
// ABOUTME: Also the snapshot, which changes when anything that Jev sees changes.

import { describe, expect, it } from 'vitest'
import type { TextBlock } from './lint'
import { passageTargets, sectionTargets, sentenceTargets, snapshotId, targetsFor } from './segment'
import { SEMANTIC_PRESETS } from './semantic'

/** Joins blocks the way docText does: one new line between blocks. */
function doc(parts: [TextBlock['kind'], string][]) {
  let text = ''
  const blocks: TextBlock[] = []
  parts.forEach(([kind, part], i) => {
    if (i > 0) text += '\n'
    blocks.push({ kind, from: text.length, to: text.length + part.length })
    text += part
  })
  return { text, blocks }
}

const sample = doc([
  ['heading', 'Monday'],
  ['prose', 'I missed my train this morning.'],
  ['prose', 'It taught me more about leadership than ten years in management.'],
  ['prose', ''],
  ['prose', 'Here are five lessons every founder needs to hear.'],
  ['heading', 'Tuesday'],
  ['prose', 'Nothing happened.'],
])

const cut = (text: string, ranges: { from: number; to: number }[]) => ranges.map((r) => text.slice(r.from, r.to))

describe('sentenceTargets', () => {
  it('gives each sentence of the prose with its offsets and the sentences around it', () => {
    const t = sentenceTargets(sample.text, sample.blocks)
    expect(t.map((x) => x.text)).toEqual([
      'I missed my train this morning.',
      'It taught me more about leadership than ten years in management.',
      'Here are five lessons every founder needs to hear.',
      'Nothing happened.',
    ])
    expect(cut(sample.text, t[1].ranges)).toEqual([t[1].text])
    expect(t[1].context).toContain('[before] I missed my train')
    expect(t[1].context).toContain('[after] Here are five lessons')
  })

  it('finds the correct offsets for a sentence that occurs two times', () => {
    const twice = doc([['prose', 'Same words. Same words.']])
    const t = sentenceTargets(twice.text, twice.blocks)
    expect(t.map((x) => x.ranges[0].from)).toEqual([0, 12])
  })
})

describe('passageTargets', () => {
  it('joins short runs of paragraphs with blank lines and stops at headings', () => {
    const t = passageTargets(sample.text, sample.blocks)
    expect(t).toHaveLength(2)
    expect(t[0].text).toBe(
      'I missed my train this morning.\n\nIt taught me more about leadership than ten years in management.\n\nHere are five lessons every founder needs to hear.',
    )
    expect(t[0].ranges).toHaveLength(3)
    expect(cut(sample.text, t[1].ranges)).toEqual(['Nothing happened.'])
  })

  it('cuts long runs into parts of at most three paragraphs', () => {
    const many = doc(Array.from({ length: 9 }, (_, i) => ['prose', `Paragraph ${i}.`] as [TextBlock['kind'], string]))
    expect(passageTargets(many.text, many.blocks).map((t) => t.ranges.length)).toEqual([3, 3, 3])
  })

  it('stops a run at a code block and does not include it', () => {
    const withCode = doc([['prose', 'One.'], ['code', 'x = 1'], ['prose', 'Two.']])
    expect(passageTargets(withCode.text, withCode.blocks).map((t) => t.text)).toEqual(['One.', 'Two.'])
  })
})

describe('sectionTargets', () => {
  it('gives each part under a heading that has at least two paragraphs, with the heading as context', () => {
    const t = sectionTargets(sample.text, sample.blocks)
    expect(t).toHaveLength(1)
    expect(t[0].context).toBe('[section heading] Monday')
    expect(t[0].ranges).toHaveLength(3)
  })
})

describe('targetsFor', () => {
  it('gives the targets of the scope', () => {
    expect(targetsFor(sample.text, sample.blocks, 'section')).toEqual(sectionTargets(sample.text, sample.blocks))
  })
})

describe('snapshotId', () => {
  const [target] = sentenceTargets(sample.text, sample.blocks)
  const rules = [SEMANTIC_PRESETS[1]]

  it('is the same for the same input, in any rule order', () => {
    const two = [SEMANTIC_PRESETS[1], SEMANTIC_PRESETS[2]]
    expect(snapshotId(target, two, 'jev-1')).toBe(snapshotId(target, [...two].reverse(), 'jev-1'))
  })

  it('changes with the text, the context, a rule version, or the model', () => {
    const base = snapshotId(target, rules, 'jev-1')
    expect(snapshotId({ ...target, text: 'Other.' }, rules, 'jev-1')).not.toBe(base)
    expect(snapshotId({ ...target, context: '' }, rules, 'jev-1')).not.toBe(base)
    expect(snapshotId(target, [{ ...rules[0], question: 'New?' }], 'jev-1')).not.toBe(base)
    expect(snapshotId(target, rules, 'jev-2')).not.toBe(base)
  })

  it('does not change with the sensitivity of a rule', () => {
    expect(snapshotId(target, [{ ...rules[0], sensitivity: 'strict' }], 'jev-1')).toBe(snapshotId(target, rules, 'jev-1'))
  })
})
