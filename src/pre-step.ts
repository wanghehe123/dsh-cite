/**
 * `agent/pre-step` adapter: after the ordinary enter decision, parse direct
 * user messages for session mentions, prepare bounded read-only snapshots, and
 * rewrite the entering messages to `[snapshot, readable direct message, …]`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionReferenceInput } from '@deepseek-ai/dsh-session-reference'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { Config } from './config.ts'
import { resolveMentionText } from './mention.ts'
import { allowedSessionRecords } from './scope.ts'

/** One adapted direct message: normalized readable text plus optional snapshot. */
interface AdaptedMessage {
  message: UserMessage
  snapshot: UserMessage | undefined
}

/** Per-message adaptation outcome; `unchanged` means the message had no mentions. */
type Adaptation =
  | { kind: 'unchanged' }
  | { kind: 'adapted'; value: AdaptedMessage }
  | { kind: 'reject'; error: unknown }

/** `agent/pre-step` waterfall payload facts this adapter reads. */
export interface PreStepPayload {
  agent: Agent
  messages: UserMessage[]
  signal: AbortSignal
}

/**
 * Waterfall listener registered on `agent/pre-step`.
 * @param payload - proposed step position, claimed messages, and cancellation.
 * @param next - the machine's default enter decision.
 * @returns the decision with referenced-session snapshots inserted, or reject.
 */
export async function onPreStep(
  ctx: Context,
  configSource: () => Config,
  payload: PreStepPayload,
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const decision = await next()
  if (decision.kind !== 'enter') return decision

  const config = configSource()
  const { agent, signal } = payload
  let allowed: ReadonlyMap<string, SessionRecord> | undefined
  const messagesOut: UserMessage[] = []
  for (const message of decision.messages) {
    if (message.source.kind !== 'user') {
      messagesOut.push(message)
      continue
    }
    allowed ??= await allowedSessionRecords(ctx, agent, config.scope, signal).catch(() => undefined)
    if (allowed === undefined) {
      messagesOut.push(message)
      continue
    }
    const adaptation = await adaptMessage(ctx, agent, allowed, message, config, signal)
    switch (adaptation.kind) {
      case 'unchanged':
        messagesOut.push(message)
        break
      case 'reject':
        if (config.failureMode === 'reject') return { kind: 'reject' }
        messagesOut.push(message)
        break
      case 'adapted': {
        const { message: adapted, snapshot } = adaptation.value
        if (snapshot !== undefined) messagesOut.push(snapshot)
        messagesOut.push(adapted)
        break
      }
    }
  }
  return { kind: 'enter', messages: messagesOut }
}

/** Parse one direct message, prepare its snapshot, and produce replacement messages. */
async function adaptMessage(
  ctx: Context,
  agent: Agent,
  allowed: ReadonlyMap<string, SessionRecord>,
  message: UserMessage,
  config: Config,
  signal: AbortSignal,
): Promise<Adaptation> {
  const references: SessionReferenceInput[] = []
  const seen = new Set<string>()
  let content: ContentBlock[] | undefined
  try {
    const nextBlocks: ContentBlock[] = []
    for (const block of message.content) {
      if (block.type !== 'text') {
        nextBlocks.push(block)
        continue
      }
      const resolved = await resolveMentionText(ctx, agent, allowed, block.text, config, signal)
      nextBlocks.push({ type: 'text', text: resolved.text })
      for (const reference of resolved.references) {
        if (seen.has(reference.sessionId)) continue
        seen.add(reference.sessionId)
        references.push(reference)
      }
    }
    if (references.length === 0) return { kind: 'unchanged' }
    content = nextBlocks

    const prepared = await ctx.sessionReferenceResolver.prepare(agent, content, references, signal)
    return {
      kind: 'adapted',
      value: {
        message: freezeMessage({ ...message, content: prepared.content }),
        snapshot: prepared.additionalContext,
      },
    }
  } catch (error: unknown) {
    if (signal.aborted) return { kind: 'unchanged' }
    console.error(`[dsh-sessions] pre-step reference preparation failed:`, error)
    // Parsing already succeeded: reject mode refuses the step; passthrough
    // keeps the readable normalized text without the snapshot. A parse
    // failure leaves the original message untouched for the passthrough path.
    if (content !== undefined) {
      if (config.failureMode === 'reject') return { kind: 'reject', error }
      return {
        kind: 'adapted',
        value: {
          message: freezeMessage({ ...message, content }),
          snapshot: undefined,
        },
      }
    }
    return { kind: 'reject', error }
  }
}
