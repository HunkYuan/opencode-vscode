# 验证记录

| 验证 | 结果 | 证据 |
|---|---|---|
| 官方 UI 构建 | 通过 | dist/webview；来源 dist/upstream.json |
| Host 与 Webview 类型检查 | 通过 | bun run check |
| HTTP/SSE/WebSocket 实现 | 通过 | test/transport.test.ts |
| diff CRLF 和无末尾换行 | 通过 | test/diff.test.ts |
| 草稿 blob 和串行写入 | 通过 | test/storage.test.ts |
| 官方 UI 真服务窄宽布局 | 通过 | artifacts/sidebar-narrow.png、sidebar-wide.png |
| 未保存选区和重载恢复 | 通过 | artifacts/context-attached.png、context-restored.png |
| 真服务自动启动与共享复用 | 通过，隔离环境 | artifacts/service-test-*/result.json |
| 消息、工具、Markdown Worker | 通过，隔离 fixture | artifacts/session-fixture.png |
| 权限请求实际按钮回复 | 通过，隔离 fixture | artifacts/permission-fixture.png |
| question 表单 | 通过，隔离 fixture | artifacts/form-fixture.png |
| 真 VS Code 扩展宿主 | 通过，官方便携 1.94 | artifacts/vscode-api.txt、vscode-window.png |
| VSIX 安装后真实运行 | 通过，隔离配置 | artifacts/installed-smoke.txt、installed-window.png |
| 日常项目真实模型请求与改码 | 待用户自测 | README.md 的需自测清单 |

UI 使用完整官方组件与状态同步。编译时针对 VS Code 的限制内联 Worker 和 SVG symbols，运行时载入官方 polyfills。构建保留官方 CSS 优化告警与大 chunk 提示；未因此改写官方 UI 逻辑。

服务启动和停止测试使用插件 artifacts 内独立 XDG 目录及独立端口；未重启或停止用户已有 service。

## GitHub 发布构建

仅复制公开文件的新目录已通过 bun run setup、bun install --frozen-lockfile、bun run check、bun test test 和 bun run package。Windows 下官方符号链接转为普通文件，package.json 与 bun.lock 字节一致；产物约 31.81 MB。

[GitHub CI](https://github.com/HunkYuan/opencode-vscode/actions/runs/39752056499) 的 Ubuntu 与 Windows job 均成功。公开 [v0.1.0 Release](https://github.com/HunkYuan/opencode-vscode/releases/tag/v0.1.0) 的 VSIX 重新下载后与 SHA256SUMS.txt 一致（33,350,629 bytes）。

## 0.1.1 当前文件附件修复

| 验证 | 结果 | 证据 |
|---|---|---|
| GBK 解码、UTF-8 快照与 Windows/UNC 路径 | 通过 | test/editor-attachment.test.ts |
| 同文件更新、精确选区与空内容 | 通过 | test/editor-attachment.test.ts |
| 新会话发送与活动会话后续发送 | 通过，官方 UI / 隔离 service | artifacts/attachment-smoke.json |
| GBK、UTF-8、未保存文件、两类选区、空文件 | 六类均发送 text/plain | scripts/attachment-smoke.ts |
| 草稿重载后实际发送 | 通过，Blob 已持久化 | scripts/attachment-smoke.ts |
| 模型输入包含完整路径与快照文本 | 通过，本地 OpenAI-compatible fixture | scripts/attachment-fixture.ts |
| 新回归在旧版上失败 | 通过，0.1.0 发送 file URI / octet-stream | OPENCODE_TEST_WEBVIEW 指向旧版产物 |
| VS Code 1.94 实际 GBK 文件命令与发送 | 通过，独立 profile | artifacts/vscode-smoke.json |
| 磁盘 GBK 文件保持原字节 | 通过 | 两个 smoke 的字节比较 |
| 日常 C++ 项目复验 | 待用户自测 | 安装 opencode-sidebar-0.1.1.vsix |

发送以添加时的编辑器快照为准；修改后可重新添加更新快照。fixture 只连接本地模型接口，并使用独立 service、XDG 配置和端口。

最终 check 通过，10 项单测通过；原选区／重载联调通过。0.1.1 VSIX 共 33,351,040 bytes，隔离 profile 安装成功；清单中没有 scripts、test、artifacts 或 .upstream。SHA256：88612da7fa4ec7d84f2a3597b7b55534f051ae77981da1351e9748752eb2867c。

## 0.1.1 公开发布验证

- [GitHub Release](https://github.com/HunkYuan/opencode-vscode/releases/tag/v0.1.1) 已公开，标签指向 6ca6c8405b35864dc7c97f36eeca802f466df4a3。
- 源码提交的 [Windows/Linux CI](https://github.com/HunkYuan/opencode-vscode/actions/runs/39773765818) 成功。
- 已通过公开地址重新下载 [VSIX](https://github.com/HunkYuan/opencode-vscode/releases/download/v0.1.1/opencode-sidebar-0.1.1.vsix) 和 [SHA256SUMS.txt](https://github.com/HunkYuan/opencode-vscode/releases/download/v0.1.1/SHA256SUMS.txt)；安装包 33,351,040 bytes，SHA256 与本机已验证安装包和校验附件一致。
- 发布说明见 [v0.1.1](releases/v0.1.1.md)。
