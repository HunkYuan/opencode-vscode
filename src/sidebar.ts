import { readFile } from "node:fs/promises"
import { randomBytes, randomUUID } from "node:crypto"
import { join, resolve, isAbsolute } from "node:path"
import { window, workspace, commands, env, Uri, ColorThemeKind, type ExtensionContext, type WebviewView, type WebviewViewProvider, type LogOutputChannel } from "vscode"
import { HOST_PROTOCOL, request, type Bootstrap, type EditorContext, type HostMessage, type Request, type ServiceState } from "./protocol"
import { LocalService, ServiceDisabled } from "./service"
import { ServiceStopped } from "./service"
import { createTransport } from "./transport"
import { Storage } from "./storage"
import { activeDirectory, openFile, createReview } from "./editor"
import { UiPackages, type UiBundle } from "./ui/packages"

export class Sidebar implements WebviewViewProvider {
  private view?: WebviewView
  private bridge?: Awaited<ReturnType<typeof createTransport>>
  private readonly storage: Storage
  private readonly service: LocalService
  private readonly review = createReview()
  private readonly packages: UiPackages
  private bundle?: UiBundle
  private boot?: ReturnType<typeof setTimeout>
  private state: ServiceState = { status: "connecting", uiVersion: "unknown" }
  private sessionID?: string
  private directory?: string
  private readonly queued: HostMessage[] = []
  private readonly requests = new Map<string, { resolve: (value: { working?: boolean }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
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
    this.packages = new UiPackages({
      directory: join(context.globalStorageUri.fsPath, "ui"),
      builtinDirectory: join(context.extensionUri.fsPath, "dist/webview"),
      hostProtocol: HOST_PROTOCOL,
      log: (message) => log.info(message),
    })
    context.subscriptions.push(window.onDidChangeActiveColorTheme(() => this.theme()))
    context.subscriptions.push(workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencodeSidebar.followTheme")) this.theme()
    }))
  }

  async resolveWebviewView(view: WebviewView) {
    this.view = view
    this.bridge ??= await createTransport({
      resolve: () => Promise.resolve(this.service.current()).then((endpoint) => endpoint ?? this.service.connect()),
      log: (message) => this.log.warn(message),
    })
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
    await this.reconnect()
    await this.load(await this.packages.select(this.state.serviceVersion))
    this.autoUpdate()
    view.onDidDispose(() => {
      this.stopBoot()
      this.view = undefined
      this.initialized = false
      this.editorReady = false
      this.interfaceReady = false
      this.bridge?.close()
      this.bridge = undefined
      this.cancelRequests()
    })
  }

  async focus() {
    await commands.executeCommand("workbench.view.extension.opencodeSidebar")
    await commands.executeCommand("opencodeSidebar.chat.focus")
    this.view?.show(false)
    if (this.initialized) this.autoUpdate()
  }

  async attach(context: EditorContext) {
    this.directory = context.directory
    await this.focus()
    this.send({ type: "context", context })
  }

  async newSession() {
    await this.focus()
    const directory = activeDirectory() ?? await this.pickDirectory()
    if (directory) this.send({ type: "newSession", directory })
  }

  reconnect() {
    this.connecting ??= this.resolveService().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private async resolveService() {
    if (this.state.status !== "ready") this.state = { ...this.state, status: "connecting", message: "正在连接本机共享服务…" }
    this.send({ type: "service", service: this.state })
    const endpoint = await this.service.connect().catch((error: unknown) => {
      this.state = { uiVersion: this.bundle?.manifest.upstreamVersion ?? "unknown", url: this.bridge?.url, status: error instanceof ServiceDisabled ? "disabled" : error instanceof ServiceStopped ? "stopped" : "error", message: error instanceof Error ? error.message : "OpenCode connection failed" }
      this.log.warn(this.state.message ?? "OpenCode connection failed")
      return undefined
    })
    if (endpoint) this.state = { status: "ready", uiVersion: this.bundle?.manifest.upstreamVersion ?? "unknown", url: this.bridge?.url, serviceVersion: endpoint.version, mismatch: this.bundle ? endpoint.version !== this.bundle.manifest.upstreamVersion : false }
    this.send({ type: "service", service: this.state })
    return this.state
  }

  async enableService() {
    await this.service.enable()
    return this.reconnect()
  }

  async reviewChanges() {
    await this.focus()
    if (!this.sessionID) { await window.showInformationMessage("先选择一个已开始的会话，再审阅改动。"); return }
    await this.ask({ type: "review", sessionID: this.sessionID })
  }

  async checkUIUpdates(force = true) {
    const current = this.bundle ?? await this.packages.select(this.state.serviceVersion)
    const next = await this.packages.check(this.state.serviceVersion, current, force)
    if (force) await window.showInformationMessage(next
      ? `UI ${next.manifest.id} 已下载，下次重载自动使用；也可执行 Apply UI Update。`
      : "当前没有可用的兼容 UI 更新。")
    return next?.manifest.id
  }

  private autoUpdate() {
    if (workspace.getConfiguration("opencodeSidebar").get("uiAutoUpdate", true) && this.state.status === "ready")
      void this.checkUIUpdates(false).catch((error: unknown) => this.log.warn(`UI update check failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  async applyUIUpdate() {
    const next = await this.packages.pending()
    if (!next) { await window.showInformationMessage("当前没有待应用的 UI 更新。"); return }
    if (!await this.prepareReload()) return
    await this.load(next)
  }

  async rollbackUI() {
    if (!await this.prepareReload()) return
    await this.load(await this.packages.rollback(this.state.serviceVersion))
  }

  dispose() {
    this.stopBoot()
    this.cancelRequests()
    this.bridge?.close()
    this.review.dispose()
  }

  private async prepareReload() {
    if (!this.initialized) return true
    const status = await this.ask({ type: "prepareReload" })
    if (!status.working) return true
    await window.showInformationMessage("OpenCode 仍在工作，完成后再应用 UI 更新。")
    return false
  }

  private async load(bundle: UiBundle) {
    if (!this.view) return
    this.stopBoot()
    this.cancelRequests()
    const previous = this.bundle
    this.bundle = bundle
    this.initialized = false
    this.editorReady = false
    this.interfaceReady = false
    this.state = { ...this.state, uiVersion: bundle.manifest.upstreamVersion, mismatch: !!this.state.serviceVersion && this.state.serviceVersion !== bundle.manifest.upstreamVersion }
    const directory = Uri.file(bundle.directory)
    this.view.webview.options = { enableScripts: true, localResourceRoots: previous ? [directory, Uri.file(previous.directory)] : [directory] }
    this.view.webview.html = await this.html(directory, bundle.manifest.entry)
    // uiReady 在官方界面挂载后发出；下载包未完成握手时只回退 UI，不动共享 service。
    this.boot = setTimeout(() => { void this.bootFailed(bundle).catch((error: unknown) => this.log.error(String(error))) }, 30_000)
    this.log.info(`Loading UI package ${bundle.manifest.id}`)
  }

  private async bootFailed(bundle: UiBundle) {
    if (this.bundle !== bundle || this.initialized) return
    this.log.error(`UI package ${bundle.manifest.id} did not finish startup`)
    const builtin = await this.packages.bundled()
    const pending = await this.packages.pending()
    if (pending && pending.manifest.id !== bundle.manifest.id) {
      await this.load(pending)
      return
    }
    if (bundle.manifest.id === builtin.manifest.id) {
      await window.showErrorMessage("OpenCode UI 启动失败，请查看插件日志。")
      return
    }
    await this.packages.failed(bundle)
    await this.load(await this.packages.select(this.state.serviceVersion))
  }

  private stopBoot() {
    if (this.boot) clearTimeout(this.boot)
    this.boot = undefined
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
    this.queued.splice(0).forEach((message) => this.send(message))
  }

  private ask(message: { type: "prepareReload" } | { type: "review"; sessionID: string }) {
    if (!this.initialized) throw new Error("UI 尚未就绪，请稍后重试。")
    const requestID = randomUUID()
    return new Promise<{ working?: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestID)
        reject(new Error("UI 未响应宿主请求，请查看插件日志。"))
      }, 30_000)
      this.requests.set(requestID, { resolve, reject, timer })
      this.send({ ...message, requestID })
    })
  }

  private cancelRequests() {
    this.requests.forEach((request) => {
      clearTimeout(request.timer)
      request.reject(new Error("UI has been reloaded"))
    })
    this.requests.clear()
  }

  private theme() {
    this.send({ type: "theme", theme: window.activeColorTheme.kind === ColorThemeKind.Light || window.activeColorTheme.kind === ColorThemeKind.HighContrastLight ? "light" : "dark", followTheme: workspace.getConfiguration("opencodeSidebar").get("followTheme", true) })
  }

  private async handle(input: Request): Promise<unknown> {
    switch (input.method) {
      case "ready": {
        if (input.hostProtocol !== HOST_PROTOCOL || input.uiId !== this.bundle?.manifest.id)
          throw new Error("UI 与扩展宿主协议不兼容，请更新插件或回退 UI。")
        this.bridge?.setOrigin(input.origin)
        const bootstrap: Bootstrap = {
          hostProtocol: HOST_PROTOCOL,
          uiId: this.bundle.manifest.id,
          service: this.state,
          directory: activeDirectory() ?? this.directory,
          route: this.context.workspaceState.get("route", "/"),
          windowID: "vscode",
          locale: env.language,
          theme: window.activeColorTheme.kind === ColorThemeKind.Light || window.activeColorTheme.kind === ColorThemeKind.HighContrastLight ? "light" : "dark",
          followTheme: workspace.getConfiguration("opencodeSidebar").get("followTheme", true),
        }
        return bootstrap
      }
      case "uiReady": {
        if (input.hostProtocol !== HOST_PROTOCOL || input.uiId !== this.bundle?.manifest.id) throw new Error("Invalid UI startup handshake")
        this.initialized = true
        this.stopBoot()
        await this.packages.loaded(this.bundle)
        this.flush()
        this.send({ type: "service", service: this.state })
        this.theme()
        this.autoUpdate()
        return
      }
      case "hostResult": {
        const pending = this.requests.get(input.requestID)
        if (!pending) return
        clearTimeout(pending.timer)
        this.requests.delete(input.requestID)
        if (input.error) pending.reject(new Error(input.error))
        if (!input.error) pending.resolve({ working: input.working })
        return
      }
      case "editorReady": { this.editorReady = input.ready; if (input.ready) this.flush(); return }
      case "interfaceReady": { this.interfaceReady = input.ready; if (input.ready) this.flush(); return }
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
      case "review": return this.review.open(input.sessionID, input.changes)
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

  private async html(directory: Uri, entry: string) {
    const webview = this.view!.webview
    const nonce = randomBytes(24).toString("base64")
    const base = webview.asWebviewUri(directory).toString() + "/"
    const port = new URL(this.bridge!.url).origin
    const html = await readFile(Uri.joinPath(directory, entry).fsPath, "utf8")
    const policy = `default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob: https: ${port}; font-src ${webview.cspSource} data:; media-src ${webview.cspSource} data: blob: ${port}; connect-src ${port} ${port.replace("http:", "ws:")} ${webview.cspSource} data: blob:; worker-src blob: data:;`
    return html.replace('<div id="root"></div>', '<div id="root"><main class="connection-screen"><h2>OpenCode</h2><p>正在连接本机共享服务…</p></main></div>')
      .replace("<head>", `<head><base href="${base}"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
      .replace(/<script\b/g, `<script nonce="${nonce}"`)
  }
}
