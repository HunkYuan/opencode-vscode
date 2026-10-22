import { readFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { join, resolve, isAbsolute } from "node:path"
import { window, workspace, commands, env, Uri, ColorThemeKind, type ExtensionContext, type WebviewView, type WebviewViewProvider, type LogOutputChannel } from "vscode"
import { request, type Bootstrap, type EditorContext, type HostMessage, type Request, type ServiceState } from "./protocol"
import { LocalService, ServiceDisabled, ServiceStopped } from "./service"
import { createTransport } from "./transport"
import { Storage } from "./storage"
import { activeDirectory, openFile, createReview } from "./editor"

declare const __OPENCODE_VERSION__: string

export class Sidebar implements WebviewViewProvider {
  private view?: WebviewView
  private bridge?: Awaited<ReturnType<typeof createTransport>>
  private readonly storage: Storage
  private readonly service: LocalService
  private readonly review = createReview()
  private state: ServiceState = { status: "connecting", uiVersion: __OPENCODE_VERSION__ }
  private sessionID?: string
  private directory?: string
  private readonly queued: HostMessage[] = []
  private connecting?: Promise<ServiceState>
  private initialized = false
  private editorReady = false
  private interfaceReady = false

  constructor(private readonly context: ExtensionContext, private readonly log: LogOutputChannel) {
    this.storage = new Storage(context.workspaceState, context.storageUri?.fsPath ?? join(context.globalStorageUri.fsPath, "default"))
    this.service = new LocalService({
      cliPath: () => workspace.getConfiguration("opencodeSidebar").get("cliPath", ""),
      autoStart: () => workspace.getConfiguration("opencodeSidebar").get("autoStart", true),
      log: (message) => log.info(message),
    })
    context.subscriptions.push(window.onDidChangeActiveColorTheme(() => this.theme()))
    context.subscriptions.push(workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencodeSidebar.followTheme")) this.theme()
    }))
  }

  async resolveWebviewView(view: WebviewView) {
    this.view = view
    this.initialized = false
    this.editorReady = false
    this.interfaceReady = false
    const directory = Uri.joinPath(this.context.extensionUri, "dist", "webview")
    view.webview.options = { enableScripts: true, localResourceRoots: [directory] }
    this.bridge ??= await createTransport({ resolve: () => Promise.resolve(this.service.current()).then((endpoint) => endpoint ?? this.service.connect()), log: (message) => this.log.warn(message) })
    view.webview.onDidReceiveMessage((input: unknown) => {
      const parsed = request.safeParse(input)
      if (!parsed.success) { this.log.warn("Rejected invalid Webview message"); return }
      void this.handle(parsed.data).then(
        (value) => view.webview.postMessage({ type: "result", id: parsed.data.id, value }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : "OpenCode operation failed"
          this.log.error(message)
          void view.webview.postMessage({ type: "result", id: parsed.data.id, error: message })
        },
      )
    }, undefined, this.context.subscriptions)
    view.webview.html = await this.html(directory)
    view.onDidDispose(() => { this.view = undefined; this.initialized = false; this.editorReady = false; this.interfaceReady = false; this.bridge?.close(); this.bridge = undefined })
  }

  async focus() {
    await commands.executeCommand("workbench.view.extension.opencodeSidebar")
    await commands.executeCommand("opencodeSidebar.chat.focus")
    this.view?.show(false)
  }

  async attach(context: EditorContext) {
    this.directory = context.directory
    await this.focus()
    this.send({ type: "context", context })
  }

  async newSession() {
    await this.focus()
    const directory = activeDirectory() ?? await this.pickDirectory()
    if (!directory) return
    this.send({ type: "newSession", directory })
  }

  reconnect() {
    this.connecting ??= this.resolveService().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private async resolveService() {
    if (this.state.status !== "ready") this.state = { ...this.state, status: "connecting", message: "正在连接本机共享服务…" }
    this.send({ type: "service", service: this.state })
    const endpoint = await this.service.connect().catch((error: unknown) => {
      this.state = { uiVersion: __OPENCODE_VERSION__, url: this.bridge?.url, status: error instanceof ServiceDisabled ? "disabled" : error instanceof ServiceStopped ? "stopped" : "error", message: error instanceof Error ? error.message : "OpenCode connection failed" }
      this.log.warn(this.state.message ?? "OpenCode connection failed")
      return undefined
    })
    if (endpoint) this.state = { status: "ready", uiVersion: __OPENCODE_VERSION__, url: this.bridge?.url, serviceVersion: endpoint.version, mismatch: endpoint.version !== __OPENCODE_VERSION__ }
    this.send({ type: "service", service: this.state })
    return this.state
  }

  async enableService() {
    await this.service.enable()
    return this.reconnect()
  }

  async reviewChanges() {
    if (!this.sessionID) { await window.showInformationMessage("先选择一个已开始的会话，再审阅改动。"); return }
    await this.review.open(await this.service.connect(), this.sessionID)
  }

  dispose() {
    this.bridge?.close()
    this.review.dispose()
  }

  private send(message: HostMessage) {
    if (!this.initialized || (message.type === "context" && !this.editorReady) || (message.type === "newSession" && !this.interfaceReady)) {
      if (message.type === "context" || message.type === "newSession") this.queued.push(message)
      return
    }
    void this.view?.webview.postMessage(message)
  }

  private flush() {
    if (!this.initialized) return
    const pending = this.queued.splice(0)
    pending.forEach((message) => this.send(message))
  }

  private theme() {
    this.send({ type: "theme", theme: window.activeColorTheme.kind === ColorThemeKind.Light || window.activeColorTheme.kind === ColorThemeKind.HighContrastLight ? "light" : "dark", followTheme: workspace.getConfiguration("opencodeSidebar").get("followTheme", true) })
  }

  private async handle(input: Request): Promise<unknown> {
    switch (input.method) {
      case "ready": {
        this.bridge?.setOrigin(input.origin)
        await this.reconnect()
        const bootstrap: Bootstrap = {
          service: this.state,
          directory: activeDirectory() ?? this.directory,
          route: this.context.workspaceState.get("route", "/"),
          windowID: "vscode",
          locale: env.language,
          theme: window.activeColorTheme.kind === ColorThemeKind.Light || window.activeColorTheme.kind === ColorThemeKind.HighContrastLight ? "light" : "dark",
          followTheme: workspace.getConfiguration("opencodeSidebar").get("followTheme", true),
        }
        // 消息桥握手后排队上下文需要等 UI 的组件订阅完成，再由 uiReady 刷新。
        return bootstrap
      }
      case "uiReady": {
        this.initialized = true
        this.flush()
        this.send({ type: "service", service: this.state })
        this.theme()
        return
      }
      case "editorReady": {
        this.editorReady = input.ready
        if (input.ready) this.flush()
        return
      }
      case "interfaceReady": {
        this.interfaceReady = input.ready
        if (input.ready) this.flush()
        return
      }
      case "reconnect": return this.reconnect()
      case "enableService": return this.enableService()
      case "openExternal": {
        const url = Uri.parse(input.url)
        if (!["https", "http", "mailto", "file"].includes(url.scheme)) throw new Error("Unsupported external URL")
        if (url.scheme === "file") return openFile(url.fsPath, this.directory)
        await env.openExternal(url)
        return
      }
      case "openFile": return openFile(input.path, input.directory ?? this.directory, input.line, input.character)
      case "fileExists": return workspace.fs.stat(Uri.file(isAbsolute(input.path) ? input.path : resolve(input.directory ?? this.directory ?? activeDirectory() ?? "", input.path))).then(() => true, () => false)
      case "pickDirectory": return this.pickDirectory()
      case "clipboard": return env.clipboard.writeText(input.text)
      case "storageRead": return this.storage.read(input.name)
      case "storageWrite": return this.storage.write(input.name, input.values)
      case "draftGet": return this.storage.draftGet(input.key)
      case "draftSet": return this.storage.draftSet(input.key, input.value, input.strict)
      case "draftRemove": return this.storage.draftRemove(input.key)
      case "blobPut": return this.storage.putBlob(input.data, input.mime)
      case "blobGet": return this.storage.getBlob(input.key)
      case "route": {
        this.sessionID = input.sessionID
        this.directory = input.directory
        await this.context.workspaceState.update("route", input.route)

        return
      }
      case "review": return this.review.open(await this.service.connect(), input.sessionID)
      case "log": this.log.info(input.message); return
    }
  }

  private async pickDirectory() {
    const selected = workspace.workspaceFolders?.length
      ? await window.showQuickPick(workspace.workspaceFolders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath })), { placeHolder: "选择 OpenCode 工作区" })
      : undefined
    if (selected) return selected.description
    if (workspace.workspaceFolders?.length) return null
    return window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }).then((items) => items?.[0]?.fsPath ?? null)
  }

  private async html(directory: Uri) {
    const webview = this.view!.webview
    const nonce = randomBytes(24).toString("base64")
    const base = webview.asWebviewUri(directory).toString() + "/"
    const port = new URL(this.bridge!.url).origin
    const html = await readFile(Uri.joinPath(directory, "index.html").fsPath, "utf8")
    const policy = `default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob: https: ${port}; font-src ${webview.cspSource} data:; media-src ${webview.cspSource} data: blob: ${port}; connect-src ${port} ${port.replace("http:", "ws:")} ${webview.cspSource} data: blob:; worker-src blob: data:;`
    return html.replace('<div id="root"></div>', '<div id="root"><main class="connection-screen"><h2>OpenCode</h2><p>正在连接本机共享服务…</p></main></div>')
      .replace("<head>", `<head><base href="${base}"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
      .replace(/<script\b/g, `<script nonce="${nonce}"`)
  }
}
