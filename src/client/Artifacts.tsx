/**
 * Final-artifacts row rendered below a completed assistant message. Each
 * produced file is listed with a document glyph and an optional description
 * parsed from the closing message's Markdown list. Right-click (or the
 * platform's equivalent gesture) offers open / copy path / reveal in the
 * desktop file manager.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderOpenOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import { basename, desktopLabel } from './platform.ts'
import css from './Artifacts.module.css'

/** Injected face bound by the turn-tail registration. */
export interface ArtifactsInjected {
  /** Copy the resolved produced path to the browser clipboard. */
  copyPath(path: string): Promise<boolean>
  /** Open the produced file's containing folder in the OS file manager. */
  revealPath(path: string): Promise<void>
}

/** Full props: turn-tail owner share + session kit + matched paths + locale + injected face. */
export type ArtifactsProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & PropsLocale<typeof NS>
  & ArtifactsInjected
  & { matched: readonly string[] }

interface ArtifactItem {
  path: string
  name: string
  description?: string
}

interface ContextMenuState {
  x: number
  y: number
  path: string
}

/** Small document glyph; the platform has no file icon. */
function FileGlyph(): ReactElement {
  return (
    <svg className={css.fileIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.2l-3.7-3.7H4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M10 1.5v3.4h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8h6M5 10.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Parse a Markdown-list description for one produced path from the closing prose. */
function descriptionFor(path: string, text: string): string | undefined {
  if (text === '') return undefined
  const name = basename(path)
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(raw)) continue
    const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()
    if (!line.includes(name)) continue
    const plain = line.replace(/`/g, '')
    const index = plain.indexOf(name)
    if (index === -1) continue
    const after = plain.slice(index + name.length)
    const match = after.match(/^\s*(?::|：| - | — | – |\t| )(.*)$/)
    if (match !== null && match[1] !== undefined && match[1].trim() !== '') {
      return match[1].trim()
    }
  }
  return undefined
}

/**
 * Render one turn's produced files as a vertical artifact list.
 * @param props - matched paths, the chat view's file opener, locale, and injected face.
 * @returns the artifacts row, or null when there are no paths.
 */
export function Artifacts({ matched: paths, openFile, seq, useSession, copyPath, revealPath, t }: ArtifactsProps): ReactElement | null {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const toastId = useRef(0)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const chat = useSession(s => s.chat)

  const closingText = useMemo(() => {
    for (const node of chat.nodes.values()) {
      if (node.kind !== 'assistant-step') continue
      const data = node.data as { finalNode?: { seq?: number }; blocks?: readonly { kind?: string; text?: string }[] }
      if (data.finalNode?.seq !== seq) continue
      return data.blocks
        ?.filter(block => block.kind === 'text')
        .map(block => block.text ?? '')
        .join('\n') ?? ''
    }
    return ''
  }, [chat, seq])

  const items = useMemo<readonly ArtifactItem[]>(
    () => paths.map((path) => {
      const description = descriptionFor(path, closingText)
      return description === undefined
        ? { path, name: basename(path) }
        : { path, name: basename(path), description }
    }),
    [paths, closingText],
  )

  useEffect(() => {
    if (menu === null) return
    const close = () => { setMenu(null) }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const showToast = useCallback((text: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, text })
  }, [])

  const runAction = useCallback(async (path: string, action: 'open' | 'copy' | 'reveal') => {
    setMenu(null)
    setBusyPath(path)
    try {
      if (action === 'open') {
        openFile(path)
      } else if (action === 'copy') {
        const ok = await copyPath(path)
        showToast(ok ? t('artifacts.copied') : t('artifacts.copyFailed'))
      } else {
        await revealPath(path)
      }
    } catch {
      showToast(action === 'copy' ? t('artifacts.copyFailed') : action === 'reveal' ? t('artifacts.revealFailed') : t('artifacts.openFailed'))
    } finally {
      setBusyPath(null)
    }
  }, [openFile, copyPath, revealPath, showToast, t])

  const revealLabel = desktopLabel({
    macos: t('artifacts.reveal.macos'),
    windows: t('artifacts.reveal.windows'),
    linux: t('artifacts.reveal.linux'),
  })

  const menuStyle = menu === null
    ? undefined
    : {
      left: Math.max(8, Math.min(menu.x, window.innerWidth - 208)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - 132)),
    }

  return (
    <div className={css.root} data-dsh-sessions-artifacts>
      <span className={css.label}>{t('artifacts.label')}</span>
      <ul className={css.list}>
        {items.map(item => (
          <li key={item.path} className={css.item}>
            <button
              type="button"
              className={css.file}
              title={item.path}
              disabled={busyPath === item.path}
              onClick={() => { runAction(item.path, 'open') }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, path: item.path })
              }}
            >
              <FileGlyph />
              <span className={css.name}>{item.name}</span>
              {item.description !== undefined && <span className={css.description}>：{item.description}</span>}
            </button>
          </li>
        ))}
      </ul>

      {menu !== null && createPortal(
        <div
          ref={menuRef}
          className={css.menu}
          style={menuStyle}
          role="menu"
          onMouseDown={(event) => { event.stopPropagation() }}
          onClick={(event) => { event.stopPropagation() }}
        >
          <button type="button" className={css.menuItem} onClick={() => { runAction(menu.path, 'open') }}>
            <span className={css.menuItemLabel}>{t('artifacts.open')}</span>
            <span className={css.menuItemMeta}>{basename(menu.path)}</span>
          </button>
          <button type="button" className={css.menuItem} onClick={() => { runAction(menu.path, 'copy') }}>
            <span className={css.menuItemLabel}>{t('artifacts.copyPath')}</span>
          </button>
          <button type="button" className={css.menuItem} onClick={() => { runAction(menu.path, 'reveal') }}>
            <IconFolderOpenOutline16 size={16} className={css.menuItemIcon} />
            <span className={css.menuItemLabel}>{revealLabel}</span>
          </button>
        </div>,
        document.body,
      )}

      {toast !== null && (
        <Toast key={toast.id} text={toast.text} onDone={() => { setToast(current => current?.id === toast.id ? null : current) }} />
      )}
    </div>
  )
}
