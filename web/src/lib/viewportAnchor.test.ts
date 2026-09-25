import { describe, expect, it } from 'vitest'
import { anchorFingerprint, sameAnchorText } from './viewportAnchor'

describe('reading anchors', () => {
  it('matches a rendered heading with its Markdown source', () => {
    expect(sameAnchorText(anchorFingerprint('## Section 25'), anchorFingerprint('Section 25'))).toBe(true)
    expect(sameAnchorText(anchorFingerprint('## Section 2'), anchorFingerprint('Section 25'))).toBe(false)
  })
})
