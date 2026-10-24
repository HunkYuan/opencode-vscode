import { HOST_PROTOCOL, type Bootstrap, type HostMessage, type Request } from "../src/protocol"
import type { UiManifest } from "../src/ui/manifest"
declare const __UI_PACKAGE__: UiManifest

declare function acquireVsCodeApi(): { postMessage(message: Request): void }
const vscode = acquireVsCodeApi()
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
const handlers = new Set<(message: HostMessage) => void>()
window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data
  if (message.type === "result") {
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    if (message.error) { call.reject(new Error(message.error)); return }
    call.resolve(message.value)
    return
  }
  handlers.forEach((handler) => handler(message))
})

type Input = Request extends infer R ? R extends Request ? Omit<R, "id"> : never : never
export function call<T = unknown>(input: Input): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject })
    vscode.postMessage({ ...input, id } as Request)
  })
}
export function listen(handler: (message: HostMessage) => void) {
  handlers.add(handler)
  return () => { handlers.delete(handler) }
}
export function bootstrap() {
  return call<Bootstrap>({ method: "ready", origin: location.origin, hostProtocol: HOST_PROTOCOL, uiId: __UI_PACKAGE__.id })
}
