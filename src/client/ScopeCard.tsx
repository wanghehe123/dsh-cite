/**
 * Plugin-configuration card for the dsh-sessions reference scope. Reads and
 * writes the plugin-owned `/dsh-sessions/settings` routes.
 */
import { useEffect, useState, type ReactElement } from 'react'
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

/** Render the reference-scope card. */
export function ScopeCard({ load, save, t }: ScopeCardProps): ReactElement {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [scope, setScope] = useState<SessionSettings['scope'] | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((settings) => {
        setScope(settings.scope)
        setStatus('ready')
      })
      .catch(() => { setStatus('unavailable') })
    return () => { controller.abort() }
  }, [load])

  const select = (next: SessionSettings['scope']): void => {
    if (saving || scope === undefined) return
    setSaving(true)
    save(next)
      .then(() => { setScope(next) })
      .finally(() => { setSaving(false) })
  }

  return (
    <section className={css.card}>
      <div className={css.heading}>
        <h3 className={css.title}>{t('settings.title')}</h3>
        <p className={css.description}>{t('settings.description')}</p>
      </div>
      {status === 'unavailable'
        ? <p className={css.unavailable}>{t('settings.unavailable')}</p>
        : (
          <div className={css.options} role="radiogroup" aria-label={t('settings.scopeLabel')}>
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'workspace'}
              className={css.option}
              disabled={status !== 'ready' || saving}
              onClick={() => { select('workspace') }}
            >
              <span className={css.optionTitle}>{t('settings.scope.workspace')}</span>
              <span className={css.optionHint}>{t('settings.scope.workspaceHint')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'all'}
              className={css.option}
              disabled={status !== 'ready' || saving}
              onClick={() => { select('all') }}
            >
              <span className={css.optionTitle}>{t('settings.scope.all')}</span>
              <span className={css.optionHint}>{t('settings.scope.allHint')}</span>
            </button>
          </div>
        )}
    </section>
  )
}
