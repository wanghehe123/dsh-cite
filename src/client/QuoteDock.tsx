/**
 * Quote capture surface registered into `conversation.input.dock`: a
 * document-level selection popover plus the quote bar above the composer.
 * Quote state is derived entirely from InputState.occurrences — the same
 * chips the input machine already tracks — so undo, copy/paste, draft edits,
 * and manual chip deletion stay in sync for free.
 */
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { NS } from './locales.ts'
import { QUOTE_SOURCE_NAME } from './quote-source.ts'
import {
  createQuoteId, encodeQuoteRef, formatQuoteBlock, normalizeQuoteText,
  quoteFullText, quotePreview, type QuoteRefPayload,
} from './quote.ts'
import css from './QuoteDock.module.css'

/** Injected face bound by the registration to the session-scoped ctx. */
export interface QuoteDockInjected {
  insertQuote(reference: ReferenceInsert, span: TokenSpan): boolean
  removeQuoteAt(span: TokenSpan): boolean
}

/** Full props: the input.dock owner share, the locale seat, and the bail face. */
export type QuoteDockProps =
  PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & QuoteDockInjected

/** Transient popover anchored to the current selection. */
interface QuotePopup {
  left: number
  top: number
  above: boolean
  text: string
  kind: 'offer' | 'added' | 'failed'
}

/** Small quote-mark glyph; the platform has no quote icon. */
function QuoteGlyph(): ReactElement {
  return (
    <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3v3H4.2c.2 1.1.9 2 1.9 2.6V11c-2.2-.6-4.1-2.1-4.1-4.6V3.5Zm9 0A1.5 1.5 0 0 1 12.5 2h3v3h-2.3c.2 1.1.9 2 1.9 2.6V11c-2.2-.6-4.1-2.1-4.1-4.6V3.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Render the quote bar and the selection popover.
 * @param props - live InputZone snapshot plus the scoped insert/remove face.
 * @returns the dock row when quotes exist, and the portaled popover.
 */
export function QuoteDock({ input, insertQuote, removeQuoteAt, t }: QuoteDockProps): ReactElement {
  const [popup, setPopup] = useState<QuotePopup | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const inputRef = useRef(input)
  const dismissTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => { inputRef.current = input }, [input])

  const quotes = useMemo(() => input.occurrences
    .filter(occurrence => occurrence.source === QUOTE_SOURCE_NAME), [input.occurrences])

  const scheduleDismiss = useCallback(() => {
    window.clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = window.setTimeout(() => { setPopup(null) }, 1400)
  }, [])

  const hideOffer = useCallback(() => {
    setPopup(current => current?.kind === 'offer' ? null : current)
  }, [])

  const updatePopup = useCallback(() => {
    const selection = window.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      hideOffer()
      return
    }
    const range = selection.getRangeAt(0)
    const text = selection.toString()
    if (text.trim() === '') {
      hideOffer()
      return
    }
    const node = range.commonAncestorContainer
    const element = node instanceof Element ? node : node.parentElement
    if (
      element === null
      || element.closest('[data-composer-seat]') !== null
      || element.closest('[data-conversation-scroll]') === null
    ) {
      hideOffer()
      return
    }
    if (inputRef.current.phase !== 'plain') {
      hideOffer()
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      hideOffer()
      return
    }
    window.clearTimeout(dismissTimerRef.current)
    const maxLeft = Math.max(12, window.innerWidth - 12)
    const left = Math.min(Math.max(rect.left + rect.width / 2, 12), maxLeft)
    const above = rect.top >= 48
    const top = above ? rect.top - 8 : rect.bottom + 8
    setPopup({ left, top, above, text, kind: 'offer' })
  }, [hideOffer])

  useEffect(() => {
    document.addEventListener('selectionchange', updatePopup)
    document.addEventListener('scroll', updatePopup, true)
    window.addEventListener('resize', updatePopup)
    return () => {
      document.removeEventListener('selectionchange', updatePopup)
      document.removeEventListener('scroll', updatePopup, true)
      window.removeEventListener('resize', updatePopup)
      window.clearTimeout(dismissTimerRef.current)
    }
  }, [updatePopup])

  const showTransient = useCallback((kind: 'added' | 'failed') => {
    setPopup(current => current === null ? null : { ...current, kind })
    scheduleDismiss()
  }, [scheduleDismiss])

  const focusComposerAtEnd = useCallback(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
    if (textarea === null) return
    textarea.focus({ preventScroll: true })
    requestAnimationFrame(() => {
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    })
  }, [])

  const addQuote = useCallback(() => {
    if (popup === null || popup.kind !== 'offer') return
    const snapshot = inputRef.current
    if (snapshot.phase !== 'plain') {
      showTransient('failed')
      return
    }
    const normalized = normalizeQuoteText(popup.text, t('quote.truncated'))
    if (normalized.text === '') {
      hideOffer()
      return
    }
    const index = snapshot.occurrences
      .filter(occurrence => occurrence.source === QUOTE_SOURCE_NAME).length + 1
    const payload: QuoteRefPayload = {
      v: 1,
      id: createQuoteId(),
      text: normalized.text,
      truncated: normalized.truncated,
    }
    const reference: ReferenceInsert = {
      source: QUOTE_SOURCE_NAME,
      ref: encodeQuoteRef(payload),
      label: t('quote.chip', { index }),
      clipboardText: formatQuoteBlock(normalized.text),
    }
    const span: TokenSpan = {
      start: snapshot.draft.length,
      end: snapshot.draft.length,
      draftRev: snapshot.draftRev,
    }
    if (!insertQuote(reference, span)) {
      showTransient('failed')
      return
    }
    window.getSelection()?.removeAllRanges()
    showTransient('added')
    focusComposerAtEnd()
  }, [popup, insertQuote, showTransient, hideOffer, focusComposerAtEnd, t])

  const toggleExpanded = useCallback((occurrenceId: number) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(occurrenceId)) next.delete(occurrenceId)
      else next.add(occurrenceId)
      return next
    })
  }, [])

  const removeQuote = useCallback((occurrenceId: number, offset: number) => {
    const snapshot = inputRef.current
    if (snapshot.phase !== 'plain' || offset < 0 || offset + 1 > snapshot.draft.length) return
    removeQuoteAt({ start: offset, end: offset + 1, draftRev: snapshot.draftRev })
    setExpanded(current => {
      if (!current.has(occurrenceId)) return current
      const next = new Set(current)
      next.delete(occurrenceId)
      return next
    })
  }, [removeQuoteAt])

  const popover = popup === null ? null : createPortal(
    <div
      className={css.popover}
      style={{
        left: popup.left,
        top: popup.top,
        transform: popup.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      <button
        type="button"
        className={clsx(css.popoverButton, popup.kind === 'failed' && css.popoverFailed)}
        disabled={popup.kind !== 'offer'}
        onMouseDown={event => { event.preventDefault() }}
        onClick={() => { addQuote() }}
      >
        <QuoteGlyph />
        <span>
          {popup.kind === 'added'
            ? t('quote.added')
            : popup.kind === 'failed'
              ? t('quote.failed')
              : t('quote.button')}
        </span>
      </button>
    </div>,
    document.body,
  )

  return (
    <>
      {quotes.length > 0
        ? (
          <section className={css.bar} aria-label={t('quote.count', { count: quotes.length })}>
            <div className={css.barTitle}>{t('quote.count', { count: quotes.length })}</div>
            <ul className={css.list}>
              {quotes.map(quote => {
                const isOpen = expanded.has(quote.occurrenceId)
                return (
                  <li key={quote.occurrenceId} className={css.item}>
                    <div className={css.row}>
                      <button
                        type="button"
                        className={css.toggle}
                        aria-expanded={isOpen}
                        aria-label={t(isOpen ? 'quote.collapse' : 'quote.expand')}
                        onClick={() => { toggleExpanded(quote.occurrenceId) }}
                      >
                        <span className={css.chipLabel}>{quote.label}</span>
                        <span className={css.preview}>{quotePreview(quote.ref, quote.label)}</span>
                        <IconChevronDownOutline14 className={clsx(css.chevron, isOpen && css.chevronOpen)} />
                      </button>
                      <button
                        type="button"
                        className={css.remove}
                        disabled={input.phase !== 'plain'}
                        aria-label={t('quote.remove', { label: quote.label })}
                        onClick={() => { removeQuote(quote.occurrenceId, quote.offset) }}
                      >
                        <IconCloseOutline16 />
                      </button>
                    </div>
                    {isOpen ? <pre className={css.body}>{quoteFullText(quote.ref) ?? quote.label}</pre> : null}
                  </li>
                )
              })}
            </ul>
          </section>
        )
        : null}
      {popover}
    </>
  )
}
