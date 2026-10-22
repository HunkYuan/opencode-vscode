import { createEffect, getOwner, onCleanup, onMount, runWithOwner } from "solid-js"
import { useLocation } from "@solidjs/router"
import { ServerConnection, useTabs, useGlobal } from "@opencode/app/desktop"
import { call, listen } from "./bridge"
import type { Bootstrap } from "../src/protocol"

export function EditorBridge(props: { initial: Bootstrap }) {
  const tabs = useTabs()
  const global = useGlobal()
  const location = useLocation()
  const owner = getOwner()
  const current = () => tabs.store.find((tab) => tab.type === "draft"
    ? location.pathname === "/new-session" && location.query.draftId === tab.draftID
    : location.pathname.endsWith("/session/" + (tab.routeSessionId ?? tab.sessionId)))
  const draft = async (directory?: string) => {
    const target = directory ?? props.initial.directory
    if (!target) return
    const connection = global.servers.list().find((connection) => ServerConnection.builtin(connection))
    if (!connection) throw new Error("本机服务尚未就绪。")
    const ctx = global.ensureServerCtx(connection)
    ctx.projects.open(target)
    ctx.projects.touch(target)
    return tabs.newDraft({ directory: target, server: ServerConnection.key(connection) })
  }
  let initialized = false
  createEffect(() => {
    if (!tabs.ready() || initialized) return
    initialized = true
    if (location.pathname === "/" && props.initial.directory) void draft()
  })
  createEffect(() => {
    const tab = current()
    const connection = global.servers.list().find((connection) => ServerConnection.builtin(connection))
    const directory = tab?.type === "draft" ? tab.directory : tab && connection
      ? global.ensureServerCtx(connection).data.session.get(tab.sessionId)?.location.directory ?? props.initial.directory
      : props.initial.directory
    void call({ method: "route", route: location.pathname + location.search, sessionID: tab?.type === "session" ? tab.sessionId : undefined, directory })
  })
  onCleanup(listen((message) => {
    if (message.type === "newSession") void runWithOwner(owner, () => draft(message.directory))
  }))
  onMount(() => { void call({ method: "interfaceReady", ready: true }) })
  onCleanup(() => { void call({ method: "interfaceReady", ready: false }) })
  return null
}
