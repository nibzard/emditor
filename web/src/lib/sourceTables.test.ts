import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { tableLines } from './sourceTables'

describe('source table lines', () => {
  it('keeps GFM table rows together but leaves prose and code fences alone', () => {
    const doc = 'Before\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n```\n| not | a table |\n```'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    expect(tableLines(state, 0, doc.length)).toEqual([3, 4, 5])
  })
})
