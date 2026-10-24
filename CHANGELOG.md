# Changelog

## 0.3.0 — 2026-10-24

- feat(ui): import locally built UI ZIPs with per-file integrity and host/service compatibility checks.
- feat(ui): retain cached application, rollback and draft preservation without an online update catalog.
- chore(build): prepare an explicit pinned OpenCode version locally, with no GitHub token, PR, commit or push.
- chore(repo): remove retired Actions workflows and hosted publishing scripts; distribute source only.
- test(ui): verify local imports, corrupted files, legacy state, actual sends and VS Code commands.

使用者本地构建 VSIX/UI ZIP。旧 Release 文字保留作历史，附件已撤下。需用户在日常项目自测。

## 0.2.0 — 2026-10-24

- feat(ui): separate official UI/Client SDK packages from the stable VS Code Host.
- feat(ui): automatically download compatible packages, verify SHA256, preserve drafts and support reload/rollback.
- feat(ui): monitor GitHub/npm stable releases, validate fixed candidates on Windows/Linux, merge and publish automatically.
- feat(editor): move SDK diff queries into the UI package and keep native diff display in Host.
- test(ui): verify actual package download/reload/rollback, GBK and unsaved attachments, file links and native diff in VS Code.

0.2.0 已发布到 [GitHub Release](https://github.com/HunkYuan/opencode-vscode/releases/tag/v0.2.0)。首次安装后，后续兼容 UI 更新独立下载；日常项目需用户自测。

## 0.1.1 — 2026-10-22

- fix(editor): send decoded editor snapshots through official text attachments so saved GBK files reach the model.
- fix(editor): preserve absolute paths, exact selection ranges and unsaved state; re-adding a file refreshes its snapshot.
- test(editor): verify actual UI sends, restored drafts, service attachment MIME and model input with an isolated local provider.
- test(vscode): verify real VS Code GBK decoding, Add Current File and Send without changing source bytes.

0.1.1 已发布到 [GitHub Release](https://github.com/HunkYuan/opencode-vscode/releases/tag/v0.1.1)，日常项目仍需用户自测。

## 0.1.0 — 2026-10-22

- feat(vscode): embed official OpenCode Solid UI in sidebar.
- feat(service): discover or start shared service, honor disabled setting and preserve existing version.
- feat(editor): attach current file or selection and review session snapshots in native diff.
- fix(webview): load official polyfills and inline Workers/SVG sprites for VS Code.
- test(vscode): verify real service, isolated fixtures and VS Code extension host.

需用户安装自测。
