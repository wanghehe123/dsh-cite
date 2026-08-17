/**
 * dsh-cite: point the current turn at past sessions, earlier messages,
 * and files this turn just wrote. The host half mounts `/dsh-sessions`
 * JSON routes, the `agent/pre-step` mention adapter, and a settings
 * namespace persisted through the harness settings seam (edited by the
 * browser card via the plugin's own routes).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-reference'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, type Config as SessionBridgeConfigType } from './config.ts'
import { onPreStep } from './pre-step.ts'
import { registerBridgeRoutes } from './routes.ts'

export type { Config as SessionBridgeConfig } from './config.ts'
export { Config }
export type * from './types.ts'

/** Loader identity. */
export const name = 'dsh-sessions'

/** Settings namespace persisted through the settings seam. */
export const SETTINGS_NAMESPACE = 'dsh-sessions'

/** Services the bridge routes and pre-step adapter read. */
export const inject = ['agents', 'sessionQuery', 'sessionReferenceResolver', 'webServer']

/** Settings handle surfaced to the bridge routes once the settings service exists. */
export interface SessionBridgeSettings {
  get(): SessionBridgeConfigType
  update(patch: Partial<SessionBridgeConfigType>): Promise<void>
}

/**
 * Mount the cross-session bridge: `/dsh-sessions` JSON routes plus the
 * `agent/pre-step` mention adapter. The effective configuration follows the
 * persisted settings section when a settings provider is composed.
 * @param ctx - host root context.
 * @param config - validated plugin configuration from the Loader entry.
 */
export function apply(ctx: Context, config: SessionBridgeConfigType): void {
  let source = (): SessionBridgeConfigType => config
  let settings: SessionBridgeSettings | undefined
  ctx.inject(['settings'], (settingsCtx) => {
    const scope: SettingsScope<SessionBridgeConfigType> = settingsCtx.settings.register(
      settingsNamespace(SETTINGS_NAMESPACE),
      Config,
      { base: config },
    )
    source = () => scope.get()
    settings = {
      get: () => scope.get(),
      update: async patch => { await scope.update(patch) },
    }
  })
  ctx.effect(() => registerBridgeRoutes(ctx, () => source(), () => settings), 'dsh-sessions: routes')
  ctx.on('agent/pre-step', (payload, next) => onPreStep(ctx, () => source(), payload, next))
}
