import { describe, expect, it } from 'vitest'
import { renderPreview } from './preview'

describe('desk preview', () => {
  it('ends at a complete block when listing content was cut off', () => {
    const html = renderPreview('# Title\n\nComplete paragraph.\n\n| unfinished | row', 'doc.md', true)
    expect(html).toContain('Complete paragraph.')
    expect(html).not.toContain('unfinished')
  })
})
