import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { expect } from "@playwright/test"
import type { Memento } from "vscode"
import type { ReviewChange } from "../src/protocol"
import type { SessionInboxUser, SessionPromptInput } from "@opencode/client/promise"
import { HOST_PROTOCOL } from "../src/protocol"
import { UiPackages, type UiBundle } from "../src/ui/packages"
import { createUIUpdateFixture } from "./ui-update-fixture"
import { Storage } from "../src/storage"
import { createTransport } from "../src/transport"
import { createAttachmentFixture, verifyEditorAttachment } from "./attachment-fixture"
import { launchBrowser } from "./browser"

const root = resolve(import.meta.dir, "..")
await using fixture = await createAttachmentFixture()
const originalDirectory = join(root, "dist/webview")
await using distribution = await createUIUpdateFixture(originalDirectory)
const original = distribution.original
const updated = distribution.updated
const source = distribution.server
let active: UiBundle = { directory: originalDirectory, manifest: original }
const packages = new UiPackages({ directory: join(fixture.directory, "ui-cache"), builtinDirectory: originalDirectory, hostProtocol: HOST_PROTOCOL, log: console.log })
const transport = await createTransport({ resolve: async () => fixture.endpoint, log: console.warn })
transport.setOrigin(source.url.origin)
const state = new Map<string, unknown>()
const memento: Memento = { keys: () => [...state.keys()], get: <T>(key: string, fallback?: T) => (state.get(key) ?? fallback) as T, update: async (key, value) => { state.set(key, value) } }
const storage = new Storage(memento, join(fixture.directory, "ui-storage"))
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 440, height: 900 } })
const errors: string[] = []
const requests = new Map<string, (value: { working?: boolean; error?: string }) => void>()
let loaded = ""
let route = "/"
let review: ReviewChange[] | undefined
page.on("pageerror", (error) => errors.push(error.message))
await page.exposeFunction("hostMessage", async (input: Record<string, unknown>) => {
  const result = async () => {
    switch (input.method) {
      case "ready":
        assert.equal(input.hostProtocol, HOST_PROTOCOL)
        assert.equal(input.uiId, active.manifest.id)
        return { hostProtocol: HOST_PROTOCOL, uiId: active.manifest.id, service: { status: "ready", url: transport.url, serviceVersion: fixture.endpoint.version, uiVersion: original.upstreamVersion }, directory: fixture.project, route, windowID: "ui-update", locale: "zh", theme: "dark", followTheme: true }
      case "uiReady":
        await packages.loaded(active)
        loaded = String(input.uiId)
        return
      case "storageRead": return storage.read(String(input.name))
      case "storageWrite": return storage.write(String(input.name), input.values as Record<string, string | null>)
      case "draftGet": return storage.draftGet(String(input.key))
      case "draftSet": return storage.draftSet(String(input.key), String(input.value), !!input.strict)
      case "draftRemove": return storage.draftRemove(String(input.key))
      case "blobPut": return storage.putBlob(String(input.data), String(input.mime))
      case "blobGet": return storage.getBlob(String(input.key))
      case "route": route = String(input.route); return
      case "fileExists": return true
      case "review": review = input.changes as ReviewChange[]; return
      case "hostResult": requests.get(String(input.requestID))?.({ working: !!input.working, error: input.error ? String(input.error) : undefined }); return
      case "log": console.log("UI:", input.message); return
    }
  }
  const value = await result()
  await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "result", id: input.id, value })
})
await page.addInitScript(() => Object.assign(window, { acquireVsCodeApi: () => ({ postMessage: (message: unknown) => { void (window as unknown as { hostMessage: (message: unknown) => Promise<void> }).hostMessage(message) } }) }))
async function prepare() {
  const requestID = randomUUID()
  const completion = new Promise<{ working?: boolean; error?: string }>((resolve) => requests.set(requestID, resolve))
  await page.evaluate((requestID) => window.dispatchEvent(new MessageEvent("message", { data: { type: "prepareReload", requestID } })), requestID)
  const result = await completion
  assert.equal(result.error, undefined)
  assert.equal(result.working, false)
  requests.delete(requestID)
}

try {
  await page.goto(source.url.origin, { waitUntil: "domcontentloaded" })
  await expect.poll(() => loaded).toBe(original.id)
  await page.locator('[contenteditable="true"]').waitFor()
  const context = fixture.contexts[0]!.context
  await page.evaluate((context) => window.dispatchEvent(new MessageEvent("message", { data: { type: "context", context } })), context)
  await page.getByText("saved file.cpp", { exact: false }).first().waitFor()
  await page.locator('[contenteditable="true"]').fill("UI 更新前的 GBK 草稿")
  const next = await packages.importPackage(distribution.zip, fixture.endpoint.version)
  assert.equal(next?.manifest.id, updated.id)
  assert.equal(active.manifest.id, original.id)
  await prepare()
  active = await new UiPackages({ directory: join(fixture.directory, "ui-cache"), builtinDirectory: originalDirectory, hostProtocol: HOST_PROTOCOL, log: () => {} }).select(fixture.endpoint.version)
  distribution.use(active.directory)
  loaded = ""
  const agents = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/api/agent") && url.searchParams.get("location[directory]")?.toLowerCase() === fixture.project.toLowerCase() && response.status() === 200
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(() => loaded).toBe(updated.id)
  assert.ok((await (await agents).json() as { data: { id: string }[] }).data.some((agent) => agent.id === "build"))
  await expect(page.locator('[contenteditable="true"]')).toHaveText("UI 更新前的 GBK 草稿")
  await page.getByText("saved file.cpp", { exact: false }).first().waitFor()
  const response = page.waitForResponse(/\/api\/session\/[^/]+\/prompt(?:\?.*)?$/)
  await page.locator('[data-action="composer-submit"]').click()
  const received = await response
  assert.equal(received.status(), 200)
  const admitted = (await received.json() as { data: SessionInboxUser }).data
  const snapshot = verifyEditorAttachment(received.request().postDataJSON() as SessionPromptInput, admitted, context)
  await fixture.waitForModel(snapshot)
  await fixture.api.session.wait({ sessionID: admitted.sessionID })
  const expected: ReviewChange[] = [{ file: "sample.cpp", additions: 1, deletions: 1, patch: "--- a/sample.cpp\n+++ b/sample.cpp\n@@ -1 +1 @@\n-before\n+after\n" }]
  await page.route(/\/api\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => route.fulfill({ json: { data: expected } }))
  const requestID = randomUUID()
  const reviewed = new Promise<{ error?: string }>((resolve) => requests.set(requestID, resolve))
  await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "review", requestID, sessionID: admitted.sessionID })
  assert.equal((await reviewed).error, undefined)
  assert.deepEqual(review, expected)
  await page.locator('[contenteditable="true"]').fill("回退后保留的草稿")
  await prepare()
  active = await packages.rollback(fixture.endpoint.version)
  distribution.use(active.directory)
  loaded = ""
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(() => loaded).toBe(original.id)
  await expect(page.locator('[contenteditable="true"]')).toHaveText("回退后保留的草稿")
  assert.equal((await packages.select(fixture.endpoint.version)).manifest.id, original.id)
  assert.deepEqual(errors, [])
  await Bun.write(join(root, "artifacts/ui-update-smoke.json"), JSON.stringify({ imported: updated.id, applied: true, draftPreserved: true, gbkSent: true, modelReceived: true, sdkReview: true, rolledBack: original.id, directory: fixture.directory }, null, 2))
  console.log("Local UI import, verified reload, draft preservation, GBK send, SDK review and rollback passed")
} catch (error) {
  console.error("UI update failure:", (await page.locator("body").innerText()).slice(-2200))
  await page.screenshot({ path: join(fixture.directory, "ui-update-failure.png") })
  throw error
} finally {
  await browser.close()
  transport.close()
  source.stop(true)
}
