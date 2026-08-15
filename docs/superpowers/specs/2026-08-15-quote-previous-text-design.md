# 引用前文（Codex 式选区引用）设计

日期：2026-08-15
状态：已确认，待实现

## 背景与目标

`dsh-sessions` 已支持跨会话 `@` 引用，但用户还希望像 Codex 一样引用**当前会话里的前文**：选中一段聊天正文，点「添加到对话」，把它作为引用块送进当前输入框。

目标行为：

1. 在会话正文（聊天记录）里选中非空文本时，选区旁出现浮动按钮「添加到对话」。
2. 点击后把选中文本做成输入框里的原生引用 chip（输入框只显示「引用 N」小标签）。
3. 输入框上方出现引用条，逐条显示预览、支持展开/收起全文和移除。
4. 发送时官方输入机管线把每个 chip 序列化为逐行 `> ` 前缀的 Markdown 引用块，纯内容、不带来源标注。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 功能范围 | 选区浮动按钮 + 输入框上方可折叠/可移除引用条；不做 AI 回复内的引用块渲染 |
| 输入框呈现 | 官方 input-trigger chip（`ReferenceInsert`），不把全文写进草稿 |
| 实现路线 | 接入官方 input-trigger 管线：`slash/input-insert-reference` 插入、`slash/input-consume-token` 移除 |
| 单条长度上限 | 16,000 Unicode 码点；超出截断并追加「…（已截断）」标记 |
| 模型格式 | 纯 `> 引用内容`，逐行前缀，无来源标注、无「引用 N」标题 |
| 插入位置 | 统一追加到当前草稿末尾，插入后聚焦输入框并把光标放到末尾 |

## 非目标

- 不在 AI 回复中解析或渲染引用块。
- 不给引用附消息角色、时间戳等来源信息。
- 不去重相同文本；同一段文本可以再次引用。
- 不跨会话引用（现有 `@` mention 已覆盖）。
- 不保证页面重载后 chip 还原为 chip：与现有 session mention chip 一致，持久化后按 `clipboardText`（引用块文本）继续存在。

## 架构与数据流

```
聊天正文选区
   │  selectionchange / scroll / resize
   ▼
选区旁浮动按钮「添加到对话」
   │  规范化：trim → 按 16,000 码点截断（可选截断标记）
   ▼
actx.bail(actx, 'slash/input-insert-reference',
          { reference, span: { start: draft.length, end: draft.length, draftRev } })
   │  reference.source = 'dsh-sessions-quote'
   │  reference.ref    = base64url(JSON: { v: 1, id, text, truncated })
   ▼
InputMachine 插入 U+FFFC chip（官方撤销/复制/粘贴/偏移维护）
   │
   ├─► conversation.input.dock 引用条：
   │     从 input.occurrences 过滤 source === 'dsh-sessions-quote'
   │     预览/展开/移除（slash/input-consume-token，span CAS）
   │
   └─► 提交时官方序列化对每个 chip 调 codec.serialize(ref)
          → 逐行 '> ' 前缀的引用块 → defaultSink(text.trim())
```

## 文件结构

全部为客户端改动，宿主侧不变。

- `src/client/quote.ts`（新增）
  - `MAX_QUOTE_CHARS = 16_000`
  - `normalizeQuoteText(raw, truncatedMarker)`：trim；超过 16,000 码点时按码点截断并追加标记；返回 `{ text, truncated }`。按 `Array.from` 处理，避免劈开代理对（emoji）。
  - `formatQuoteBlock(text)`：把文本按行拆分，每行加 `> ` 前缀；空行输出 `>`。
  - `QuoteRefPayload`：`{ v: 1, id: string, text: string, truncated: boolean }`。
  - `encodeQuoteRef(payload)` / `decodeQuoteRef(ref)`：JSON + base64url；畸形 ref 抛错。
  - id 用 `crypto.randomUUID()` 生成，函数可注入 id 以便测试。
- `src/client/quote-source.ts`（新增）
  - `createQuoteSource(): InputTriggerSource`：
    - `trigger: '@'`，`name: 'dsh-sessions-quote'`，`order: 1000`。
    - `candidates()` 恒返回 `[]`，不参与 `matchSpace` / `matchEnter` / `lexicon`，因此不污染现有 `@` 菜单（空组不渲染）。
    - `codec.clipboardText(ref)` 与 `codec.serialize(ref)` 均解码 ref 并返回 `formatQuoteBlock(text)`；`serialize` 解码失败时抛错，由官方管线阻止发送并显示通知，绝不静默降级。
  - 由 `ctx.effect(() => ctx.inputTriggers.registerSource(createQuoteSource()), ...)` 常驻注册。
- `src/client/QuoteDock.tsx`（新增）
  - 注册进 `conversation.input.dock`（`id: 'dsh-sessions-quote-dock'`，`order: 100`，`locale: 'dsh-sessions'`）。
  - 组件职责：
    1. 引用条渲染（无引用时返回 `null`）。
    2. 文档级选区监听，`createPortal` 渲染选区旁浮动按钮。
    3. 插入与移除动作（经 inject 工厂绑定到当前 session scope）。
- `src/client/QuoteDock.module.css`（新增）
  - 浮动按钮与引用条样式；只使用 dsh 主题 CSS 变量（`--dsw-*`），与内置 composer / chip 视觉一致。
- `src/client/index.ts`（修改）
  - 注册 quote source；注册 `conversation.input.dock` 条目。
- `src/client/locales.ts`（修改）
  - 新增 quote 相关中英文案。
- `tests/quote.spec.ts`（新增）
  - 纯逻辑单测，见「测试」。

## 关键实现细节

### quote chip 插入

- inject 工厂收到 `sessionId` 后调用 `ctx.sessions.scope(sessionId)` 得到会话级 `AgentContext`；未解析到 scope 时抛错（与 ui-input-trigger 的 MenuView 行为一致）。
- 组件持有的动作面：
  - `insertQuote(reference, span): boolean` → `actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true`
  - `removeQuote(span): boolean` → `actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span } }) === true`
- 插入 span 恒为草稿末尾的空区间 `{ start: draft.length, end: draft.length, draftRev }`；`draft`/`draftRev` 取组件当次渲染的最新 `input` 快照（handler 经 ref 防闭包过期）。
- `ReferenceInsert`：
  - `label`：插入时按当前引用 chip 数 + 1 生成，如「引用 2」；该 label 缓存在 occurrence 上，引用条直接使用，避免两处编号算法漂移。
  - `clipboardText`：组件在插入时用 `formatQuoteBlock(text)` 生成并随 `ReferenceInsert` 传入（occurrence 缓存的就是它），与序列化结果一致；`codec.clipboardText` 也返回同一格式，供未来消费该钩子的路径使用。
- 只在 `input.phase === 'plain'` 时允许插入/移除；其他阶段浮动按钮不出现、引用条操作按钮禁用。

### 选区监听与浮动按钮

- 监听 `document` 的 `selectionchange`，以及 capture 阶段的 `scroll` / `resize`。
- 命中条件（全部满足才显示按钮）：
  - `window.getSelection()` 非空、未折叠、`toString().trim()` 非空；
  - Range 的公共祖先元素位于 `[data-conversation-scroll]` 内；
  - 不位于 `[data-composer-seat]` 内（排除输入区与引用条自身）；
  - 当前输入阶段为 `plain`。
- 浮层位置来自 `range.getBoundingClientRect()`：
  - 水平居中于选区，左右 clamp 到视口；
  - 选区上方空间不足（`rect.top < 48`）时显示在选区下方；
  - `scroll`/`resize` 时用保存的 `Range`（`cloneRange()`）重算；Range 已脱离 DOM（`getClientRects().length === 0`）则隐藏。
- 按钮 `onMouseDown` 阻止默认，保持选区；点击后清空选区并聚焦 `[data-composer-card] textarea`，把光标放到末尾。
- 点击后浮层短暂显示「已添加」（约 1.2 秒）再消失；`bail` 返回 `false` 时显示失败文案。
- 浮层通过 `createPortal(..., document.body)` 渲染，避免被父级 overflow/transform 裁剪。

### 引用条

- 数据完全派生：`input.occurrences.filter(o => o.source === 'dsh-sessions-quote')`，按 `offset` 排序。无第二份内存引用状态。
- 每条 UI：
  - 头行：`引用 N`（occurrence label）+ 单行预览 + 展开/收起按钮；
  - 展开后：完整文本（`pre-wrap`，可滚动）；
  - 移除按钮：aria-label 含编号。
- 展开状态用 `occurrenceId` 的 Set；occurrence 消失时清理对应 id。
- 移除只删 chip 占位符本身（span = `[offset, offset + 1)` + 当前 `draftRev`）；相邻空格不特殊处理，提交时的整体 `trim()` 与用户手动 backspace 兜底。
- 引用条在 `conversation.input.dock` 里渲染，因此在输入框正上方、不占聊天流布局；无引用时返回 `null`。

### 发送与持久化

- 官方 `sinkSerialized` 逐个替换 chip：`serialize(ref)` 返回逐行 `> ` 引用块；最后整段 `trim()` 后发送。
- `clipboardText` 与 `serialize` 输出一致：
  - 会话内复制/剪切 chip 得到引用块文本；
  - 草稿持久化/重载后引用以引用块文本形式保留，语义不变。
- 移除全部 chip 后引用条自动消失；发送成功后草稿清空，同理消失。

### 错误处理

| 情形 | 处理 |
|---|---|
| 选中内容为空 / 折叠 | 不显示浮层 |
| 选中位于输入区 / 引用条 | 不显示浮层 |
| `phase !== 'plain'` | 浮层不出现，引用条操作禁用 |
| insert/consume 的 span CAS 失败（draft 并发变化） | `bail` 返回 false；浮层显示失败文案，不吞错 |
| ref 解码失败（理论上不会发生） | `serialize` 抛错，官方管线阻止发送并显示通知 |
| session scope 解析失败 | inject 抛错，slot 条目按框架错误边界处理 |

## 测试

自动测试（`npm test`，vitest node 环境）：

- `normalizeQuoteText`：
  - 普通文本 trim；
  - 未超上限不截断、`truncated: false`；
  - 恰好 16,000 码点不截断；
  - 超过 16,000 码点按码点截断、`truncated: true`、追加截断标记；
  - 含 emoji / 多字节字符时不劈开代理对。
- `formatQuoteBlock`：
  - 单行、多行；
  - 空行输出 `>`；
  - 内容已含 `>` 的行仍逐行加前缀（形成嵌套引用）。
- ref 编解码：
  - 中文 / emoji / 换行 round-trip 一致；
  - 畸形 base64 / 畸形 JSON / 版本不符抛错。

构建验证：`npm run typecheck`、`npm run build`（build 会执行 client bundle purity 检查）、`npm test`。

手动验证路径：

1. 打开一个已有对话，选中上方回复中的一段文本 → 选区上方出现「添加到对话」。
2. 点击 → 输入框末尾出现「引用 1」chip，上方引用条出现该条预览。
3. 展开引用条查看全文；点移除 → chip 与引用条行同时消失。
4. 再添加两条 → 编号递增；发送 → 模型收到逐行 `> ` 前缀的引用块。
5. 复制 chip / 撤销 / 重做，确认行为与其他 chip 一致。

## 对现有功能的影响

- 新增一个 `@` 触发源，但候选恒为空，`@` 菜单与现有 session mention 候选不受影响。
- 新增一个 `conversation.input.dock` 列表条目；该 slot 本身允许任意插件贡献，无冲突。
- 宿主侧代码、配置、路由均不变。
