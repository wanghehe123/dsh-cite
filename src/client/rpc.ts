/** Browser-side JSON transport for the `/dsh-sessions` host routes. */

import type {
  SessionBridgeOutcome, SessionReferenceCandidateView, SessionReferenceInputView,
} from './types.ts'

/** Network or protocol failure surfaced to the submit transaction. */
export class SessionBridgeTransportError extends Error {
  override name = 'SessionBridgeTransportError'
}

/** POST one JSON operation and unwrap the outcome envelope. */
async function post<T>(operation: string, body: unknown, signal?: AbortSignal): Promise<SessionBridgeOutcome<T>> {
  let response: Response
  try {
    response = await fetch(`/dsh-sessions/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? null,
    })
  } catch (error: unknown) {
    if (signal?.aborted === true) throw new SessionBridgeTransportError('request aborted', { cause: error })
    throw new SessionBridgeTransportError(`dsh-sessions ${operation} request failed: ${String(error)}`, { cause: error })
  }
  let payload: unknown
  try {
    payload = await response.json() as unknown
  } catch {
    throw new SessionBridgeTransportError(`dsh-sessions ${operation} returned invalid JSON (HTTP ${String(response.status)})`)
  }
  if (!isOutcome(payload)) {
    throw new SessionBridgeTransportError(`dsh-sessions ${operation} returned a malformed outcome`)
  }
  return payload as SessionBridgeOutcome<T>
}

/** Fetch scoped mention candidates. */
export async function listCandidates(
  sessionId: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<readonly SessionReferenceCandidateView[]> {
  const outcome = await post<readonly SessionReferenceCandidateView[]>('candidates', { sessionId, query, limit }, signal)
  if (!outcome.ok) throw new SessionBridgeTransportError(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.value
}

/** Validate one reference set before the prompt is enqueued. */
export async function preflightReferences(
  sessionId: string,
  references: readonly SessionReferenceInputView[],
  signal?: AbortSignal,
): Promise<void> {
  const outcome = await post<null>('preflight', { sessionId, references }, signal)
  if (!outcome.ok) throw new SessionBridgeTransportError(`${outcome.error.code}: ${outcome.error.message}`)
}

function isOutcome(value: unknown): value is { ok: boolean } {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
}
