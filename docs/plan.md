# dsh 跨会话互通插件《计划书》

> 目标：做一个 DeepSeek Harness（dsh）插件，让不同会话可以互相引用上下文，交互上对齐 Codex CLI 的 prior-conversation mention 机制：
>
> 1. 在新会话输入 `@会话标题`（如 `@修复bug`）引用旧会话；
> 2. 直接粘贴/输入旧会话的 session id 即可引用；工作区侧栏会话行右侧 `⋯` 菜单增加“复制会话 ID”；
> 3. session id 使用 dsh session 管理中的原生 session id。

---

## 一、调研结论

### 1.1 dsh 官方插件开发文档（`develop/basic`）

- 文档地址：https://deepseek-harness.github.io/deepseek-harness/develop/basic/
- 仓库对应源文件：`docs/user/develop/basic/index.zh.md`
- 核心结论：
  - 插件 = 导出 `apply(ctx)` 的 TypeScript/JS 模块，基于 Cordis 微内核；
  - 通过 `ctx` 注册服务、事件监听、定时器等，卸载自动清理；
  - `inject = ['tools', ...]` 声明依赖，框架等依赖就绪后才加载插件；
  - 支持函数/对象/类三种插件形态；配置用 Schemastery `Config` schema；
  - 分发方式：`cordis.patch.yml` overlay（开发期 `--patch`）或带 `dsh.bundle` manifest 的 npm 组合包（`dsh plugin add <pkg>`）。
- 结论：本插件应做成**一个同时带 `dsh.bundle`（宿主半）与 `dsh.client`（浏览器半）的安装包**，开发期用 patch overlay 调试。

### 1.2 dsh 源码中的 session 管理（session id 的出处）

- 运行中环境实证（本机）：
  - `DSH_SESSION_ID=session-0c3a66f2-efa1-4564-a550-6920dc1597fc`
  - `DSH_SESSION_JSONL=$DSH_HOME/sessions/<cwd-hash>/<sessionId>/session.jsonl.zstd`
- 源码证据：
  - Web 创建会话时 mint id：`packages/host/apiproxy/src/api-proxy.ts:2168`
    ```ts
    const sessionId = request.payload.sessionId ?? `session-${randomUUID()}` as SessionId
    ```
  - 内存 session store 兜底计数器 id：`packages/core/session/src/index.ts:866`（`session-<n>`）
  - 持久化目录规则：`packages/bundle/base/cordis.patch.yml` 中 `session-persistence-jsonl` 的 `root: dshHomePath('sessions')`
- 结论：**引用与复制操作一律使用 `SessionId` 原文（如 `session-0c3a66f2-…`），不做任何二次包装**。

### 1.3 重大发现：dsh 已经内置了跨会话引用的“语义层”，只是没有 Web 宿主适配器

- 包：`packages/context/session-reference`（`@deepseek-ai/dsh-session-reference`），README：
  - `ctx.sessionReferenceResolver.listCandidates(agent, query, limit, signal)`：按 session id / cwd / 最新标题做不区分大小写候选检索，排除自身，同 cwd 优先；
  - `ctx.sessionReferenceResolver.prepare(agent, content, references, signal)`：把最多 3 个来源会话投影为**有界、只读、带来源标记的快照**，返回“可读直接内容 + 一条聚合 `UserMessage` 上下文”；
  - 规范 URI：`dsh-session:<base64url(JSON.stringify(sessionId))>`；mention 语法 `@[label](uri)`；
  - `parseSessionReferenceText()` 把 mention / 裸 URI 规整成可读 `@label` 文本并返回结构化引用；
  - 快照语义：只投影当前表层中的用户直接消息、assistant 文本、compact checkpoint；排除工具/推理/上下文/被压缩遮蔽的历史；每条引用默认 64 KiB 预算；注入不可信警告，防止被引用会话“指令注入”。
- 官方实现注记：`.agents/notes/implemented/feature/2026-07-21-cross-session-references.md`
  - 明确写了 Host 适配器应当如何使用 `agent/pre-step` 与 `inject()+steer()` 交付快照；核心 agent 不解析任何 mention 语法。
- 现状核查（grep 全仓库）：`sessionReferenceResolver` 只出现在包本身与 tool-cordis 的 API catalog 中；`packages/bundle/web-app/cordis.patch.yml` 的 shipped Web 组合**没有挂载 session-reference，也没有任何 UI 调用它**。
- 结论：**本插件不需要重新发明快照/预算/防注入逻辑，而是做“宿主适配层 + 浏览器 UI + 会话行菜单”三件事，把现成的 `session-reference` 服务接进 Web**。

### 1.4 dsh 可用的扩展点（决定插件形态）

| 需求 | 可用机制 | 证据 |
|---|---|---|
| `@` 触发候选菜单 | 客户端 `ctx.inputTriggers.registerSource({trigger:'@', candidates, onPick, codec, lexicon…})` | `packages/client/ui-input-trigger/src/types.ts`；已有 `ui-skill`、`ui-subagent` 两个 `@` source 实例 |
| 客户端插件（浏览器半） | `package.json` 声明 `dsh.client`，`src/client/` 实现，tsdown 闭包 bundle | `packages/client/ui-skill/package.json`、`packages/client/tsdown.client.ts`、`packages/client/modules/README.zh.md` |
| 客户端调用宿主服务 | 宿主类继承 `TypertRemoteService` + `@Remote(...)`，生成 `/remote` 客户端贡献并 `ctx.remote.$mount()` | `packages/typert/protocol/src/index.ts`、`packages/client/ui-settings-plugin-inventory/src/client/index.ts` |
| 在消息进入 step 前改写/追加消息 | `agent/pre-step` waterfall：`next()` 后返回 `{kind:'enter', messages:[...]}` | `docs/subsystems/core.zh.md`、`packages/core/agent-loop/src/agent.ts` |
| 非 user 来源的上下文消息在聊天里的紧凑展示 | 聊天节点把 `source.kind !== 'user'` 的 `user/message` 渲染成 `ContextInjectionRow` | `packages/client/ui-conversation/src/client/conversation-nodes/message.ts`、`ContextInjectionRow.tsx` |
| 会话行 `⋯` 菜单 | **已硬编码 Rename/Fork/Archive，无扩展槽** | `packages/client/ui-workspace/src/client/rows/Rows.tsx`（`SessionNodeItem`） |

### 1.5 Codex CLI 的会话互通机制（对齐对象）

- 官方文档：
  - https://learn.chatgpt.com/docs/codex/cli（`codex resume`：从当前仓库恢复近期对话，可跨本地会话搜索；`codex fork`/`/resume` 选择器）
- 源码证据（`openai/codex`）：
  - session id = **UUIDv7 字符串**：`codex-rs/protocol/src/session_id.rs`；
  - 落盘：`~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`：`codex-rs/rollout/src/metadata.rs`；
  - 恢复：CLI 提示 `codex resume 123e4567-…`：`codex-rs/cli/src/main.rs:3543`。
- **跨会话 mention 机制（本需求的原型）**：openai/codex PR #17358 “Add prior-conversation remember support with # mentions and autocomplete”（https://github.com/openai/codex/pull/17358）
  - 输入 `#` → 自动补全弹出历史会话，Enter/Tab 选中，支持多选；
  - 草稿可见文本保持 `#会话标题`，同时**隐藏绑定 `thread://<thread-id>`**；
  - 提交后，在可见 user turn 开始前**前置注入一条隐藏 `ResponseItem::Message`**：`<remembered_context> … previous Codex conversation(s) … as remembered context`；
  - 只抽取源会话的可见 user/assistant 消息，排除 system prompt / tool call / reasoning；
  - 后端 `thread/remember` RPC **拒绝自引用**，任一来源不可访问则**整体失败（原子性）**。
- 对照结论：dsh 的 `session-reference` 设计与 Codex PR 高度同构（可见 `@标题` 文本 + 隐藏快照 + 自引用拒绝 + 原子失败 + 排除工具/reasoning），差异只是 Codex 用 `#`、我们用 `@`。我们完全复用 dsh 已实现语义，UI 行为对齐 Codex。

---

## 二、方案总览

### 2.1 总体架构

```
浏览器（dsh.client 半）
  ┌────────────────────────────────────────────────────┐
  │ 会话行 ⋯ 菜单（上游小扩展，见 §6）                    │
  │   └─ [复制会话 ID]  ← 本插件注册，writeClipboard(id) │
  │                                                    │
  │ 输入框 @ 触发器（ctx.inputTriggers.registerSource）   │
  │   ├─ candidates → Remote.listCandidates(sessionId) │
  │   ├─ onPick      → ReferenceInsert(chip)           │
  │   └─ serialize   → preflight(校验) + 规范 mention   │
  └───────────────────────┬────────────────────────────┘
                          │ Typert Remote（插件自带 namespace）
宿主（node 半）
  ┌────────────────────────────────────────────────────┐
  │ SessionReferenceBridge (TypertRemoteService)        │
  │   candidates / preflight / formatMention           │
  │                                                    │
  │ MentionPreStepAdapter（agent/pre-step waterfall）    │
  │   解析：规范 mention / 裸 session id / 手打 @标题    │
  │   准备：ctx.sessionReferenceResolver.prepare()      │
  │   改写：decision.messages = [snapshot, 可读@标题…]  │
  └───────────────────────┬────────────────────────────┘
                          │
        ctx.sessionReferenceResolver（挂载官方包）
                          │
        ctx.sessionQuery.readSurface（只读会话表层）
```

### 2.2 关键设计决策

1. **复用官方 `session-reference` 服务，不改 core**。插件只在 cordis 组合里新增一行 `session-reference`，然后做 Host 适配。
2. **提交路径仍走标准 `session.prompt` RPC**，不改 api-proxy、不 fork 客户端 runtime：
   - 浏览器端把选中会话编码为规范 mention 文本（`@[修复bug](dsh-session:…)`）随标准消息提交；
   - 宿主 `agent/pre-step` 监听器在消息真正进入 step 前解析 mention、准备快照、把决策消息改写成 `[快照上下文, 可读 @修复bug, …]`；
   - 用户气泡最终显示可读 `@修复bug`，快照以 source=`session-reference` 的上下文消息出现，Web 自动渲染成紧凑的 ContextInjectionRow。
3. **双保险错误处理**：`codec.serialize()` 在提交事务内先调用 Remote `preflight`（真正执行一次 prepare 验证），失败则**阻断发送并恢复草稿**；`agent/pre-step` 再执行一次 prepare 兜底（源会话可能恰好在两次调用之间变化），失败策略可配置（默认 passthrough 并保留可读文本，见 §5.4）。
4. **会话行复制 ID 需要 dsh 上游加一个小扩展点**（当前菜单硬编码，没有槽位）。推荐先做一个小型上游 PR（方案 A），插件再注册动作；不接受的备选是插件整体 shadow `sidebar.workspaces`（方案 B，见 §6）。

---

## 三、插件包形态与目录

建议包名：`dsh-sessions`（仓库目录 `dsh-sessions/`）。

```
dsh-sessions/
├── package.json              # dsh.bundle + dsh.client 双 manifest
├── cordis.patch.yml          # 挂载 session-reference + 本插件（host/client 双面）
├── tsdown.config.ts          # 参照 packages/client/tsdown.client.ts 的 clientBundle 预设
├── src/
│   ├── index.ts              # 宿主入口：提供 Bridge 服务 + 注册 agent/pre-step 适配器
│   ├── bridge.ts             # SessionReferenceBridge (TypertRemoteService)
│   ├── mention.ts            # 宿主侧 mention 解析/裸 id/裸 @标题 解析
│   ├── pre-step-adapter.ts   # agent/pre-step waterfall 改写器
│   ├── config.ts             # Schemastery 配置
│   ├── types.ts              # Remote DTO
│   └── client/
│       ├── index.ts          # 浏览器入口：@ source + 复制ID动作注册
│       ├── session-mention-source.ts
│       ├── session-action.ts # 复制会话ID
│       ├── locales.ts        # zh/en
│       └── styles.module.css
├── upstream/
│   └── 0001-workspace-session-row-actions.patch   # 方案A的上游补丁（自留说明/回放用）
└── tests/
    ├── mention.spec.ts
    ├── pre-step-adapter.spec.ts
    ├── bridge.spec.ts
    ├── client-source.client.spec.ts
    └── e2e/
        ├── mention-by-title.e2e.ts
        ├── mention-by-id.e2e.ts
        └── copy-session-id.e2e.ts
```

### 3.1 `package.json` 要点

```jsonc
{
  "name": "dsh-sessions",
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./types": "./lib/types/types.d.ts",
    "./typert": "./lib/typert.host.js",
    "./remote": "./lib/typert.remote-client.js"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-input-trigger",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-workspace"        // 方案A需要；方案B去掉
      ]
    }
  }
}
```

依赖（peer）：`@deepseek-ai/dsh-session-reference`、`@deepseek-ai/dsh-session-query`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/cordis`、`zod`；开发依赖 `@deepseek-ai/dsh-api-remotes` 等 client 侧类型。

### 3.2 `cordis.patch.yml`

```yaml
- insert:
    - id: session-reference
      name: '@deepseek-ai/dsh-session-reference'
      config:
        maxReferences: 3          # 官方硬上限即 3
        candidateLimit: 50
        maxReferenceBytes: 65536  # 每引用 64 KiB

    - id: session-bridge
      name: 'dsh-sessions'   # 宿主半：Bridge 服务 + pre-step 适配器
      inject: [agents, sessionQuery, sessionReferenceResolver]
      config:
        failureMode: passthrough  # passthrough | reject
        allowBareSessionIds: true
        allowPlainTitleMentions: true
        preflight: true
```

说明：`dsh-sessions` 这一行同时是宿主条目与 `dsh.client` 浏览器条目（node 半边扫描 `dsh.client` 声明后自动提供 `/plugins/session-bridge/client.js`）。

---

## 四、宿主半详细设计

### 4.1 `SessionReferenceBridge`（Remote 服务）

```ts
export class SessionReferenceBridge extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'sessionReferenceResolver']

  constructor(ctx: Context) { super(ctx, 'sessionBridge') }

  @Remote('candidates')
  async candidates(sessionId: SessionId, query: string, limit: number, signal?: AbortSignal) {
    const agent = this.requireAgent(sessionId)      // ctx.agents.get，缺省报 session-not-found
    return this.ctx.sessionReferenceResolver.listCandidates(agent, query, limit, signal)
  }

  @Remote('preflight')
  async preflight(sessionId: SessionId, references: SessionReferenceInput[], signal?: AbortSignal) {
    const agent = this.requireAgent(sessionId)
    // 真正跑一次 prepare，丢弃快照；任何读失败/预算超限/自引用都向上抛错
    await this.ctx.sessionReferenceResolver.prepare(
      agent, [{ type: 'text', text: '' }], references, signal,
    )
    return { ok: true }
  }

  @Remote('formatMention')
  formatMention(reference: SessionReferenceInput): string {
    return formatSessionReferenceMention(reference)
  }
}
```

要点：
- 候选和 preflight 只面向“已打开（live agent）”的目标会话；这正是发消息时必有的事实。
- `@Remote` 方法尾参 `signal?: AbortSignal` 会被 Typert Gateway 识别为取消信号，候选菜单关闭时自动中止。

### 4.2 `MentionPreStepAdapter`（`agent/pre-step` 改写）

注册：

```ts
ctx.on('agent/pre-step', async (payload, next) => {
  const decision = await next()
  if (decision.kind !== 'enter') return decision
  const adapted = await adaptDecision(ctx, payload, decision)   // 失败按 failureMode
  return adapted
})
```

`adaptDecision` 流程（每条直接用户消息只处理一次）：

1. 只扫描 `source.kind === 'user'` 且带 `rpcId` 的直接消息；快照消息（`source.kind === 'session-reference'`）与工具结果一律跳过，避免递归/误伤。
2. 用三种规则解析文本块，优先级：
   - **规范 mention**：`@[label](dsh-session:…)` 与裸 `dsh-session:…` URI（调用 `parseSessionReferenceText`）；
   - **裸 session id**：把 `ctx.sessionQuery.listSessions()` 返回的 id 集合做最长前缀匹配（支持任意合法 id，不硬编码 uuid 格式；找不到的 id 保留为普通文本）；
   - **手打 `@标题`**：`@` 后非空 token 在 `listCandidates(agent, token)` 结果中做**不区分大小写精确 label 匹配**；命中多个同名会话时视为歧义，保留原文不引用（避免引用错对象）。
3. 命中后调用 `ctx.sessionReferenceResolver.prepare(agent, normalizedContent, refs, payload.signal)`：
   - `normalizedContent` = 去掉 mention 标记后的可读内容（`@修复bug`）；
   - `refs` 按首次出现顺序、去重；官方服务负责拒绝自引用、上限 3、64 KiB 预算与读取失败。
4. 改写 `decision.messages`：
   - 在**对应直接消息的正前方**插入 `additionalContext`（快照，source=`session-reference`）；
   - 直接消息替换为“保留原 `id`/`source`（rpcId、clientTimeZone 等）+ 规整后内容”的新消息；
   - 系统提示组装出的 context 消息等其余消息原样保留、顺序不变；
   - 最终进入 step 的日志顺序 = `[快照 user/message, 可读直接 user/message, …]`，满足官方“snapshot 紧邻直接消息、目标回放可重建”的约定。
5. 失败策略（配置 `failureMode`）：
   - `passthrough`（默认）：保留已规整的可读 `@标题` 文本但不附快照，结构化记录错误日志；消息不会丢；
   - `reject`：返回 `{kind:'reject'}`。注意这会关闭 turn 且消息不落日志，**仅建议**在需要强一致性的部署中使用；
   - 前端 `preflight` 已经把绝大多数失败挡在发送之前，pre-step 失败只剩“preflight 之后源会话被删/损坏”的竞态。

### 4.3 配置项（Schemastery）

| 键 | 默认 | 说明 |
|---|---|---|
| `maxReferences` | 3 | 透传官方配置，官方硬上限 3 |
| `candidateLimit` | 50 | 候选数量 |
| `maxReferenceBytes` | 65536 | 每条快照字节预算 |
| `allowBareSessionIds` | true | 支持直接输入 session id |
| `allowPlainTitleMentions` | true | 支持手打 `@标题`（不经过菜单） |
| `failureMode` | `passthrough` | pre-step 二次 prepare 失败策略 |
| `preflight` | true | 是否在 serialize 阶段做 preflight |

---

## 五、浏览器半详细设计

### 5.1 `@` 触发源（`InputTriggerSource`，trigger=`'@'`，name=`'session'`）

参照 `packages/client/ui-subagent/src/client/index.ts` 的注册方式，但语义不同：

```ts
const source: InputTriggerSource = {
  trigger: '@',
  name: 'session',
  order: 10,
  async candidates(session, { query, signal }) {
    const list = await remote.sessionBridge.candidates(session.sessionId, query, undefined, signal)
    idByLabel.set(session.sessionId, new Map(list.map(c => [c.label, c])))
    return list.map(c => ({
      name: c.label,
      description: c.sessionId,        // 菜单副标题显示 id，便于确认
      // 可选 icon
    }))
  },
  warm(session) { void this.candidates(...) 预取 },
  lexicon(session) {
    // 零 RPC 热词表：会话列表 snapshot 的 displayTitle（装饰已输入文本）
    return titlesFrom(ctx.sessions.list, session.sessionId)
  },
  subscribeLexicon(_session, listener) {
    return ctx.sessions.list.subscribe(listener)
  },
  onPick({ candidate, session }) {
    const hit = idByLabel.get(session.sessionId)?.get(candidate.name)
    return {
      insert: {
        source: 'session-reference',
        ref: hit.sessionId,            // 隐藏绑定：原生 SessionId
        label: hit.label,              // 芯片显示：@修复bug
        clipboardText: `@${hit.label}`,
      },
    }
  },
  codec: {
    clipboardText: ref => `@${ref}`,
    async serialize(ref, signal) {
      // 1) 提交事务内先 preflight（读源会话、校验预算/自引用）；失败 → 本次发送被阻断，草稿保留
      await remote.sessionBridge.preflight(sessionIdOfSubmit, [{ sessionId: ref }], signal)
      // 2) 模型表示 = 规范 markdown mention；宿主 pre-step 会规整成可读 @label
      return remote.sessionBridge.formatMention({ sessionId: ref, label: labelOf(ref) })
    },
  },
}
ctx.effect(() => ctx.inputTriggers.registerSource(source), 'session-bridge: @ source')
```

要点：
- `name` 用 `'session'`，与现有 `'subagent'`、`'skill'` 不冲突；
- `onPick` 走 `insert`（带隐藏 ref 的 chip），而不是 ui-subagent 的纯文本路径——这样才能在提交时绑定 id；
- serialize 的 preflight 失败会抛出，按照 ui-input-trigger 约定**失败阻塞发送、永不静默降级**，正好满足 Codex PR “任一来源不可访问则原子失败”的 UX。

### 5.2 复制会话 ID（依赖 §6 的上游扩展点）

```ts
ctx.sessionRowActions.register({
  id: 'copy-session-id',
  order: 40,
  label: () => t('menu.copySessionId'),          // 复制会话 ID / Copy session ID
  icon: React.createElement(IconCopyOutline16),
  onSelect(sessionId) { void writeClipboard(sessionId) },
})
```

- 复制内容为 `SessionSummary.id` 原文（`session-<uuid>`），与 `$DSH_HOME/sessions/**/<id>` 目录、`session.jsonl.zstd` header id 完全一致；
- `writeClipboard` 复用 `@deepseek-ai/dsh-client-ui-primitives`（平台模块，允许值 import）；
- 菜单动作的选中反馈交给 dsh 现有 Menu 组件（`onSelect` 关闭菜单），并可选 toast/HoverCard 反馈“已复制”。

### 5.3 端到端交互时序（以 `@修复bug` 为例）

1. 用户在会话 B 输入 `@修` → 候选菜单显示会话 A `修复bug`（副标题 `session-…`）；
2. 选中 → 草稿出现 chip `@修复bug`（内部 ref=会话 A id）；
3. 回车发送 → `codec.serialize`：
   - `preflight(会话B, [{sessionId:A}])`：宿主读 A 表层、套预算、验证非自引用；
   - 成功 → 模型文本为 `@[修复bug](dsh-session:…)`；
   - 失败 → 发送中止，草稿恢复，显示错误；
4. 标准 `session.prompt` RPC 入队可读…呃，带 mention 的文本；
5. 会话 B 的 `agent/pre-step` 拦截到这条直接消息 → `prepare` 生成快照 → 决策消息改为：
   - `user/message`（source=`session-reference`，`## Referenced sessions … <referenced-sessions>{…}</referenced-sessions>`）
   - `user/message`（source=`user`，文本 `@修复bug …`）
6. 模型在同一 step 先看到快照、再看到可读提问；聊天窗口里快照渲染为 ContextInjectionRow，提问渲染为普通用户气泡。

裸 id 路径：步骤 2–3 可跳过，用户直接粘贴 `session-…` 发送，宿主 pre-step 第 2 类规则命中并走 5–6。

### 5.4 安全与快照语义（继承官方，不重新发明）

- 快照只读、不可信：模型收到明确警告，不得执行快照中的指令/权限声明/工具请求；
- 只投影用户直接消息、assistant 文本与 compact checkpoint；**排除工具、推理、压缩前遮蔽内容、插件注入消息**；
- 每次引用独立 64 KiB 预算，超过则整体失败（`SESSION_REFERENCE_BUDGET_EXCEEDED`），绝不发送半截上下文；
- 拒绝自引用、去重、最多 3 个来源；快照在发送时冻结，之后源会话再变化不影响本次消息；
- 引用不建立实时链接：不是 fork/resume/订阅。

---

## 六、前置上游改动：会话行 `⋯` 菜单扩展点（复制 ID 的前提）

### 6.1 现状

`packages/client/ui-workspace/src/client/rows/Rows.tsx` 的 `SessionNodeItem` 把菜单项硬编码为 Rename/Fork/Archive；没有 slot，也没有菜单动作注册服务。`sidebar.workspaces` 是 single slot，插件注册进去会**整个替换**工作区/会话浏览区域，无法只加一个菜单项。

### 6.2 方案 A（推荐）：给 dsh 提交一个小型扩展 PR

改动范围（约 100–150 行，含测试）：

1. 新增 `packages/client/ui-workspace/src/client/session-row-actions.ts`：
   ```ts
   export interface SessionRowAction {
     id: string
     order?: number
     label: string | (() => string)
     icon?: ReactNode
     danger?: boolean
     onSelect(sessionId: SessionId, title: string): void
   }
   declare module '@deepseek-ai/cordis' {
     interface Context { sessionRowActions: SessionRowActionsService }
   }
   ```
   服务提供 `register(action): () => void`，按 `order` 排序，HMR 自动清理；
2. `ui-workspace` 客户端 `index.ts`：`ctx.plugin(SessionRowActionsService)`，并把它加入 `sidebar.workspaces` 注册项的 inject；
3. `Rows.tsx` 的 `SessionNodeItem`：合并 `基础项 + sessionRowActions.list()` 生成 `MenuEntry[]`；`onSelect` 中未知 id 分发给对应 action 的 `onSelect(sessionId, title)`；注册表变化时菜单自然重渲染；
4. 单测：注册/卸载、排序、菜单分发、多动作共存。

插件随后只依赖 `@deepseek-ai/dsh-client-ui-workspace` 的 `/client` 类型（type-only，符合客户端 purity 门禁），并在运行时注册复制动作。该扩展点是通用能力，与“复制 ID”解耦，符合 dsh 的插件化方向，建议直接向上游提交。

### 6.3 方案 B（备选，纯插件不改 dsh）

把 `ui-workspace` 的 `WorkspaceBrowser.tsx` / `rows/Rows.tsx` / `tree.ts` 等**复制进插件仓库**，在 `sidebar.workspaces`（single slot）注册整体替换版，只在其 `SessionNodeItem` 中增加“复制会话 ID”。

- 优点：零上游依赖，装上即用；
- 缺点：约 600–800 行 UI 复制；dsh 每次改侧栏都要同步；跨插件值 import 被 purity 门禁禁止，只能复制不能复用；维护成本显著高于方案 A。

**计划默认按方案 A 推进**；若评审否决上游改动，再切方案 B。

---

## 七、打包、安装与开发验证

### 7.1 开发期（推荐先做）

在 dsh 源码 checkout 中：

```sh
pnpm dsh web --patch ./dsh-sessions/cordis.patch.yml
```

（插件行指向本地构建/源码绝对路径；参考 `docs/user/develop/basic/index.zh.md` 的 scratch-plugin 流程。）

若把插件作为 dsh fork 内的 workspace 包开发（`packages/context/session-bridge-web`），则直接复用仓库的 `packages/client/tsdown.client.ts` clientBundle 预设与 Typert 生成，开发和 HMR 最顺。

### 7.2 发布安装

独立 npm/git 包场景：把 `packages/client/tsdown.client.ts` 的 clientBundle 预设按 MIT 许可复制进插件仓库（去掉仓库根路径假设），`prepare` 脚本构建 `lib/` 与 `lib/client.js`，然后：

```sh
dsh plugin --profile web add dsh-sessions
# 或本地/git：
dsh plugin --profile web add ./dsh-sessions
dsh plugin --profile web add github:you/dsh-sessions#<sha>
```

安装后 `dsh --profile web --dump-config` 应出现 `session-reference` 与 `session-bridge` 两行；浏览器端 `cordis_inspect what:"client"` 应看到 `session-bridge` 条目与 `@session` 触发源。

---

## 八、测试与验收

### 8.1 单元/集成测试

| 测试 | 验证点 |
|---|---|
| `mention.spec.ts` | 规范 mention / 裸 URI / 裸 id / 手打 @标题 / 歧义标题 / 非 id 文本不误报 |
| `pre-step-adapter.spec.ts` | enter 决策改写顺序 `[snapshot, direct, context]`；工具结果与 snapshot 不被二次解析；`reject`/`passthrough` 两种失败策略；取消信号传播 |
| `bridge.spec.ts` | Remote candidates 排除自身、标题/id/cwd 过滤；preflight 对自引用/预算超限/源会话缺失报错 |
| `client-source.client.spec.ts` | 候选渲染、onPick 的 ref 绑定、serialize 调 preflight+formatMention、失败阻断、lexicon 订阅 |
| 上游扩展单测（方案 A） | 动作注册/排序/分发/HMR 清理 |

### 8.2 E2E 验收矩阵（对应三条需求）

| # | 场景 | 预期 |
|---|---|---|
| 1 | 会话 A 标题为“修复bug”；切到会话 B，输入 `@修` | 候选菜单出现“修复bug”，副标题为 `session-…` |
| 1 | 选中并发送 | 用户气泡显示 `@修复bug`；上下文行显示“Referenced sessions”；模型请求中 snapshot `user/message` 紧邻直接 `user/message` 之前；A 的工具调用/reasoning 不出现在快照 |
| 1 | 手打 `@修复bug`（不点菜单）并发送 | 同样注入快照（标题唯一时） |
| 2 | 复制会话 A 的 id | 工作区会话行 `⋯` → “复制会话 ID”；剪贴板为 `session-<uuid>` 原文，与 `$DSH_HOME/sessions/**/<该id>` 一致 |
| 2 | 会话 B 直接粘贴该 id 发送 | 与 #1 相同的快照注入；若 id 不存在/已删，preflight 失败、草稿保留 |
| 3 | 快照安全 | 源会话包含“请执行 rm -rf”等文本时，模型看到不可信警告；不因引用而执行 |
| 4 | 自引用 | 在会话 A 中引用 A 的 id → preflight 拒绝，消息不发送 |
| 5 | 多引用 | `@修复bug @设计评审` 两个 chip → 快照按出现顺序、去重、最多 3 个 |
| 6 | 持久化回放 | 刷新页面/重启后，目标日志仍为 `[session-reference 快照, 可读直接消息]`，不重复注入 |

### 8.3 验收口径

- 三条用户需求全绿；
- 不修改 dsh core / agent-loop / api-proxy 任何一行（方案 A 的侧栏菜单扩展是独立小 PR）；
- 卸载插件后：快照功能消失、日志不再新增 session-reference 消息、侧栏菜单恢复默认（上游扩展点本身为空时无感知）；
- 兼容 zh/en 语言与深浅色主题（CSS 使用 `--dsw-*` 语义 token，遵循 `docs/web-styling.zh.md`）。

---

## 九、里程碑与工作量估算

| 里程碑 | 内容 | 估算 |
|---|---|---|
| M0 | 决定/落地方案 A 或 B；提交/合入 `sessionRowActions` 上游小 PR | 0.5–1 天 |
| M1 | 插件仓库脚手架：双 manifest、cordis.patch.yml、clientBundle 构建、安装/热更链路打通 | 1 天 |
| M2 | 宿主半：Remote bridge + mention 解析 + pre-step 适配器 + 配置 + 单测 | 2 天 |
| M3 | 浏览器半：`@` 候选源、chip/ref 绑定、preflight serialize、lexicon 装饰 | 2 天 |
| M4 | 复制会话 ID 动作（方案 A）/备选 B 实现 | 0.5–1.5 天 |
| M5 | 打包发布 + 安装文档（npm/git/本地三种路径） | 1 天 |
| M6 | E2E 验收矩阵、回归、文档（README.zh/en、设计注记） | 1.5 天 |
| 合计 | | 约 8–10 人天 |

---

## 十、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| preflight 与 pre-step 之间存在竞态（源会话刚被删除/压缩） | 快照缺失或消息被拒 | preflight 已挡 99%；pre-step 默认 `passthrough` 保留可读消息并记日志；可切 `reject` |
| `sessionRowActions` 上游扩展不被接受 | 复制 ID 无法以插件动作接入菜单 | 方案 B（vendor 侧栏）或改为会话头部 actions 的折中入口 |
| 标题重名导致手打 `@标题` 歧义 | 引用错会话 | 规则：重名不自动解析，只认菜单 chip 或 id；候选菜单展示 id 副标题 |
| 大量旧会话时 `listSessions()` 每次 pre-step 都遍历 | 长会话列表下轻微延迟 | 候选/解析用 `sessionQuery` 的有界读取与 AbortSignal；后续可加 id 索引缓存 |
| 客户端 bundle 构建门槛（closure factory + purity 门禁） | 插件在 Web 加载失败 | M1 先用 dsh 仓库内 `clientBundle` 预设跑通，再评估独立包；CI 校验 `/plugins/<id>/client.js` 可达 |
| dsh 版本漂移 | 依赖 API 变化 | 锁定 peer 依赖版本；发布时注明最低 dsh 版本（0.1.0-rc.5 起） |
| 快照 token 成本 | 引用消息增加 64 KiB×3 token | 官方默认预算与投影已控；提供 `maxReferenceBytes` 配置下调 |

---

## 十一、开放决策（评审时确认）

1. **方案 A / B**：是否接受给 dsh 上游（或你的 dsh fork）提交 `sessionRowActions` 小扩展？**推荐 A**。
2. **范围**：本期只做 Web UI（工作区菜单已限定 Web）；CLI/TUI 的 `@` mention 适配是否列入二期？
3. **裸 id 的作用域**：默认全 `$DSH_HOME` 可见会话（同 cwd 排序靠前）；是否需要限制“仅同一工作区”？
4. **发布形态**：dsh fork 内的 workspace 包，还是独立 npm/git 可安装包？两者可共存，默认先做独立包 + 开发 overlay。

---

## 附录：引用清单

- dsh 官方 basic 文档：https://deepseek-harness.github.io/deepseek-harness/develop/basic/
- session-reference 包：`packages/context/session-reference/README.zh.md`
- 跨会话引用设计注记：`.agents/notes/implemented/feature/2026-07-21-cross-session-references.md`
- session id 生成：`packages/host/apiproxy/src/api-proxy.ts:2168`、`packages/core/session/src/index.ts:866`
- Web 组合：`packages/bundle/web-app/cordis.patch.yml`（未挂 session-reference）
- 输入触发系统：`packages/client/ui-input-trigger/src/types.ts`
- 会话行菜单：`packages/client/ui-workspace/src/client/rows/Rows.tsx`
- 客户端插件构建：`packages/client/tsdown.client.ts`、`packages/client/modules/README.zh.md`
- Typert Remote：`packages/typert/protocol/src/index.ts`
- Codex CLI 官方文档：https://learn.chatgpt.com/docs/codex/cli
- Codex # mention PR：https://github.com/openai/codex/pull/17358
- Codex 源码：`codex-rs/protocol/src/session_id.rs`、`codex-rs/rollout/src/metadata.rs`、`codex-rs/cli/src/main.rs`
