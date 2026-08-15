/**
 * Plugin-configuration card for the dsh-sessions reference scope. Reads and
 * writes the plugin-owned `/dsh-sessions/settings` routes, and reuses the
 * built-in plugin-card chrome (name-over-description header, in-place
 * disclosure, staged edit with Save/Discard) so the card matches the shipped
 * Shell / Agent loop / Web search cards on the Plugins page.
 */
import { useEffect, useState, type ReactElement } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import css from './ScopeCard.module.css'
import type { NS } from './locales.ts'

/** Client view of the `dsh-sessions` settings section. */
export interface SessionSettings {
  scope: 'workspace' | 'all'
}

/** Injected face resolved when the card slot mounts. */
export interface ScopeCardInjected {
  load(signal?: AbortSignal): Promise<SessionSettings>
  save(scope: SessionSettings['scope']): Promise<void>
}

export type ScopeCardProps =
  PropsRuntime<'settings.plugin.item'> & PropsLocale<typeof NS> & ScopeCardInjected

/**
 * Render the reference-scope card.
 * @param props - the card's locale seat and its load/save face.
 * @returns the card, or nothing while the settings section is unavailable.
 */
export function ScopeCard({ load, save, t }: ScopeCardProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [scope, setScope] = useState<SessionSettings['scope'] | undefined>()
  const [draft, setDraft] = useState<SessionSettings['scope'] | undefined>()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((settings) => {
        setScope(settings.scope)
        setDraft(settings.scope)
        setStatus('ready')
      })
      .catch(() => { setStatus('unavailable') })
    return () => { controller.abort() }
  }, [load])

  if (status === 'unavailable') return null

  const title = t('settings.title')
  const dirty = status === 'ready' && draft !== undefined && draft !== scope
  const blocked = !dirty || saving

  const select = (next: SessionSettings['scope']): void => {
    if (status !== 'ready') return
    setDraft(next)
    setFailed(false)
  }

  const onSave = (): void => {
    if (blocked || draft === undefined) return
    setSaving(true)
    setFailed(false)
    save(draft)
      .then(() => { setScope(draft) })
      .catch(() => { setFailed(true) })
      .finally(() => { setSaving(false) })
  }

  const onDiscard = (): void => {
    setDraft(scope)
    setFailed(false)
  }

  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(current => !current) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        {dirty ? <span className={css.pending}>{t('settings.unsaved')}</span> : null}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open && status === 'ready' && draft !== undefined
        ? (
          <div className={css.body}>
            <div className={css.field}>
              <span className={css.label} id="dsh-sessions-scope-label">
                {t('settings.scopeLabel')}
              </span>
              <div
                className={css.options}
                role="radiogroup"
                aria-labelledby="dsh-sessions-scope-label"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft === 'workspace'}
                  className={css.option}
                  disabled={saving}
                  onClick={() => { select('workspace') }}
                >
                  <span className={css.optionTitle}>{t('settings.scope.workspace')}</span>
                  <span className={css.optionHint}>{t('settings.scope.workspaceHint')}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft === 'all'}
                  className={css.option}
                  disabled={saving}
                  onClick={() => { select('all') }}
                >
                  <span className={css.optionTitle}>{t('settings.scope.all')}</span>
                  <span className={css.optionHint}>{t('settings.scope.allHint')}</span>
                </button>
              </div>
            </div>
            <div className={css.footer}>
              {failed ? <p className={css.failed} role="status">{t('settings.saveFailed')}</p> : null}
              <button
                type="button"
                className={css.discard}
                disabled={!dirty || saving}
                onClick={onDiscard}
              >
                {t('settings.discard')}
              </button>
              <button
                type="button"
                className={css.save}
                disabled={blocked}
                onClick={onSave}
              >
                {t(saving ? 'settings.saving' : 'settings.save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
