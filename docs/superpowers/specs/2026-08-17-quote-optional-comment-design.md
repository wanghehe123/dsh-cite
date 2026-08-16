# 选区引用添加可选评论设计

日期：2026-08-17
状态：已确认，待实现

## 背景与目标

现有「引用前文」功能：选中聊天正文 → 浮动按钮「添加到对话」→ 把选区做成引用 chip 进入草稿，发送时序列化为逐行 `> ` 引用块。

本次改进让它像 Codex 一样支持**可选评论**：选区浮层变成「评论输入框 + 圆形确认按钮」，用户可以在引用一段前文的同时附带一句说明/追问；评论随引用一起发给模型。不输入评论时行为与现状完全一致。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 评论语义 | 评论随引用一起发给模型，不是纯 UI 备注 |
| 模型看到的格式 | 引用块在前，空一行后跟评论文本；多条引用按出现顺序依次排列，评论紧跟自己的引用 |
| 浮层交互 | 圆角卡片：文本输入框（单行）+ 蓝色圆形确认按钮（显示新引用序号）；Enter 或点按钮确认；Esc/点击外部关闭并丢弃未确认评论 |
| 数据模型 | 评论存入引用 chip 的 `QuoteRefPayload`（v=1 增加可选 `comment?: string`），不另建状态表、不把评论当普通草稿文本插入 |
| 兼容性 | 旧 chip（无 comment）可正常解码；新版 chip 在旧插件上最多丢评论，不会报错 |
| 评论上限 | 4,000 Unicode 码点；超出截断并追加本地化截断标记 |
| 麦克风图标 | 不实现语音输入；DSH 客户端没有可用的语音能力，不放装饰性死按钮 |
| 评论编辑 | 加入后不支持再编辑；要改就移除后重新引用 |

## 非目标

- 不做语音输入。
- 不支持加入引用后再编辑评论。
- 不改变现有「引用条从 `input.occurrences` 派生、不维护第二份状态」的原则。
- 不把评论插入草稿正文或作为独立消息发送。
- 不改变引用原文的 16,000 码点上限与 `> ` 序列化格式。

## 架构与数据流

```
聊天正文选区
   │  selectionchange / scroll / resize
   ▼
选区浮层（圆角卡片）
   ├─ 输入框：可选评论（trim → 4,000 码点截断）
   └─ 圆形确认按钮：显示「引用 N」（N = 当前草稿引用数 + 1）
   │  Enter / 点击按钮
   ▼
actx.bail(actx, 'slash/input-insert-reference',
          { reference, span: { start: draft.length, end: draft.length, draftRev } })
   │  reference.ref = base64url(JSON: { v: 1, id, text, truncated, comment? })
   ▼
InputMachine 插入 U+FFFC chip（官方撤销/复制/粘贴/偏移维护）
   │
   ├─► conversation.input.dock 引用条：
   │     从 input.occurrences 过滤 source === 'dsh-sessions-quote'
   │     展开时显示原文 + 评论小节（有评论才显示）；移除引用时评论一并消失
   │
   └─► 提交时 codec.serialize(ref)
          → formatQuoteWithComment(text, comment)
          → 无评论：'> 原文'（与现状逐字节一致）
          → 有评论：'> 原文\n\n评论'
```

## 文件与改动

全部为客户端改动，宿主侧不变。

### 1. `src/client/quote.ts`

- 新增 `MAX_COMMENT_CHARS = 4_000`。
- `QuoteRefPayload` 增加 `comment?: string`；`v` 仍为 `1`。
- `decodeQuoteRef`：`comment` 存在时必须是 `string`，缺失合法；其余校验不变。
- 新增 `normalizeQuoteComment(raw, truncatedMarker): { text: string; truncated: boolean }`：`trim`；超 4,000 码点按 `Array.from` 截断并追加标记；空串返回 `{ text: '', truncated: false }`。
- 新增 `formatQuoteWithComment(text, comment?): string`：
  - `comment` 为 undefined / 空串时返回 `formatQuoteBlock(text)`；
  - 否则返回 `` `${formatQuoteBlock(text)}\n\n${comment}` ``。
- 新增 `formatQuoteSerialized(text, comment?): string`：返回 `` `\n${formatQuoteWithComment(text, comment)}\n` ``，供 codec 的 prompt 序列化使用；官方 sink 最终 `trim()`，首尾换行不会进入模型文本，但内部换行保证相邻 chip（官方只插一个空格）之间引用块和评论不会粘连成一行。
- 新增 `quoteComment(ref): string | null` 供引用条读取；畸形 ref 返回 null。

### 2. `src/client/quote-source.ts`

- `codec.serialize` 改用 `formatQuoteSerialized(text, comment)`（带首尾换行分隔）；`codec.clipboardText` 继续用 `formatQuoteWithComment(text, comment)` 输出干净的单条文本。解码失败行为不变（抛错、阻断发送）。

### 3. `src/client/QuoteDock.tsx`

- `QuotePopup` 增加 `comment: string`，`kind` 不变（`offer | added | failed`）。
- 浮层从单按钮改为卡片：
  - `<input>`（`data-dsh-sessions-quote-comment`），placeholder 用 `t('quote.commentPlaceholder')`；`maxLength` 不设（按码点截断在确认时做）；`onKeyDown`：Enter 确认、Escape 关闭；Enter 在 IME 组词中（`event.nativeEvent.isComposing === true`）时只提交组词、不触发添加。
  - 圆形确认按钮显示 `index`（即将成为的「引用 N」），aria-label 用 `t('quote.confirm', { index })`；点击调 `addQuote()`。
- 保留选区打字：卡片根节点 `onMouseDown={e => e.preventDefault()}`；输入框 `onMouseDown` 手动 `event.preventDefault()` 后 `focus()`，阻止浏览器折叠选区。
- 聚焦期间暂停重定位：`updatePopup` 开头检查 `document.activeElement` 是否在浮层内（`data-dsh-sessions-quote-popover`），是则直接返回；失焦后恢复由 `selectionchange` 驱动。
- 浮层位置保持现有计算（选区上方优先、下方兜底、视口夹取）；不做截图里的右对齐改造，避免长选区下跳动。
- 确认流程：校验 `input.phase === 'plain'` → 规范化原文与评论 → 构造带 `comment` 的 payload → 插入 chip → 清选区 → `showTransient('added')` → 聚焦输入框末尾。
  - 瞬态渲染：`kind === 'offer'` 时渲染输入卡片；`added` / `failed` 时渲染现有样式的紧凑胶囊文案。`failed` 不清空已输入评论，1.4s 后回到 `offer`（保留评论，允许直接重试），不自动关闭浮层；只有 Esc、选区消失或点击外部才丢弃评论。
- 引用条展开区：原文之后，`quoteComment(ref)` 非空时追加「评论」小节（label + 文本，样式沿用现有 `body` 的代码字体块）。
- 引用条折叠行不变。

### 4. `src/client/locales.ts`

zh 增加：`quote.commentPlaceholder: '添加可选评论…'`、`quote.commentLabel: '评论'`、`quote.confirm: '添加为引用 {index}'`。
en 增加：`quote.commentPlaceholder: 'Add optional comment…'`、`quote.commentLabel: 'Comment'`、`quote.confirm: 'Add as quote {index}'`。
评论截断复用 `quote.truncated`。

### 5. `src/client/QuoteDock.module.css`

- 复用现有 `--dsw-*` 语义 token。
- 新增 `.popoverCard`（flex 卡片）、`.commentInput`（flex:1、无边框、背景透明、颜色继承）、`.confirmButton`（蓝色圆形、显示序号）、`.commentBody` 等类；`popover` 定位逻辑不变。

## 测试

- `tests/quote.spec.ts`：
  - `normalizeQuoteComment`：trim、空串、4,000 码点边界、emoji 码点截断。
  - `formatQuoteWithComment`：无评论等于 `formatQuoteBlock`；单行/多行引用 + 评论；评论为空串时退回纯引用。
  - ref 往返：带 comment 的 payload 编码解码一致；旧 payload（无 comment）解码后 `comment === undefined`；`comment` 非字符串时报 malformed。
  - `quoteComment`：正常读取、畸形 ref 返回 null。
- `tests/quote-source.spec.ts`：
  - serialize 输出 `\n> 引用\n\n评论\n`，clipboardText 输出 `> 引用\n\n评论`。
  - 无评论 payload 经 sink `trim()` 后与旧格式一致（回归）。
  - 相邻多个 chip 模拟官方 sink 拼接后，各引用块与评论互不粘连。
  - 畸形 ref 仍 reject。
- 回归：现有全部 vitest、`npx tsc -b tsconfig.json`、`npm run build`。

## 验收清单

- [ ] 选中聊天正文后浮层显示评论输入框与圆形「引用 N」按钮。
- [ ] 不输入评论直接点按钮：行为与现状一致，模型只看到 `> 原文`。
- [ ] 输入评论后 Enter/点按钮：草稿出现 chip，引用条展开能看到原文和「评论」小节，发送后模型看到 `> 原文\n\n评论`。
- [ ] 连续添加多条（有评论/无评论混合）：模型按顺序收到各自引用块，评论紧跟对应引用。
- [ ] 打字期间选区不丢、浮层不闪动；Esc/点击外部关闭；空选区不显示浮层。
- [ ] 移除引用时评论一并移除；撤销插入同样生效（chip 级原子性）。
- [ ] zh/en 文案与深浅色主题正确。
- [ ] 旧版本生成的 chip ref（无 comment）仍能正常解码和序列化。
