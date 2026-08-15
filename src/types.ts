/**
 * Wire and configuration types shared by the host and browser halves.
 * Plain strings cross the Remote boundary; branded identities stay host-side.
 */

/** Which persisted sessions may back a reference. */
export type SessionScope = 'workspace' | 'all'

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

/** Result of validating one message's references before enqueue. */
export interface PreflightResult {
  /** Readable direct-message content after mention tokens are removed. */
  content: string
  /** Structured references in first-appearance order. */
  references: readonly SessionReferenceInputView[]
}

/** Failure envelope returned by Remote methods (Typert errors carry these fields). */
export interface SessionReferenceErrorView {
  code: string
  message: string
}

/** Discriminated result used by every bridge Remote method. */
export type SessionBridgeOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: SessionReferenceErrorView }
