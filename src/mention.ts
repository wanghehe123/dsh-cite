/**
 * Host-side mention resolution: canonical `dsh-session:` mentions, bare native
 * session ids, and plain `@title` text become structured references plus
 * readable direct text.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  parseSessionReferenceText,
  type SessionReferenceInput,
} from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-session-reference'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { Config } from './config.ts'

/** A reference resolves to a session outside the configured scope. */
export class SessionReferenceScopeError extends Error {
  readonly code = 'SESSION_REFERENCE_SCOPE_DENIED'

  constructor(sessionId: SessionId) {
    super(`session "${sessionId}" is outside the configured reference scope`)
    this.name = 'SessionReferenceScopeError'
  }
}

/** Resolved readable text plus structured references in first-appearance order. */
export interface ResolvedMentionText {
  text: string
  references: readonly SessionReferenceInput[]
}

/** Regex boundary helper for bare id scanning. */
function isIdBoundary(char: string | undefined): boolean {
  if (char === undefined) return true
  return !/[A-Za-z0-9_-]/.test(char)
}

/** Replace every occurrence of a known session id with itself and collect the reference. */
function collectBareIds(
  text: string,
  allowed: ReadonlyMap<string, SessionRecord>,
  references: SessionReferenceInput[],
): void {
  const ids = [...allowed.keys()].sort((a, b) => b.length - a.length)
  for (const id of ids) {
    let from = 0
    while (true) {
      const at = text.indexOf(id, from)
      if (at < 0) break
      const before = text[at - 1]
      const after = text[at + id.length]
      if (isIdBoundary(before) && isIdBoundary(after)) {
        pushReference(references, id, id)
      }
      from = at + id.length
    }
  }
}

/** Strip trailing punctuation from one `@token` capture. */
function trimToken(token: string): string {
  return token.replace(/[\s.,!?;:，。！？；："'”’」』)）\]}]+$/u, '')
}

/** Resolve plain `@title` tokens against exact candidate labels; ambiguous titles stay text. */
async function collectPlainTitleMentions(
  ctx: Context,
  agent: Agent,
  text: string,
  allowed: ReadonlyMap<string, SessionRecord>,
  references: SessionReferenceInput[],
  signal?: AbortSignal,
): Promise<void> {
  const pattern = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_][^\s@]*)/gu
  for (const match of text.matchAll(pattern)) {
    const rawToken = match[2]
    if (rawToken === undefined) continue
    const token = trimToken(rawToken)
    if (token === '') continue
    const candidates = await ctx.sessionReferenceResolver.listCandidates(agent, token, 20, signal)
    const hits = candidates.filter(candidate =>
      allowed.has(candidate.sessionId)
      && candidate.label.toLocaleLowerCase() === token.toLocaleLowerCase())
    const ids = [...new Set(hits.map(hit => hit.sessionId))]
    if (ids.length !== 1) continue
    const sessionId = ids[0]
    if (sessionId !== undefined) pushReference(references, sessionId, token)
  }
}

function pushReference(references: SessionReferenceInput[], id: string | SessionId, label: string): void {
  const sessionId = id as SessionId
  if (references.some(reference => reference.sessionId === sessionId)) return
  references.push({ sessionId, label })
}

/**
 * Resolve one plain-text message into readable text and structured references.
 * Canonical mentions are normalized to `@label`; bare ids and plain titles
 * stay as typed. Every resolved id must belong to the allowed scope.
 */
export async function resolveMentionText(
  ctx: Context,
  agent: Agent,
  allowed: ReadonlyMap<string, SessionRecord>,
  text: string,
  config: Config,
  signal?: AbortSignal,
): Promise<ResolvedMentionText> {
  const parsed = parseSessionReferenceText(text)
  const references: SessionReferenceInput[] = [...parsed.references]
  let readable = parsed.text

  if (config.allowBareSessionIds) collectBareIds(readable, allowed, references)
  if (config.allowPlainTitleMentions) {
    await collectPlainTitleMentions(ctx, agent, readable, allowed, references, signal)
  }

  for (const reference of references) {
    if (!allowed.has(reference.sessionId)) throw new SessionReferenceScopeError(reference.sessionId)
  }

  return { text: readable, references }
}
