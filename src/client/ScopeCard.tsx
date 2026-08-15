/**
 * Plugin-configuration card for the dsh-sessions reference scope. Binds the
 * `dsh-sessions` settings namespace and persists explicit scope choices.
 */
import { useState, useSyncExternalStore, type ReactElement } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
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
  scope: SettingsScope<SessionSettings>
}

export type ScopeCardProps =
  PropsRuntime<'settings.plugin.item'> & PropsLocale<typeof NS> & ScopeCardInjected

/** Decode one host settings section into the client scope view. */
function decodeSessionSettings(section: unknown): SessionSettings | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const scope = (section as Record<string, unknown>).scope
  return scope === 'workspace' || scope === 'all' ? { scope } : undefined
}

/** Render the reference-scope card. */
export function ScopeCard({ scope, t }: ScopeCardProps): ReactElement {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const [saving, setSaving] = useState(false)
  const value = snapshot.value?.scope
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving

  const select = (next: SessionSettings['scope']): void => {
    if (disabled || value === next) return
    setSaving(true)
    void scope.set('scope', next).finally(() => { setSaving(false) })
  }

  return (
    <section className={css.card}>
      <div className={css.heading}>
        <h3 className={css.title}>{t('settings.title')}</h3>
        <p className={css.description}>{t('settings.description')}</p>
      </div>
      {snapshot.status === 'unavailable'
        ? <p className={css.unavailable}>{t('settings.unavailable')}</p>
        : (
          <div className={css.options} role="radiogroup" aria-label={t('settings.scopeLabel')}>
            <button
              type="button"
              role="radio"
              aria-checked={value === 'workspace'}
              className={css.option}
              disabled={disabled}
              onClick={() => { select('workspace') }}
            >
              <span className={css.optionTitle}>{t('settings.scope.workspace')}</span>
              <span className={css.optionHint}>{t('settings.scope.workspaceHint')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value === 'all'}
              className={css.option}
              disabled={disabled}
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

export { decodeSessionSettings }
