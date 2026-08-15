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
      .toBe('> 第一行\n>\n> 第二行')
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
})
