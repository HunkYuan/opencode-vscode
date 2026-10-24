# OpenCode VS Code 插件实施计划

> 本文保留最初实现计划。当前采用源码分发与本地 UI ZIP 导入，见 [SOURCE-ONLY.md](SOURCE-ONLY.md)。

结论：复用官方 Solid UI，仅新增 VS Code 启动入口与宿主适配。

- 插件目录：E:\\opencode-vscode；官方源码：E:\\opencode。
- 官方 UI 编译到 VSIX，运行时只依赖已安装 CLI。
- 已有服务复用，未启动时按需启动共享服务；尊重 disabled 设置。
- 版本差异提示并优先复用，接口不兼容时提示更新。
- 私有服务密码保留在 Extension Host；回环转发处理 HTTP/SSE/WebSocket。
- 复用官方会话、工具、权限、模型、diff 组件和状态同步。
- 编辑器联动：工作区、文件／选区、文件定位、原生 diff。
- 验证：真实服务只读联调，隔离环境启动测试，检查与打包，用户安装自测。

```mermaid
flowchart LR
UI[官方 Solid UI] <--> Host[VS Code Host]
Host <--> Service[共享 Service]
Host --> CLI[官方 CLI]
CLI --> Service
```

阶段：工程与 UI 加载 → 服务连接 → 编辑器联动 → 联调与交付。
