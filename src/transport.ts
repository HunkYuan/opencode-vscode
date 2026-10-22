import http from "node:http"
import https from "node:https"
import { randomBytes } from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"
import type { Socket } from "node:net"
import type { Endpoint } from "./service"

export async function createTransport(options: { resolve: () => Promise<Endpoint>; log: (message: string) => void }) {
  const prefix = "/" + randomBytes(32).toString("hex") + "/"
  const sockets = new Set<Socket>()
  const upgrades = new WebSocketServer({ noServer: true })
  const connections = new Set<WebSocket>()
  let origin: string | undefined
  const server = http.createServer(async (incoming, outgoing) => {
    if (!incoming.url?.startsWith(prefix)) { outgoing.writeHead(404).end(); return }
    if (incoming.headers.origin && incoming.headers.origin !== origin) { outgoing.writeHead(403).end(); return }
    if (origin) {
      outgoing.setHeader("Access-Control-Allow-Origin", origin)
      outgoing.setHeader("Vary", "Origin")
      outgoing.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
      outgoing.setHeader("Access-Control-Allow-Headers", incoming.headers["access-control-request-headers"] ?? "content-type, authorization, range, x-opencode-ticket")
      outgoing.setHeader("Access-Control-Expose-Headers", "*")
    }
    if (incoming.method === "OPTIONS") { outgoing.writeHead(204).end(); return }
    const endpoint = await options.resolve().catch((error: unknown) => {
      options.log(error instanceof Error ? error.message : "Service connection failed")
      return undefined
    })
    if (!endpoint || outgoing.destroyed) { outgoing.writeHead(503).end(); return }
    const path = "/" + incoming.url.slice(prefix.length)
    if (!path.startsWith("/api/") && !path.startsWith("/auth/") && path !== "/openapi.json") { outgoing.writeHead(404).end(); return }
    const target = new URL(path, endpoint.url)
    const headers = { ...incoming.headers }
    delete headers.origin
    delete headers.referer
    delete headers.cookie
    delete headers.connection
    headers.host = target.host
    headers.authorization = "Basic " + Buffer.from("opencode:" + endpoint.password).toString("base64")
    const upstream = (target.protocol === "https:" ? https.request : http.request)(target, { method: incoming.method, headers }, (response) => {
      Object.entries(response.headers).forEach(([key, value]) => {
        if (value !== undefined && !["access-control-allow-origin", "access-control-allow-credentials", "set-cookie", "connection"].includes(key))
          outgoing.setHeader(key, value)
      })
      outgoing.writeHead(response.statusCode ?? 502)
      response.pipe(outgoing)
    })
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    // 包括 SSE 在内，关闭 Webview 请求即关闭对应上游连接。
    outgoing.on("close", () => upstream.destroy())
    incoming.pipe(upstream)
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("upgrade", async (incoming, socket, head) => {
    if (!incoming.url?.startsWith(prefix) || (incoming.headers.origin && incoming.headers.origin !== origin)) {
      socket.destroy()
      return
    }
    const endpoint = await options.resolve().catch(() => undefined)
    if (!endpoint || socket.destroyed) { socket.destroy(); return }
    const path = "/" + incoming.url.slice(prefix.length)
    if (!/^\/api\/(?:experimental\/persistent-pty|pty)\//.test(path)) { socket.destroy(); return }
    const target = new URL(path, endpoint.url)
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
    // ticket 原样传递；服务密码仅由 Host 注入，上游请求不携带 Webview Origin。
    const upstream = new WebSocket(target, { headers: { Authorization: "Basic " + Buffer.from("opencode:" + endpoint.password).toString("base64") } })
    connections.add(upstream)
    upstream.on("error", () => socket.destroy())
    upstream.once("open", () => {
      if (socket.destroyed) { upstream.close(); return }
      upgrades.handleUpgrade(incoming, socket, head, (client) => {
        connections.add(client)
        client.on("message", (data, binary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary })
        })
        upstream.on("message", (data, binary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
        })
        client.on("close", () => { connections.delete(client); upstream.close() })
        client.on("error", () => upstream.close())
        upstream.on("close", () => { connections.delete(upstream); client.close() })
      })
    })
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not bind the OpenCode connection adapter.")
  return {
    url: `http://127.0.0.1:${address.port}${prefix.slice(0, -1)}`,
    setOrigin(value: string) { origin = value },
    close() {
      connections.forEach((socket) => socket.terminate())
      sockets.forEach((socket) => socket.destroy())
      upgrades.close()
      server.close()
    },
  }
}
