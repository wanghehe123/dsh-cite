import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import { resolveMentionText, SessionReferenceScopeError } from '../src/mention.ts'

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

function allowed(records: SessionRecord[]): ReadonlyMap<string, SessionRecord> {
  return new Map(records.map(record => [record.header.id, record]))
}

function agent(): Agent {
  return { session: { header: { cwd: '/proj' } } } as unknown as Agent
}

function ctx(listCandidates = (): Awaited<ReturnType<Context['sessionReferenceResolver']['listCandidates']>> => []) {
  return { sessionReferenceResolver: { listCandidates: vi.fn(listCandidates) } } as unknown as Context
}

describe('resolveMentionText', () => {
  it('normalizes a canonical mention to readable @label text', async () => {
    const id = 'session-0c3a66f2-efa1-4564-a550-6920dc1597fc'
    const mention = formatSessionReferenceMention({ sessionId: id as SessionId, label: '修复bug' })
    const resolved = await resolveMentionText(ctx(), agent(), allowed([record(id)]), `继续 ${mention} 的结论`, config)
    expect(resolved.text).toBe('继续 @修复bug 的结论')
    expect(resolved.references).toEqual([{ sessionId: id as SessionId, label: '修复bug' }])
  })

  it('collects a bare session id without rewriting the text', async () => {
    const id = 'session-0c3a66f2-efa1-4564-a550-6920dc1597fc'
    const resolved = await resolveMentionText(ctx(), agent(), allowed([record(id)]), `继续 session-0c3a66f2-efa1-4564-a550-6920dc1597fc`, config)
    expect(resolved.text).toBe('继续 session-0c3a66f2-efa1-4564-a550-6920dc1597fc')
    expect(resolved.references).toEqual([{ sessionId: id as SessionId, label: id }])
  })

  it('resolves a unique plain @title mention', async () => {
    const id = 'session-abc'
    const candidates = [{ sessionId: id as SessionId, label: '修复bug', cwd: '/proj', createdAt: 1 }]
    const resolved = await resolveMentionText(ctx(() => candidates), agent(), allowed([record(id)]), '@修复bug 继续', config)
    expect(resolved.text).toBe('@修复bug 继续')
    expect(resolved.references).toEqual([{ sessionId: id as SessionId, label: '修复bug' }])
  })

  it('leaves an ambiguous plain title unresolved', async () => {
    const a = 'session-a'
    const b = 'session-b'
    const candidates = [
      { sessionId: a as SessionId, label: '修复bug', cwd: '/proj', createdAt: 1 },
      { sessionId: b as SessionId, label: '修复bug', cwd: '/proj', createdAt: 1 },
    ]
    const resolved = await resolveMentionText(ctx(() => candidates), agent(), allowed([record(a), record(b)]), '@修复bug 继续', config)
    expect(resolved.references).toEqual([])
  })

  it('rejects references outside the allowed scope', async () => {
    const id = 'session-outside'
    await expect(resolveMentionText(
      ctx(),
      agent(),
      allowed([record('session-inside')]),
      formatSessionReferenceMention({ sessionId: id as SessionId, label: '别的项目' }),
      config,
    )).rejects.toBeInstanceOf(SessionReferenceScopeError)
  })
})
