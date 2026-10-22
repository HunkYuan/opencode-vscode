import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import { once } from "node:events"
import { createTransport } from "../src/transport"

test("loopback adapter preserves requests, SSE cancellation and binary sockets while keeping service auth in Host", async () => {
  const auth = "Basic " + Buffer.from("opencode:private-test-password").toString("base64")
  const requests: { url?: string; method?: string; origin?: string; authorization?: string; body: string }[] = []
  let closed: (() => void) | undefined
  const upstream = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    requests.push({ url: incoming.url, method: incoming.method, origin: incoming.headers.origin, authorization: incoming.headers.authorization, body: Buffer.concat(chunks).toString() })
    if (incoming.url === "/api/event") {
      outgoing.writeHead(200, { "content-type": "text/event-stream" })
      outgoing.write('data: {"type":"server.connected"}\n\n')
      outgoing.on("close", () => closed?.())
      return
    }
    outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }))
  })
  const upstreamSockets = new WebSocketServer({ server: upstream })
  upstreamSockets.on("connection", (socket, incoming) => {
    expect(incoming.headers.origin).toBeUndefined()
    expect(incoming.headers.authorization).toBe(auth)
    socket.on("message", (bytes, binary) => socket.send(bytes, { binary }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const address = upstream.address()
  if (!address || typeof address === "string") throw new Error("No upstream address")
  const proxy = await createTransport({ resolve: async () => ({ url: `http://127.0.0.1:${address.port}`, password: "private-test-password", version: "test" }), log: () => {} })
  const origin = "vscode-webview://test"
  proxy.setOrigin(origin)
  try {
    const result = await fetch(proxy.url + "/api/session?search=a%20b", {
      method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: '{"text":"你好"}',
    })
    expect(await result.json()).toEqual({ ok: true })
    expect(result.headers.get("access-control-allow-origin")).toBe(origin)
    expect(requests[0]).toEqual({ url: "/api/session?search=a%20b", method: "POST", origin: undefined, authorization: auth, body: '{"text":"你好"}' })
    expect((await fetch(proxy.url + "/api/info", { headers: { Origin: "https://wrong.example" } })).status).toBe(403)
    expect((await fetch(proxy.url.replace(/\/[^/]+$/, "/wrong") + "/api/info")).status).toBe(404)
    const aborted = new Promise<void>((resolve) => { closed = resolve })
    const controller = new AbortController()
    const events = await fetch(proxy.url + "/api/event", { headers: { Origin: origin }, signal: controller.signal })
    const reader = events.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("server.connected")
    controller.abort()
    await aborted
    const websocket = new WebSocket(proxy.url.replace("http:", "ws:") + "/api/pty/test/connect?ticket=test", { origin })
    await once(websocket, "open")
    websocket.send(Buffer.from([0, 255, 42]))
    const [data, binary] = await once(websocket, "message")
    expect(Buffer.from(data)).toEqual(Buffer.from([0, 255, 42]))
    expect(binary).toBe(true)
    websocket.close()
    await once(websocket, "close")
  } finally {
    proxy.close()
    upstreamSockets.clients.forEach((client) => client.terminate())
    upstreamSockets.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
