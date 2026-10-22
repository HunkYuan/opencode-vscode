import "@/runtime/polyfills"
import "@opencode/app/index.css"
import "./sidebar.css"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createEffect, Show } from "solid-js"
import { AppBaseProviders, AppInterface, PlatformProvider, ServerConnection } from "@opencode/app"
import { useTheme } from "@opencode/ui/theme/context"
import { bootstrap, call, listen } from "./bridge"
import { createPlatform } from "./platform"
import { createRouter } from "./router"
import { EditorBridge } from "./editor"
import type { ServiceState } from "../src/protocol"
import { loadLocaleDict, normalizeLocale } from "@opencode/app/desktop"

const root = document.getElementById("root")!
const initial = await bootstrap()
const locale = normalizeLocale(initial.locale.toLowerCase().startsWith("zh") ? "zh" : initial.locale)
await loadLocaleDict(locale)
const platform = createPlatform(initial)
const [state, setState] = createStore({ service: initial.service, mounted: initial.service.status === "ready", theme: initial.theme, followTheme: initial.followTheme })
listen((message) => {
  if (message.type === "service") { setState("service", message.service); if (message.service.status === "ready") setState("mounted", true) }
  if (message.type === "theme") setState({ theme: message.theme, followTheme: message.followTheme })
})
const router = createRouter(initial.route)
const server: ServerConnection.Sidecar = {
  type: "sidecar",
  variant: "base",
  displayName: "OpenCode",
  http: { url: initial.service.url ?? "" },
  reconnect: async () => {
    const service = await call<ServiceState>({ method: "reconnect" })
    if (service.status !== "ready" || !service.url) throw new Error(service.message ?? "OpenCode is unavailable")
    return { url: service.url }
  },
}
function ConnectionScreen() {
  return <main class="connection-screen">
    <h2>OpenCode</h2>
    <p>{state.service.message ?? "正在连接本机共享服务…"}</p>
    <Show when={state.service.status === "disabled"}>
      <button onClick={() => void call({ method: "enableService" })}>启用共享服务</button>
    </Show>
    <Show when={state.service.status !== "connecting"}>
      <button onClick={() => void call({ method: "reconnect" })}>重新连接</button>
    </Show>
  </main>
}
function ThemeBridge() {
  const theme = useTheme()
  createEffect(() => { if (state.followTheme) theme.setColorScheme(state.theme) })
  return null
}
root.replaceChildren()
render(() => (
  <PlatformProvider value={platform}>
    <Show when={state.mounted} fallback={<ConnectionScreen />}>
      <Show when={state.service.mismatch}>
        <div class="version-notice">UI {state.service.uiVersion} · Service {state.service.serviceVersion}，已复用现有服务。</div>
      </Show>
      <Show when={state.service.status !== "ready"}><div class="connection-overlay"><ConnectionScreen /></div></Show>
      <AppBaseProviders locale={locale}>
        <ThemeBridge />
        <AppInterface canonicalLocalServer={ServerConnection.key(server)} servers={[server]} router={router}>
          <EditorBridge initial={initial} />
        </AppInterface>
      </AppBaseProviders>
    </Show>
  </PlatformProvider>
), root)
void call({ method: "uiReady" })
window.addEventListener("unhandledrejection", (event) => {
  void call({ method: "log", message: event.reason instanceof Error ? event.reason.message : "Webview request failed" })
})
