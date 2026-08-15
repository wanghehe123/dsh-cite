/**
 * dsh-sessions: cross-session @ mentions for the DeepSeek Harness Web UI.
 * The host half mounts the bridge Remote service and the `agent/pre-step`
 * adapter; the browser half lives under `./client`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-reference'
import { Config, type Config as SessionBridgeConfigType } from './config.ts'
import { onPreStep } from './pre-step.ts'
import { registerBridgeRoutes } from './routes.ts'

export type { Config as SessionBridgeConfig } from './config.ts'
export { Config }
export type * from './types.ts'

/** Loader identity. */
export const name = 'dsh-sessions'

/** Services the bridge routes and pre-step adapter read. */
export const inject = ['agents', 'sessionQuery', 'sessionReferenceResolver', 'webServer']

/**
 * Mount the cross-session bridge: `/dsh-sessions` JSON routes plus the
 * `agent/pre-step` mention adapter.
 * @param ctx - host root context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: SessionBridgeConfigType): void {
  ctx.effect(() => registerBridgeRoutes(ctx, config), 'dsh-sessions: routes')
  ctx.on('agent/pre-step', (payload, next) => onPreStep(ctx, config, payload, next))
}
