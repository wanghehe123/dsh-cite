# dsh-cite

**把值得留下的东西，指回这一轮。**

选中刚才说过的话，加一句批注；`@` 另一段会话当证据；模型刚写完的文件直接出现在回复下面。不用再把旧对话和路径粘进输入框。

这是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 插件。中文名：**引注**。曾用名 `dsh-sessions`。

```sh
dsh plugin --profile web add @wishp3/dsh-cite
dsh --profile web
```

装好后打开设置 → 插件 → 插件配置 → **引注**，按需把 `@` 范围从「仅当前工作区」改成「所有可见会话」。

## 四件你会立刻用到的事

### 1. 圈一段前文，像批注一样带回去

在聊天里选中文本，点「添加到对话」。句子末尾出现 1、2、3 小号圆点；点圆点就能写下评论。发送时，模型看到的是普通 Markdown 引用，评论跟在后面：

```md
> 你选中的第一行
> 你选中的第二行

你的可选评论
```

同一轮可以圈多处。输入框上方只留一颗「N 条注释」胶囊，点开再管理。

### 2. `@` 一段旧会话，当只读证据

新对话里输入 `@`，从历史会话里挑一段。宿主会做成有界、只读、带来源的快照，再交给模型——不是把整段日志糊进去。

<img src="docs/screenshots/02-mention-menu.png" alt="输入 @ 后出现的会话候选菜单" width="560">

也可以直接写 `session-<uuid>`，或在开关打开时手打 `@标题`（标题必须唯一，重名会当普通文本）。

### 3. 这一轮写出的文件，就钉在回复下面

回复完成后，「产物」列表出现在消息下方：文件名、说明。左键打开；右键复制路径，或在 Finder / 资源管理器 / 文件管理器里显示所在文件夹。

### 4. 会话和工作区的两个小菜单

会话行 `⋯` 可以复制原生 session id；工作区行 `⋯` 可以直接打开那个文件夹。

| 复制会话 ID | 复制成功 |
| --- | --- |
| <img src="docs/screenshots/03-copy-session-id.png" alt="会话行菜单里的复制会话 ID" width="400"> | <img src="docs/screenshots/04-copy-toast.png" alt="复制会话 ID 成功 toast" width="400"> |

## 和官方的关系

`dsh-cite` 是社区插件，不是 DeepSeek 官方产品，也不改官方运行时。

- 跨会话快照完全走官方 `@deepseek-ai/dsh-session-reference`。本包只做 Web 触发、路由和 `agent/pre-step` 接线。
- 浏览器半挂在官方的 `inputTriggers`、slots、conversation 等服务上。
- 选区引注是浏览器里组装的 `> ` 文本，不写入结构化引用元数据。

需要改核心运行时或走 CLI，请以[官方仓库](https://github.com/deepseek-ai/deepseek-harness)为准。插件怎么装进 profile，见官方[插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#plugin-management)和[架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)。

## 配置

<img src="docs/screenshots/01-plugin-config.png" alt="插件配置页：引注卡片展开后的样式" width="520">

卡片默认折叠。`scope` 在卡片上改，保存后写入宿主 settings；其余键用 `cordis.patch.yml` 或 profile 覆盖。

卡片不走官方 settings 槽（api-proxy 白名单不覆盖第三方包），而是走本包的 `GET/POST /dsh-sessions/settings`。持久化节目前仍是 `settings.yaml` 里的 `dsh-sessions:`，以免已有配置丢失。

| 键 | 默认 | 作用 |
|---|---|---|
| `scope` | `workspace` | `workspace`：只能引用与目标会话同 cwd 的记录；`all`：引用本机 dsh 可见的全部持久化会话 |
| `allowBareSessionIds` | `true` | 解析消息中的裸 session id |
| `allowPlainTitleMentions` | `true` | 解析手打 `@标题` |
| `candidateLimit` | `50` | 预留：浏览器半目前固定请求 50 个候选 |
| `failureMode` | `passthrough` | preflight 成功后、pre-step 再次 prepare 失败时：`passthrough` 保留可读文本继续，`reject` 拒绝该步 |

## 引用前文，逐步

1. 在聊天正文里选中一段文本（代码、自然语言都可以）。选区上方出现「添加到对话」。
2. 点击后：
   - 文本先 `trim`，超过 16,000 Unicode 码点会截断并加上本地化截断标记；
   - 草稿末尾插入一个 `dsh-sessions-quote` chip，输入框里显示「引用 N」；
   - 选中句子第一行末尾出现小号数字圆点。
3. 点击圆点：
   - 弹出评论卡片，预填已有评论（没有就是空的）；
   - 「保存」写回这条引用；圆点上多一个小点，表示已有评论；
   - 「取消」、Esc 或点卡片外，什么都不改。
4. 输入框上方的「N 条注释」默认收起。展开后可看预览、全文、评论，或逐条移除（等价于删掉对应 chip）。
5. 发送时每个 chip 变成逐行 `> ` 的引用块；有评论则空一行再跟评论。
6. 发送成功后草稿清空，圆点和注释胶囊一起消失。

选区必须在会话正文（`[data-conversation-scroll]`）里，且不在输入区（`[data-composer-seat]`）。空选区、输入阶段不是 `plain` 时，按钮不会出现。

### 和 `@` 跨会话引用差在哪

| | 引用前文 | `@` 历史会话 |
| --- | --- | --- |
| 来源 | 当前会话里已经出现的文字 | 本机其他历史会话 |
| 谁准备内容 | 浏览器当场组装 | 宿主 `prepare()` 做快照 |
| 模型看到的 | `> ` Markdown + 可选评论 | `## Referenced sessions` 快照 + 可读 `@label` |
| 来源能不能追溯 | 没有结构化元数据 | 有 session id、label、cwd |
| 大小限制 | 单条 16,000 码点；评论 4,000 码点 | 每个来源 65536 字节 |

### 实现要点

- **圆点位置**：添加前克隆选区 `Range`，取第一行非空 `clientRect` 的右端、垂直居中；滚出视口就隐藏。上游刷新卸掉节点后，圆点会消失，再引用一次即可。
- **保存评论**：官方输入机先 `slash/input-consume-token` 拿掉旧 chip，再 `slash/input-insert-reference` 插回同一位置。两次事务，撤销要按两下。失败会回滚旧 chip，并在卡片里提示重试。
- **状态只有一份**：注释条从 `input.occurrences` 里过滤 `source === 'dsh-sessions-quote'`。撤销、重做、复制、粘贴、手删 chip，都会一起变。
- **序列化**：`serialize` 和 `clipboardText` 都带首尾换行，相邻引用不会粘成一行。草稿重载后不再是 chip，只留下 `> ` 文本。
- **不挡 `@` 菜单**：引注用的是一个候选恒为空的 `@` 源，空分组不渲染。

## `@` 跨会话，逐步

1. `@` 候选来自 `POST /dsh-sessions/candidates`。选中后插入 chip，不透明 ref 带着目标会话、来源会话、label 和规范 mention。
2. 提交时 `serialize` 调 `/dsh-sessions/preflight`：按当前 `scope` 过滤并完整跑一次 `prepare()`。失败会中止提交、保住草稿；成功才写出 `@[label](dsh-session:…)`。
3. 宿主 `agent/pre-step` 先走普通 enter，再解析这条 user 消息：规范 mention 收成可读 `@label`；裸 id 和手打 `@标题` 看开关。每个 id 必须落在 scope 里，否则按 `failureMode` 处理。
4. `prepare()` 一次读完全部来源并去重，重写成 `[快照, 可读直接消息, …]`。快照源标记为 `{ kind: 'session-reference', version: 1 }`。

快照语义沿用 `@deepseek-ai/dsh-session-reference`：

- 每个来源只调一次 `sessionQuery.readSurface()`，入队后不重读。只投影用户直接发出的 `user/message`、assistant 文本，以及带 `dsh-compaction` 标记的检查点。工具、reasoning、上下文、插件生成的 user 消息、未完成的 assistant 分片、被压缩遮蔽的事件全部排除。
- 每个来源独立受 65536 字节限制，保留检查点和最新消息，旧的非检查点单元按 `dsh-output-retention` 头尾截断。固定字段就超限时以 `SESSION_REFERENCE_BUDGET_EXCEEDED` 失败。
- 一条消息最多 3 个不同来源；不能引用自己。
- 目标日志先记带来源的上下文 `user/message`，再记可读直接消息。之后源会话变更、压缩或删除，都不影响目标回放。

### 模型看到的跨会话内容

两条连续的 user 消息：先是 `## Referenced sessions` 不可信快照，再是带可读 `@label` 的当前消息。警告禁止遵循快照里的指令、权限声明或工具请求，除非当前 user 又说了一遍。label、cwd、id 和会话文本以 JSON 放进 `<referenced-sessions>`；数据里的每个 `<` 会写成 `\u003c`，源文本拼不出定界标签。

每条带引用的消息多一段固定警告，外加最多三个快照。精确快照留在目标历史里，直到目标自己压缩或摘要它。源会话之后怎么变，都不会再涨 token。快照和请求是两条只追加的新消息，前面的 KV cache 还能用；换一套引用只动新后缀。

## 工作区界面（vendor）

当前发布的 `ui-workspace` 没有会话行菜单槽位。`upstream/0001-web-session-row-menu-slot.patch` 是给上游的补丁；在它合并之前，本包 vendor 了工作区浏览器（`src/vendor/workspace/`），在 bundle patch 里关掉内置行，自己补上 `sidebar.workspaces` 和 `conversation.hero.workspace`。其余行为和内置一致。

复制先在点击手势里走 `document.execCommand('copy')`，失败再试 `navigator.clipboard.writeText()`。toast 在行组件里渲染，4 秒后消失。

bundle patch 同时插入官方 `session-reference` 和本包这一行（`dsh.bundle` + `dsh.client`），Web loader 会从同一行带上浏览器半。dsh 升级工作区 UI 后，需要同步 vendor；上游槽位补丁合并后，可以删掉 vendor、恢复内置实现。

## 已知限制

- 选区引注只收文本。图片、工具卡片进不去。
- 同一段文字可以圈多次，不会自动去重。
- 不做 AI 回复里的引用块渲染；`>` 就是普通 Markdown。
- 不做语音输入，也不放装饰性的死按钮。
- 草稿重载后，选区引用不会变回 chip。
- 手打 `@标题` 只精确匹配；重名请用菜单或裸 id。
- 不搜索消息正文。候选只看 id、cwd 和折叠后的标题。
- 跨会话只传播文本。非文本块不过去。
- 引用不是实时链接：快照在发送时冻结，不是 fork、恢复或订阅。
- preflight 和 pre-step 之间，源会话可能被删或损坏。默认 `passthrough` 留下可读文本；`reject` 则拒绝这一步。
- 浮层定位依赖上游的 `data-conversation-scroll` / `data-composer-seat`。

## 开发

```sh
npm install --ignore-scripts   # 首次安装，跳过 prepare
npm run build
npm test
```

构建需要 Node 22+（tsdown 用到 `Promise.withResolvers`），加载 TypeScript 配置需要 `unrun`（已在 devDependencies）。本机若是 Node 20，用 `npx -y -p node@22 npm run build`。

在 deepseek-harness 源码树里本地调试：

```sh
pnpm dsh web --patch /absolute/path/to/dsh-cite/cordis.patch.yml
```

仓库目录如果还叫 `dsh-sessions`，把路径换成实际目录即可。

## 发布

```sh
npm run build
npm publish
```

`package.json` 已声明 `publishConfig.access: public`，scope 为 `@wishp3`。

## License

[MIT](LICENSE)。

> 基于 DeepSeek Harness 的社区插件，并非 DeepSeek 官方产品。
