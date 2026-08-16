/**
 * Pure quote helpers shared by the selection popover, the quote codec, and
 * the quote bar. No DOM or React dependencies, so vitest can exercise them
 * directly in the Node environment.
 */

/** Hard cap on one quote's size, counted in Unicode code points. */
export const MAX_QUOTE_CHARS = 16_000

/** Hard cap on one comment's size, counted in Unicode code points. */
export const MAX_COMMENT_CHARS = 4_000

/** Wire-neutral payload carried inside one quote chip's opaque ref. */
export interface QuoteRefPayload {
  v: 1
  id: string
  text: string
  truncated: boolean
  comment?: string
}

/** Result of normalizing one selection before it becomes a quote. */
export interface NormalizedQuote {
  text: string
  truncated: boolean
}

/** Base64url bytes without Node or Buffer globals. */
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Decode a base64url string back to bytes, restoring removed padding. */
function base64urlToBytes(ref: string): Uint8Array {
  const normalized = ref.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch (cause: unknown) {
    throw new Error('malformed quote ref', { cause })
  }
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

/**
 * Serialize one quote payload into the opaque ref carried by an
 * input-machine occurrence.
 */
export function encodeQuoteRef(payload: QuoteRefPayload): string {
  return base64url(new TextEncoder().encode(JSON.stringify(payload)))
}

/** Parse an opaque quote ref; malformed input throws. */
export function decodeQuoteRef(ref: string): QuoteRefPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64urlToBytes(ref))) as unknown
  } catch (cause: unknown) {
    throw new Error('malformed quote ref', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('malformed quote ref')
  const candidate = parsed as Record<string, unknown>
  if (
    candidate.v !== 1
    || typeof candidate.id !== 'string'
    || typeof candidate.text !== 'string'
    || typeof candidate.truncated !== 'boolean'
    || (candidate.comment !== undefined && typeof candidate.comment !== 'string')
  ) {
    throw new Error('malformed quote ref')
  }
  if (candidate.comment === undefined) {
    return { v: 1, id: candidate.id, text: candidate.text, truncated: candidate.truncated }
  }
  return {
    v: 1,
    id: candidate.id,
    text: candidate.text,
    truncated: candidate.truncated,
    comment: candidate.comment,
  }
}

/**
 * Normalize one selection: trim, then truncate by code points so emoji and
 * other surrogate pairs are never split; append `truncatedMarker` exactly
 * when truncation happened.
 */
export function normalizeQuoteText(raw: string, truncatedMarker: string): NormalizedQuote {
  const trimmed = raw.trim()
  const units = Array.from(trimmed)
  if (units.length <= MAX_QUOTE_CHARS) return { text: trimmed, truncated: false }
  return {
    text: `${units.slice(0, MAX_QUOTE_CHARS).join('')}${truncatedMarker}`,
    truncated: true,
  }
}

/**
 * Normalize one optional comment: trim, then truncate by code points so
 * surrogate pairs are never split; append `truncatedMarker` exactly when
 * truncation happened.
 */
export function normalizeQuoteComment(raw: string, truncatedMarker: string): NormalizedQuote {
  const trimmed = raw.trim()
  const units = Array.from(trimmed)
  if (units.length <= MAX_COMMENT_CHARS) return { text: trimmed, truncated: false }
  return {
    text: `${units.slice(0, MAX_COMMENT_CHARS).join('')}${truncatedMarker}`,
    truncated: true,
  }
}

/**
 * Project one quote payload to the Markdown blockquote sent to the model:
 * every line gets a `> ` prefix; blank lines stay bare `>` so paragraph
 * breaks survive inside the quote.
 */
export function formatQuoteBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line === '' ? '>' : `> ${line}`)
    .join('\n')
}

/**
 * Project one quote payload to the Markdown sent to the model: the
 * blockquote first, then one blank line and the trimmed comment when it is
 * non-empty. Without a comment the output is exactly `formatQuoteBlock`.
 */
export function formatQuoteWithComment(text: string, comment: string | undefined): string {
  const quote = formatQuoteBlock(text)
  const trimmed = comment?.trim()
  if (trimmed === undefined || trimmed === '') return quote
  return `${quote}\n\n${trimmed}`
}

/**
 * Prompt serialization for the input sink: the official pipeline joins chip
 * texts with the draft text around the placeholder (usually a single space
 * between adjacent chips), so surround the block with newlines. The sink
 * trims the final message; the inner newlines keep adjacent blockquotes and
 * their comments from gluing into one line.
 */
export function formatQuoteSerialized(text: string, comment: string | undefined): string {
  return `\n${formatQuoteWithComment(text, comment)}\n`
}

/**
 * Return a copy of `payload` with its optional comment replaced by
 * `comment`. A missing or blank comment yields a copy without the `comment`
 * key so the result satisfies `exactOptionalPropertyTypes`.
 */
export function withQuoteComment(payload: QuoteRefPayload, comment: string | undefined): QuoteRefPayload {
  const trimmed = comment?.trim()
  if (trimmed === undefined || trimmed === '') {
    return { v: 1, id: payload.id, text: payload.text, truncated: payload.truncated }
  }
  return { v: 1, id: payload.id, text: payload.text, truncated: payload.truncated, comment: trimmed }
}

/** Generate a unique quote id for one quote chip. */
export function createQuoteId(): string {
  return crypto.randomUUID()
}

/** Read the full quoted text from an occurrence ref; null on malformed refs. */
export function quoteFullText(ref: string): string | null {
  try {
    return decodeQuoteRef(ref).text
  } catch {
    return null
  }
}

/** One-line preview for the quote bar: first non-empty line, else fallback. */
export function quotePreview(ref: string, fallback: string): string {
  const text = quoteFullText(ref)
  if (text === null || text === '') return fallback
  const first = text.split('\n').find(line => line.trim() !== '')
  return first ?? fallback
}

/** Read the optional comment from an occurrence ref; null when absent/malformed. */
export function quoteComment(ref: string): string | null {
  try {
    const comment = decodeQuoteRef(ref).comment
    return comment === undefined || comment === '' ? null : comment
  } catch {
    return null
  }
}
