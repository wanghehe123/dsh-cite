/**
 * dsh-sessions browser half: the `@session` input-trigger source, the
 * copy-session-id row in each workspace session `...` menu, and the plugin
 * configuration card on the Web Plugins settings page.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { ScopeCard, decodeSessionSettings, type ScopeCardInjected } from './ScopeCard.tsx'
import { en, NS, zh } from './locales.ts'
import { createSessionMentionSource } from './session-mention-source.ts'
import { SessionMenuAction } from './SessionMenuAction.tsx'
import type {} from './slot-map.ts'

/** Settings namespace the host half registers and this card edits. */
const SETTINGS_NAMESPACE = 'dsh-sessions'

/** Required client services: locale, session list feed, triggers, slots, settings. */
export const inject = ['sessions', 'locale', 'inputTriggers', 'slots', 'settingsScope']

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
        scope: ctx.settingsScope.bind({
          namespace: SETTINGS_NAMESPACE,
          decode: decodeSessionSettings,
        }),
      }),
    }, ScopeCard),
  )
}
