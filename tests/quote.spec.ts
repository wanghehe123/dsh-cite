import { describe, expect, it } from 'vitest'
import {
  ANCHOR_BUBBLE_GAP, ANCHOR_BUBBLE_PAD, ANCHOR_BUBBLE_SIZE,
  bubbleAnchorFromRect, commentEditorPosition, decodeQuoteRef, encodeQuoteRef,
  formatQuoteBlock, formatQuoteWithComment, MAX_COMMENT_CHARS, MAX_QUOTE_CHARS,
  normalizeQuoteComment, normalizeQuoteText, pickFirstClientRect, quoteComment,
  quoteFullText, quotePreview, withQuoteComment, type QuoteRefPayload,
} from '../src/client/quote.ts'

const MARKER = '…（已截断）'

describe('normalizeQuoteText', () => {
  it('trims the captured text', () => {
    expect(normalizeQuoteText('  hello\n', MARKER)).toEqual({ text: 'hello', truncated: false })
  })

  it('keeps text at the code-point cap untouched', () => {
    const text = 'a'.repeat(MAX_QUOTE_CHARS)
    expect(normalizeQuoteText(`  ${text}  `, MARKER)).toEqual({ text, truncated: false })
  })

  it('truncates over the cap by code points and appends the marker', () => {
    const normalized = normalizeQuoteText('😀'.repeat(MAX_QUOTE_CHARS + 1), MARKER)
    expect(normalized.truncated).toBe(true)
    expect(Array.from(normalized.text).slice(0, MAX_QUOTE_CHARS).join(''))
      .toBe('😀'.repeat(MAX_QUOTE_CHARS))
    expect(normalized.text.endsWith(MARKER)).toBe(true)
  })

  it('returns empty text as not truncated', () => {
    expect(normalizeQuoteText('   \n', MARKER)).toEqual({ text: '', truncated: false })
  })
})

describe('normalizeQuoteComment', () => {
  it('trims the comment', () => {
    expect(normalizeQuoteComment('  帮我解释一下\n', MARKER)).toEqual({ text: '帮我解释一下', truncated: false })
  })

  it('returns an empty comment untouched and not truncated', () => {
    expect(normalizeQuoteComment('   \n', MARKER)).toEqual({ text: '', truncated: false })
  })

  it('keeps a comment at the code-point cap untouched', () => {
    const comment = 'a'.repeat(MAX_COMMENT_CHARS)
    expect(normalizeQuoteComment(comment, MARKER)).toEqual({ text: comment, truncated: false })
  })

  it('truncates over the cap by code points and appends the marker', () => {
    const normalized = normalizeQuoteComment('😀'.repeat(MAX_COMMENT_CHARS + 1), MARKER)
    expect(normalized.truncated).toBe(true)
    expect(Array.from(normalized.text).slice(0, MAX_COMMENT_CHARS).join('')).toBe('😀'.repeat(MAX_COMMENT_CHARS))
    expect(normalized.text.endsWith(MARKER)).toBe(true)
  })
})

describe('formatQuoteWithComment', () => {
  it('equals formatQuoteBlock when the comment is undefined or blank', () => {
    expect(formatQuoteWithComment('hello', undefined)).toBe('> hello')
    expect(formatQuoteWithComment('hello', '   \n')).toBe('> hello')
  })

  it('appends the trimmed comment after one blank line', () => {
    expect(formatQuoteWithComment('a\n\nb', '  解释一下  ')).toBe('> a\n>\n> b\n\n解释一下')
  })
})

describe('formatQuoteBlock', () => {
  it('prefixes a single line', () => {
    expect(formatQuoteBlock('hello')).toBe('> hello')
  })

  it('prefixes every line and keeps blank lines as bare >', () => {
    expect(formatQuoteBlock('a\n\nb')).toBe('> a\n>\n> b')
  })

  it('normalizes CRLF and nests existing quote lines', () => {
    expect(formatQuoteBlock('a\r\n> nested')).toBe('> a\n> > nested')
  })
})

describe('quote refs', () => {
  it('round-trips Chinese text, emoji, and newlines through base64url', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-1', text: '中文\n😀', truncated: false }
    const ref = encodeQuoteRef(payload)
    expect(ref).not.toMatch(/[+/=]/)
    expect(decodeQuoteRef(ref)).toEqual(payload)
  })

  it('rejects malformed base64', () => {
    expect(() => decodeQuoteRef('%%%')).toThrow(/malformed quote ref/)
  })

  it('rejects a payload with the wrong version', () => {
    const ref = encodeQuoteRef({ v: 2, id: 'x', text: 'x', truncated: false } as unknown as QuoteRefPayload)
    expect(() => decodeQuoteRef(ref)).toThrow(/malformed quote ref/)
  })

  it('round-trips a payload with an optional comment and decodes legacy payloads without one', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-5', text: '原文', truncated: false, comment: '解释一下' }
    const ref = encodeQuoteRef(payload)
    expect(decodeQuoteRef(ref)).toEqual(payload)
    const legacy = encodeQuoteRef({ v: 1, id: 'quote-6', text: '原文', truncated: false })
    expect(decodeQuoteRef(legacy).comment).toBeUndefined()
  })

  it('rejects a payload whose comment is not a string', () => {
    const ref = encodeQuoteRef({ v: 1, id: 'x', text: 'x', truncated: false, comment: 42 } as unknown as QuoteRefPayload)
    expect(() => decodeQuoteRef(ref)).toThrow(/malformed quote ref/)
  })
})

describe('withQuoteComment', () => {
  const base: QuoteRefPayload = { v: 1, id: 'quote-8', text: '原文', truncated: false }

  it('attaches a comment without mutating the original payload', () => {
    const next = withQuoteComment(base, '解释一下')
    expect(next).toEqual({ v: 1, id: 'quote-8', text: '原文', truncated: false, comment: '解释一下' })
    expect(base.comment).toBeUndefined()
    expect(Object.hasOwn(next, 'comment')).toBe(true)
  })

  it('drops the comment key when the comment is undefined or blank', () => {
    for (const comment of [undefined, '', '   ']) {
      const next = withQuoteComment(base, comment)
      expect(next).toEqual({ v: 1, id: 'quote-8', text: '原文', truncated: false })
      expect(Object.hasOwn(next, 'comment')).toBe(false)
    }
  })
})

describe('quote display helpers', () => {
  it('reads full text and the first non-empty line preview', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-2', text: '第一行\n\n第二行', truncated: false }
    const ref = encodeQuoteRef(payload)
    expect(quoteFullText(ref)).toBe(payload.text)
    expect(quotePreview(ref, 'fallback')).toBe('第一行')
  })

  it('falls back for malformed refs', () => {
    expect(quoteFullText('%%%')).toBeNull()
    expect(quotePreview('%%%', 'fallback')).toBe('fallback')
  })

  it('reads an optional comment and falls back for malformed refs', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-7', text: '原文', truncated: false, comment: '重点看这里' }
    expect(quoteComment(encodeQuoteRef(payload))).toBe('重点看这里')
    expect(quoteComment('%%%')).toBeNull()
  })
})

describe('pickFirstClientRect', () => {
  it('returns the first non-empty rect and skips collapsed fragments', () => {
    expect(pickFirstClientRect([
      { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
      { left: 10, right: 110, top: 20, bottom: 36, width: 100, height: 16 },
    ])).toEqual({ left: 10, right: 110, top: 20, bottom: 36, width: 100, height: 16 })
  })

  it('returns null when every rect is empty', () => {
    expect(pickFirstClientRect([])).toBeNull()
    expect(pickFirstClientRect([
      { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
    ])).toBeNull()
  })
})

describe('bubbleAnchorFromRect', () => {
  const viewport = { width: 800, height: 600 }

  it('pins the badge to the end of the first line, vertically centered', () => {
    expect(bubbleAnchorFromRect(
      { left: 40, right: 240, top: 80, bottom: 100, width: 200, height: 20 },
      viewport,
    )).toEqual({
      left: 240 + ANCHOR_BUBBLE_GAP,
      top: 90,
    })
  })

  it('clamps the badge inside the viewport when the line ends near the right edge', () => {
    expect(bubbleAnchorFromRect(
      { left: 700, right: 790, top: 80, bottom: 100, width: 90, height: 20 },
      viewport,
    )).toEqual({
      left: viewport.width - ANCHOR_BUBBLE_SIZE - ANCHOR_BUBBLE_PAD,
      top: 90,
    })
  })

  it('hides the badge when the line is scrolled out of the viewport', () => {
    expect(bubbleAnchorFromRect(
      { left: 40, right: 240, top: -40, bottom: -10, width: 200, height: 30 },
      viewport,
    )).toBeNull()
    expect(bubbleAnchorFromRect(
      { left: 40, right: 240, top: 620, bottom: 640, width: 200, height: 20 },
      viewport,
    )).toBeNull()
  })
})

describe('commentEditorPosition', () => {
  it('places the editor just below the badge and clamps to the viewport', () => {
    expect(commentEditorPosition({ left: 244, top: 90 }, { width: 800, height: 600 }))
      .toEqual({ left: 236, top: 104 })
    expect(commentEditorPosition({ left: 780, top: 590 }, { width: 800, height: 600 }))
      .toEqual({ left: 800 - 264 - 12, top: 600 - 160 })
  })
})
