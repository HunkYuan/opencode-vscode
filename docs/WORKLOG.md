# 工作日志

任务：OpenCode VS Code 官方 UI 侧栏集成。插件目录 E:\opencode-vscode；官方源码只读来源 E:\opencode。

| 日期 | 阶段 | 改动／结果 |
|---|---|---|
| 2026-10-22 | 开工 | 用户确认官方 Solid UI + VS Code 启动入口与宿主适配，开始独立目录开发。 |
| 2026-10-22 | 环境 | CLI 2.1.2；真实共享 service 已运行；来源 commit c93aaae37157d785f76a8e9a9243a6560e286468。 |
| 2026-10-22 | 构建 | 12 个官方 workspace 的隔离快照，记录 upstream.json；Vite Webview + esbuild Host。 |
| 2026-10-22 | 依赖 | 整套 IBM Plex 187 MB 下载阻塞，改为相同版本实际字体 46 KB 与许可证；固定可选 React peer，保留官方 UI。 |
| 2026-10-22 | 服务 | 官方 CLI service 命令发现和启动；尊重 disabled；不按 UI 版本替换服务；重连复用。 |
| 2026-10-22 | 网络 | 仅回环绑定的随机路径转发；Host 注入私有鉴权；HTTP/SSE/WebSocket 与取消回收。 |
| 2026-10-22 | UI | 官方 AppInterface；MemoryRouter；官方 polyfill；内联 Markdown/diff Worker、SVG sprite；专用宿主入口。 |
| 2026-10-22 | 编辑器 | Composer 选区／文件上下文、未保存内容；LinkHandler 文件定位；原生会话 snapshot diff。 |
| 2026-10-22 | 存储 | 工作区命名空间、tab 与草稿持久化；图片/文本 blob；串行写入和引用完整性。 |
| 2026-10-22 | 单测 | 4 项关键契约测试通过；曾连续重复 3 次通过；验证实际网络和文件操作。 |
| 2026-10-22 | 真服务 UI | 窄宽视口、模型、项目目录、选区附件、输入和重载恢复通过。 |
| 2026-10-22 | 隔离 service | disabled 与 autoStart=false 正确；自动启动和并发共享复用通过；仅停止测试 service。 |
| 2026-10-22 | 消息 fixture | 隔离服务导入真实会话，Markdown Worker、工具、权限按钮回复与 question 表单通过；无模型调用。 |
| 2026-10-22 | 真 VS Code | 用官方便携 1.94 验证扩展激活、侧栏、文件命令和真实 service 连接；补 polyfill 与 SVG 跨源适配。 |
| 2026-10-22 | 交付 | VSIX、来源记录、许可、安装调试与自测说明；最终仍需用户在日常项目中验收。 |

所有插件实现、UI 快照、依赖、构建和测试产物均在 E:\opencode-vscode。临时工具写入通道位于系统临时目录；E:\opencode 源文件未改动。

交付结果：opencode-sidebar-0.1.0.vsix，31.76 MB；已安装到 artifacts/installed-extensions 的隔离 VS Code profile，官方 UI 与文件附件显示通过。日常 VS Code 配置未安装。

## GitHub 发布准备 — 2026-10-22

- 用户确认创建公开仓库 HunkYuan/opencode-vscode，默认分支 dev，发布 v0.1.0 与 VSIX。
- 排除依赖、UI 快照、VSIX、测试环境、安装日志和一次性修补脚本，保留本机诊断文件。
- setup 默认下载 upstream.json 固定 commit，实体化官方 symlink；Windows 无需 symlink 权限。
- 字体和许可随源码保留；公开文档使用通用路径，标明第三方维护。
- 新增 Windows/Linux CI：固定来源准备、frozen-lockfile 安装、check、test、VSIX 构建。
- 在只含待公开文件的新目录从零完成 setup、安装、检查、测试、打包；清单和锁文件未改变。
- 初始 Release 包约 31.81 MB；已验证范围和安装步骤写入 docs/releases/v0.1.0.md。

## GitHub 发布完成 — 2026-10-22

- 公开仓库：[HunkYuan/opencode-vscode](https://github.com/HunkYuan/opencode-vscode)，默认分支 dev。
- 初始源码提交：05bf5c8，feat(vscode): embed official OpenCode UI。
- [Windows/Linux CI](https://github.com/HunkYuan/opencode-vscode/actions/runs/39752056499) 均通过：固定来源、锁定安装、lint/typecheck、测试、VSIX 构建。
- [v0.1.0 Release](https://github.com/HunkYuan/opencode-vscode/releases/tag/v0.1.0) 已公开，附 opencode-sidebar-0.1.0.vsix 与 SHA256SUMS.txt。
- 从公开下载地址重新读取安装包，33,350,629 bytes；SHA256 efe21fabae8c51d30e04e55c674b6b2be2ec93aba6da6e086d1df1959ac72f13，与校验附件一致。
- 固定公开来源的 Release 构建在隔离真实 VS Code 中完成侧栏、共享服务连接与当前文件附件验证。
- 后续通过 GitHub Issues 收集日常项目使用反馈；Linux/macOS 实际编辑器使用仍待手动验证。

## ATTACH-001 — 修复当前文件附件在模型输入中丢失 — 2026-10-22

- 用户反馈 Add Current File 显示文件卡片，但模型没有收到文件；修复方案经用户确认后开工。
- 读取真实会话确认附件已到 service；6301 字节与磁盘一致，但 GBK 源码被识别为 application/octet-stream，模型输入转换忽略该 MIME。
- 插件发送 VS Code 已解码的 UTF-8 编辑器快照，复用官方通用附件与 Blob 存储；路径、选区、保存状态位于模型可读文本中。
- 同文件同选区再次添加会替换旧快照；添加后编辑须再次添加以更新捕获内容。
- 新增独立 service / 本地模型 fixture，验证六类实际 UI 发送与草稿重载；旧版 0.1.0 产物在新回归断言处失败，新版通过。
- 真实 VS Code 1.94 通过 GBK 解码、Add Current File、点击发送、service text/plain 与模型输入核对；GBK 文件字节未变。
- 更新版本为 0.1.1；插件实现和测试均在 E:/opencode-vscode，官方来源和 SDK 生成文件未改。
- 本次验证使用 artifacts 下隔离 XDG 配置和独立端口，未停止或重启用户已有 service。日常项目验收待用户完成。

- 最终验证：bun run check 通过；bun test ./test 为 10 pass / 0 fail；新回归六类发送通过，原 interaction-smoke 的选区与重载恢复通过。
- 0.1.1 VSIX 已生成并安装到隔离 profile；33,351,040 bytes，2816 个 ZIP entries，无测试、fixture、依赖和源码快照目录。
- SHA256：88612da7fa4ec7d84f2a3597b7b55534f051ae77981da1351e9748752eb2867c。

- ATTACH-001 仓库同步：用户授权更新 GitHub dev；本次提交包含附件适配、回归测试、0.1.1 版本与验证文档。GitHub CI 验证 Windows/Linux 的检查、单测和 VSIX 构建。

## ATTACH-001 — v0.1.1 GitHub Release 发布 — 2026-10-22

- 用户明确授权发布 0.1.1 安装包到 GitHub Release。
- [v0.1.1 Release](https://github.com/HunkYuan/opencode-vscode/releases/tag/v0.1.1) 已公开，标签指向附件修复提交 6ca6c8405b35864dc7c97f36eeca802f466df4a3。
- 对应 [Windows/Linux CI](https://github.com/HunkYuan/opencode-vscode/actions/runs/39773765818) 均通过检查、单测和 VSIX 构建。
- 已上传 opencode-sidebar-0.1.1.vsix 与 SHA256SUMS.txt，发布说明保存于 docs/releases/v0.1.1.md。
- 不带凭据从公开下载地址重新读取两个附件，安装包 33,351,040 bytes；SHA256 88612da7fa4ec7d84f2a3597b7b55534f051ae77981da1351e9748752eb2867c，与公开校验文件一致。
- GitHub 标签与源码提交已核对；日常项目自测与验收仍由用户完成。


## UI-001 — 独立 UI 适配包计划 — 2026-10-24

- 用户选择稳定扩展壳与独立 UI 包方案。
- 核对现有依赖：除 UI 快照／Composer 适配外，原生 diff 仍在 Host 中调用 OpenCode SDK，计划一并移动到 UI 包。
- 计划包含宿主协议 v1、独立构建、GitHub 更新清单、下载与缓存、重载切换／回退，以及官方正式 Release 的定时监测与候选 PR 发布流程。
- 完整方案与文件清单见 docs/UI-PACKAGES.md；本轮停在计划确认，尚未改插件实现。

- 用户明确要求正常上游更新无需人工操作；方案改为自动发现、准备候选、验证同一 commit、自动合并、自动发布 UI 包与更新清单。客户端自动下载，下次启动或重建 Webview 自动使用。
- 异常停止发布并保留已验证版本；Actions 事件链显式串联，避免内置 GITHUB_TOKEN 的机器人提交未触发 CI。当前仍等待开工指令，未改插件实现。

## UI-001 — 实施与本地验证 — 2026-10-24

- 用户授权开工，并确认 GitHub/npm 正式发布双渠道监测；正常更新全自动，异常停止发布。
- 宿主协议 v1、扩展壳/UI 独立构建、UI ZIP 声明、SHA256 下载校验、缓存选择、应用与固定回退已实现。
- 原生 diff 的 SDK 查询移到 UI 包，Host 仅校验文件/patch 并打开原生 diff；构建守卫证明 Host 不依赖 OpenCode SDK。
- 保留已有工作区草稿、tab、Blob 键；应用前 flush，正在工作时延后；启动握手失败只回退 UI，不替换共享 service。
- 13 项单测和完整 UI 更新测试通过；实际 GBK/UTF-8/未保存/选区/空文件发送通过，模型收到路径与快照。
- 真实 VS Code 1.94 已验证文件定位、原生 diff、未保存选区、更新和回退后发送以及草稿保留；GBK 源文件字节保持不变。
- 测试中的 Agent 初始加载等待、跨源响应拦截和文件读取缓存问题已调整为真实响应／HTTP fixture；临时诊断代码已移除。
- 新增匹配版本 CLI 下载、UI 校验可复用 workflow、每 6 小时监测、同提交候选验证／自动合并／发布／更新清单；不要求用户提供或维护 token。
- 当前实现版本 0.2.0，官方内置 UI 基线 2.1.2；下一阶段接通 GitHub CI，发布首个 UI 包并运行一次 npm 2.1.4 自动更新。

- GitHub 自动监测已从官方 npm 发现 2.1.4，生成 PR #1；Windows/Linux 验证通过后自动合并至 7910587，发布 ui-2.1.4-vscode.1 并初始化 ui-updates/stable.json。
- 2.1.2 初始化发布任务的 Windows 测试因重载后 Agent 加载未等完而失败，发布被正确阻止；更新测试改为等待目标 location 的 Agent 响应，保留已发布 2.1.4 包内容。

- 公开 2.1.4 UI ZIP 经客户端更新清单下载、完整性校验和真实 VS Code 1.94 验证，GBK／未保存选区／文件定位／原生 diff／应用／回退后发送与草稿保留均通过。
- UI 发布 workflow 增加验证-only 选项，修正测试时可跑完整 Windows/Linux 校验而不重发不可变版本。
