/**
 * Browser-facing JSON HTTP routes: candidate discovery, pre-enqueue
 * validation, and canonical mention formatting. The plugin owns one
 * `/dsh-sessions` prefix route; every response is a discriminated outcome so
 * the browser half can render stable errors.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import type { SessionReferenceInput } from '@deepseek-ai/dsh-session-reference'
import type { Config } from './config.ts'
import { allowedSessionRecords, sessionId } from './scope.ts'
import type {
  SessionBridgeOutcome, SessionReferenceCandidateView, SessionReferenceInputView,
} from './types.ts'

/** Maximum accepted JSON request body. */
const MAX_BODY_BYTES = 65536

/** Wire-validation failure with a stable browser-facing code. */
class BadRequest extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'BadRequest'
  }
}

/**
 * Register the `/dsh-sessions` prefix route.
 * @param ctx - host root context carrying `webServer`.
 * @param config - validated plugin configuration.
 * @returns disposer removing the route.
 */
export function registerBridgeRoutes(ctx: Context, config: Config): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-sessions',
    handler: (req, res) => handleRoute(ctx, config, req, res),
  })
}

/** Dispatch one request to its bridge operation. */
async function handleRoute(
  ctx: Context,
  config: Config,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = (req.url ?? '').split('?', 1)[0] ?? ''
  const operation = path.slice('/dsh-sessions'.length).replace(/^\/+/u, '')
  let body: unknown
  try {
    body = await readJsonBody(req)
    const outcome = await dispatch(ctx, config, operation, body, req)
    sendJson(res, 200, outcome)
  } catch (error: unknown) {
    const bad = error instanceof BadRequest
      ? error
      : new BadRequest('INTERNAL', error instanceof Error ? error.message : String(error))
    sendJson(res, bad.code === 'INTERNAL' ? 500 : 400, {
      ok: false,
      error: { code: bad.code, message: bad.message },
    })
  }
}

/** Execute one named bridge operation with validated wire input. */
async function dispatch(
  ctx: Context,
  config: Config,
  operation: string,
  body: unknown,
  req: IncomingMessage,
): Promise<SessionBridgeOutcome<unknown>> {
  switch (operation) {
    case 'candidates': {
      const { sessionId, query, limit } = candidatesPayload(body)
      return candidates(ctx, config, sessionId, query, limit, req)
    }
    case 'preflight': {
      const { sessionId, references } = preflightPayload(body)
      return preflight(ctx, config, sessionId, references, req)
    }
    case 'format': {
      const { sessionId, label } = formatPayload(body)
      return { ok: true, value: formatSessionReferenceMention({
        sessionId: sessionId as SessionId,
        ...(label === undefined ? {} : { label }),
      }) }
    }
    default:
      throw new BadRequest('NOT_FOUND', `unknown dsh-sessions operation "${operation}"`)
  }
}

/** Candidate discovery, scoped and ranked by target cwd. */
async function candidates(
  ctx: Context,
  config: Config,
  targetSessionId: string,
  query: string,
  limit: number,
  req: IncomingMessage,
): Promise<SessionBridgeOutcome<readonly SessionReferenceCandidateView[]>> {
  const resolved = await resolveAgent(ctx, targetSessionId)
  if (!('agent' in resolved)) return resolved
  try {
    const signal = requestSignal(req)
    const allowed = await allowedSessionRecords(ctx, resolved.agent, config.scope, signal)
    const list = await ctx.sessionReferenceResolver.listCandidates(
      resolved.agent,
      query,
      limit,
      signal,
    )
    return {
      ok: true,
      value: list
        .filter(candidate => allowed.has(candidate.sessionId))
        .map(candidate => ({
          sessionId: candidate.sessionId,
          label: candidate.label,
          ...(candidate.cwd === undefined ? {} : { cwd: candidate.cwd }),
          createdAt: candidate.createdAt,
        })),
    }
  } catch (error: unknown) {
    return internalOutcome(error)
  }
}

/** Pre-enqueue validation: run the full prepare pipeline, discard the snapshot. */
async function preflight(
  ctx: Context,
  config: Config,
  targetSessionId: string,
  references: readonly SessionReferenceInputView[],
  req: IncomingMessage,
): Promise<SessionBridgeOutcome<null>> {
  const resolved = await resolveAgent(ctx, targetSessionId)
  if (!('agent' in resolved)) return resolved
  try {
    const signal = requestSignal(req)
    const allowed = await allowedSessionRecords(ctx, resolved.agent, config.scope, signal)
    const inputs: SessionReferenceInput[] = references.map(reference => {
      const id = sessionId(reference.sessionId)
      if (!allowed.has(id)) {
        throw new BadRequest('SESSION_REFERENCE_SCOPE_DENIED', `session "${id}" is outside the configured reference scope`)
      }
      return { sessionId: id, label: reference.label ?? reference.sessionId }
    })
    await ctx.sessionReferenceResolver.prepare(
      resolved.agent,
      [{ type: 'text', text: '' }],
      inputs,
      signal,
    )
    return { ok: true, value: null }
  } catch (error: unknown) {
    if (error instanceof BadRequest) throw error
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: {
        code: message.includes('SESSION_REFERENCE_')
          ? 'SESSION_REFERENCE_PREPARE_FAILED'
          : 'INTERNAL',
        message,
      },
    }
  }
}

/** Resolve one open target session to its live agent. */
async function resolveAgent(
  ctx: Context,
  targetSessionId: string,
): Promise<{ agent: Agent } | SessionBridgeOutcome<never>> {
  const agent = ctx.agents.get(sessionId(targetSessionId))
  if (agent === undefined) {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: `session "${targetSessionId}" is not open or does not exist`,
      },
    }
  }
  return { agent }
}

/** Fold unexpected host failures into the outcome envelope. */
function internalOutcome(error: unknown): SessionBridgeOutcome<never> {
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/** One cancellable signal tied to the client disconnect. */
function requestSignal(req: IncomingMessage): AbortSignal {
  const controller = new AbortController()
  req.once('close', () => { controller.abort() })
  return controller.signal
}

/** Validate and narrow the candidates request payload. */
function candidatesPayload(body: unknown): { sessionId: string; query: string; limit: number } {
  if (!isRecord(body)) throw new BadRequest('BAD_REQUEST', 'candidates body must be a JSON object')
  if (typeof body.sessionId !== 'string' || body.sessionId === '') {
    throw new BadRequest('BAD_REQUEST', 'sessionId must be a non-empty string')
  }
  const query = body.query === undefined ? '' : body.query
  if (typeof query !== 'string') throw new BadRequest('BAD_REQUEST', 'query must be a string')
  const limit = body.limit === undefined ? 50 : body.limit
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new BadRequest('BAD_REQUEST', 'limit must be an integer between 1 and 200')
  }
  return { sessionId: body.sessionId, query, limit }
}

/** Validate and narrow the preflight request payload. */
function preflightPayload(body: unknown): { sessionId: string; references: SessionReferenceInputView[] } {
  if (!isRecord(body)) throw new BadRequest('BAD_REQUEST', 'preflight body must be a JSON object')
  if (typeof body.sessionId !== 'string' || body.sessionId === '') {
    throw new BadRequest('BAD_REQUEST', 'sessionId must be a non-empty string')
  }
  if (!Array.isArray(body.references)) {
    throw new BadRequest('BAD_REQUEST', 'references must be an array')
  }
  const references = body.references.map((reference, index) => {
    if (!isRecord(reference) || typeof reference.sessionId !== 'string' || reference.sessionId === '') {
      throw new BadRequest('BAD_REQUEST', `references[${String(index)}].sessionId must be a non-empty string`)
    }
    if (reference.label !== undefined && typeof reference.label !== 'string') {
      throw new BadRequest('BAD_REQUEST', `references[${String(index)}].label must be a string when present`)
    }
    return {
      sessionId: reference.sessionId,
      ...(reference.label === undefined ? {} : { label: reference.label }),
    } satisfies SessionReferenceInputView
  })
  return { sessionId: body.sessionId, references }
}

/** Validate and narrow the format request payload. */
function formatPayload(body: unknown): { sessionId: string; label: string | undefined } {
  if (!isRecord(body)) throw new BadRequest('BAD_REQUEST', 'format body must be a JSON object')
  if (typeof body.sessionId !== 'string' || body.sessionId === '') {
    throw new BadRequest('BAD_REQUEST', 'sessionId must be a non-empty string')
  }
  if (body.label !== undefined && typeof body.label !== 'string') {
    throw new BadRequest('BAD_REQUEST', 'label must be a string when present')
  }
  return { sessionId: body.sessionId, label: body.label }
}

/** Read and parse one bounded JSON request body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new BadRequest('BAD_REQUEST', 'request body exceeds 65536 bytes')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new BadRequest('BAD_REQUEST', 'request body is not valid JSON')
  }
}

/** Send one JSON response with the status and common headers. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
