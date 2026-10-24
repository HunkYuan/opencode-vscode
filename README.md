# OpenCode Sidebar

将官方 OpenCode Solid UI 显示在 VS Code 侧栏，连接本机共享服务。聊天、会话历史、模型选择、工具过程、权限和提问界面复用官方组件与逻辑。

这是 HunkYuan 维护的第三方扩展，使用 MIT 许可的官方 UI。GitHub 只提供源码和文档，Actions 已停用；VSIX 和 UI ZIP 由使用者在本机构建。

![OpenCode Sidebar](docs/images/sidebar.png)

## 构建并安装插件

要求：

- VS Code 1.94+，本机已安装 [OpenCode CLI](https://opencode.ai)。
- 构建时需要 Git、Bun 1.4.2、Node.js 20+ 和 `tar`。Windows 10/11 自带 `tar.exe`。

`setup` 从 [upstream.json](upstream.json) 的固定 commit 获取官方源码。下载、依赖与构建产物均留在插件目录，官方源码无需另外修改。

```sh
git clone https://github.com/HunkYuan/opencode-vscode.git
cd opencode-vscode
bun run setup
bun install --frozen-lockfile
bun run check
bun test ./test
bun run package
```

生成 `opencode-sidebar-0.3.0.vsix`，位于仓库根目录。在 VS Code 扩展菜单选择 **Install from VSIX…** 安装，再执行 **Developer: Reload Window**。

VSIX 附带同次构建的官方 UI，运行时不需要 Bun、Node.js 或源码目录。打开本地项目后执行 **OpenCode: Open Sidebar**，或按 `Ctrl+Alt+O`（macOS：`Cmd+Alt+O`）。

已安装 0.2.0 的用户应升级到本地构建的 0.3.0。原 GitHub 在线更新入口已移除；旧工作区草稿、附件和本地 UI 缓存继续保留。

## 单独构建与导入 UI 包

首次安装插件后，可以只构建 UI ZIP 并导入，无需重新安装 VSIX。

指定需要的 OpenCode 版本，例如：

```sh
bun run ui:upstream 2.1.4
bun run check
bun test ./test
bun run build:ui
```

`ui:upstream` 解析官方 Git tag，固定源码 commit、同步依赖并更新本地锁文件。同一版本再次准备会增加 UI 修订号，避免覆盖已有包；命令不创建提交、PR 或推送仓库。上游改动影响宿主适配时，需要修复并在本机重新验证。

产物位于 `artifacts/ui/`：

| 文件 | 用途 |
|---|---|
| `opencode-ui-<版本>-vscode.<修订号>.zip` | 导入插件的 UI 包 |
| `ui-package.json` | 包 ID、版本、兼容范围、来源 commit、大小和 SHA256 |
| `SHA256SUMS.txt` | ZIP 的 SHA256 校验值 |

ZIP 包含官方 UI、Client SDK、宿主适配、静态资源、许可证以及每个文件的 SHA256 清单。

1. 在 VS Code 执行 **OpenCode: Import UI Package**，选择本地 ZIP。
2. 插件校验包内容、宿主协议和当前 service 版本，再保存到插件全局 UI 缓存。当前聊天继续使用原包。
3. 正常重载侧栏时使用导入包；也可执行 **OpenCode: Apply UI Update** 主动应用。应用前会保存草稿，OpenCode 正在工作时提示稍后应用。
4. 如需回退，执行 **OpenCode: Roll Back UI**，选择上一份可用的兼容包；再次导入会恢复新包选择。

只导入自己构建的包。完整性校验用于发现损坏和缺失内容，不替代对包来源的信任。旧 0.2.0 ZIP 没有文件完整性清单，需要用当前源码重新构建。

如果只执行 `build:ui` 而没有修改版本／修订号，包 ID 仍与内置版本相同。要更新该 UI，请先执行 `ui:upstream`；同一 ID 的不同内容会被拒绝。包兼容范围表示其目标 service 版本，实际功能需本机自测。

已有本地官方 Git 源码时，也可以用只读来源准备：

```sh
bun run ui:upstream 2.1.4 ../opencode
```

来源的 `package.json` 版本必须匹配。默认固定版本已准备好时，可直接执行 `bun run setup ../opencode`，来源 HEAD 必须与 `upstream.json` 一致。

## 功能与命令

| 命令 | 用途 |
|---|---|
| OpenCode: Open Sidebar | 打开官方 UI 侧栏 |
| OpenCode: New Session | 在当前工作区新建会话 |
| OpenCode: Add Current File | 添加当前编辑器文本快照，包含完整路径 |
| OpenCode: Add Selection | 添加精确选区与范围，支持未保存内容 |
| OpenCode: Review Changes | 在 VS Code 原生 diff 中审阅 |
| OpenCode: Reconnect | 重新发现并连接 service |
| OpenCode: Enable Shared Service | 主动启用被禁用的 service |
| OpenCode: Show Logs | 查看插件日志 |
| OpenCode: Import UI Package | 导入本地构建的 UI ZIP |
| OpenCode: Apply UI Update | 保存草稿后应用已导入的包 |
| OpenCode: Roll Back UI | 回退上一份兼容 UI 包 |

文件／选区在添加时捕获 VS Code 已解码的文本，作为 UTF-8 快照发送。GBK 文件保持磁盘原编码；继续编辑后需再次添加，以更新快照。添加选区可右键选择命令，或按 `Ctrl+Alt+K`（macOS：`Cmd+Alt+K`）。

工具按 OpenCode 权限执行并直接修改磁盘，diff 用于修改后的审阅。

## 共享服务与设置

侧栏发现并复用本机共享 service；未运行时按需启动。关闭 VS Code 后 service 继续运行，多个 VS Code 窗口和 TUI 可以共用。OpenCode CLI 本身按使用者原来的方式升级。

| 设置 | 默认 | 说明 |
|---|---|---|
| `opencodeSidebar.cliPath` | 空 | 从 PATH、标准 npm 或 `.opencode/bin` 定位 CLI；Windows 推荐指定 `opencode.exe` |
| `opencodeSidebar.autoStart` | true | 缺少 service 时启动，OpenCode 的 disabled 设置优先 |
| `opencodeSidebar.followTheme` | true | 跟随 VS Code 深浅主题 |

- `opencode service get disabled` 为 true 时，显示原因和启用入口。
- 已运行 service 与内置 UI 版本不一致时提示并复用，不因 UI 版本更换 service。导入包须匹配当前 service 和宿主协议。
- 密码留在 Extension Host，回环转发支持 HTTP、SSE、WebSocket 与取消。
- 会话数据在 service；tab、草稿和附件使用既有 VS Code 工作区存储。导入 UI 不创建空的新工作区状态。

## 本地验证

```sh
bun run check
bun test ./test
bun run build
bun run test:attachments
bun run test:ui-update
bun run test:vscode /path/to/Code.exe
```

`test:attachments` 和 `test:ui-update` 使用独立 service、本地模型接口及确定的 fixture。`test:ui-update` 验证本地 ZIP 导入、重载、草稿恢复、GBK 发送、diff 查询与回退；`test:vscode` 额外验证真实 VS Code 的命令和安装运行边界。

Windows 默认使用 Edge；其他平台先安装 Playwright Chromium，也可通过 `OPENCODE_TEST_BROWSER` 指定浏览器。可通过 `OPENCODE_TEST_CLI_PATH` 指定测试 CLI；`bun scripts/ui-test-cli.ts` 可下载并校验固定版本 CLI，路径写入 `artifacts/test-cli-path.txt`。

`bun run test:service` 验证隔离服务启停与共享复用。`bun run test:ui` 包含已有 service 的只读 UI 联调和隔离消息、权限、提问 fixture。测试只停止自身的隔离服务。

Windows 已验证 GBK／未保存内容、文件定位、原生 diff、本地 UI 导入／应用／回退、草稿恢复与附件发送。Linux/macOS 的实际编辑器使用需手动验证。Remote SSH 和 WSL 远端工作区暂不支持。

请在日常项目自测：发送需求、回复权限、停止执行、查看 diff，并重载检查草稿和附件。

## 目录与记录

| 目录 | 内容 |
|---|---|
| `src/` | service、编辑器、网络、存储与本地 UI 包管理 |
| `webview/` | 官方 UI 启动、主题、路由、Composer 和宿主消息 |
| `scripts/` | 本地来源准备、构建、打包与验证 |
| `test/` | 网络、草稿、diff 和本地包契约测试 |
| `resources/fonts/` | IBM Plex 字体与许可 |
| `.upstream/` | 官方源码的隔离构建快照，Git 忽略 |
| `dist/`、`artifacts/` | 本地构建和测试产物，Git 忽略 |

[MIT License](LICENSE) · [第三方许可](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md) · [工作日志](docs/WORKLOG.md) · [验证记录](docs/VALIDATION.md)

[源码分发与本地 UI 包](docs/SOURCE-ONLY.md) 记录当前方案；[原独立包设计](docs/UI-PACKAGES.md) 保留已退役自动发布流程的历史。官方源码为 [anomalyco/opencode](https://github.com/anomalyco/opencode)，固定版本见 [upstream.json](upstream.json)。
