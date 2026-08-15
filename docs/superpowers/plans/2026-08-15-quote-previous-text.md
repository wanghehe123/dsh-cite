# 引用前文（Codex 式选区引用）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH Web UI 中实现 Codex 式引用前文：选中聊天正文后点击「添加到对话」，以原生 input-trigger chip 暂存引用，输入框上方引用条支持展开/移除，发送时序列化为 `> ` 引用块。

**Architecture:** 纯客户端实现。注册一个候选恒为空的 `@` input-trigger source 提供 chip codec；`conversation.input.dock` 条目负责选区监听、浮动按钮和引用条；插入/移除通过会话级 `slash/input-insert-reference` / `slash/input-consume-token` bail 事件走官方输入机。

**Tech Stack:** TypeScript、React 18、CSS Modules（lightningcss 内联）、dsh client runtime / slots / input-trigger 服务。

---

### Task 1: 纯引用逻辑 `src/client/quote.ts`（TDD）

**Files:**
- Create: `src/client/quote.ts`
- Test: `tests/quote.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/quote.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  decodeQuoteRef, encodeQuoteRef, formatQuoteBlock, MAX_QUOTE_CHARS,
  normalizeQuoteText, quoteFullText, quotePreview, type QuoteRefPayload,
} from '../src/client/quote.ts'

const MARKER = '…（已截断）'

describe('normalizeQuoteText', () => {
  it('trims the captured text', () => {
    expect(normalizeQuoteText('  hello\n', MARKER)).toEqual({ text: 'hello', truncated: false })
  })

  it('keeps text at the code-point cap untouched', () => {
    const text = 'a'.repeat(MAX_QUOTE_CHARS)
    expect(normalizeQuoteText(`  ${text}  `, MARKER)).toEqual({ text, truncated: false })
  })

  it('truncates over the cap by code points and appends the marker', () => {
    const normalized = normalizeQuoteText('😀'.repeat(MAX_QUOTE_CHARS + 1), MARKER)
    expect(normalized.truncated).toBe(true)
    expect(Array.from(normalized.text).slice(0, MAX_QUOTE_CHARS).join(''))
      .toBe('😀'.repeat(MAX_QUOTE_CHARS))
    expect(normalized.text.endsWith(MARKER)).toBe(true)
  })

  it('returns empty text as not truncated', () => {
    expect(normalizeQuoteText('   \n', MARKER)).toEqual({ text: '', truncated: false })
  })
})

describe('formatQuoteBlock', () => {
  it('prefixes a single line', () => {
    expect(formatQuoteBlock('hello')).toBe('> hello')
  })

  it('prefixes every line and keeps blank lines as bare >', () => {
    expect(formatQuoteBlock('a\n\nb')).toBe('> a\n>\n> b')
  })

  it('normalizes CRLF and nests existing quote lines', () => {
    expect(formatQuoteBlock('a\r\n> nested')).toBe('> a\n> > nested')
  })
})

describe('quote refs', () => {
  it('round-trips Chinese text, emoji, and newlines through base64url', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-1', text: '中文\n😀', truncated: false }
    const ref = encodeQuoteRef(payload)
    expect(ref).not.toMatch(/[+/=]/)
    expect(decodeQuoteRef(ref)).toEqual(payload)
  })

  it('rejects malformed base64', () => {
    expect(() => decodeQuoteRef('%%%')).toThrow(/malformed quote ref/)
  })

  it('rejects a payload with the wrong version', () => {
    const ref = encodeQuoteRef({ v: 2, id: 'x', text: 'x', truncated: false } as unknown as QuoteRefPayload)
    expect(() => decodeQuoteRef(ref)).toThrow(/malformed quote ref/)
  })
})

describe('quote display helpers', () => {
  it('reads full text and the first non-empty line preview', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-2', text: '第一行\n\n第二行', truncated: false }
    const ref = encodeQuoteRef(payload)
    expect(quoteFullText(ref)).toBe(payload.text)
    expect(quotePreview(ref, 'fallback')).toBe('第一行')
  })

  it('falls back for malformed refs', () => {
    expect(quoteFullText('%%%')).toBeNull()
    expect(quotePreview('%%%', 'fallback')).toBe('fallback')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `./node_modules/.bin/vitest run tests/quote.spec.ts`
Expected: FAIL — `Failed to resolve import "../src/client/quote.ts"`（模块尚不存在）。

- [ ] **Step 3: 实现最小代码**

Create `src/client/quote.ts`:

```ts
/**
 * Pure quote helpers shared by the selection popover, the quote codec, and
 * the quote bar. No DOM or React dependencies, so vitest can exercise them
 * directly in the Node environment.
 */

/** Hard cap on one quote's size, counted in Unicode code points. */
export const MAX_QUOTE_CHARS = 16_000

/** Wire-neutral payload carried inside one quote chip's opaque ref. */
export interface QuoteRefPayload {
  v: 1
  id: string
  text: string
  truncated: boolean
}

/** Result of normalizing one selection before it becomes a quote. */
export interface NormalizedQuote {
  text: string
  truncated: boolean
}

/** Base64url bytes without Node or Buffer globals. */
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Decode a base64url string back to bytes, restoring removed padding. */
function base64urlToBytes(ref: string): Uint8Array {
  const normalized = ref.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch (cause: unknown) {
    throw new Error('malformed quote ref', { cause })
  }
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

/**
 * Serialize one quote payload into the opaque ref carried by an
 * input-machine occurrence.
 */
export function encodeQuoteRef(payload: QuoteRefPayload): string {
  return base64url(new TextEncoder().encode(JSON.stringify(payload)))
}

/** Parse an opaque quote ref; malformed input throws. */
export function decodeQuoteRef(ref: string): QuoteRefPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64urlToBytes(ref))) as unknown
  } catch (cause: unknown) {
    throw new Error('malformed quote ref', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('malformed quote ref')
  const candidate = parsed as Record<string, unknown>
  if (
    candidate.v !== 1
    || typeof candidate.id !== 'string'
    || typeof candidate.text !== 'string'
    || typeof candidate.truncated !== 'boolean'
  ) {
    throw new Error('malformed quote ref')
  }
  return { v: 1, id: candidate.id, text: candidate.text, truncated: candidate.truncated }
}

/**
 * Normalize one selection: trim, then truncate by code points so emoji and
 * other surrogate pairs are never split; append `truncatedMarker` exactly
 * when truncation happened.
 */
export function normalizeQuoteText(raw: string, truncatedMarker: string): NormalizedQuote {
  const trimmed = raw.trim()
  const units = Array.from(trimmed)
  if (units.length <= MAX_QUOTE_CHARS) return { text: trimmed, truncated: false }
  return {
    text: `${units.slice(0, MAX_QUOTE_CHARS).join('')}${truncatedMarker}`,
    truncated: true,
  }
}

/**
 * Project one quote payload to the Markdown blockquote sent to the model:
 * every line gets a `> ` prefix; blank lines stay bare `>` so paragraph
 * breaks survive inside the quote.
 */
export function formatQuoteBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line === '' ? '>' : `> ${line}`)
    .join('\n')
}

/** Generate a unique quote id for one quote chip. */
export function createQuoteId(): string {
  return crypto.randomUUID()
}

/** Read the full quoted text from an occurrence ref; null on malformed refs. */
export function quoteFullText(ref: string): string | null {
  try {
    return decodeQuoteRef(ref).text
  } catch {
    return null
  }
}

/** One-line preview for the quote bar: first non-empty line, else fallback. */
export function quotePreview(ref: string, fallback: string): string {
  const text = quoteFullText(ref)
  if (text === null || text === '') return fallback
  const first = text.split('\n').find(line => line.trim() !== '')
  return first ?? fallback
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `./node_modules/.bin/vitest run tests/quote.spec.ts`
Expected: PASS — 4 个 describe 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/client/quote.ts tests/quote.spec.ts
git commit -m "feat(quote): add pure quote payload and formatting helpers"
```

---

### Task 2: 引用 codec source `src/client/quote-source.ts`（TDD）

**Files:**
- Create: `src/client/quote-source.ts`
- Test: `tests/quote-source.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/quote-source.spec.ts`:

```ts
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { decodeQuoteRef, encodeQuoteRef, type QuoteRefPayload } from '../src/client/quote.ts'
import { createQuoteSource, QUOTE_SOURCE_NAME } from '../src/client/quote-source.ts'

describe('createQuoteSource', () => {
  it('registers under @ with an empty candidate roll', async () => {
    const source = createQuoteSource()
    expect(source.trigger).toBe('@')
    expect(source.name).toBe(QUOTE_SOURCE_NAME)
    await expect(source.candidates(
      { sessionId: 'session-quote-test' as SessionId },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([])
    expect(source.onPick({
      candidate: { name: 'unreachable' },
      session: { sessionId: 'session-quote-test' as SessionId },
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 0, draftRev: 0 },
    })).toBeUndefined()
  })

  it('serializes a ref to a Markdown blockquote', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-3', text: '第一行\n\n第二行', truncated: false }
    await expect(source.codec.serialize(encodeQuoteRef(payload))).resolves
      .toBe('> 第一行\n>\n> 第二行')
  })

  it('projects the same blockquote through clipboardText', () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-4', text: 'copy me', truncated: true }
    const ref = encodeQuoteRef(payload)
    expect(source.codec.clipboardText(ref)).toBe('> copy me')
    expect(decodeQuoteRef(ref).truncated).toBe(true)
  })

  it('rejects malformed refs instead of silently downgrading', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    await expect(source.codec.serialize('%%%')).rejects.toThrow(/malformed quote ref/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `./node_modules/.bin/vitest run tests/quote-source.spec.ts`
Expected: FAIL — `Failed to resolve import "../src/client/quote-source.ts"`。

- [ ] **Step 3: 实现最小代码**

Create `src/client/quote-source.ts`:

```ts
/**
 * The quote chip's input-trigger source. It exists for the reference codec:
 * the candidate menu never shows it (the roll is always empty, and the menu
 * hides ready-but-empty groups), while submit serialization routes every
 * occurrence with this source name through `codec.serialize`.
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { decodeQuoteRef, formatQuoteBlock } from './quote.ts'

/** Source name stamped on ReferenceInsert and used by the quote bar filter. */
export const QUOTE_SOURCE_NAME = 'dsh-sessions-quote'

/** Create the quote codec source registered once per client root. */
export function createQuoteSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: QUOTE_SOURCE_NAME,
    order: 1000,

    async candidates() {
      return []
    },

    onPick() {
      return undefined
    },

    codec: {
      clipboardText(ref) {
        return formatQuoteBlock(decodeQuoteRef(ref).text)
      },
      async serialize(ref) {
        return formatQuoteBlock(decodeQuoteRef(ref).text)
      },
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `./node_modules/.bin/vitest run tests/quote-source.spec.ts`
Expected: PASS — 4 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/client/quote-source.ts tests/quote-source.spec.ts
git commit -m "feat(quote): add quote chip serialization source"
```

---

### Task 3: 注册 codec source 并补齐文案

**Files:**
- Modify: `src/client/locales.ts`
- Modify: `src/client/index.ts`

- [ ] **Step 1: 更新中英文案**

用下面的内容整体替换 `src/client/locales.ts`：

```ts
/** Localized copy owned by the session bridge surface. */

export const NS = 'dsh-sessions'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.copySessionId': '复制会话 ID',
  'menu.copied': '已复制',
  'settings.title': '会话引用',
  'settings.description': '选择新会话可以通过 @ 或 session id 引用哪些历史会话。',
  'settings.scopeLabel': '可选范围',
  'settings.scope.workspace': '仅当前工作区',
  'settings.scope.workspaceHint': '只能引用 cwd 相同的历史会话。',
  'settings.scope.all': '所有可见会话',
  'settings.scope.allHint': '可引用本机 dsh 可见的全部历史会话。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.unsaved': '未保存',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃修改',
  'settings.saveFailed': '本部署没有接受这些值，已保留供你修改。',
  'quote.button': '添加到对话',
  'quote.added': '已添加',
  'quote.failed': '添加失败，请重试',
  'quote.chip': '引用 {index}',
  'quote.count': '已引用 {count} 段',
  'quote.expand': '展开引用',
  'quote.collapse': '收起引用',
  'quote.remove': '移除 {label}',
  'quote.truncated': '…（已截断）',
} satisfies Record<string, string>

/** The session bridge namespace key union. */
export type SessionKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'menu.copySessionId': 'Copy session ID',
  'menu.copied': 'Copied',
  'settings.title': 'Session references',
  'settings.description': 'Choose which past sessions a new session can reference with @ or a session id.',
  'settings.scopeLabel': 'Reference scope',
  'settings.scope.workspace': 'Current workspace only',
  'settings.scope.workspaceHint': 'Only past sessions with the same cwd can be referenced.',
  'settings.scope.all': 'All visible sessions',
  'settings.scope.allHint': 'Every past session visible to this dsh installation can be referenced.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.unsaved': 'Unsaved',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'quote.button': 'Add to conversation',
  'quote.added': 'Added',
  'quote.failed': 'Could not add; try again',
  'quote.chip': 'Quote {index}',
  'quote.count': 'Quoted: {count}',
  'quote.expand': 'Expand quote',
  'quote.collapse': 'Collapse quote',
  'quote.remove': 'Remove {label}',
  'quote.truncated': '… (truncated)',
} satisfies Record<SessionKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-sessions': SessionKey
  }
}
```

- [ ] **Step 2: 注册 quote codec source**

修改 `src/client/index.ts`：

1. 在 `import { createSessionMentionSource }` 下面加：

```ts
import { createQuoteSource } from './quote-source.ts'
```

2. 在 `'dsh-sessions: @ source'` effect 之后加：

```ts
  ctx.effect(() => {
    const unregister = ctx.inputTriggers.registerSource(createQuoteSource())
    return () => { unregister() }
  }, 'dsh-sessions: quote source')
```

- [ ] **Step 3: 运行类型检查**

Run: `npm run typecheck`
Expected: PASS — 所有 tsconfig project 构建成功。

- [ ] **Step 4: 运行全部现有测试**

Run: `npm test`
Expected: PASS — 含 Task 1/2 新增测试在内的全部测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/client/locales.ts src/client/index.ts
git commit -m "feat(quote): register quote codec source and add copy"
```

---

### Task 4: 选区浮层与引用条 `QuoteDock`

**Files:**
- Create: `src/client/QuoteDock.module.css`
- Create: `src/client/QuoteDock.tsx`
- Modify: `src/client/index.ts`

- [ ] **Step 1: 写样式**

Create `src/client/QuoteDock.module.css`:

```css
/* Codex-style quote capture: the selection popover and the quote bar above
   the composer. Colors ride the shipped dsh theme variables so the surface
   matches the built-in composer chrome in both themes. */

.bar {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width);
  margin: 0 auto 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-shadow-lv1);
}

.barTitle {
  padding: 0 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
}

.toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.toggle:focus-visible,
.remove:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}

.chipLabel {
  flex: none;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-state-business-primary);
}

.preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}

.chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 0.16s;
}

.chevronOpen {
  transform: rotate(180deg);
}

.remove {
  flex: none;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.remove:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.remove:disabled {
  opacity: 0.4;
  cursor: default;
}

.body {
  margin: 0;
  padding: 0 10px 10px;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}

.popover {
  position: fixed;
  z-index: 130;
}

.popoverButton {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-button-floating-fill);
  box-shadow: var(--dsw-shadow-lv2);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}

.popoverButton:hover:not(:disabled) {
  background: var(--dsw-alias-button-floating-hover);
}

.popoverButton:disabled {
  cursor: default;
}

.popoverFailed {
  color: var(--dsw-alias-state-error-primary);
}

.icon {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-state-business-primary);
}
```

- [ ] **Step 2: 写组件**

Create `src/client/QuoteDock.tsx`:

```tsx
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
```

- [ ] **Step 3: 注册 `conversation.input.dock` 条目**

用下面的内容整体替换 `src/client/index.ts`：

```ts
/**
 * dsh-sessions browser half: vendored workspace surface with copy-session-id,
 * the `@session` input-trigger source, the quote-capture surface in the
 * composer, and the plugin configuration card on the Web Plugins settings
 * page.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { en, NS, zh } from './locales.ts'
import { getScopeSetting, setScopeSetting } from './rpc.ts'
import { QuoteDock, type QuoteDockInjected } from './QuoteDock.tsx'
import { createQuoteSource } from './quote-source.ts'
import { ScopeCard, type ScopeCardInjected } from './ScopeCard.tsx'
import { createSessionMentionSource } from './session-mention-source.ts'
import { registerWorkspaceSurface } from '../vendor/workspace/index.ts'

/** Required client services: locale, session/workspace feeds, triggers, slots. */
export const inject = ['sessions', 'workspaces', 'locale', 'inputTriggers', 'slots']

/**
 * Register the vendored workspace surface, session mention source, quote
 * capture surface, and reference-scope configuration card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sessions: dictionaries')
  registerWorkspaceSurface(ctx)

  ctx.effect(() => {
    const unregister = ctx.inputTriggers.registerSource(createSessionMentionSource(ctx))
    return () => { unregister() }
  }, 'dsh-sessions: @ source')

  ctx.effect(() => {
    const unregister = ctx.inputTriggers.registerSource(createQuoteSource())
    return () => { unregister() }
  }, 'dsh-sessions: quote source')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'dsh-sessions-quote-dock',
      order: 100,
      locale: NS,
      inject: (sessionId): QuoteDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) {
          throw new Error(`dsh-sessions: quote surface resolved no session scope for "${String(sessionId)}"`)
        }
        return {
          insertQuote: (reference, span) =>
            actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true,
          removeQuoteAt: (span) =>
            actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true,
        }
      },
    },
    QuoteDock,
  ))

  ctx.slots.inject(
    'settings.plugin.item',
    () => ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'dsh-sessions-scope',
      order: 100,
      locale: NS,
      inject: (): ScopeCardInjected => ({
        load: signal => getScopeSetting(signal),
        save: scope => setScopeSetting(scope),
      }),
    }, ScopeCard),
  )
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run typecheck`
Expected: PASS — 客户端 project 编译成功，`QuoteDock` 的 `PropsRuntime<'conversation.input.dock'>` 与 inject face 均通过。

- [ ] **Step 5: 构建客户端 bundle**

Run: `npm run build:client`
Expected: PASS — tsdown 输出 `lib/client.js`，purity 插件与 CSS Module 内联均无报错。

- [ ] **Step 6: 提交**

```bash
git add src/client/QuoteDock.tsx src/client/QuoteDock.module.css src/client/index.ts
git commit -m "feat(quote): add selection popover and collapsible quote bar"
```

---

### Task 5: README 与全量验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新功能列表**

在 `## 功能` 列表的「复制会话 ID」条目之后加入：

```md
- 引用前文：在会话正文中选中文本会出现「添加到对话」按钮；引用以输入框 chip + 上方引用条暂存，支持展开/收起与逐条移除，发送时自动序列化为逐行 `> ` 前缀的引用块。
```

- [ ] **Step 2: 在「工作方式」开头补一段**

在 `## 工作方式` 标题和 `新会话输入 @ 时的候选菜单（浏览器半）：` 之间插入：

```md
### 引用前文（选区引用）

1. 选中聊天正文 → 选区上方出现「添加到对话」（输入区与引用条内的选区不触发）。
2. 点击后文本按 16,000 Unicode 码点截断（超出追加「…（已截断）」），以 `dsh-sessions-quote` chip 插入草稿末尾；输入框上方的 `conversation.input.dock` 引用条直接从 `input.occurrences` 派生，支持展开/收起与移除。
3. 提交时 codec 把每个 chip 序列化为 `> 引用内容`；`clipboardText` 同为引用块，复制 chip 或草稿重载后语义保持。
```

- [ ] **Step 3: 全量测试与构建**

Run:

```sh
npm test
npm run typecheck
npm run build
```

Expected: 三项全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: document quote-previous-text feature"
```

---

## 手动验收清单

1. 打开一个已有对话，选中上方回复中的一段文本 → 选区上方出现「添加到对话」，滚动/缩放时按钮跟随选区。
2. 选中输入框里的草稿文本 → 不出现按钮。
3. 点击「添加到对话」→ 按钮短暂显示「已添加」；输入框末尾出现「引用 1」chip；输入框上方出现引用条，行内为「引用 1」+ 首行预览。
4. 点引用条行 → 展开全文；再次点击收起。
5. 再添加两段 → chip 编号递增为「引用 2」「引用 3」；引用条显示「已引用 3 段」。
6. 点「引用 2」的移除 → chip 与引用条行同时消失，输入机可 Cmd/Ctrl+Z 撤销。
7. 直接在输入框删除一个 chip → 引用条对应行同步消失。
8. 发送 → 模型收到逐行 `> ` 前缀的引用块；引用条消失。
9. 切换中英文界面后新增引用：按钮、引用条标题、截断标记文案随语言变化（已存在的 chip 标签沿用插入时的文案，与平台 chip 行为一致）。
10. 选中超过 16,000 码点的文本 → 引用全文以截断标记结尾，emoji 不被劈开。
