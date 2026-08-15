/**
 * dsh-sessions browser half: vendored workspace surface with copy-session-id,
 * the `@session` input-trigger source, the quote-capture surface in the
 * composer, and the plugin configuration card on the Web Plugins settings
 * page.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { en, NS, zh } from './locales.ts'
import { getScopeSetting, setScopeSetting } from './rpc.ts'
import { QuoteDock, type QuoteDockInjected } from './QuoteDock.tsx'
import { createQuoteSource } from './quote-source.ts'
import { ScopeCard, type ScopeCardInjected } from './ScopeCard.tsx'
import { createSessionMentionSource } from './session-mention-source.ts'
import { registerWorkspaceSurface } from '../vendor/workspace/index.ts'

/** Required client services: locale, session/workspace feeds, triggers, slots. */
export const inject = ['sessions', 'workspaces', 'locale', 'inputTriggers', 'slots']

/**
 * Register the vendored workspace surface, session mention source, quote
 * capture surface, and reference-scope configuration card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sessions: dictionaries')
  registerWorkspaceSurface(ctx)

  ctx.effect(() => {
    const unregister = ctx.inputTriggers.registerSource(createSessionMentionSource(ctx))
    return () => { unregister() }
  }, 'dsh-sessions: @ source')

  ctx.effect(() => {
    const unregister = ctx.inputTriggers.registerSource(createQuoteSource())
    return () => { unregister() }
  }, 'dsh-sessions: quote source')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'dsh-sessions-quote-dock',
      order: 100,
      locale: NS,
      inject: (sessionId): QuoteDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) {
          throw new Error(`dsh-sessions: quote surface resolved no session scope for "${String(sessionId)}"`)
        }
        return {
          insertQuote: (reference, span) =>
            actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true,
          removeQuoteAt: (span) =>
            actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true,
        }
      },
    },
    QuoteDock,
  ))

  ctx.slots.inject(
    'settings.plugin.item',
    () => ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'dsh-sessions-scope',
      order: 100,
      locale: NS,
      inject: (): ScopeCardInjected => ({
        load: signal => getScopeSetting(signal),
        save: scope => setScopeSetting(scope),
      }),
    }, ScopeCard),
  )
}
