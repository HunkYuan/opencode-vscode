# Changelog

## 0.1.1 — 2026-10-22

- fix(editor): send decoded editor snapshots through official text attachments so saved GBK files reach the model.
- fix(editor): preserve absolute paths, exact selection ranges and unsaved state; re-adding a file refreshes its snapshot.
- test(editor): verify actual UI sends, restored drafts, service attachment MIME and model input with an isolated local provider.
- test(vscode): verify real VS Code GBK decoding, Add Current File and Send without changing source bytes.

0.1.1 本地自测包，待用户在日常项目验收。

## 0.1.0 — 2026-10-22

- feat(vscode): embed official OpenCode Solid UI in sidebar.
- feat(service): discover or start shared service, honor disabled setting and preserve existing version.
- feat(editor): attach current file or selection and review session snapshots in native diff.
- fix(webview): load official polyfills and inline Workers/SVG sprites for VS Code.
- test(vscode): verify real service, isolated fixtures and VS Code extension host.

需用户安装自测。
