/**
 * dsh-sessions browser half: the `@session` input-trigger source, the
 * copy-session-id row in each workspace session `...` menu, and the plugin
 * configuration card on the Web Plugins settings page.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { en, NS, zh } from './locales.ts'
import { getScopeSetting, setScopeSetting } from './rpc.ts'
import { ScopeCard, type ScopeCardInjected } from './ScopeCard.tsx'
import { createSessionMentionSource } from './session-mention-source.ts'
import { SessionMenuAction } from './SessionMenuAction.tsx'
import type {} from './slot-map.ts'

/** Required client services: locale, session list feed, triggers, and slots. */
export const inject = ['sessions', 'locale', 'inputTriggers', 'slots']

/**
 * Register the session mention source, row-menu copy action, and scope card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sessions: dictionaries')

  ctx.effect(() => {
    const unregister = ctx.inputTriggers.registerSource(createSessionMentionSource(ctx))
    return () => { unregister() }
  }, 'dsh-sessions: @ source')

  ctx.slots.inject(
    'sidebar.workspaces.session-menu',
    () => ctx.slots.register({
      name: 'sidebar.workspaces.session-menu',
      id: 'copy-session-id',
      order: 50,
      locale: NS,
    }, SessionMenuAction),
  )

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
