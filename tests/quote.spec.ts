import { describe, expect, it } from 'vitest'
import {
  decodeQuoteRef, encodeQuoteRef, formatQuoteBlock, formatQuoteWithComment,
  MAX_COMMENT_CHARS, MAX_QUOTE_CHARS, normalizeQuoteComment, normalizeQuoteText,
  quoteComment, quoteFullText, quotePreview, type QuoteRefPayload,
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
