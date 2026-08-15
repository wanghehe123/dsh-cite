/**
 * dsh-sessions browser half: vendored workspace surface with copy-session-id,
 * the `@session` input-trigger source, and the plugin configuration card on
 * the Web Plugins settings page.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { en, NS, zh } from './locales.ts'
import { getScopeSetting, setScopeSetting } from './rpc.ts'
import { ScopeCard, type ScopeCardInjected } from './ScopeCard.tsx'
import { createSessionMentionSource } from './session-mention-source.ts'
import { createQuoteSource } from './quote-source.ts'
import { registerWorkspaceSurface } from '../vendor/workspace/index.ts'

/** Required client services: locale, session/workspace feeds, triggers, slots. */
export const inject = ['sessions', 'workspaces', 'locale', 'inputTriggers', 'slots']

/**
 * Register the vendored workspace surface, session mention source, and
 * reference-scope configuration card.
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
