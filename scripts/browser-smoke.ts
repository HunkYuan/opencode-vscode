import { launchBrowser } from "./browser"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { join, resolve, extname } from "node:path"
import { LocalService } from "../src/service"
import { createTransport } from "../src/transport"

const root = resolve(import.meta.dir, "..")
const ui = await Bun.file(join(process.env.OPENCODE_TEST_WEBVIEW ?? join(root, "dist/webview"), "ui-manifest.json")).json()
await mkdir(join(root, "artifacts"), { recursive: true })
const service = new LocalService({ cliPath: () => "", autoStart: () => false, log: (message) => console.log(message) })
const endpoint = await service.connect()
const transport = await createTransport({ resolve: async () => endpoint, log: console.warn })
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf" }
const http = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  const file = join(root, "dist/webview", path === "/" ? "index.html" : path)
  const bytes = await readFile(file).catch(() => undefined)
  if (!bytes) { response.writeHead(404).end(); return }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(bytes)
})
await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
const address = http.address()
if (!address || typeof address === "string") throw new Error("No browser test address")
const origin = `http://127.0.0.1:${address.port}`
transport.setOrigin(origin)
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const errors: string[] = []
page.on("pageerror", (error) => { errors.push(error.message); console.error("Page error:", error.message) })
page.on("console", (message) => { if (message.type() === "error") console.error("Browser:", message.text()) })
const data = new Map<string, Record<string, string>>()
await page.exposeFunction("hostMessage", async (input: Record<string, unknown>) => {
  const result = async () => {
    if (input.method === "ready") return { hostProtocol: 1, uiId: ui.id, service: { status: "ready", url: transport.url, serviceVersion: endpoint.version, uiVersion: "2.1.2" }, directory: root, route: "/", windowID: "browser-smoke", locale: "zh", theme: "dark", followTheme: true }
    if (input.method === "storageRead") return data.get(String(input.name)) ?? {}
    if (input.method === "storageWrite") {
      const values = { ...data.get(String(input.name)), ...input.values as Record<string, string> }
      data.set(String(input.name), values)
      return
    }
    if (input.method === "draftGet") return null
    if (input.method === "draftSet") return []
    if (input.method === "reconnect") return { status: "ready", url: transport.url, serviceVersion: endpoint.version, uiVersion: "2.1.2" }
  }
  const value = await result()
  await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "result", id: input.id, value })
})
await page.addInitScript(() => {
  Object.assign(window, { acquireVsCodeApi: () => ({ postMessage: (message: unknown) => { void (window as unknown as { hostMessage: (message: unknown) => Promise<void> }).hostMessage(message) } }) })
})
try {
  await page.goto(origin, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('[contenteditable="true"]', { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.screenshot({ path: join(root, "artifacts/sidebar-narrow.png") })
  const body = await page.locator("body").innerText()
  await writeFile(join(root, "artifacts/browser-smoke.txt"), body + "\nErrors:\n" + errors.join("\n"))
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.screenshot({ path: join(root, "artifacts/sidebar-wide.png") })
  if (errors.length) throw new Error(errors.join("\n"))
  console.log("Official UI rendered at narrow and wide viewport sizes")
} finally {
  await browser.close()
  transport.close()
  http.closeAllConnections()
  http.close()
}
