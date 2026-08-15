import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import { registerBridgeRoutes } from '../src/routes.ts'

const config: Config = {
  scope: 'workspace',
  allowBareSessionIds: true,
  allowPlainTitleMentions: true,
  candidateLimit: 50,
  failureMode: 'passthrough',
}

function record(id: string, cwd = '/proj'): SessionRecord {
  return {
    header: { id: id as SessionId, cwd, createdAt: 1 },
    live: true,
    persisted: true,
  } as unknown as SessionRecord
}

function fakeAgent(): Agent {
  return { id: 'session-target' as SessionId, session: { header: { cwd: '/proj' } } } as unknown as Agent
}

function fakeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const ctx = {
    webServer: { register: vi.fn((route: { handler: (req: IncomingMessage, res: ServerResponse) => unknown }) => route.handler) },
    agents: { get: vi.fn((id: string) => (id === 'session-target' ? fakeAgent() : undefined)) },
    sessionQuery: { listSessions: vi.fn(async () => [record('session-target'), record('session-source')]) },
    sessionReferenceResolver: {
      listCandidates: vi.fn(async () => [
        { sessionId: 'session-source' as SessionId, label: '修复bug', cwd: '/proj', createdAt: 1 },
      ]),
      prepare: vi.fn(async () => ({ content: [{ type: 'text', text: '' }] })),
    },
    ...overrides,
  }
  return ctx as unknown as Context
}

interface FakeResponse extends ServerResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  headersSent: boolean
}

function fakeResponse(): FakeResponse {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name: string, value: string) { res.headers[name] = value },
    end(text: string) { res.body = text },
  }
  return res as unknown as FakeResponse
}

function fakeRequest(url: string, body: unknown): IncomingMessage {
  const encoded = Buffer.from(JSON.stringify(body))
  return {
    url,
    method: 'POST',
    once: vi.fn(),
    [Symbol.asyncIterator]: async function * () { yield encoded },
  } as unknown as IncomingMessage
}

async function call(ctx: Context, operation: string, body: unknown): Promise<{ status: number; payload: unknown }> {
  const handler = registerBridgeRoutes(ctx, config) as unknown as (req: IncomingMessage, res: ServerResponse) => Promise<void>
  const res = fakeResponse()
  await handler(fakeRequest(`/dsh-sessions/${operation}`, body), res)
  return { status: res.statusCode, payload: JSON.parse(res.body) as unknown }
}

describe('bridge routes', () => {
  it('returns scoped candidates', async () => {
    const { status, payload } = await call(fakeCtx(), 'candidates', { sessionId: 'session-target', query: '修', limit: 10 })
    expect(status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      value: [{ sessionId: 'session-source', label: '修复bug', cwd: '/proj', createdAt: 1 }],
    })
  })

  it('reports unknown target sessions', async () => {
    const { status, payload } = await call(fakeCtx(), 'preflight', { sessionId: 'missing', references: [{ sessionId: 'session-source' }] })
    expect(status).toBe(200)
    expect(payload).toEqual({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: expect.stringContaining('missing') },
    })
  })

  it('rejects malformed bodies with a bad-request envelope', async () => {
    const { status, payload } = await call(fakeCtx(), 'candidates', { sessionId: 42 })
    expect(status).toBe(400)
    expect(payload).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('sessionId') },
    })
  })

  it('rejects out-of-scope references during preflight', async () => {
    const { status, payload } = await call(fakeCtx(), 'preflight', {
      sessionId: 'session-target',
      references: [{ sessionId: 'session-outside', label: '别的项目' }],
    })
    expect(status).toBe(400)
    expect(payload).toEqual({
      ok: false,
      error: { code: 'SESSION_REFERENCE_SCOPE_DENIED', message: expect.stringContaining('outside') },
    })
  })
})
