/**
 * Copy-session-id row rendered inside each session's `...` menu through the
 * upstream `sidebar.workspaces.session-menu` slot.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { IconCopyOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import css from './SessionMenuAction.module.css'
import type { NS } from './locales.ts'
import type {} from './slot-map.ts'

export type SessionMenuActionProps =
  PropsRuntime<'sidebar.workspaces.session-menu'> & PropsLocale<typeof NS>

/** Close delay after a successful copy, so the row shows feedback first. */
const COPIED_CLOSE_MS = 900

/** Copy the addressed session's native id to the clipboard. */
export function SessionMenuAction({ sessionId, title, onClose, t }: SessionMenuActionProps): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(onClose, COPIED_CLOSE_MS)
    return () => { window.clearTimeout(timer) }
  }, [copied, onClose])

  return (
    <button
      type="button"
      role="menuitem"
      className={css.row}
      title={title}
      onClick={() => {
        if (copied) return
        void writeClipboard(sessionId).then((ok) => {
          if (ok) setCopied(true)
          else onClose()
        })
      }}
    >
      <span className={css.icon}><IconCopyOutline16 /></span>
      <span className={css.label}>{copied ? t('menu.copied') : t('menu.copySessionId')}</span>
    </button>
  )
}
