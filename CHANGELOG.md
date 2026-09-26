# Changelog

本文件记录 `@xiaoso/dsh-run-config` 的版本更新。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> 本插件每个版本只适配一条 dsh 线，范围写死在 `peerDependencies`：**0.2.x → dsh 0.1.7 线**、0.1.5 → dsh 0.1.5 线、0.1.4-rc.1 → dsh 0.1.2 线、0.1.0–0.1.3 → dsh 0.1.1 线。dsh 升级后请配套升级插件。

## [Unreleased]

### Fixed

- `build:types` 先清空 `lib/types` 再生成：`tsc -p tsconfig.build.json` 不清理输出目录，源码目录重构后旧路径的声明文件会一直留在产物里（0.2.0 的发布包里就混进去了 8 个 `lib/types/client/*.d.ts` 扁平旧路径的陈旧声明），现改为生成前先 `rmSync('lib/types')`，声明数由 30 降为 22（`exports` 引用的声明路径不变）

## [0.2.0] - 2026-09-26

> 正式版，发布在 `latest`。首个适配 dsh **0.1.7** 线的版本。此前为验证打过的本地预发布号 `0.2.0-beta.1` 未发布，其内容已并入本节。

### Added

- `tests/cdp-llm-run.mjs`：新建会话 → 选中 LLM 任务 → 点运行 的端到端验收脚本，覆盖 `autoSend` 两条分支（`send` 断言消息进入会话且输入框被提交清空、`fill` 断言 prompt 只留在输入框不提交），每轮用唯一标记防止读到上一轮会话内容造成的假阳性
- `tests/rpc-route.spec.ts` 的 `tasks/create` 字段转发回归用例（`autoSend: false` / `description` / `notifyLlm: false`）
- `CHANGELOG.md`（本文件）

### Changed

- **适配 dsh 0.1.7 线（0.1.7-rc.1 起）**：44 处 `@deepseek-ai/dsh-*` 由 `0.1.5-rc.1`/`0.1.7-rc.1` 对齐到 `0.1.7-rc.2`，`@deepseek-ai/cordis` 由 `^4.0.2` 改 `^4.0.4`（`Volatile` 类型所在版本）、`@deepseek-ai/schemastery` 由 `^3.18.1` 改 `^3.18.4`（`.volatile()` 所在版本）；`peerDependencies` 全部抬到 `^0.1.7-rc.2`
- **设置面从「运行时注册命名空间」改为「插件自己的 Config」**：dsh 0.1.7 删除了整个 `SettingsProvider`/`SettingsScope`/`SettingsApplies` 与 `settings.register(ns, schema, …)`（连 `settings-file` 包一并删除），改为把插件条目自身的 Cordis `Config` 投影成表单。现在 `toolEnabled` 是 `Config` 上的 `.volatile()` 字段，由官方设置表单按 profile 条目 id `task-runner` 读写，写入落到当前 profile 的 cordis patch（用户补丁层在插件升级后依然保留）
- **配置变更的监听方式随语义变化**：`.volatile()` 写值是**原地替换引用、不会重跑插件**（官方 `packages/boot/hmr` 的用例可证：`entry.update({config})` 后 apply 不重入，但同一个引用立刻返回新值），因此开关变更改由 `settings/document-updated` 事件触发重新同步工具注册，而不是靠插件重载
- **客户端设置改走共享配置表单**：`ctx.settingsScope.bind({namespace})` → `ctx.configForms.get('task-runner')`，类型 `SettingsScope<T>` → `ConfigForm<T>`；`set`/`unset`/`mutate` 的返回值由 `Promise<void>` 改为 `Promise<boolean>`（宿主拒绝返回 `false` 而不再 reject），运行设置弹窗对拒绝补上保存失败提示
- **命令任务执行迁移到 `shell.execute`**：dsh 0.1.7 移除了 `ShellExecutor.start()`，改为 `execute(spec): Promise<ShellExecution>`；作业的 `run` 钩子必须**同步**返回 hooks，所以在钩子内捕获 spawn promise 并投影（`cancel` 对已解析的句柄调 `kill`，spawn 失败交由注册表判 `failed`）。`readOutput()`/`status`/`exitCode`/`kill()`/`done` 未变
- **后台作业契约迁移到 0.1.7**：`JobSnapshot` → `JobView`；`JobSpec.owner` 由 `Agent` 改为 `SessionId`；`JobOutcome.output` → `result`（`job_output` 仍可读到全量输出，本插件刻意不设 `outputLimitBytes` 的行为不变）；抑制官方通知的 `JobView.reported` 标记取消，改为 settled 事件的 `awaited`（释放了一个 live wait 即为 `awaited`，官方 tool-jobs 会跳过这类结算）
- **完成通知的 message source 改为插件自声明 kind**：0.1.7 移除了通用的 `plugin` kind，每个生产者要在自己模块里声明（`MessageSourceMap` 合并 `'task-runner'`）。通知正文与抑制机制不变，仍是「挂一个 `jobs.wait` 抑制官方 tool-jobs + 自己发一条逐字对齐的通知」
- **图标改用 0.1.7 的中性命名**：`Icon*Outline14/16` → `Icon*OutlineMedium/Regular`（原 14px=1.3px 笔画 → Medium，原 16px=1px → Regular），涉及 13 个图标、73 处引用；显式 `size` 属性全部保留，尺寸表现不变
- **会话选择改用官方替代选择器**：`SessionListState.current` 在 0.1.7 被移除，运行设置弹窗改用官方同款写法（`Object.values(state.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)`，见 ui-layout 的 DocumentTitle 与 ui-settings-general 的 SettingsRoot）
- `AGENTS.md` 补 Windows 无 shim 的运行方式：本机 `pnpm` 是 `pnpm.cmd` 脚本，每条 `pnpm <script>` 都会拉起一个可见的 `cmd.exe`（用户在电脑前会看到控制台窗口一闪而逝），改列 `node node_modules/{typescript/bin/tsc,vitest/vitest.mjs,@biomejs/biome/bin/biome,tsdown/dist/run.mjs}` 直跑入口，并约定不再使用 `powershell`

### Fixed

- 修复 **hero 页新建会话后点运行、LLM 任务发不出去**：`connectWorkspace` 成功后落到的是**空会话**，而空会话不渲染会话头部 —— 挂在待运行槽里的任务没有任何组件消费，命令被静默丢弃（表现是点了运行毫无反应，控制台也没有报错）。现在 hero 直接通过官方的会话级输入面执行标准发送流程：`ctx.sessions.binding(sessionId).ctx` → `ctx.conversation.input.for(该 ctx)` 取到该会话的 `SessionInput`，用 `setDraft` + `submit` 完成「填入 + 发送」（这正是会话头部 RunControl 拿到的同一套 `InputActions`）；绑定尚未就绪时按 10×200ms 重试，仍取不到才回退原来的待运行槽
- 修复 **新建任务时 `autoSend` 与「描述」字段被丢弃**：`tasks/create` 端点是逐个手写字段转发给存储的，漏了 `autoSend` 和 `description` 两个（`tasks/update` 走整包 patch，因此一直没暴露）。后果是**新建** LLM 任务时「运行后直接发送」开关不生效（一律直接发送，用户以为开关坏了）、描述字段也存不下来。已补齐两个字段，并在 `tests/rpc-route.spec.ts` 增加回归用例锁住（`false` 必须原样透传，不能写成真值判断）
- 删除 hero 页读取 `ctx.sessions.currentProvideInfo` 的死路径：该成员在 dsh 0.1.5 与 0.1.7 的安装包里**都不存在**（全量扫描 0 命中），一旦执行必抛 `TypeError`。它原本要覆盖的场景正是上面那个 hero 发送 bug，现在由会话级输入面正经实现
- 修复 `tests/cdp-combo.mjs` 的 tooltip 判定在 0.1.7 下失配：0.1.7 把 tooltip 文本包进 `<span class="label">` 并新增 `shortcutKeys`/`input-modality`，原来「扫描无子元素的 span」的写法不再成立。改为按 `role="tooltip"` 匹配文本、每次重新测量锚点矩形、失败重试 6 次
- 修复 `tests/verify-pwsh.mjs` 仍调用 0.1.5 的 `shell.run()`（`.mjs` 不在 `tsc` 范围内，上一次迁移漏改）：改为 `await shell.execute(spec)` + `await execution.result()`

### Removed

- `settings.register` / `SettingsScope` / `SettingsApplies` / `installTaskRunnerSettings` 等 0.1.5 时代的设置 API 用法
- `ShellExecutor.start()`、`JobSnapshot`、`JobOutcome.output`、`JobView.reported`、`SessionListState.current`、通用 `plugin` message source、`ctx.settingsScope`、`Icon*Outline14/16` 等已从 dsh 0.1.7 删除的 API 用法

### 说明

- **不兼容 dsh 0.1.5 线**：0.1.5 版插件在 dsh 0.1.7 上无法加载（它调用的 `settings.register`、`shell.start`、`JobSnapshot` 在 0.1.7 已不存在）；反过来本版也不能装在 dsh 0.1.5 上。dsh 0.1.5 线请继续使用插件 0.1.5
- 数据无迁移：任务仍在 `$DSH_HOME/storages/task_runner.json`，storage domain 名、RPC 端点、工具名、locale 命名空间、slot 挂载点全部未变
- 真机验收环境：全局 CLI `dsh 0.1.7-rc.2` + 独立测试 profile（端口 3190，`link:` 指向源码）。结果：插件加载零错误；`cdp-refresh` / `cdp-combo` / `cdp-header-order` / `cdp-workspace-select` / `cdp-llm-run` 全部通过且 console error 为 0；`verify-skill` / `verify-tool-schema` / `verify-pwsh` 在真实包上通过；单测 49 条通过
- 已知环境问题：验收时 DeepSeek API 额度用尽（会话内显示「当前请求的额度已用尽」），模型回复全部失败；发送链路的断言不依赖模型成功，与此无关

[对比 0.1.5](https://github.com/xiaoso456/dsh-run-config/compare/run-config-v0.1.5...run-config-v0.2.0)

## [0.1.5] - 2026-09-10

### Changed

- **浏览器 ↔ 宿主通信改走 Connection 的共享 `/api` 通道**：每个端点注册一条精确 Fetch 路由 `POST /api/task-runner/<endpoint>`（`requestBody: 'buffered'`），用官方 `clientRequestSchema` 信封解包、按 `{type:'server-response', rpcId, result}` 回包，方法名不等于命名空间端点名判 `bad-request`、非 JSON 回 400。通道/命名空间/端点列表抽到两侧共用的 `src/shared/wire.ts`，避免两个 bundle 漂移
- 注册位置从顶层 `inject` 改为 `ctx.inject(['connection'], cb)`：`ctx.connection.fetch` 必须绑定在调用上下文的 Connection 上，顶层拿不到
- `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 与 `pnpm-lock.yaml` 同步；安装需 `--no-frozen-lockfile`（CI 环境默认冻结 + 供应链 release-age 策略）

### Fixed

- 修复 dsh 0.1.5 下**插件整棵加载失败**：0.1.5 把 `webServer` 从 Connection 插件的顶层 `inject` 移除（改为内部自挂 `/api`），导致 `connection.rpc.handle` 内部解析「注册方 ctx 的 webServer」时落回 connection 自己的 fiber，必报 `cannot get property "webServer" without inject`。实测顶层加 `webServer`、`ctx.inject(['connection','webServer'])` 子上下文调用、官方 api-gateway 的 `intercept` 三条路径，并全量扫描官方包与已装第三方插件确认**没有任何调用方使用 `rpc.handle`**，判定为上游回归、调用方无法修复，改走 `/api` 精确 Fetch 路由后 Host/Origin 与浏览器会话鉴权由官方 carrier 免费提供（实测未带会话 POST 返回 401、带 token cookie 返回真实任务列表），且不再依赖只存在于 web profile 的 `webServer`
- 技能目录自 0.1.5 起只进模型上下文、页面文本里搜不到，删除已失去意义的 `tests/cdp-skill.mjs`，改为挂**真实** skill 注册表的 `tests/skill-registry.spec.ts`（目录条目 / 按需正文 / dispose 后消失三例）
- `tests/command-runner.spec.ts` 的 Inbox 替身随 0.1.5 把 `Inbox` 由 class 改为 interface 而重写

### Added

- `tests/rpc-route.spec.ts`（5 例）：每端点一条 buffered POST 路由且都在 `/api/task-runner` 下、成功信封、handler 失败 → `internal`、方法不匹配 → `bad-request`、非 JSON → 400
- `tests/lib/web-session.mjs`：用 `DSH_WEB_TOKEN`（`dsh web` 打印的 `?token=`）兑换会话 cookie，供各 CDP 脚本复用

[对比 0.1.4-rc.1](https://github.com/xiaoso456/dsh-run-config/compare/run-config-v0.1.4-rc.1...run-config-v0.1.5)

## [0.1.4-rc.1] - 2026-09-03

> 预发布：发布在 npm `next`，不占 `latest`（当时 dsh 0.1.2 线仍是预发布）。

### Changed

- 适配 dsh 0.1.2 线：移除 `dsh-client-runtime` / `dsh-host-apiproxy` 等已废弃包，宿主端改用当时的 `settings.register` 新 API，`rpc.handle` 改为两参签名
- 全部 `@deepseek-ai/*` 依赖对齐 `0.1.2-rc.1`
- README 去掉版本兼容表（改由本节与 npm dist-tag 表达）

[对比 0.1.3](https://github.com/xiaoso456/dsh-run-config/compare/run-config-v0.1.3...run-config-v0.1.4-rc.1)

## [0.1.3] - 2026-08-29

### Added

- LLM 类型任务新增「运行后直接发送」（`autoSend`）开关：关闭时运行只把 prompt 填入输入框、由用户确认后再发送，并 toast 提示「已填入输入框，可修改后发送」；命令类型任务不显示该开关。语义为 `autoSend ?? true`，缺省即直接发送，兼容旧任务
- `task_run_config` 工具同步支持 `autoSend`（输出 schema、创建/更新参数与透传）

### 说明

- 已知边界：关闭该开关时预填会覆盖输入框里已有的草稿，用户未要求处理

[对比 0.1.2](https://github.com/xiaoso456/dsh-run-config/compare/run-config-v0.1.2...run-config-v0.1.3)

## [0.1.2] - 2026-08-24

### Changed

- 命令任务的执行与完成通知重构，逐字对齐官方 tool-jobs 模板（仅头部改词）：`User-started job <id> (<kind>: <label>) finished [status: <status>, exit code: N]. Read its output with job_output.`；`completed` 同样带 `exit code` 明细以对齐官方，通知不带输出正文、不做截断，模型自行用 `job_output` 读全量
- 命令任务的 cwd 与沙箱根改为**当前会话工作区优先**，任务的 `workspacePath` 仅作为会话无 cwd 时的回退（对齐官方 bash 工具）
- 手动运行命令任务继续无审批、`notifyLlm` 关闭时完全静默

### Fixed

- 修复**手动运行命令任务后看不到任何输出**：此前只等 `done`/`exitCode`，从未调用 `ShellProcess.readOutput()`。现在退出前做一次完整读取（stdout+stderr 合并），结果随作业保留、`job_output` 可读全量；执行器内存截断时以 spill 文件路径在输出末尾兜底指路（`[Output truncated; read <path> for full output]`）

### Docs

- README 增加精简的「推荐环境与配置」章节：推荐完全权限（`danger-full-access`）模式，措辞经校准为「可避免部分场景下运行命令配置出现的沙箱错误」；推荐后台任务管理插件 DSH-better-sidebar（仅链接，不给安装命令）

[对比 0.1.1](https://github.com/xiaoso456/dsh-run-config/compare/run-config-v0.1.1...run-config-v0.1.2)

## [0.1.1] - 2026-08-23

### Added

- 首次公开发布：会话头部 VS Code/IDEA 风格运行控件（连体 `[▶运行][任务名▾]`，运行段只显示图标、与任务名段共用一条边框）、IDEA 风格「运行设置」弹窗（左栏任务列表分组 + 新增/复制/删除，右栏详情表单）、hero 页运行控件（仅列 LLM 任务）、面向模型的 `task_run_config` 工具及其按需加载的用量技能
- 命名定稿：npm 包 `@xiaoso/dsh-run-config`、工具 `task_run_config`、中文概念「任务运行配置」、README 标题「运行配置管理」；内部标识保留（storage domain `task_runner`、settings 命名空间 `task-runner`、RPC 前缀 `/task-runner`、目录名 `dsh-task-runner`）

### Changed

- 依赖适配 dsh v0.1.1-rc.2

### Fixed

- 运行配置技能注册失败不再拖垮整个插件：技能只是工具的用量说明，注册失败时记警告并继续（修于 2026-08-23 22:19，随本版发布）

[对比 0.1.0](https://github.com/xiaoso456/dsh-run-config/compare/run-config-v0.1.0...run-config-v0.1.1)

## [0.1.0] - 2026-08-23

### Added

- 首个版本（M1–M5）：任务数据模型与持久化（storage domain `task_runner` → `$DSH_HOME/storages/task_runner.json`）、浏览器 ↔ 宿主 RPC、命令任务后台执行（`jobs.start` + 自定义 `kind: 'task'`）、运行控件与运行设置弹窗、`task_run_config` 工具及审批门（`tools/pre-execute`：完全权限免审批，其余走标准审批）
- 任务作用域字段用标准化路径（canonical path）而非 workspace id：路径是工作区的本质标识，注册表重建或迁移后 id 会变、路径不变
- 运行设置弹窗底部只有「保存」+「取消」（保存后弹窗不关闭，支持连续编辑多个任务，成功后页脚短暂显示绿色「已保存」）

[查看发布](https://github.com/xiaoso456/dsh-run-config/releases/tag/run-config-v0.1.0)
