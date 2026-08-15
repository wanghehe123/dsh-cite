/**
 * dsh-sessions: cross-session @ mentions for the DeepSeek Harness Web UI.
 * The host half mounts `/dsh-sessions` JSON routes, the `agent/pre-step`
 * mention adapter, and a settings namespace the Web Plugins page edits.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-reference'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, type Config as SessionBridgeConfigType } from './config.ts'
import { onPreStep } from './pre-step.ts'
import { registerBridgeRoutes } from './routes.ts'

export type { Config as SessionBridgeConfig } from './config.ts'
export { Config }
export type * from './types.ts'

/** Loader identity. */
export const name = 'dsh-sessions'

/** Settings namespace exposed on the Web Plugins configuration page. */
export const SETTINGS_NAMESPACE = 'dsh-sessions'

/** Services the bridge routes and pre-step adapter read. */
export const inject = ['agents', 'sessionQuery', 'sessionReferenceResolver', 'webServer']

/**
 * Mount the cross-session bridge: `/dsh-sessions` JSON routes plus the
 * `agent/pre-step` mention adapter. The effective configuration follows the
 * settings namespace when a settings provider is composed.
 * @param ctx - host root context.
 * @param config - validated plugin configuration from the Loader entry.
 */
export function apply(ctx: Context, config: SessionBridgeConfigType): void {
  let source = (): SessionBridgeConfigType => config
  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), Config, config, {
    setSource: (next) => { source = next },
    onChange: () => {},
  })
  ctx.effect(() => registerBridgeRoutes(ctx, () => source()), 'dsh-sessions: routes')
  ctx.on('agent/pre-step', (payload, next) => onPreStep(ctx, () => source(), payload, next))
}
