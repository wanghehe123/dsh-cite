/**
 * Produced-file tracking for dsh-sessions.
 *
 * The browser half mirrors the shipped `ui-deliverables` contract but uses a
 * private turn-data key and a private conversation Definition so it never
 * collides with (and never depends on) the official deliverables plugin. The
 * vocabulary is the mutation tools own follow-along locations, never the
 * closing prose, so a produced file is listed even when the model forgets to
 * name it.
 *
 * The Definition is stateless: it matches tool-call/tool-result events and
 * derives turn data directly from the context matches. That keeps the row
 * visible when a reopened session window starts after `turn/start` (history
 * pages are cut at message boundaries, so a turn-start can fall outside the
 * loaded window).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  isAppendSurfaceEvent,
  resolveWorkspacePath,
  type ConversationMatch,
  type ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { copyTextToClipboard } from '../vendor/workspace/clipboard.ts'
import { Artifacts, type ArtifactsInjected } from './Artifacts.tsx'
import { NS } from './locales.ts'
import { dirname } from './platform.ts'

/** Private Turn-data key; distinct from the official `deliverables` key. */
export const DELIVERABLES_KEY = 'dsh-sessions-deliverables'

interface ProducedPath {
  readonly seq: number
  readonly path: string
}

export interface DshDeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    'dsh-sessions-deliverables': DshDeliverablesTurnData
  }
}

/** Structural subset of the tool presentation call view. */
interface MutationCallView {
  card?: string
  kind?: string
  locations?: readonly { path?: string }[]
}

interface ArtifactsState {
  readonly produced: readonly ProducedPath[]
}

function pathsFromCallView(view: unknown): readonly string[] {
  if (view === null || typeof view !== 'object') return []
  const call = view as MutationCallView
  if (call.card === 'diff') return call.locations?.map(location => location.path ?? '').filter(Boolean) ?? []
  if (call.card === 'generic' && call.kind === 'edit') return call.locations?.map(location => location.path ?? '').filter(Boolean) ?? []
  return []
}

/** Derive first-seen produced paths from the context's already-matched events. */
function producedFromMatches(matches: readonly ConversationMatch[]): readonly ProducedPath[] {
  const calls = new Map<string, MutationCallView | null>()
  const produced: ProducedPath[] = []
  for (const match of matches) {
    const event = match.event
    if (event.type === 'tool/call') {
      const callView = match.view?.for === 'call' ? match.view.view : null
      calls.set(String(event.data.callId), callView as MutationCallView | null)
      continue
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      const first = event.data.message.content[0]
      if (first === undefined || first.isError === true) continue
      const callId = String(event.data.message.source.callId)
      const additions = pathsFromCallView(calls.get(callId) ?? null)
      for (const path of additions) produced.push({ seq: event.seq, path })
    }
  }
  return produced
}

/**
 * Files produced by one turn data value, in first-seen order, excluding Tool
 * settlements that landed after the closing assistant seq.
 */
export function producedForClosing(
  data: Readonly<DshDeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/** Turn-local produced-file accumulator; publishes no view Node. */
export const artifactsDefinition: ConversationNodeDefinition<ArtifactsState> = {
  kind: 'dsh-sessions-deliverables',
  match(event) {
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start() {
    throw new Error('dsh-sessions deliverables is stateless; start must never be called')
  },
  update(context) {
    return context.state
  },
  buildLocationData(context, scope) {
    if (scope !== 'turn') return null
    const produced = producedFromMatches(context.matches)
    if (produced.length === 0) return null
    const turn = Number(context.id)
    if (Number.isSafeInteger(turn) === false || turn < 0) return null
    return {
      kind: 'turn',
      turn,
      key: 'dsh-sessions-deliverables',
      value: { produced },
    }
  },
}

/** Claim the turn-tail chain only when the closing turn produced files. */
export function selectArtifacts(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('dsh-sessions-deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/**
 * Register the produced-file accumulator and the artifacts turn-tail row.
 * @param ctx - client root context.
 */
export function registerArtifacts(ctx: ClientContext): void {
  ctx.conversationEvents.register(artifactsDefinition)

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    {
      name: 'conversation.chat.turnTail',
      select: selectArtifacts,
      // Run before the shipped deliverables row when both are present.
      priority: -100,
      locale: NS,
      inject: (sessionId): ArtifactsInjected => {
        const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
        return {
          copyPath: path => copyTextToClipboard(resolveWorkspacePath(cwd, path)),
          revealPath: async (path) => {
            const absolute = resolveWorkspacePath(cwd, path)
            await ctx.workspaces.openPath(dirname(absolute))
          },
        }
      },
    },
    Artifacts,
  ))
}
