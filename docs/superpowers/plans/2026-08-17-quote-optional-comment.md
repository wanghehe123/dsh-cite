# 选区引用可选评论 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「引用前文」支持在选区浮层输入可选评论，评论随引用一起发给模型。

> 工作区现状：已有未提交的产物清单（artifacts）改动，涉及 `src/client/locales.ts` 等文件。提交时只暂存本功能相关文件/区块，不把无关改动带进本功能的 commit；`lib/` 被 .gitignore 忽略，不需要提交构建产物。

**Architecture:** 评论作为可选字段 `comment` 存入引用 chip 的 base64url JSON ref（保持 v=1 向后兼容）；浮层从单按钮改为「输入框 + 圆形确认按钮」；codec 统一输出「`> 引用块` + 空行 + 评论」。引用条继续完全从 `input.occurrences` 派生。

**Tech Stack:** TypeScript + React（DSH client plugin），CSS Modules，vitest，tsc/tsdown 构建链。

> 实现期间发现并修复了两个计划外问题，以最终代码与 spec 为准：1) `codec.serialize` 与 `clipboardText` 都使用 `formatQuoteSerialized`（首尾换行分隔），本计划 Task 2 的旧代码片段已被替代；2) `decodeQuoteRef` 为满足 `exactOptionalPropertyTypes` 使用条件分支返回，不是计划里的直接返回。本计划保留为历史记录。

> 第二轮交互改版（2026-08-17）：用户把交互改为「先添加引用 → 选中句子上方序号气泡 → 点气泡弹出评论卡片（取消/保存）」。本计划描述的第一轮浮层输入框方案仅作历史参考；最终实现见 spec 第二轮修订与 commit `8283129` 起的提交。

---

### Task 1: 扩展纯引用工具（quote.ts）并补测试

**Files:**
- Modify: `src/client/quote.ts`
- Test: `tests/quote.spec.ts`

- [ ] **Step 1.1: 写失败测试**

在 `tests/quote.spec.ts` 顶部 import 中加入 `formatQuoteWithComment, MAX_COMMENT_CHARS, normalizeQuoteComment, quoteComment`；在 `describe('quote refs')` 与 `describe('quote display helpers')` 中追加以下测试：

```ts
describe('normalizeQuoteComment', () => {
  it('trims the comment', () => {
    expect(normalizeQuoteComment('  帮我解释一下\n', MARKER)).toEqual({ text: '帮我解释一下', truncated: false })
  })

  it('returns an empty comment untouched and not truncated', () => {
    expect(normalizeQuoteComment('   \n', MARKER)).toEqual({ text: '', truncated: false })
  })

  it('keeps a comment at the code-point cap untouched', () => {
    const comment = 'a'.repeat(MAX_COMMENT_CHARS)
    expect(normalizeQuoteComment(comment, MARKER)).toEqual({ text: comment, truncated: false })
  })

  it('truncates over the cap by code points and appends the marker', () => {
    const normalized = normalizeQuoteComment('😀'.repeat(MAX_COMMENT_CHARS + 1), MARKER)
    expect(normalized.truncated).toBe(true)
    expect(Array.from(normalized.text).slice(0, MAX_COMMENT_CHARS).join('')).toBe('😀'.repeat(MAX_COMMENT_CHARS))
    expect(normalized.text.endsWith(MARKER)).toBe(true)
  })
})

describe('formatQuoteWithComment', () => {
  it('equals formatQuoteBlock when the comment is undefined or blank', () => {
    expect(formatQuoteWithComment('hello', undefined)).toBe('> hello')
    expect(formatQuoteWithComment('hello', '   \n')).toBe('> hello')
  })

  it('appends the trimmed comment after one blank line', () => {
    expect(formatQuoteWithComment('a\n\nb', '  解释一下  ')).toBe('> a\n>\n> b\n\n解释一下')
  })
})
```

在 `describe('quote refs')` 内追加：

```ts
  it('round-trips a payload with an optional comment and decodes legacy payloads without one', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-5', text: '原文', truncated: false, comment: '解释一下' }
    const ref = encodeQuoteRef(payload)
    expect(decodeQuoteRef(ref)).toEqual(payload)
    const legacy = encodeQuoteRef({ v: 1, id: 'quote-6', text: '原文', truncated: false })
    expect(decodeQuoteRef(legacy).comment).toBeUndefined()
  })

  it('rejects a payload whose comment is not a string', () => {
    const ref = encodeQuoteRef({ v: 1, id: 'x', text: 'x', truncated: false, comment: 42 } as unknown as QuoteRefPayload)
    expect(() => decodeQuoteRef(ref)).toThrow(/malformed quote ref/)
  })
```

在 `describe('quote display helpers')` 内追加：

```ts
  it('reads an optional comment and falls back for malformed refs', () => {
    const payload: QuoteRefPayload = { v: 1, id: 'quote-7', text: '原文', truncated: false, comment: '重点看这里' }
    expect(quoteComment(encodeQuoteRef(payload))).toBe('重点看这里')
    expect(quoteComment('%%%')).toBeNull()
  })
```

- [ ] **Step 1.2: 运行测试确认失败**

Run: `npx vitest run tests/quote.spec.ts`
Expected: FAIL——`formatQuoteWithComment`、`normalizeQuoteComment`、`quoteComment`、`MAX_COMMENT_CHARS` 未导出。

- [ ] **Step 1.3: 实现 quote.ts 扩展**

`src/client/quote.ts` 中：

1. `MAX_QUOTE_CHARS` 下方新增：

```ts
/** Hard cap on one comment's size, counted in Unicode code points. */
export const MAX_COMMENT_CHARS = 4_000
```

2. `QuoteRefPayload` 增加可选字段：

```ts
export interface QuoteRefPayload {
  v: 1
  id: string
  text: string
  truncated: boolean
  comment?: string
}
```

3. `decodeQuoteRef` 校验段改为：

```ts
  if (
    candidate.v !== 1
    || typeof candidate.id !== 'string'
    || typeof candidate.text !== 'string'
    || typeof candidate.truncated !== 'boolean'
    || (candidate.comment !== undefined && typeof candidate.comment !== 'string')
  ) {
    throw new Error('malformed quote ref')
  }
  return {
    v: 1,
    id: candidate.id,
    text: candidate.text,
    truncated: candidate.truncated,
    comment: candidate.comment,
  }
```

4. `normalizeQuoteText` 下方新增：

```ts
/**
 * Normalize one optional comment: trim, then truncate by code points so
 * surrogate pairs are never split; append `truncatedMarker` exactly when
 * truncation happened.
 */
export function normalizeQuoteComment(raw: string, truncatedMarker: string): NormalizedQuote {
  const trimmed = raw.trim()
  const units = Array.from(trimmed)
  if (units.length <= MAX_COMMENT_CHARS) return { text: trimmed, truncated: false }
  return {
    text: `${units.slice(0, MAX_COMMENT_CHARS).join('')}${truncatedMarker}`,
    truncated: true,
  }
}
```

5. `formatQuoteBlock` 下方新增：

```ts
/**
 * Project one quote payload to the Markdown sent to the model: the
 * blockquote first, then one blank line and the trimmed comment when it is
 * non-empty. Without a comment the output is exactly `formatQuoteBlock`.
 */
export function formatQuoteWithComment(text: string, comment: string | undefined): string {
  const quote = formatQuoteBlock(text)
  const trimmed = comment?.trim()
  if (trimmed === undefined || trimmed === '') return quote
  return `${quote}\n\n${trimmed}`
}
```

6. `quotePreview` 下方新增：

```ts
/** Read the optional comment from an occurrence ref; null when absent/malformed. */
export function quoteComment(ref: string): string | null {
  try {
    const comment = decodeQuoteRef(ref).comment
    return comment === undefined || comment === '' ? null : comment
  } catch {
    return null
  }
}
```

- [ ] **Step 1.4: 运行测试确认通过**

Run: `npx vitest run tests/quote.spec.ts`
Expected: PASS（全部用例）。

- [ ] **Step 1.5: 提交**

```bash
git add src/client/quote.ts tests/quote.spec.ts
git commit -m "feat(quote): add optional comment helpers and payload support"
```

---

### Task 2: codec 输出引用 + 评论

**Files:**
- Modify: `src/client/quote-source.ts`
- Test: `tests/quote-source.spec.ts`

- [ ] **Step 2.1: 写失败测试**

`tests/quote-source.spec.ts` 中 import 增加 `formatQuoteWithComment` 不需要；直接追加用例：

```ts
  it('serializes an optional comment after the blockquote', async () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-5', text: '第一行\n\n第二行', truncated: false, comment: '解释一下' }
    await expect(source.codec.serialize(encodeQuoteRef(payload))).resolves
      .toBe('> 第一行\n>\n> 第二行\n\n解释一下')
  })

  it('projects the same quoted comment through clipboardText', () => {
    const source = createQuoteSource()
    if (source.codec === undefined) throw new Error('quote source must declare a codec')
    const payload: QuoteRefPayload = { v: 1, id: 'quote-6', text: 'copy me', truncated: true, comment: '请精简' }
    const ref = encodeQuoteRef(payload)
    expect(source.codec.clipboardText(ref)).toBe('> copy me\n\n请精简')
  })
```

- [ ] **Step 2.2: 运行测试确认失败**

Run: `npx vitest run tests/quote-source.spec.ts`
Expected: FAIL——期望出现 `\n\n解释一下`，实际没有。

- [ ] **Step 2.3: 实现 codec 扩展**

`src/client/quote-source.ts`：

1. import 改为：

```ts
import { decodeQuoteRef, formatQuoteWithComment } from './quote.ts'
```

2. codec 两个方法改为：

```ts
    codec: {
      clipboardText(ref) {
        const payload = decodeQuoteRef(ref)
        return formatQuoteWithComment(payload.text, payload.comment)
      },
      async serialize(ref) {
        const payload = decodeQuoteRef(ref)
        return formatQuoteWithComment(payload.text, payload.comment)
      },
    },
```

- [ ] **Step 2.4: 运行测试确认通过**

Run: `npx vitest run tests/quote.spec.ts tests/quote-source.spec.ts`
Expected: PASS。

- [ ] **Step 2.5: 提交**

```bash
git add src/client/quote-source.ts tests/quote-source.spec.ts
git commit -m "feat(quote): serialize optional comment after the blockquote"
```

---

### Task 3: 选区浮层改造（输入框 + 圆形确认按钮）

**Files:**
- Modify: `src/client/locales.ts`
- Modify: `src/client/QuoteDock.module.css`
- Modify: `src/client/QuoteDock.tsx`

- [ ] **Step 3.1: 加文案**

`src/client/locales.ts` zh 的 quote 组加入：

```ts
  'quote.commentPlaceholder': '添加可选评论…',
  'quote.commentLabel': '评论',
  'quote.confirm': '添加为引用 {index}',
```

en 组加入：

```ts
  'quote.commentPlaceholder': 'Add optional comment…',
  'quote.commentLabel': 'Comment',
  'quote.confirm': 'Add as quote {index}',
```

- [ ] **Step 3.2: 加样式**

`src/client/QuoteDock.module.css` 中 `.popoverButton` 块后追加：

```css
.popoverCard {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-button-floating-fill);
  box-shadow: var(--dsw-shadow-lv2);
}

.popoverCard:focus-within {
  border-color: var(--dsw-alias-state-business-primary);
}

.commentInput {
  flex: 1;
  min-width: 176px;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  outline: none;
}

.commentInput::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.confirmButton {
  flex: none;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 12px;
  font-weight: 600;
  line-height: 28px;
  cursor: pointer;
}

.confirmButton:hover {
  opacity: 0.88;
}

.confirmButton:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.commentBox {
  margin: 0 10px 10px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.commentLabel {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.commentBody {
  margin: 2px 0 0;
  padding: 0;
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
```

- [ ] **Step 3.3: 改造 QuoteDock 浮层**

`src/client/QuoteDock.tsx`：

1. import 增加：

```ts
import { normalizeQuoteComment, quoteComment, type ... } from './quote.ts'
```

即 quote import 改为：

```ts
import {
  createQuoteId, encodeQuoteRef, formatQuoteWithComment, normalizeQuoteComment,
  normalizeQuoteText, quoteComment, quoteFullText, quotePreview, type QuoteRefPayload,
} from './quote.ts'
```

2. `QuotePopup` 增加 `comment: string`：

```ts
interface QuotePopup {
  left: number
  top: number
  above: boolean
  text: string
  comment: string
  kind: 'offer' | 'added' | 'failed'
}
```

3. 组件内新增 `popoverRef`：

```ts
  const popoverRef = useRef<HTMLDivElement | null>(null)
```

4. `hideOffer` 改为同时关闭 failed（保留 added 瞬态）：

```ts
  const hideOffer = useCallback(() => {
    setPopup(current => current === null || current.kind === 'added' ? current : null)
  }, [])
```

5. `updatePopup` 开头（在读取 selection 之前）加入聚焦守卫：

```ts
    if (popoverRef.current?.contains(document.activeElement)) {
      if (inputRef.current.phase !== 'plain') hideOffer()
      return
    }
```

并把 `setPopup({ left, top, above, text, kind: 'offer' })` 改为带初始空评论：

```ts
    setPopup({ left, top, above, text, comment: '', kind: 'offer' })
```

6. `showTransient` 改为：`added` 自动关闭，`failed` 1.4s 后回到 `offer` 保留评论：

```ts
  const showTransient = useCallback((kind: 'added' | 'failed') => {
    setPopup(current => current === null ? null : { ...current, kind })
    window.clearTimeout(dismissTimerRef.current)
    if (kind === 'added') {
      scheduleDismiss()
      return
    }
    dismissTimerRef.current = window.setTimeout(() => {
      setPopup(current => current === null || current.kind !== 'failed' ? current : { ...current, kind: 'offer' })
    }, 1400)
  }, [scheduleDismiss])
```

7. `addQuote` 在构造 payload 前规范化评论，并写入 payload / clipboardText：

```ts
    const normalized = normalizeQuoteText(popup.text, t('quote.truncated'))
    if (normalized.text === '') {
      hideOffer()
      return
    }
    const normalizedComment = normalizeQuoteComment(popup.comment, t('quote.truncated'))
    const comment = normalizedComment.text === '' ? undefined : normalizedComment.text
    ...
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
      clipboardText: formatQuoteWithComment(normalized.text, comment),
    }
```

8. 浮层渲染替换为：`offer` 渲染卡片，其余渲染现有胶囊：

```tsx
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
              className={css.commentInput}
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
```

- [ ] **Step 3.4: typecheck 确认**

Run: `npx tsc -b tsconfig.client.json --pretty false`
Expected: PASS。

- [ ] **Step 3.5: 提交**

```bash
git add src/client/locales.ts src/client/QuoteDock.module.css src/client/QuoteDock.tsx
git commit -m "feat(quote): add optional comment input to the selection popover"
```

---

### Task 4: 引用条展示评论

**Files:**
- Modify: `src/client/QuoteDock.tsx`

- [ ] **Step 4.1: 展开区渲染评论小节**

把引用条 map 回调开头改为：

```tsx
              {quotes.map(quote => {
                const isOpen = expanded.has(quote.occurrenceId)
                const comment = quoteComment(quote.ref)
                return (
```

并把展开区替换为：

```tsx
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
```

- [ ] **Step 4.2: typecheck 确认**

Run: `npx tsc -b tsconfig.client.json --pretty false`
Expected: PASS。

- [ ] **Step 4.3: 提交**

```bash
git add src/client/QuoteDock.tsx
git commit -m "feat(quote): show the optional comment in the quote bar"
```

---

### Task 5: 全量验证

**Files:** 无代码改动。

- [ ] **Step 5.1: 单测**

Run: `npx vitest run`
Expected: PASS。

- [ ] **Step 5.2: 全量类型检查**

Run: `npx tsc -b tsconfig.json --pretty false`
Expected: PASS。

- [ ] **Step 5.3: 构建**

Run: `npx -y -p node@22 npm run build`
Expected: 产出更新后的 `lib/index.js` 与 `lib/client.js`，无报错。

---

### Task 6: README 与发布说明

**Files:**
- Modify: `README.md`

- [ ] **Step 6.1: 更新「引用前文」文档**

在「使用步骤」第 2 步后补充评论步骤，并把「模型看到的内容」一节改为说明带评论格式：

- 浮层新增「添加可选评论…」输入框：可留空；输入后按 Enter 或点圆形按钮（显示「引用 N」）添加。
- 模型看到：

```md
> 你选中的第一行
> 你选中的第二行

你的评论（可选）
```

- 引用条展开时会显示「评论」小节；移除引用时评论一并移除；评论上限 4,000 码点。

在「已知限制」中加入：评论加入后不支持再编辑，需要修改请移除后重新引用；DSH 暂无语音输入，浮层麦克风不提供。

- [ ] **Step 6.2: 提交**

```bash
git add README.md
git commit -m "docs: document optional comments on quoted selections"
```

---

## 最终验收（对照 spec）

- 选中聊天正文 → 浮层显示评论输入框 + 圆形「引用 N」按钮。
- 无评论添加 → 模型只看到 `> 原文`（回归不变）。
- 有评论添加 → chip 进入草稿；引用条展开显示原文 + 「评论」；发送后模型看到 `> 原文\n\n评论`。
- 多条混合引用按序排列，评论紧跟自己的引用。
- 打字时选区不丢；Esc/点击外部关闭；失败 1.4s 后保留评论可重试。
- zh/en 文案、深浅色主题正确；旧 ref 兼容。
- `npx vitest run`、`npx tsc -b tsconfig.json`、`npx -y -p node@22 npm run build` 全绿。
