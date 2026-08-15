# @wishp3/dsh-sessions

dsh Web UI 插件：让不同会话像 Codex CLI 的 prior-conversation mention 一样互相引用。

- `@会话标题`：输入 `@` 自动补全历史会话，提交后把来源会话的**有界只读快照**注入当前消息之前的上下文。
- 裸 session id：直接把 `session-<uuid>` 粘进输入框发送即可引用；默认只允许当前工作区（同 cwd），可配置 `scope: all`。
- 复制会话 ID：工作区侧栏会话行右侧 `⋯` 菜单新增“复制会话 ID”，复制 dsh 原生 session id。

## 安装

```sh
dsh plugin --profile web add @wishp3/dsh-sessions
```

之后按正常方式启动：

```sh
dsh --profile web
```

## 前置条件：上游补丁

复制会话 ID 的菜单项需要一个 dsh 上游扩展点（`sidebar.workspaces.session-menu` slot）。补丁位于本仓库：

```sh
git apply upstream/0001-web-session-row-menu-slot.patch
# 重新构建并运行 catalog 生成与 GUI 测试
pnpm run gen-client-catalog
pnpm run test:gui
```

未打补丁时，`@` 引用与裸 id 引用照常工作，只有菜单动作不出现。

## 配置

Web UI：**设置 → 插件 → 插件配置 → 会话引用**，可直接切换“仅当前工作区 / 所有可见会话”。

插件行配置（`cordis.patch.yml` 或 profile 覆盖，作为 UI 未覆盖项与默认值）：

```yaml
- id: session-bridge
  name: '@wishp3/dsh-sessions'
  config:
    scope: workspace            # workspace | all
    allowBareSessionIds: true
    allowPlainTitleMentions: true
    candidateLimit: 50
    failureMode: passthrough    # passthrough | reject
```

| 键 | 默认 | 说明 |
|---|---|---|
| `scope` | `workspace` | `workspace`：来源会话必须与目标会话同 cwd；`all`：所有可见持久化会话 |
| `allowBareSessionIds` | `true` | 允许直接输入原生 session id |
| `allowPlainTitleMentions` | `true` | 允许手打 `@标题`（标题唯一时解析；重名视为歧义） |
| `candidateLimit` | `50` | 候选菜单上限 |
| `failureMode` | `passthrough` | 发送前 preflight 成功、pre-step 二次 prepare 失败时的策略 |

## 工作方式

1. 浏览器半注册 `@` 触发源（`ctx.inputTriggers`），候选来自宿主 `/dsh-sessions/candidates`。
2. 选中后输入框放入带隐藏 ref 的 chip；提交事务调用 `/dsh-sessions/preflight` 完整执行一次官方 `sessionReferenceResolver.prepare()`，失败会阻止发送并恢复草稿。
3. 模型文本为规范 `@[label](dsh-session:…)` mention；宿主 `agent/pre-step` 监听器在消息进入 step 前解析它，改写为 `[session-reference 快照, 可读 @label 直接消息, …]`。
4. 快照语义完全复用 `@deepseek-ai/dsh-session-reference`：只读、不可信、每条默认 64 KiB、最多 3 个来源、拒绝自引用、排除工具/reasoning/被压缩遮蔽的内容。

## 模型体验

每条含引用的消息会新增一条 source=`session-reference` 的 `user/message`（`## Referenced sessions` 警告 + JSON 快照），紧邻可读直接消息之前；快照随后参与目标会话的普通压缩流程。每条引用最多 65536 字节，整条消息最多 3 个来源。

## Known Limitations and Deferred Work

- 复制会话 ID 依赖上游 `sidebar.workspaces.session-menu` slot；未合并/未打补丁时该动作静默缺席。
- 手打 `@标题` 只按标题精确匹配；重名标题不自动解析，请使用菜单 chip 或 id。
- preflight 与 pre-step 之间存在源会话被删除/损坏的竞态窗口，默认 `passthrough` 保留可读消息并记录错误，`reject` 可改为拒绝该步。
- 引用不是实时链接：快照在发送时冻结，来源会话后续变化不影响本条消息。

## 开发

```sh
npm install --ignore-scripts   # 首次安装，跳过 prepare
npm run build                  # tsc + 宿主/浏览器 bundle
npm test
```

本地调试（在 deepseek-harness 源码 checkout 中）：

```sh
pnpm dsh web --patch /absolute/path/to/dsh-sessions/cordis.patch.yml
```

## 发布

```sh
npm run build
npm publish --access public
```
