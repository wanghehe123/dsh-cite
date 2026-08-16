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
  createQuoteId, encodeQuoteRef, formatQuoteSerialized, normalizeQuoteComment,
  normalizeQuoteText, quoteComment, quoteFullText, quotePreview, type QuoteRefPayload,
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
  comment: string
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
  const failedTimerRef = useRef<number | undefined>(undefined)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const commentInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current = input }, [input])

  const quotes = useMemo(() => input.occurrences
    .filter(occurrence => occurrence.source === QUOTE_SOURCE_NAME), [input.occurrences])

  const scheduleDismiss = useCallback(() => {
    window.clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = window.setTimeout(() => { setPopup(null) }, 1400)
  }, [])

  const hideOffer = useCallback(() => {
    setPopup(current => current === null || current.kind === 'added' ? current : null)
  }, [])

  const updatePopup = useCallback((event?: Event) => {
    if (
      event?.type === 'selectionchange'
      && popoverRef.current?.contains(document.activeElement)
    ) {
      if (inputRef.current.phase !== 'plain') hideOffer()
      return
    }
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
    setPopup(current => ({
      left,
      top,
      above,
      text,
      comment: current?.text === text ? current.comment : '',
      kind: 'offer',
    }))
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
      window.clearTimeout(failedTimerRef.current)
    }
  }, [updatePopup])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && popoverRef.current?.contains(target)) return
      hideOffer()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => { document.removeEventListener('pointerdown', closeOnOutsidePointer, true) }
  }, [hideOffer])

  const showTransient = useCallback((kind: 'added' | 'failed') => {
    setPopup(current => current === null ? null : { ...current, kind })
    window.clearTimeout(dismissTimerRef.current)
    window.clearTimeout(failedTimerRef.current)
    if (kind === 'added') {
      scheduleDismiss()
      return
    }
    failedTimerRef.current = window.setTimeout(() => {
      setPopup(current => current === null || current.kind !== 'failed' ? current : { ...current, kind: 'offer' })
    }, 1400)
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
    const normalizedComment = normalizeQuoteComment(popup.comment, t('quote.truncated'))
    const comment = normalizedComment.text === '' ? undefined : normalizedComment.text
    const index = snapshot.occurrences
      .filter(occurrence => occurrence.source === QUOTE_SOURCE_NAME).length + 1
    const payload: QuoteRefPayload = {
      v: 1,
      id: createQuoteId(),
      text: normalized.text,
      truncated: normalized.truncated,
      ...(comment === undefined ? {} : { comment }),
    }
    const reference: ReferenceInsert = {
      source: QUOTE_SOURCE_NAME,
      ref: encodeQuoteRef(payload),
      label: t('quote.chip', { index }),
      clipboardText: formatQuoteSerialized(normalized.text, comment),
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
      ref={popoverRef}
      className={css.popover}
      data-dsh-sessions-quote-popover
      style={{
        left: popup.left,
        top: popup.top,
        transform: popup.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {popup.kind === 'offer'
        ? (
          <div
            className={css.popoverCard}
            onMouseDown={event => { event.preventDefault() }}
          >
            <input
              ref={commentInputRef}
              className={css.commentInput}
              data-dsh-sessions-quote-comment
              value={popup.comment}
              placeholder={t('quote.commentPlaceholder')}
              aria-label={t('quote.commentPlaceholder')}
              onMouseDown={event => {
                event.preventDefault()
                event.currentTarget.focus()
              }}
              onChange={event => {
                const comment = event.currentTarget.value
                setPopup(current => current === null ? null : { ...current, comment })
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  if (event.nativeEvent.isComposing) return
                  event.preventDefault()
                  addQuote()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  window.getSelection()?.removeAllRanges()
                  setPopup(null)
                }
              }}
            />
            <button
              type="button"
              className={css.confirmButton}
              aria-label={t('quote.confirm', { index: quotes.length + 1 })}
              title={t('quote.confirm', { index: quotes.length + 1 })}
              onClick={() => { addQuote() }}
            >
              {quotes.length + 1}
            </button>
          </div>
        )
        : (
          <button
            type="button"
            className={clsx(css.popoverButton, popup.kind === 'failed' && css.popoverFailed)}
            disabled
            onMouseDown={event => { event.preventDefault() }}
          >
            <QuoteGlyph />
            <span>{popup.kind === 'added' ? t('quote.added') : t('quote.failed')}</span>
          </button>
        )}
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
                const comment = quoteComment(quote.ref)
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
                    {isOpen
                      ? (
                        <>
                          <pre className={css.body}>{quoteFullText(quote.ref) ?? quote.label}</pre>
                          {comment !== null
                            ? (
                              <div className={css.commentBox}>
                                <div className={css.commentLabel}>{t('quote.commentLabel')}</div>
                                <pre className={css.commentBody}>{comment}</pre>
                              </div>
                            )
                            : null}
                        </>
                      )
                      : null}
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
