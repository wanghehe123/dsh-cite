# 选区引用可选评论设计（第二轮：先引用、后注释）

日期：2026-08-17
状态：已确认，实现中

## 背景与目标

第一轮实现把评论输入框放在选区浮层里。用户实际想要 Codex 式两步交互：

1. 选中聊天正文 → 浮层只出现「添加到对话」按钮。
2. 点击后引用 chip 进入草稿，同时**选中句子第一行上方出现一个聊天气泡**，显示该引用在当前草稿中的序号（1、2、3…）。
3. 点击气泡 → 弹出评论卡片（预填已有评论，输入框 + 取消/保存）。
4. 保存后评论写回该引用 chip；引用条展开显示「评论」；气泡加「已有评论」标记。
5. 取消、点卡片外、Esc 关闭卡片且不改动数据；删除引用或发送成功后气泡随引用消失。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 选区浮层 | 恢复为单个「添加到对话」按钮；点击后短暂显示「已添加」 |
| 气泡位置 | 锚定选中句子的第一行上方（Range 锚点 + `getClientRects()[0]`），随滚动/窗口缩放重算 |
| 气泡内容 | 显示该引用的「引用 N」标签（与 composer chip、引用条一致）；有评论时追加小圆点标记 |
| 评论编辑 | 点气泡弹出卡片：textarea 预填已有评论；「取消 / 保存」按钮 |
| 保存语义 | 评论写回 chip 的 ref（v1 可选 `comment`）；再次点气泡可修改或清空评论 |
| 保存实现 | 官方输入机 `slash/input-consume-token` 移除旧 chip + `slash/input-insert-reference` 同位插入新 chip；两个调用之间用 `ctx.conversation.input.for(actx).state.getSnapshot()` 读最新 draftRev |
| 评论模型格式 | 引用块在前，空一行后跟评论；多条引用各带各的评论 |
| 评论上限 | 4,000 Unicode 码点，超出截断并追加截断标记 |
| 序列化分隔 | `serialize` 与 `clipboardText` 都用 `formatQuoteSerialized`（首尾换行），防止相邻 chip 粘连 |

## 非目标

- 不做语音输入。
- 气泡不是新消息，不写入会话日志。
- 不支持在气泡上直接删除引用（仍用引用条删除）。
- 不跨会话，不使用宿主侧元数据。

## 架构与数据流

```
聊天正文选区
   │ selectionchange
   ▼
选区浮层「添加到对话」
   │ 规范化原文 → cloneRange() 作锚点 → 插入无评论 chip
   ▼
InputMachine 插入 U+FFFC chip（官方撤销/复制/粘贴/偏移维护）
   │
   ├─► 气泡层（body portal）：
   │     由 quotes + anchorsRef 派生，每个引用一个气泡；
   │     显示序号，有评论加小圆点；
   │     点击气泡 → 评论卡片（取消/保存）
   │       保存：normalizeQuoteComment → withQuoteComment(payload)
   │              → updateQuote(offset, 新 ReferenceInsert)
   │              → consume 旧 chip + insert 新 chip（同位、同 label）
   │              → 新 occurrenceId 承接旧 Range 锚点
   │
   ├─► conversation.input.dock 引用条：
   │     展开显示原文 + 「评论」小节；移除引用时气泡同步消失
   │
   └─► 提交时 codec.serialize(ref)
          → formatQuoteSerialized(text, comment)
          → sink trim 后：'> 原文\n\n评论'（无评论则只有引用块）
```

## 文件与改动

全部为客户端改动，宿主侧不变。

### 1. `src/client/quote.ts`

- 保持现有 payload/规范化/序列化函数不变。
- 新增 `withQuoteComment(payload, comment): QuoteRefPayload`：`comment` 为 undefined 时返回不含 `comment` 键的副本；否则返回带 `comment` 的副本（满足 `exactOptionalPropertyTypes`）。

### 2. `src/client/QuoteDock.tsx`

- `QuotePopup` 去掉 `comment` 字段；选区浮层恢复单按钮，`showTransient` 恢复「added/failed 均 1.4s 后关闭」。
- 新增气泡锚点：
  - `anchorsRef: Map<occurrenceId, Range>`、`pendingAnchorRef`、`editorIdRef`。渲染由 `bubbleRects` state 驱动，不需要额外版本号。
  - `addQuote` 插入前 `pendingAnchorRef.current = selection.getRangeAt(0).cloneRange()`；插入失败清空。
  - effect 对 `quotes` 做对账：删除失效锚点；pending 存在且出现新 occurrenceId 时挂接并清 pending；随后调用 `updateBubbleRects()`；正在编辑的引用消失时关闭编辑卡片。
- `updateBubbleRects()`：遍历 anchorsRef，`range.getClientRects()[0]` 取第一行矩形，得到气泡中心 `left/top`，写入 `bubbleRects` state；scroll（capture）与 resize 时调用。
- 气泡渲染：body portal，样式 `anchorBubble`；显示序号；`quoteComment(ref) !== null` 时加 `anchorBubbleDot` 标记；点击打开编辑卡片。
- 评论卡片：body portal，`commentEditor` 卡片 + textarea（`quote.commentPlaceholder`）+ 取消/保存；Escape 或点击卡片外关闭；打开时预填 `quoteComment(ref) ?? ''`。
- 保存：解码旧 payload → `normalizeQuoteComment` → 内容与现状一致则直接关闭；否则 `withQuoteComment` 构造新 payload，设 `pendingAnchorRef = 旧 Range.cloneRange()`，调用注入的 `updateQuote(offset, 新 ReferenceInsert)`。成功关闭卡片；失败时若返回 `restoredOccurrenceId` 则把编辑卡片与锚点迁移到回滚后的新 id 并显示「保存失败，请重试」，否则清空 pending。
- 引用条展开区继续显示原文 + 「评论」小节。

### 3. `src/client/index.ts`

- `QuoteDockInjected` 增加 `updateQuote(offset, next, previous): QuoteUpdateResult`（`{ saved, restoredOccurrenceId? }`）。
- 实现：`const shell = ctx.conversation.input.for(actx)`；
  1. `before = shell.state.getSnapshot()`，校验 phase、offset 与 `before.draft[offset] === '\uFFFC'`；
  2. `actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span: { start: offset, end: offset + 1, draftRev: before.draftRev } } })`；
  3. 成功后 `after = shell.state.getSnapshot()`，再 `actx.bail(actx, 'slash/input-insert-reference', { reference, span: { start: offset, end: offset, draftRev: after.draftRev } })`。

### 4. `src/client/locales.ts`

zh：`quote.commentPlaceholder: '添加评论…'`、`quote.commentCancel: '取消'`、`quote.commentSave: '保存'`、`quote.commentSaveFailed: '保存失败，请重试'`、`quote.bubbleHasComment: '{label}，已有评论'`；删除 `quote.confirm` 与 `quote.bubble`。
en 对应：`Add comment…` / `Cancel` / `Save` / `Could not save; try again` / `{label}, commented`。

### 5. `src/client/QuoteDock.module.css`

- 删除不再使用的 `.popoverCard / .commentInput / .confirmButton`。
- 新增 `.anchorBubble`（圆角气泡 + 小尾巴）、`.anchorBubbleDot`（已有评论标记）、`.commentEditor`、`.editorInput`、`.editorActions`、`.editorButton`、`.editorSave`、`.editorError`。
- 全部使用 `--dsw-*` 语义 token。

## 测试

- `tests/quote.spec.ts` 新增 `withQuoteComment`：
  - 带 comment 的 payload 返回包含 comment 的副本且不修改原对象；
  - comment 为 undefined / 空串时返回无 comment 键的副本；
  - 保持 v/id/text/truncated 不变。
- 现有 quote / quote-source 用例全部回归（序列化、复制、相邻 chip、旧 ref 兼容）。
- `npx vitest run`、`npx tsc -b tsconfig.json`、`npx -y -p node@22 npm run build` 全绿。

## 验收清单

- [ ] 选中正文只出现「添加到对话」按钮。
- [ ] 添加后引用 chip 进入草稿，且选中句子上方出现带序号的气泡。
- [ ] 连续添加多条：气泡编号 1/2/3，对应引用条顺序。
- [ ] 点击气泡弹出评论卡片，预填已有评论；取消/Esc/点外部不改变数据。
- [ ] 保存后引用条出现「评论」，气泡加圆点；发送时模型看到 `> 原文\n\n评论`。
- [ ] 再次打开可修改或清空评论；清空后气泡圆点消失。
- [ ] 删除引用或发送成功后气泡消失。
- [ ] 滚动/缩放时气泡跟随原句第一行，打开的评论卡片跟随气泡并夹在视口内；中文 IME 输入评论不受影响。
- [ ] 点击已打开评论卡片的气泡会收起卡片；保存失败且回滚成功时，卡片与气泡仍指向恢复后的引用。
- [ ] 保存评论走两次官方事务（consume + insert），Ctrl/Cmd+Z 需两步回到保存前状态。
- [ ] zh/en 文案、深浅色主题正确；旧 chip ref 兼容。
