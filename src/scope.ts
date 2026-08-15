/**
 * Reference-scope filtering: same workspace (source session cwd equals the
 * target session cwd) or every visible persisted session.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionScope } from './types.ts'

/** Session ids allowed to back references for one target agent. */
export async function allowedSessionRecords(
  ctx: Context,
  agent: Agent,
  scope: SessionScope,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, SessionRecord>> {
  const records = await ctx.sessionQuery.listSessions(signal)
  const targetCwd = agent.session.header.cwd
  const allowed = new Map<string, SessionRecord>()
  for (const record of records) {
    if (record.header.id === agent.id) continue
    if (scope === 'workspace' && record.header.cwd !== targetCwd) continue
    allowed.set(record.header.id, record)
  }
  return allowed
}

/** Id strings allowed to back references for one target agent. */
export async function allowedSessionIds(
  ctx: Context,
  agent: Agent,
  scope: SessionScope,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  return new Set((await allowedSessionRecords(ctx, agent, scope, signal)).keys())
}

/** Cast one wire id to the branded host identity. */
export function sessionId(value: string): SessionId {
  return value as SessionId
}
