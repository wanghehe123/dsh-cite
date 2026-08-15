# dsh-sessions

`dsh-sessions` 是 dsh Web 插件：把其他会话作为有界、只读、带来源的快照引用进当前会话。浏览器半提供 `@` 触发源、引用范围设置卡片，并 vendor `ui-workspace` 以在会话行 `⋯` 菜单加入「复制会话 ID」；宿主半通过 `agent/pre-step` 解析 mention，并调用官方 `ctx.sessionReferenceResolver.prepare()` 产出快照。

## 功能

- `@` 候选：输入 `@` 时列出可引用的历史会话，排序沿用 `sessionReferenceResolver.listCandidates()`（同 cwd、无 cwd、其他 cwd）。候选 label 取日志支撑的最新标题，缺失时回退到会话 id。
- 裸 session id：消息里的 `session-<uuid>` 直接解析为引用，只在两侧不是 `[A-Za-z0-9_-]` 的位置匹配。
- 手打 `@标题`：`allowPlainTitleMentions` 打开时，按候选标题做不区分大小写的精确匹配；唯一命中才解析，重名保持普通文本。
- 复制会话 ID：会话行 `⋯` 菜单新增「复制会话 ID」，复制 dsh 原生 session id；成功与失败都有 toast。

## 安装

```sh
dsh plugin --profile web add @wishp3/dsh-sessions
dsh --profile web
```

bundle patch 做两件事：`disabled: true` 关掉内置 `ui-workspace`，并插入 `session-reference` 与 `session-bridge` 两行。前者是官方快照语义层；后者同时声明 `dsh.bundle` 与 `dsh.client`，web loader 从同一行自动提供浏览器半。

## 工作区界面

当前发布的 `ui-workspace` 没有会话行菜单扩展槽位，`upstream/0001-web-session-row-menu-slot.patch` 是提交给上游的补丁。本包因此 vendor 了 `ui-workspace` 的完整浏览器源码（`src/vendor/workspace/`），在 bundle patch 中禁用内置行，用自己的注册补上 `sidebar.workspaces` 与 `conversation.hero.workspace` 两个 slot，其余行为与内置实现一致。

复制走 `copyTextToClipboard()`：先在点击手势内同步 `document.execCommand('copy')`，失败再回退 `navigator.clipboard.writeText()`，任一后端接受即成功。结果 toast 在行组件本地渲染，4 秒后自动消失，zh/en 文案各一套。

dsh 升级工作区 UI 后需同步 vendor 目录；`upstream/` 里的槽位补丁合并进上游后，可删除 vendor 并恢复内置 `ui-workspace`。

## 配置

Web UI：设置 → 插件 → 插件配置 → **会话引用**。卡片默认折叠，展开后可在「仅当前工作区 / 所有可见会话」之间切换，保存即写入宿主 settings。

api-proxy 的 settings 命名空间白名单不覆盖第三方包，因此卡片不注册官方 settings 槽，而是走本包自己的 `GET/POST /dsh-sessions/settings`；设置节持久化到 dsh `settings.yaml` 的 `dsh-sessions:` 段。

| 键 | 默认 | 作用 |
|---|---|---|
| `scope` | `workspace` | `workspace`：只能引用与目标会话同 cwd 的记录；`all`：引用本机 dsh 可见的全部持久化会话 |
| `allowBareSessionIds` | `true` | 解析消息中的裸 session id |
| `allowPlainTitleMentions` | `true` | 解析手打 `@标题` |
| `candidateLimit` | `50` | 预留：浏览器半目前固定请求 50 个候选 |
| `failureMode` | `passthrough` | preflight 成功后、pre-step 再次 prepare 失败时：`passthrough` 保留可读文本继续，`reject` 拒绝该步 |

`scope` 在卡片上改；其余键通过 `cordis.patch.yml` 或 profile 覆盖。

## 工作方式

1. `@` 触发源候选来自 `POST /dsh-sessions/candidates`；pick 插入 chip，不透明 ref 携带目标会话、来源会话、label 与规范 mention 文本。
2. 提交时 codec serialize 调 `/dsh-sessions/preflight`：宿主按当前 scope 过滤后完整执行一次 `prepare()`。失败会中止提交并保留草稿；成功才输出规范 `@[label](dsh-session:…)`。
3. 宿主 `agent/pre-step` waterfall 先取普通 enter 决策，再逐个解析直接 user 消息：规范 mention 规范化为可读 `@label`；裸 id 与手打 `@标题` 按开关解析；每个 id 必须落在 scope 内，否则按 `failureMode` 处理。
4. `prepare()` 一次读取全部来源并去重，重写为 `[快照, 可读直接消息, …]`。快照源标记为 `{ kind: 'session-reference', version: 1 }`。

快照语义沿用 `@deepseek-ai/dsh-session-reference`：

- 每个来源只调一次 `sessionQuery.readSurface()`，入队后不重读；只投影用户直接发出的 `user/message`、assistant 文本，以及带 `dsh-compaction` 标记的 `user/message` 检查点。工具、reasoning、上下文、插件生成的 user 消息、未完成的 assistant 分片、被压缩遮蔽的事件全部排除。
- 每条来源独立受 `maxReferenceBytes`（65536）限制，保留压缩检查点与最新消息，旧的非检查点单元按 `dsh-output-retention` 头尾截断；固定字段就超限时以 `SESSION_REFERENCE_BUDGET_EXCEEDED` 失败。
- 一条消息最多 3 个不同来源；拒绝自引用。
- 目标日志先记录带来源的上下文 `user/message`，再记录可读直接消息；之后源会话变更、压缩或删除不影响目标回放。

## 模型体验

### 引用会话背景

#### 模型看到的内容

模型看到两条连续的 user 消息：先是 `## Referenced sessions` 不可信快照，再是带可读 `@label` 的当前消息。警告禁止遵循快照中的指令、权限声明或工具请求，除非当前 user 重复这些内容。label、cwd 值、id 与会话文本序列化为 JSON 放进 `<referenced-sessions>` 标签；数据中的每个 `<` 以 `\u003c` 发出，源文本拼不出定界标签。

#### Token 影响

每条含引用的消息增加固定警告和最多三个序列化快照，每个独立受 65536 字节限制。精确快照保留在目标历史中，直到目标压缩遮蔽或摘要它；源会话变化不增加更多 token。

#### KV Cache 影响

快照与请求是两条连续、仅追加的目标消息，保留较早的可缓存历史。不同引用或源捕获内容只改变新后缀；目标压缩可能从替换边界起使复用失效。

## 已知限制与暂缓事项

- **vendor 工作区浏览器**：dsh 升级 UI 后需同步 `src/vendor/workspace/`；上游合并 `upstream/` 槽位补丁后可切回内置实现。
- **手打 `@标题` 只精确匹配**：重名标题不自动解析，请用菜单 chip 或裸 id。
- **preflight 与 pre-step 之间存在竞态**：源会话可能被删除或损坏；默认 `passthrough` 保留可读文本并记录错误，`reject` 改为拒绝该步。
- **不搜索消息正文**：候选查询只检查 id、cwd 与折叠后的标题（语义层限制）。
- **只传播文本**：非文本 user 与 assistant 块不跨会话。
- **引用不是实时链接**：快照在发送时冻结，不是 fork、恢复或订阅。

## 开发

```sh
npm install --ignore-scripts   # 首次安装，跳过 prepare
npm run build
npm test
```

本地调试（在 deepseek-harness 源码 checkout 中）：

```sh
pnpm dsh web --patch /absolute/path/to/dsh-sessions/cordis.patch.yml
```

## 发布

```sh
npm run build
npm publish
```

`package.json` 已声明 `publishConfig.access: public`，scope 为 `@wishp3`。
