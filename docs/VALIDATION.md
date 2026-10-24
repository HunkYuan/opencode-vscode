# 验证记录

> 当前版本 0.3.0 使用本地构建／导入，GitHub Actions 已停用，旧 Release 附件已撤下。下方历史 CI 与下载记录不代表当前仍提供托管产物。

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

## 0.2.0 独立 UI 包

| 验证 | 结果 | 证据 |
|---|---|---|
| Host 不依赖 OpenCode SDK/GUI | 通过，构建守卫 | scripts/build-host.ts / artifacts/host-inputs.json |
| lint、typecheck、契约测试 | 通过，13 tests | bun run check / bun test ./test |
| UI ZIP 构建及许可 | 通过 | artifacts/ui/release.json |
| 下载校验、包路径、兼容选择、回退 | 通过 | test/ui-packages.test.ts |
| 完整 UI 下载、重载、草稿、发送和回退 | 通过 | artifacts/ui-update-smoke.json |
| 六类附件到服务端及模型 | 通过 | artifacts/attachment-smoke.json |
| 权限实际回复与提问表单 | 通过，隔离 2.1.2 CLI | scripts/session-smoke.ts |
| 真实 VS Code 文件与未保存选区 | 通过 | artifacts/vscode-smoke.json |
| 真实 VS Code 文件定位及原生 diff | 通过 | artifacts/vscode-smoke.json |
| 更新后／回退后实际发送及草稿保留 | 通过 | artifacts/vscode-smoke.json |

GitHub 自动监测和公开发布将在服务器端验证后记录。日常项目验收待用户完成。

自动流水线 [40060291615](https://github.com/HunkYuan/opencode-vscode/actions/runs/40060291615) 已完成 npm 2.1.4 的发现、候选 PR #1、Windows/Linux 验证、自动合并和发布。公开 [ui-2.1.4-vscode.1](https://github.com/HunkYuan/opencode-vscode/releases/tag/ui-2.1.4-vscode.1) 包已通过真实客户端从更新清单下载安装，SHA256 a65fbb7e0afb54c37de2063960c906f74b095faa34a6bda0185f95b36e99f5fd。

## 0.2.0 最终交付验证

| 项目 | 结果 | 证据 |
|---|---|---|
| Windows/Linux 扩展检查、单测、VSIX 构建 | 全部通过 | [40061206849](https://github.com/HunkYuan/opencode-vscode/actions/runs/40061206849) |
| Windows/Linux UI 更新、回退、附件、权限与表单 | 全部通过 | [40061233451](https://github.com/HunkYuan/opencode-vscode/actions/runs/40061233451) |
| 自动发现 2.1.4 → PR → 校验 → 合并 → 发布 → 清单 | 全链路通过 | [40060291615](https://github.com/HunkYuan/opencode-vscode/actions/runs/40060291615) |
| 2.1.2 兼容包校验与公开发布 | 全部通过 | [40062127251](https://github.com/HunkYuan/opencode-vscode/actions/runs/40062127251) |
| 公开 2.1.4 UI ZIP 客户端下载／SHA256 | 通过 | artifacts/public-ui-installed.json |
| 0.2.0 VSIX 隔离安装及实际运行 | 通过 | artifacts/installed-0.2.0.json / artifacts/vscode-smoke.json |
| 安装后 GBK、未保存选区、文件定位、原生 diff | 通过 | 真实 VS Code 1.94 + 隔离 2.1.4 service |
| 安装后更新／回退、草稿保留及再次发送 | 通过 | 真实 VS Code 1.94 |
| v0.2.0 公开下载及校验文件 | 一致 | artifacts/publish/verified-0.2.0.json |

交付 VSIX 使用 Host 提交 57847de593f05d8b1fbd663d883b561ad06b7582 与公开 UI 提交 0cc5a377c4f79b79c6cbffefa04e4f09887af562，从全新暂存目录组装；33,600,292 bytes，2827 entries，无测试或临时数据。SHA256 8e4e69306370fccb4aaa18ce6ee2d0c87643e7325a2536294940a11f2d418855。

[下载 0.2.0](https://github.com/HunkYuan/opencode-vscode/releases/download/v0.2.0/opencode-sidebar-0.2.0.vsix)；首次安装后执行 Reload Window，后续正常兼容 UI 更新自动下载，下一次正常重载使用。日常项目仍需用户自测。

## 0.3.0 本地 UI 导入验证

| 项目 | 结果 | 证据 |
|---|---|---|
| lint、Host/Webview 类型检查 | 通过 | bun run check |
| 本地包及已有契约测试 | 14 pass / 0 fail | bun test ./test |
| 指定版本本地准备 | 2.1.4 固定 tag/commit，修订增加，依赖安装通过 | bun run ui:upstream 2.1.4 |
| ZIP 每文件校验、协议／service 检查 | 通过 | test/ui-packages.test.ts |
| 损坏／缺少文件／旧 ZIP／相同 ID 拒绝 | 通过，原包保持可用 | test/ui-packages.test.ts |
| 读取旧在线状态，不联系 catalog | 通过 | test/ui-packages.test.ts |
| 完整 UI 本地导入、重载、草稿、回退 | 通过 | artifacts/ui-update-smoke.json |
| GBK、UTF-8、未保存内容、选区、空文件实际发送 | 六类通过 | artifacts/attachment-smoke.json |
| Markdown、权限实际回复与表单 | 通过，隔离 service | scripts/session-smoke.ts |
| 真实 VS Code 1.94 Import UI Package | 通过 | artifacts/vscode-smoke.json |
| 文件定位／原生 diff／未保存选区 | 通过 | artifacts/vscode-smoke.json |
| 本地包应用和回退后再次发送，草稿保留 | 通过 | artifacts/vscode-smoke.json |
| 0.3.0 VSIX 文件范围、版本、许可证及 SHA256 | 通过 | artifacts/package-0.3.0.json |
| 实际 VSIX 隔离安装及同组编辑器／UI 命令验证 | 通过，真实 VS Code 1.94 | artifacts/installed-vscode-smoke.json |
| 远端 Actions 停用、附件／artifact／cache 清空 | 回查通过 | artifacts/publish/source-only-after.json |

全部验证在本机进行，没有启用 GitHub Actions 或上传新产物。用户 service 保持运行；日常项目验收仍需用户自测。

### 0.3.0 本地产物与安装记录

构建源码提交：`57e108e090fdc841b9d49fde9401e2f323a5ea8b`。后续验证文档提交不改变 Host/UI 实现。OpenCode 来源为 2.1.4、`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`，内置 UI ID 为 `opencode-2.1.4-vscode.3`。

| 本地产物 | 字节 | SHA256 |
|---|---:|---|
| `opencode-sidebar-0.3.0.vsix` | 34,457,806 | `c44e1dcf9056aec4276341b610ea643403c6659ddd7765442530a24338ea6ef3` |
| `artifacts/ui/opencode-ui-2.1.4-vscode.3.zip` | 33,796,029 | `64316dbe3dc9b1bb5687b703742b5192741e6a6c23ae3de38b8e54fef09d81ef` |

VSIX 共 3,648 个 entries，包含 Host、Webview 和许可证，没有 scripts、test、artifacts、.upstream、node_modules 或 .github 目录。安装到 artifacts 下的独立 profile 后，实际插件命令验证 GBK 文件与未保存选区发送、文件跳转、原生 diff、导入／应用／回退及草稿恢复；service 和本地模型接口收到 text/plain 快照，GBK 源文件字节未变。导入测试包修订 4 后回退到内置修订 3。

构建日志保存于 `artifacts/package-0.3.0.log`，安装验证日志保存于 `artifacts/installed-vscode-0.3.0.log`。以上产物与测试目录均被 Git 忽略，没有发布到 GitHub；用户日常配置未安装。2026-10-24 的远端回查确认 Actions enabled=false，五个历史 Release 附件数为零，artifact／cache 库存为零。
