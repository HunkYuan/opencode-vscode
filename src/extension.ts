import { window, commands, type ExtensionContext } from "vscode"
import { Sidebar } from "./sidebar"
import { captureContext } from "./editor"

export function activate(context: ExtensionContext) {
  const output = window.createOutputChannel("OpenCode Sidebar", { log: true })
  const sidebar = new Sidebar(context, output)
  context.subscriptions.push(output, sidebar, window.registerWebviewViewProvider("opencodeSidebar.chat", sidebar, { webviewOptions: { retainContextWhenHidden: true } }))
  const actions = {
    open: () => sidebar.focus(),
    newSession: () => sidebar.newSession(),
    addFile: () => sidebar.attach(captureContext(false)),
    addSelection: () => sidebar.attach(captureContext(true)),
    review: () => sidebar.reviewChanges(),
    reconnect: () => sidebar.reconnect(),
    enableService: () => sidebar.enableService(),
    logs: () => output.show(),
    checkUIUpdates: () => sidebar.checkUIUpdates(),
    applyUIUpdate: () => sidebar.applyUIUpdate(),
    rollbackUI: () => sidebar.rollbackUI(),
  }
  Object.entries(actions).forEach(([name, action]) => context.subscriptions.push(commands.registerCommand("opencodeSidebar." + name, () =>
    Promise.resolve().then(async () => { await action() }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "OpenCode operation failed"
      output.error(message)
      void window.showErrorMessage(message)
    }),
  )))
  return { sidebar }
}
