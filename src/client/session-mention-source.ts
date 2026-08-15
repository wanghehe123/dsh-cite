/**
 * `@` input-trigger source for cross-session mentions: candidates come from
 * the host `/dsh-sessions/candidates` route, picks insert chips whose opaque
 * ref carries the target session, source session, label, and canonical
 * mention text.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionReferenceCandidateView } from './types.ts'
import { listCandidates, preflightReferences } from './rpc.ts'

/** Opaque `ReferenceInsert.ref` payload carried by one session mention chip. */
interface SessionRefPayload {
  /** Target session receiving the prompt (preflight owner). */
  t: string
  /** Source session being referenced. */
  s: string
  /** User-facing mention label. */
  l: string
  /** Canonical Markdown mention produced for the model. */
  m: string
}

/** Latest candidate views per target session, keyed by display label. */
const latestBySession = new Map<SessionId, Map<string, SessionReferenceCandidateView>>()

/** Parse one opaque ref produced by {@link buildRef}. */
function parseRef(ref: string): SessionRefPayload {
  const parsed: unknown = JSON.parse(ref)
  if (
    typeof parsed !== 'object' || parsed === null
    || typeof (parsed as Record<string, unknown>).t !== 'string'
    || typeof (parsed as Record<string, unknown>).s !== 'string'
    || typeof (parsed as Record<string, unknown>).l !== 'string'
    || typeof (parsed as Record<string, unknown>).m !== 'string'
  ) {
    throw new Error('malformed session mention ref')
  }
  return parsed as unknown as SessionRefPayload
}

/** Base64url bytes without Node or Buffer globals. */
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Build the canonical `dsh-session:` URI for one source session. */
function mentionFor(view: SessionReferenceCandidateView): string {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(view.sessionId)))
  const label = view.label.replaceAll('\\', '\\\\').replaceAll(']', '\\]')
  return `@[${label}](dsh-session:${payload})`
}

/** Opaque ref for one picked candidate, targeting one open session. */
function buildRef(target: string, view: SessionReferenceCandidateView): string {
  return JSON.stringify({
    t: target,
    s: view.sessionId,
    l: view.label,
    m: mentionFor(view),
  } satisfies SessionRefPayload)
}

/**
 * Create the `@` session mention source over one client root context.
 * @param ctx - client root context (sessions list feed + captured transport).
 * @returns the input-trigger source.
 */
export function createSessionMentionSource(ctx: ClientContext): InputTriggerSource {
  return {
    trigger: '@',
    name: 'session',
    order: 20,

    async candidates(session, { query, signal }) {
      try {
        const views = await listCandidates(session.sessionId, query, 50, signal)
        latestBySession.set(session.sessionId, new Map(views.map(view => [view.label, view])))
        return views.map(view => ({
          name: view.label,
          description: view.sessionId,
        }))
      } catch (error: unknown) {
        console.error('[dsh-sessions] candidate lookup failed:', error)
        return []
      }
    },

    warm(session) {
      void listCandidates(session.sessionId, '', 50)
        .then((views) => {
          latestBySession.set(session.sessionId, new Map(views.map(view => [view.label, view])))
        })
        .catch(() => {})
    },

    lexicon(session) {
      const list = ctx.sessions.list.getSnapshot()
      return Object.values(list.byId)
        .filter(summary => summary.id !== session.sessionId && !summary.blank)
        .map(summary => summary.displayTitle)
    },

    subscribeLexicon(_session, listener) {
      return ctx.sessions.list.subscribe(listener)
    },

    onPick({ candidate, session }) {
      const view = latestBySession.get(session.sessionId)?.get(candidate.name)
      if (view === undefined) {
        // Cache miss: fall back to plain text; the host resolves a unique title.
        return { text: `@${candidate.name} ` }
      }
      return {
        insert: {
          source: 'dsh-sessions',
          ref: buildRef(session.sessionId, view),
          label: view.label,
          clipboardText: `@${view.label}`,
        },
      }
    },

    codec: {
      clipboardText(ref) {
        try {
          return `@${parseRef(ref).l}`
        } catch {
          return ref
        }
      },
      async serialize(ref, signal) {
        const parsed = parseRef(ref)
        await preflightReferences(parsed.t, [{ sessionId: parsed.s, label: parsed.l }], signal)
        return parsed.m
      },
    },
  }
}
