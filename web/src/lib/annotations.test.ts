// ABOUTME: Tests for the annotation logic.
// ABOUTME: They cover text-quote anchors, anchor recovery after edits, the notes file, and margin layout.

import { describe, expect, it } from 'vitest'
import {
  anchorNotes, colorOf, cutRange, kindOf, locate, mergeNotes, type Note, parseNotes, quoteAt, refreshQuotes, serializeNotes,
  stackMargin, trimSpan, wordsAfterCuts,
} from './annotations'

const TEXT = 'The cat sat on the mat. The cat ate the fish. Then the cat slept.'

function note(id: string, text: string, from: number, to: number, extra: Partial<Note> = {}): Note {
  return { id, quote: quoteAt(text, from, to), body: `note ${id}`, created: 1, resolved: false, ...extra }
}

describe('quoteAt', () => {
  it('keeps the selected text and some context on each side', () => {
    const from = TEXT.indexOf('ate')
    const quote = quoteAt(TEXT, from, from + 3, 8)
    expect(quote).toEqual({ exact: 'ate', prefix: 'The cat ', suffix: ' the fis' })
  })

  it('cuts the context at the start and end of the text', () => {
    expect(quoteAt('abc', 0, 3, 8)).toEqual({ exact: 'abc', prefix: '', suffix: '' })
  })
})

describe('locate', () => {
  it('finds a quote that occurs once', () => {
    const from = TEXT.indexOf('mat')
    expect(locate(TEXT, quoteAt(TEXT, from, from + 3))).toEqual({ from, to: from + 3 })
  })

  it('uses the context to choose between repeated words', () => {
    const second = TEXT.indexOf('cat', TEXT.indexOf('cat') + 1)
    const third = TEXT.lastIndexOf('cat')
    expect(locate(TEXT, quoteAt(TEXT, second, second + 3))).toEqual({ from: second, to: second + 3 })
    expect(locate(TEXT, quoteAt(TEXT, third, third + 3))).toEqual({ from: third, to: third + 3 })
  })

  it('follows the quote when text before it changes', () => {
    const from = TEXT.indexOf('fish')
    const quote = quoteAt(TEXT, from, from + 4)
    const edited = 'A new first line.\n\n' + TEXT
    const at = edited.indexOf('fish')
    expect(locate(edited, quote)).toEqual({ from: at, to: at + 4 })
  })

  it('finds the new text between the old context when the quote itself was edited', () => {
    const from = TEXT.indexOf('ate the fish')
    const quote = quoteAt(TEXT, from, from + 'ate the fish'.length)
    const edited = TEXT.replace('ate the fish', 'ate the whole salmon')
    const at = edited.indexOf('ate the whole salmon')
    expect(locate(edited, quote)).toEqual({ from: at, to: at + 'ate the whole salmon'.length })
  })

  it('returns null when the quote and its context are gone', () => {
    const from = TEXT.indexOf('ate the fish')
    const quote = quoteAt(TEXT, from, from + 12)
    expect(locate('Something else entirely.', quote)).toBeNull()
  })

  it('returns null for an empty quote', () => {
    expect(locate(TEXT, { exact: '', prefix: '', suffix: '' })).toBeNull()
  })
})

describe('anchorNotes', () => {
  it('puts found notes in text order and lists the lost ones as detached', () => {
    const late = note('late', TEXT, TEXT.indexOf('slept'), TEXT.indexOf('slept') + 5)
    const early = note('early', TEXT, TEXT.indexOf('mat'), TEXT.indexOf('mat') + 3)
    const lost = note('lost', TEXT, TEXT.indexOf('fish'), TEXT.indexOf('fish') + 4)
    const edited = TEXT.replace('The cat ate the fish. ', '')
    const result = anchorNotes(edited, [late, lost, early])
    expect(result.attached.map((a) => a.note.id)).toEqual(['early', 'late'])
    expect(result.attached[1].span).toEqual({ from: edited.indexOf('slept'), to: edited.indexOf('slept') + 5 })
    expect(result.detached.map((n) => n.id)).toEqual(['lost'])
  })

  it('leaves resolved notes out', () => {
    const done = note('done', TEXT, 4, 7, { resolved: true })
    expect(anchorNotes(TEXT, [done])).toEqual({ attached: [], detached: [] })
  })
})

describe('parseNotes and serializeNotes', () => {
  it('round-trips notes', () => {
    const notes = [note('a', TEXT, 4, 7), note('b', TEXT, 8, 11, { resolved: true })]
    expect(parseNotes(serializeNotes(notes))).toEqual(notes)
  })

  it('writes a versioned file that ends with a newline', () => {
    const out = serializeNotes([])
    expect(JSON.parse(out)).toEqual({ version: 1, notes: [] })
    expect(out.endsWith('\n')).toBe(true)
  })

  it('returns no notes for empty or broken input', () => {
    expect(parseNotes('')).toEqual([])
    expect(parseNotes('{not json')).toEqual([])
    expect(parseNotes('{"version":1,"notes":"x"}')).toEqual([])
  })

  it('drops entries that do not have the correct shape', () => {
    const good = note('a', TEXT, 4, 7)
    const raw = JSON.stringify({ version: 1, notes: [good, { id: 'bad' }, null, { ...good, id: 7 }] })
    expect(parseNotes(raw)).toEqual([good])
  })
})

describe('stackMargin', () => {
  it('keeps notes at their anchor when they do not overlap', () => {
    expect(stackMargin([{ top: 0, height: 40 }, { top: 100, height: 40 }], 8)).toEqual([0, 100])
  })

  it('pushes a note down below the note above it', () => {
    expect(stackMargin([{ top: 0, height: 40 }, { top: 10, height: 40 }, { top: 20, height: 40 }], 8)).toEqual([
      0, 48, 96,
    ])
  })

  it('keeps the input order when the anchors are not sorted', () => {
    expect(stackMargin([{ top: 50, height: 40 }, { top: 0, height: 40 }], 8)).toEqual([50, 0])
  })
})

describe('stackMargin with a pinned note', () => {
  it('keeps the pinned note at its anchor and moves the notes above it up', () => {
    const items = [{ top: 0, height: 40 }, { top: 10, height: 40 }, { top: 20, height: 40 }]
    expect(stackMargin(items, 8, 2)).toEqual([-76, -28, 20])
  })

  it('pushes the notes below the pinned note down', () => {
    const items = [{ top: 0, height: 40 }, { top: 10, height: 40 }, { top: 20, height: 40 }]
    expect(stackMargin(items, 8, 1)).toEqual([-38, 10, 58])
  })
})

describe('trimSpan', () => {
  it('moves the ends of a selection past white space', () => {
    expect(trimSpan('  hello world  ', 0, 15)).toEqual({ from: 2, to: 13 })
  })

  it('returns null when only white space is selected', () => {
    expect(trimSpan('a   b', 1, 4)).toBeNull()
    expect(trimSpan('abc', 2, 2)).toBeNull()
  })
})

describe('refreshQuotes', () => {
  it('gives new quotes for notes whose text or context changed', () => {
    // The two notes are far apart, so the edit changes only the context of the fish note.
    const text = 'The mat was red. ' + 'Filler text. '.repeat(6) + TEXT
    const fish = note('fish', text, text.indexOf('fish'), text.indexOf('fish') + 4)
    const mat = note('mat', text, text.indexOf('mat'), text.indexOf('mat') + 3)
    const edited = text.replace('ate the fish', 'ate the big fish')
    const { attached } = anchorNotes(edited, [fish, mat])
    const updates = refreshQuotes(edited, attached)
    expect([...updates.keys()]).toEqual(['fish'])
    const at = edited.indexOf('fish')
    expect(updates.get('fish')).toEqual(quoteAt(edited, at, at + 4))
  })
})

describe('mergeNotes', () => {
  const a = note('a', TEXT, 4, 7)
  const b = note('b', TEXT, 8, 11)
  const c = note('c', TEXT, 12, 14)

  it('keeps notes from both sides, and the local version of a note wins', () => {
    const localA = { ...a, body: 'mine' }
    const merged = mergeNotes([a, b], [localA, c], new Set())
    expect(merged.map((n) => n.id)).toEqual(['a', 'c', 'b'])
    expect(merged[0].body).toBe('mine')
  })

  it('leaves out notes that were deleted here', () => {
    expect(mergeNotes([a, b], [a], new Set(['b'])).map((n) => n.id)).toEqual(['a'])
  })
})

describe('note kinds', () => {
  it('reads a note without a kind as a comment, and a highlight without a color as yellow', () => {
    expect(kindOf(note('a', TEXT, 4, 7))).toBe('comment')
    expect(colorOf(note('a', TEXT, 4, 7, { kind: 'highlight' }))).toBe('yellow')
    expect(colorOf(note('a', TEXT, 4, 7, { kind: 'highlight', color: 'blue' }))).toBe('blue')
  })

  it('round-trips highlights and cuts', () => {
    const notes = [note('h', TEXT, 4, 7, { kind: 'highlight', color: 'pink' }), note('c', TEXT, 8, 11, { kind: 'cut' })]
    expect(parseNotes(serializeNotes(notes))).toEqual(notes)
  })

  it('keeps notes with an unknown kind or color as plain notes', () => {
    const odd = { ...note('a', TEXT, 4, 7), kind: 'sticker', color: 'plaid' }
    const [read] = parseNotes(JSON.stringify({ version: 1, notes: [odd] }))
    expect(read).toEqual(note('a', TEXT, 4, 7))
  })

  it('does not write a kind or color into a plain note', () => {
    expect(serializeNotes([note('a', TEXT, 4, 7)])).not.toContain('kind')
  })
})

describe('wordsAfterCuts', () => {
  it('takes away the words of each cut', () => {
    const cuts = [note('c', TEXT, 0, 11, { kind: 'cut' }), note('d', TEXT, 24, 31, { kind: 'cut' })]
    expect(wordsAfterCuts(100, cuts)).toBe(95)
  })

  it('does not go below zero', () => {
    expect(wordsAfterCuts(1, [note('c', TEXT, 0, 11, { kind: 'cut' })])).toBe(0)
  })
})

describe('cutRange', () => {
  const text = 'a worse one, quickly, and then'

  it('takes one of the two spaces around the cut', () => {
    const from = text.indexOf('quickly,')
    expect(cutRange(text, { from, to: from + 8 })).toEqual({ from, to: from + 9 })
  })

  it('takes the space before a cut that ends at punctuation', () => {
    const from = text.indexOf('one')
    expect(cutRange(text, { from, to: from + 3 })).toEqual({ from: from - 1, to: from + 3 })
  })

  it('keeps the span when there is no extra space', () => {
    expect(cutRange('abc', { from: 1, to: 2 })).toEqual({ from: 1, to: 2 })
  })
})
