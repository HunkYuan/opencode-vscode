import { launchBrowser } from "./browser"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { join, resolve, extname } from "node:path"
import { LocalService } from "../src/service"
import { createTransport } from "../src/transport"
import { Storage } from "../src/storage"
import type { Memento } from "vscode"

const root = resolve(import.meta.dir, "..")
const ui = await Bun.file(join(process.env.OPENCODE_TEST_WEBVIEW ?? join(root, "dist/webview"), "ui-manifest.json")).json()
await mkdir(join(root, "artifacts"), { recursive: true })
const service = new LocalService({ cliPath: () => "", autoStart: () => false, log: console.log })
const endpoint = await service.connect()
const transport = await createTransport({ resolve: async () => endpoint, log: console.warn })
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf" }
const http = createServer(async (incoming, response) => {
 const path = new URL(incoming.url ?? "/", "http://localhost").pathname
 const file = join(root, "dist/webview", path === "/" ? "index.html" : path)
 const bytes = await readFile(file).catch(() => undefined)
 if (!bytes) { response.writeHead(404).end(); return }
 response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(bytes)
})
await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
const address = http.address()
if (!address || typeof address === "string") throw new Error("No test address")
const origin = `http://127.0.0.1:${address.port}`
transport.setOrigin(origin)
const state = new Map<string, unknown>()
const memento: Memento = { keys: () => [...state.keys()], get: <T>(key: string, value?: T) => (state.get(key) ?? value) as T, update: async (key, value) => { state.set(key, value) } }
const storage = new Storage(memento, join(root, "artifacts/interaction-storage"))
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 400, height: 850 } })
const errors: string[] = []
let editorReady: (() => void) | undefined
let route = "/"
page.on("pageerror", (error) => errors.push(error.message))
await page.exposeFunction("hostMessage", async (input: Record<string, unknown>) => {
 const result = async () => {
   switch (input.method) {
     case "ready": return { hostProtocol: 1, uiId: ui.id, service: { status: "ready", url: transport.url, serviceVersion: endpoint.version, uiVersion: "2.1.2" }, directory: root, route, windowID: "interaction", locale: "zh", theme: "dark", followTheme: true }
     case "storageRead": return storage.read(String(input.name))
     case "storageWrite": return storage.write(String(input.name), input.values as Record<string, string | null>)
     case "draftGet": return storage.draftGet(String(input.key))
     case "draftSet": return storage.draftSet(String(input.key), String(input.value), !!input.strict)
     case "draftRemove": return storage.draftRemove(String(input.key))
     case "blobPut": return storage.putBlob(String(input.data), String(input.mime))
     case "blobGet": return storage.getBlob(String(input.key))
     case "route": route = String(input.route); return
     case "editorReady": if (input.ready) editorReady?.(); return
     case "fileExists": return true
     case "reconnect": return { status: "ready", url: transport.url, serviceVersion: endpoint.version, uiVersion: "2.1.2" }
     case "log": console.log("UI log", input.message); return
   }
 }
 const value = await result()
 await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "result", id: input.id, value })
})
await page.addInitScript(() => Object.assign(window, {
 acquireVsCodeApi: () => ({ postMessage: (message: unknown) => { void (window as unknown as { hostMessage: (message: unknown) => Promise<void> }).hostMessage(message) } }),
}))
try {
 const ready = new Promise<void>((resolve) => { editorReady = resolve })
 await page.goto(origin, { waitUntil: "domcontentloaded" })
 await ready
 const context = { type: "context", context: { directory: root, path: "src/service.ts", dirty: true, content: 'const selectedValue = "测试选区";', selection: { startLine: 1, startChar: 0, endLine: 1, endChar: 35 } } }
 await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), context)
 await page.getByText('service.ts', { exact: false }).first().waitFor()
 await page.locator('[contenteditable="true"]').fill("这是一条未发送的测试草稿")
 await page.screenshot({ path: join(root, "artifacts/context-attached.png") })
 await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.includes("未发送的测试草稿"))
 // 等待 Host 的真实草稿文件已写入，而不是依赖固定延时。
 for (let attempt = 0; attempt < 100; attempt++) {
   const documents = [...new Bun.Glob("artifacts/interaction-storage/drafts/*").scanSync({ cwd: root })]
   if ((await Promise.all(documents.map((file) => Bun.file(join(root, file)).text()))).some((value) => value.includes("未发送的测试草稿"))) break
   await Bun.sleep(20)
 }
 await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "service", service: { status: "error", message: "test disconnection", uiVersion: "2.1.2" } } })))
 await page.getByText("test disconnection", { exact: true }).waitFor()
 await page.evaluate((url) => window.dispatchEvent(new MessageEvent("message", { data: { type: "service", service: { status: "ready", url, uiVersion: "2.1.2", serviceVersion: "2.1.2" } } })), transport.url)
 await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.includes("未发送的测试草稿"))
 const reloaded = new Promise<void>((resolve) => { editorReady = resolve })
 await page.reload({ waitUntil: "domcontentloaded" })
 await reloaded
 await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.includes("未发送的测试草稿"))
 await page.getByText("service.ts", { exact: false }).first().waitFor()
 await page.screenshot({ path: join(root, "artifacts/context-restored.png") })
 await writeFile(join(root, "artifacts/interaction-smoke.txt"), "Editor selection attachment and draft restoration passed\n" + errors.join("\n"))
 if (errors.length) throw new Error(errors.join("\n"))
 console.log("Official Composer accepted unsaved selection and restored draft plus context after reload")
} finally {
 await browser.close()
 transport.close()
 http.closeAllConnections()
 http.close()
}
