/**
 * dsh-sessions browser half: the `@session` input-trigger source and the
 * copy-session-id row in each workspace session `...` menu.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionMenuAction } from './SessionMenuAction.tsx'
import { en, NS, zh } from './locales.ts'
import { createSessionMentionSource } from './session-mention-source.ts'
import type {} from './slot-map.ts'

/** Required client services: locale, session list feed, triggers, and slots. */
export const inject = ['sessions', 'locale', 'inputTriggers', 'slots']

/**
 * Register the session mention source and the row-menu copy action.
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
}
