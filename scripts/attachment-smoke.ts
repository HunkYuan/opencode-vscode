import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join, resolve, extname } from "node:path"
import { expect } from "@playwright/test"
import type { Memento } from "vscode"
import type { SessionInboxUser, SessionPromptInput } from "@opencode/client/promise"
import { launchBrowser } from "./browser"
import { createAttachmentFixture, verifyEditorAttachment } from "./attachment-fixture"
import { createTransport } from "../src/transport"
import { Storage } from "../src/storage"

const root = resolve(import.meta.dir, "..")
const webview = process.env.OPENCODE_TEST_WEBVIEW ?? join(root, "dist/webview")
await using fixture = await createAttachmentFixture()
const transport = await createTransport({ resolve: async () => fixture.endpoint, log: console.warn })
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".wasm": "application/wasm" }
const http = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const file = Bun.file(join(webview, path === "/" ? "index.html" : path))
    if (!await file.exists()) return new Response(null, { status: 404 })
    return new Response(file, { headers: { "content-type": types[extname(path === "/" ? "index.html" : path)] ?? "application/octet-stream" } })
  },
})
const origin = http.url.origin
transport.setOrigin(origin)
const state = new Map<string, unknown>()
const memento: Memento = {
  keys: () => [...state.keys()],
  get: <T>(key: string, fallback?: T) => (state.get(key) ?? fallback) as T,
  update: async (key, value) => { state.set(key, value) },
}
const storage = new Storage(memento, join(fixture.directory, "ui-storage"))
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 440, height: 900 } })
const errors: string[] = []
let route = "/"
const drafts = new Map<string, string>()
page.on("pageerror", (error) => { errors.push(error.message); console.error("Page:", error.message) })
page.on("console", (message) => { if (message.type() === "error") console.error("Console:", message.text().slice(0, 1000)) })
await page.exposeFunction("hostMessage", async (input: Record<string, unknown>) => {
  const result = async () => {
    switch (input.method) {
      case "ready": return { service: { status: "ready", url: transport.url, serviceVersion: fixture.endpoint.version, uiVersion: "2.1.2" }, directory: fixture.project, route, windowID: "attachment-test", locale: "zh", theme: "dark", followTheme: true }
      case "storageRead": return storage.read(String(input.name))
      case "storageWrite": return storage.write(String(input.name), input.values as Record<string, string | null>)
      case "draftGet": return storage.draftGet(String(input.key))
      case "draftSet": {
        const missing = await storage.draftSet(String(input.key), String(input.value), !!input.strict)
        if (!missing.length) drafts.set(String(input.key), String(input.value))
        return missing
      }
      case "draftRemove": return storage.draftRemove(String(input.key))
      case "blobPut": return storage.putBlob(String(input.data), String(input.mime))
      case "blobGet": return storage.getBlob(String(input.key))
      case "route": route = String(input.route); return
      case "fileExists": return true
      case "log": console.log("UI:", input.message); return
    }
  }
  const value = await result()
  await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "result", id: input.id, value })
})
await page.addInitScript(() => Object.assign(window, {
  acquireVsCodeApi: () => ({ postMessage: (message: unknown) => { void (window as unknown as { hostMessage: (message: unknown) => Promise<void> }).hostMessage(message) } }),
}))

try {
  await page.goto(origin, { waitUntil: "domcontentloaded" })
  await page.locator('[contenteditable="true"]').waitFor({ timeout: 30_000 })
  const results: { label: string; mime: string; bytes: number; modelReceived: boolean }[] = []
  for (const item of fixture.contexts) {
    await page.evaluate((context) => window.dispatchEvent(new MessageEvent("message", { data: { type: "context", context } })), item.context)
    const filename = item.context.path.split("/").at(-1)!
    await page.getByText(filename, { exact: false }).first().waitFor()
    await page.locator('[contenteditable="true"]').fill("验证附件 " + item.label)
    if (item.label === "saved-gbk") {
      // 草稿须确实引用已落盘的 Blob；重载后再点击发送，覆盖此前仅检查附件卡片的缺口。
      await expect.poll(() => [...drafts.values()].some((value) => value.includes("saved-gbk") && value.includes("saved file.cpp")), { timeout: 10_000 }).toBe(true)
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.getByText(filename, { exact: false }).first().waitFor()
      await expect(page.locator('[contenteditable="true"]')).toHaveText("验证附件 saved-gbk")
    }
    const response = page.waitForResponse(/\/api\/session\/[^/]+\/prompt(?:\?.*)?$/, { timeout: 30_000 })
    await page.locator('[data-action="composer-submit"]').click()
    const received = await response
    assert.equal(received.status(), 200, await received.text())
    const request = received.request().postDataJSON() as Pick<SessionPromptInput, "id" | "text" | "files">
    const body = await received.json() as { data: SessionInboxUser }
    const admitted = body.data
    const snapshot = verifyEditorAttachment(request, admitted, item.context)
    await fixture.waitForModel(snapshot)
    await fixture.api.session.wait({ sessionID: admitted.sessionID }, { signal: AbortSignal.timeout(30_000) })
    await expect(page.locator('[contenteditable="true"]')).toHaveText("")
    results.push({ label: item.label, mime: admitted.payload.files![0]!.mime, bytes: Buffer.byteLength(snapshot), modelReceived: true })
    console.log("Attachment passed:", item.label)
  }
  assert.deepEqual(await readFile(join(fixture.project, fixture.contexts[0]!.context.path)), fixture.raw, "GBK source bytes must remain unchanged")
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(fixture.directory, "attachments-sent.png") })
  await Bun.write(join(root, "artifacts/attachment-smoke.json"), JSON.stringify({ directory: fixture.directory, results, sourceUnchanged: true }, null, 2))
  console.log("Official UI send, draft reload, service attachments and model input passed")
} catch (error) {
  await page.screenshot({ path: join(fixture.directory, "failure.png") })
  console.error("Failed UI:", (await page.locator("body").innerText()).slice(-2500))
  console.error("Provider request count:", fixture.requests.length)
  throw error
} finally {
  await browser.close()
  transport.close()
  http.stop(true)
}
