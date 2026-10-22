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
