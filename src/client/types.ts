/**
 * Wire types mirrored in the browser half. The host face owns the canonical
 * declarations under `src/types.ts`; these copies keep the client TypeScript
 * program independent of host-only imports.
 */

/** One candidate returned to the browser mention menu. */
export interface SessionReferenceCandidateView {
  /** Native dsh session id, e.g. `session-0c3a…`. */
  sessionId: string
  /** Latest log-backed title; falls back to the session id. */
  label: string
  /** Source session working directory, when recorded. */
  cwd?: string
  /** Source session creation time in Unix epoch milliseconds. */
  createdAt: number
}

/** One structured source session selected by a browser mention. */
export interface SessionReferenceInputView {
  sessionId: string
  label?: string
}

/** Failure envelope returned by the bridge HTTP routes. */
export interface SessionReferenceErrorView {
  code: string
  message: string
}

/** Discriminated result used by every bridge operation. */
export type SessionBridgeOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: SessionReferenceErrorView }
