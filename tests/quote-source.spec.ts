import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { decodeQuoteRef, encodeQuoteRef, type QuoteRefPayload } from '../src/client/quote.ts'
import { createQuoteSource, QUOTE_SOURCE_NAME } from '../src/client/quote-source.ts'

describe('createQuoteSource', () => {
  it('registers under @ with an empty candidate roll', async () => {
    const source = createQuoteSource()
    expect(source.trigger).toBe('@')
    expect(source.name).toBe(QUOTE_SOURCE_NAME)
    await expect(source.candidates(
      { sessionId: 'session-quote-test' as SessionId },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([])
    expect(source.onPick({
      candidate: { name: 'unreachable' },
      session: { sessionId: 'session-quote-test' as SessionId },
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 0, draftRev: 0 },
    })).toBeUndefined()
  })

  it('serializes a ref to a Markdown blockquote', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-3', text: '第一行\n\n第二行', truncated: false }
    await expect(source.codec.serialize(encodeQuoteRef(payload))).resolves
      .toBe('\n> 第一行\n>\n> 第二行\n')
  })

  it('projects the same blockquote through clipboardText', () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-4', text: 'copy me', truncated: true }
    const ref = encodeQuoteRef(payload)
    expect(source.codec.clipboardText(ref)).toBe('> copy me')
    expect(decodeQuoteRef(ref).truncated).toBe(true)
  })

  it('rejects malformed refs instead of silently downgrading', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    await expect(source.codec.serialize('%%%')).rejects.toThrow(/malformed quote ref/)
  })

  it('serializes an optional comment after the blockquote', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-5', text: '第一行\n\n第二行', truncated: false, comment: '解释一下' }
    await expect(source.codec.serialize(encodeQuoteRef(payload))).resolves
      .toBe('\n> 第一行\n>\n> 第二行\n\n解释一下\n')
  })

  it('keeps adjacent quotes and comments separated after the input sink joins chips', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payloads: QuoteRefPayload[] = [
      { v: 1, id: 'quote-7', text: '甲', truncated: false, comment: '说明甲' },
      { v: 1, id: 'quote-8', text: '乙', truncated: false, comment: '说明乙' },
    ]
    const parts = await Promise.all(payloads.map(payload => source.codec!.serialize(encodeQuoteRef(payload))))
    const draft = '\uFFFC \uFFFC '
    let out = ''
    let cursor = 0
    for (const part of parts) {
      const offset = draft.indexOf('\uFFFC', cursor)
      out += draft.slice(cursor, offset) + part
      cursor = offset + 1
    }
    out += draft.slice(cursor)
    expect(out.trim()).toBe('> 甲\n\n说明甲\n \n> 乙\n\n说明乙')
  })

  it('projects the same quoted comment through clipboardText', () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-6', text: 'copy me', truncated: true, comment: '请精简' }
    const ref = encodeQuoteRef(payload)
    expect(source.codec.clipboardText(ref)).toBe('> copy me\n\n请精简')
  })
})
