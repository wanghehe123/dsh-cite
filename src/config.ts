/**
 * Plugin configuration: reference scope, mention parsing switches, and the
 * pre-step failure policy.
 */
import Schema from '@deepseek-ai/schemastery'
import type { SessionScope } from './types.ts'

export interface Config {
  /** Default reference universe: current workspace (same cwd) or every visible persisted session. */
  scope: SessionScope
  /** Whether bare native session ids in a prompt resolve to references. */
  allowBareSessionIds: boolean
  /** Whether plain `@title` text resolves against session titles without a menu pick. */
  allowPlainTitleMentions: boolean
  /** Candidate menu result cap returned to the browser. */
  candidateLimit: number
  /** Pre-step behavior when the final prepare fails after a successful preflight. */
  failureMode: 'passthrough' | 'reject'
}

export const Config: Schema<Config> = Schema.object({
  scope: Schema.union(['workspace', 'all'] as const).default('workspace'),
  allowBareSessionIds: Schema.boolean().default(true),
  allowPlainTitleMentions: Schema.boolean().default(true),
  candidateLimit: Schema.natural().default(50),
  failureMode: Schema.union(['passthrough', 'reject'] as const).default('passthrough'),
})
