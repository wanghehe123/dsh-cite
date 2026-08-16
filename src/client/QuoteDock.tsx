/**
 * Quote capture surface registered into `conversation.input.dock`: a
 * document-level selection popover, per-quote anchor bubbles above the
 * selected sentence, a comment editor launched from each bubble, and the
 * quote bar above the composer. Quote state is derived entirely from
 * InputState.occurrences — the same chips the input machine already tracks.
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
  createQuoteId, decodeQuoteRef, encodeQuoteRef, formatQuoteSerialized,
  normalizeQuoteComment, normalizeQuoteText, quoteComment, quoteFullText,
  quotePreview, withQuoteComment, type QuoteRefPayload,
} from './quote.ts'
import css from './QuoteDock.module.css'

/** Result of replacing one quote chip in place. */
export interface QuoteUpdateResult {
  saved: boolean
  /** New occurrenceId minted by the fallback re-insert of the previous ref. */
  restoredOccurrenceId?: number
}

/** Injected face bound by the registration to the session-scoped ctx. */
export interface QuoteDockInjected {
  insertQuote(reference: ReferenceInsert, span: TokenSpan): boolean
  removeQuoteAt(span: TokenSpan): boolean
  /**
   * Replace the reference at `offset` in place: consume the old chip, then
   * insert `next` at the same draft offset with a fresh draftRev. Falls back
   * to re-inserting `previous` when the next insert is rejected.
   */
  updateQuote(offset: number, next: ReferenceInsert, previous: ReferenceInsert): QuoteUpdateResult
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

/** Viewport position of one quote anchor bubble. */
interface BubbleRect {
  left: number
  top: number
}

/** Open comment editor anchored below one quote bubble. */
interface EditorState {
  occurrenceId: number
  left: number
  top: number
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
 * Render the quote bar, the selection popover, the per-quote anchor bubbles,
 * and the comment editor.
 * @param props - live InputZone snapshot plus the scoped insert/remove/update face.
 * @returns the dock row when quotes exist, plus portaled floating layers.
 */
export function QuoteDock({
  input,
  insertQuote,
  removeQuoteAt,
  updateQuote,
  t,
}: QuoteDockProps): ReactElement {
  const [popup, setPopup] = useState<QuotePopup | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [bubbleRects, setBubbleRects] = useState<ReadonlyMap<number, BubbleRect>>(() => new Map())
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const inputRef = useRef(input)
  const dismissTimerRef = useRef<number | undefined>(undefined)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const anchorsRef = useRef<ReadonlyMap<number, Range>>(new Map())
  const pendingAnchorRef = useRef<Range | null>(null)
  const editorIdRef = useRef<number | null>(null)

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

  const clampEditorPosition = useCallback((left: number, top: number) => ({
    left: Math.min(Math.max(left, 12), Math.max(12, window.innerWidth - 276)),
    top: Math.min(Math.max(top, 8), Math.max(8, window.innerHeight - 200)),
  }), [])

  /** Recompute every anchored bubble from its live DOM Range. */
  const updateBubbleRects = useCallback(() => {
    const next = new Map<number, BubbleRect>()
    for (const [occurrenceId, range] of anchorsRef.current) {
      try {
        const rects = range.getClientRects()
        let first: DOMRect | null = null
        for (let index = 0; index < rects.length; index += 1) {
          const candidate = rects.item(index)
          if (candidate !== null && (candidate.width > 0 || candidate.height > 0)) {
            first = candidate
            break
          }
        }
        if (first === null) continue
        next.set(occurrenceId, { left: first.left + first.width / 2, top: first.top })
      } catch {
        // The conversation re-rendered and detached this range; drop the bubble.
      }
    }
    setBubbleRects(next)
    const activeId = editorIdRef.current
    if (activeId !== null) {
      const activeBubble = next.get(activeId)
      if (activeBubble !== undefined) {
        setEditor(current => current === null
          ? null
          : { ...current, ...clampEditorPosition(activeBubble.left - 132, activeBubble.top + 32) })
      }
    }
  }, [clampEditorPosition])

  useEffect(() => {
    const onScroll = () => {
      updatePopup()
      updateBubbleRects()
    }
    const onResize = () => {
      updatePopup()
      updateBubbleRects()
    }
    document.addEventListener('selectionchange', updatePopup)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('selectionchange', updatePopup)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.clearTimeout(dismissTimerRef.current)
    }
  }, [updatePopup, updateBubbleRects])

  /** Reconcile anchors with the occurrence table and attach the pending range. */
  useEffect(() => {
    const ids = new Set(quotes.map(quote => quote.occurrenceId))
    let changed = false
    for (const occurrenceId of [...anchorsRef.current.keys()]) {
      if (ids.has(occurrenceId)) continue
      const next = new Map(anchorsRef.current)
      next.delete(occurrenceId)
      anchorsRef.current = next
      changed = true
    }
    const pending = pendingAnchorRef.current
    if (pending !== null) {
      const newOccurrence = quotes.find(quote => !anchorsRef.current.has(quote.occurrenceId))
      if (newOccurrence !== undefined) {
        const next = new Map(anchorsRef.current)
        next.set(newOccurrence.occurrenceId, pending)
        anchorsRef.current = next
        pendingAnchorRef.current = null
        changed = true
      }
    }
    if (editorIdRef.current !== null && !ids.has(editorIdRef.current)) {
      editorIdRef.current = null
      setEditor(null)
    }
    if (changed) updateBubbleRects()
  }, [quotes, updateBubbleRects])

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
    const selection = window.getSelection()
    const anchor = selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null
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
      clipboardText: formatQuoteSerialized(normalized.text, undefined),
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
    pendingAnchorRef.current = anchor
    window.getSelection()?.removeAllRanges()
    showTransient('added')
    focusComposerAtEnd()
  }, [popup, insertQuote, showTransient, hideOffer, focusComposerAtEnd, t])

  const closeEditor = useCallback(() => {
    editorIdRef.current = null
    setEditor(null)
    setSaveFailed(false)
  }, [])

  const openEditor = useCallback((occurrenceId: number) => {
    const occurrence = quotes.find(quote => quote.occurrenceId === occurrenceId)
    if (occurrence === undefined) return
    editorIdRef.current = occurrenceId
    setCommentDraft(quoteComment(occurrence.ref) ?? '')
    setSaveFailed(false)
    const bubble = bubbleRects.get(occurrenceId)
    if (bubble === undefined) {
      setEditor({ occurrenceId, ...clampEditorPosition(window.innerWidth / 2 - 132, window.innerHeight / 3) })
      return
    }
    setEditor({ occurrenceId, ...clampEditorPosition(bubble.left - 132, bubble.top + 32) })
  }, [quotes, bubbleRects, clampEditorPosition])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-dsh-sessions-quote-bubble]') !== null) return
      const insidePopover = target instanceof Node && popoverRef.current?.contains(target)
      const insideEditor = target instanceof Node && editorRef.current?.contains(target)
      if (!insidePopover) hideOffer()
      if (!insideEditor) closeEditor()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => { document.removeEventListener('pointerdown', closeOnOutsidePointer, true) }
  }, [hideOffer, closeEditor])

  const saveComment = useCallback(() => {
    if (editor === null) return
    const occurrence = quotes.find(quote => quote.occurrenceId === editor.occurrenceId)
    if (occurrence === undefined) {
      closeEditor()
      return
    }
    let payload: QuoteRefPayload
    try {
      payload = decodeQuoteRef(occurrence.ref)
    } catch {
      setSaveFailed(true)
      return
    }
    const normalized = normalizeQuoteComment(commentDraft, t('quote.truncated'))
    const comment = normalized.text === '' ? undefined : normalized.text
    if ((payload.comment ?? '') === (comment ?? '')) {
      closeEditor()
      return
    }
    const nextPayload = withQuoteComment(payload, comment)
    const next: ReferenceInsert = {
      source: QUOTE_SOURCE_NAME,
      ref: encodeQuoteRef(nextPayload),
      label: occurrence.label,
      clipboardText: formatQuoteSerialized(nextPayload.text, nextPayload.comment),
    }
    const previous: ReferenceInsert = {
      source: QUOTE_SOURCE_NAME,
      ref: occurrence.ref,
      label: occurrence.label,
      clipboardText: occurrence.clipboardText,
    }
    const anchor = anchorsRef.current.get(occurrence.occurrenceId)
    pendingAnchorRef.current = anchor === undefined ? null : anchor.cloneRange()
    const result = updateQuote(occurrence.offset, next, previous)
    if (!result.saved) {
      if (result.restoredOccurrenceId === undefined) {
        pendingAnchorRef.current = null
      } else {
        const restoredId = result.restoredOccurrenceId
        editorIdRef.current = restoredId
        setEditor(current => current === null ? null : { ...current, occurrenceId: restoredId })
      }
      setSaveFailed(true)
      return
    }
    closeEditor()
  }, [editor, quotes, commentDraft, updateQuote, closeEditor, t])

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

  const bubbleLayer = quotes.map(quote => {
    const bubble = bubbleRects.get(quote.occurrenceId)
    if (bubble === undefined) return null
    const hasComment = quoteComment(quote.ref) !== null
    return createPortal(
      <button
        type="button"
        className={clsx(css.anchorBubble, hasComment && css.anchorBubbleCommented)}
        style={{ left: bubble.left, top: bubble.top - 32 }}
        data-dsh-sessions-quote-bubble
        aria-label={hasComment ? t('quote.bubbleHasComment', { label: quote.label }) : quote.label}
        title={hasComment ? t('quote.bubbleHasComment', { label: quote.label }) : quote.label}
        onClick={() => {
          if (editorIdRef.current === quote.occurrenceId) closeEditor()
          else openEditor(quote.occurrenceId)
        }}
      >
        <QuoteGlyph />
        <span>{quote.label}</span>
        {hasComment ? <span className={css.anchorBubbleDot} aria-hidden="true" /> : null}
      </button>,
      document.body,
      `dsh-sessions-quote-bubble-${quote.occurrenceId}`,
    )
  })

  const editorLayer = editor === null ? null : createPortal(
    <div
      ref={editorRef}
      className={css.commentEditor}
      style={{ left: editor.left, top: editor.top }}
      data-dsh-sessions-quote-comment-editor
    >
      <textarea
        className={css.editorInput}
        value={commentDraft}
        rows={3}
        autoFocus
        placeholder={t('quote.commentPlaceholder')}
        aria-label={t('quote.commentPlaceholder')}
        onChange={event => {
          setCommentDraft(event.currentTarget.value)
          setSaveFailed(false)
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeEditor()
          }
        }}
      />
      {saveFailed ? <div className={css.editorError}>{t('quote.commentSaveFailed')}</div> : null}
      <div className={css.editorActions}>
        <button type="button" className={css.editorButton} onClick={closeEditor}>
          {t('quote.commentCancel')}
        </button>
        <button
          type="button"
          className={clsx(css.editorButton, css.editorSave)}
          onClick={saveComment}
        >
          {t('quote.commentSave')}
        </button>
      </div>
    </div>,
    document.body,
  )

  const popover = popup === null ? null : createPortal(
    <div
      ref={popoverRef}
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
      {bubbleLayer}
      {editorLayer}
      {popover}
    </>
  )
}
