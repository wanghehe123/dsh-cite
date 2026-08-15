/**
 * Slot-map merge for the upstream ui-workspace session row-menu extension.
 * The upstream patch declares this key; the merge here keeps the published
 * plugin compilable until a dsh release ships the identical contract.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.workspaces.session-menu': {
      kind: 'list'
      scope: 'root'
      owner: SessionMenuOwnerProps
    }
  }
}

/** Owner currency passed to one session row-menu contribution. */
export interface SessionMenuOwnerProps {
  sessionId: SessionId
  title: string
  onClose: () => void
}
