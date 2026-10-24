import { createEffect, getOwner, onCleanup, onMount, runWithOwner } from "solid-js"
import { useLocation } from "@solidjs/router"
import { ServerConnection, useTabs, useGlobal } from "@opencode/app/desktop"
import { flushPersisted } from "@/runtime/persistence/persist"
import { HOST_PROTOCOL, type Bootstrap } from "../src/protocol"
import { call, listen } from "./bridge"
import { flushStorage } from "./storage"
import { readReview } from "./review"

export function EditorBridge(props: { initial: Bootstrap }) {
  const tabs = useTabs()
  const global = useGlobal()
  const location = useLocation()
  const owner = getOwner()
  const connection = () => global.servers.list().find((connection) => ServerConnection.builtin(connection))
  const current = () => tabs.store.find((tab) => tab.type === "draft"
    ? location.pathname === "/new-session" && location.query.draftId === tab.draftID
    : location.pathname.endsWith("/session/" + (tab.routeSessionId ?? tab.sessionId)))
  const draft = async (directory?: string) => {
    const target = directory ?? props.initial.directory
    if (!target) return
    const server = connection()
    if (!server) throw new Error("本机服务尚未就绪。")
    const ctx = global.ensureServerCtx(server)
    ctx.projects.open(target)
    ctx.projects.touch(target)
    return tabs.newDraft({ directory: target, server: ServerConnection.key(server) })
  }
  let initialized = false
  createEffect(() => {
    if (!tabs.ready() || initialized) return
    initialized = true
    if (location.pathname === "/" && props.initial.directory) void draft()
  })
  createEffect(() => {
    const tab = current()
    const server = connection()
    const directory = tab?.type === "draft" ? tab.directory : tab && server
      ? global.ensureServerCtx(server).data.session.get(tab.sessionId)?.location.directory ?? props.initial.directory
      : props.initial.directory
    void call({ method: "route", route: location.pathname + location.search, sessionID: tab?.type === "session" ? tab.sessionId : undefined, directory })
  })
  onCleanup(listen((message) => {
    if (message.type === "newSession") void runWithOwner(owner, () => draft(message.directory))
    if (message.type !== "review" && message.type !== "prepareReload") return
    const perform = async () => {
      if (message.type === "review") {
        await call({ method: "review", sessionID: message.sessionID, changes: await readReview(props.initial.service.url!, message.sessionID) })
        return { method: "hostResult" as const, requestID: message.requestID }
      }
      const server = connection()
      const working = server && tabs.store.some((tab) => tab.type === "session" && global.ensureServerCtx(server).data.session.status(tab.sessionId) === "running")
      if (!working) {
        flushPersisted()
        await flushStorage()
      }
      return { method: "hostResult" as const, requestID: message.requestID, working: !!working }
    }
    void perform().then((result) => call(result), (error: unknown) => call({
      method: "hostResult", requestID: message.requestID, error: error instanceof Error ? error.message : "UI operation failed",
    }))
  }))
  onMount(() => {
    void call({ method: "interfaceReady", ready: true })
    void call({ method: "uiReady", hostProtocol: HOST_PROTOCOL, uiId: props.initial.uiId })
  })
  onCleanup(() => { void call({ method: "interfaceReady", ready: false }) })
  return null
}
