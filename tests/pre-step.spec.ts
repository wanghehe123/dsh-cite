import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import { onPreStep } from '../src/pre-step.ts'

const sourceId = 'session-source' as SessionId
const targetCwd = '/proj'

const config: Config = {
  scope: 'workspace',
  allowBareSessionIds: true,
  allowPlainTitleMentions: false,
  candidateLimit: 50,
  failureMode: 'passthrough',
}

function record(id: string): SessionRecord {
  return {
    header: { id: id as SessionId, cwd: targetCwd, createdAt: 1 },
    live: true,
    persisted: true,
  } as unknown as SessionRecord
}

function snapshotMessage(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: '## Referenced sessions' }],
    source: {
      kind: 'session-reference',
      form: 'recall',
      version: 1,
      references: [],
    },
  })
}

function directMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function agent(): Agent {
  return { session: { header: { cwd: targetCwd } }, id: 'session-target' as SessionId } as unknown as Agent
}

function ctx(prepare = (): ReturnType<Context['sessionReferenceResolver']['prepare']> => Promise.resolve({
  content: [{ type: 'text', text: '继续 @修复bug 的结论' }],
  additionalContext: snapshotMessage(),
})) {
  return {
    sessionQuery: { listSessions: vi.fn(async () => [record(sourceId), record('session-target')]) },
    sessionReferenceResolver: { prepare: vi.fn(prepare) },
  } as unknown as Context
}

async function run(text: string, nextMessages?: UserMessage[]): Promise<PreStepDecision> {
  const direct = directMessage(text)
  const decision: Extract<PreStepDecision, { kind: 'enter' }> = {
    kind: 'enter',
    messages: nextMessages ?? [direct],
  }
  return onPreStep(
    ctx(),
    () => config,
    { agent: agent(), messages: [direct], signal: new AbortController().signal },
    async () => decision,
  )
}

describe('onPreStep', () => {
  it('inserts the snapshot immediately before the readable direct message', async () => {
    const mention = formatSessionReferenceMention({ sessionId: sourceId, label: '修复bug' })
    const decision = await run(`继续 ${mention} 的结论`)
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[0]?.source.kind).toBe('session-reference')
    expect(decision.messages[1]?.source.kind).toBe('user')
    expect(decision.messages[1]?.content).toEqual([{ type: 'text', text: '继续 @修复bug 的结论' }])
  })

  it('ignores tool-result and injected context messages', async () => {
    const direct = directMessage('没有引用')
    const tool = createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: '@修复bug' }] }],
      source: { kind: 'tool', callId: 'call-1' as never },
    })
    const decision = await run('没有引用', [tool, direct])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toEqual([tool, direct])
  })
})
