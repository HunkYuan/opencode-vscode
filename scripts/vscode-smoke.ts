import assert from "node:assert/strict"
import { chromium, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { readFile, mkdir } from "node:fs/promises"
import { resolve, join } from "node:path"
import esbuild from "esbuild"
import type { EditorContext } from "../src/protocol"
import type { SessionInboxUser, SessionPromptInput } from "@opencode/client/promise"
import { createAttachmentFixture, verifyEditorAttachment } from "./attachment-fixture"

const root = resolve(import.meta.dir, "..")
await using fixture = await createAttachmentFixture()
const directory = join(fixture.directory, "vscode-user")
await mkdir(directory, { recursive: true })
await mkdir(join(fixture.directory, "vscode-extensions"), { recursive: true })
const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = probe.port
probe.stop(true)
await esbuild.build({
  entryPoints: [join(root, "scripts/vscode-tests.ts")],
  outfile: join(fixture.directory, "vscode-tests.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
})
const child = spawn(process.argv[2] ?? join(root, "artifacts/vscode-1.94/Code.exe"), [
  "--user-data-dir=" + directory,
  "--extensions-dir=" + join(fixture.directory, "vscode-extensions"),
  "--extensionDevelopmentPath=" + root,
  "--extensionTestsPath=" + join(fixture.directory, "vscode-tests.cjs"),
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates",
  "--remote-debugging-port=" + port, "--disable-gpu", "--no-sandbox",
  fixture.project,
], {
  windowsHide: true,
  env: { ...fixture.environment, OPENCODE_TEST_ROOT: fixture.project, OPENCODE_TEST_FILE: fixture.contexts[0]!.context.path },
  stdio: ["ignore", "ignore", "pipe"],
})
child.stderr?.on("data", (data: Buffer) => {
  const text = data.toString()
  if (/Error|error/.test(text)) console.error(text.slice(0, 800))
})
const url = `http://127.0.0.1:${port}`
await Bun.write(join(root, "artifacts/vscode-smoke-process.json"), JSON.stringify({ pid: child.pid, url }))
await expect.poll(() => fetch(url + "/json/version").then((response) => response.ok, () => false), { timeout: 30_000 }).toBe(true)
const browser = await chromium.connectOverCDP(url, { timeout: 30_000 })
try {
  await expect.poll(() => browser.contexts()[0]?.pages().length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0)
  const page = browser.contexts()[0]!.pages()[0]!
  page.on("pageerror", (error) => console.error("Page:", error.message))
  await page.locator(".monaco-workbench").waitFor({ timeout: 30_000 })
  await expect.poll(() => page.frames().some((frame) => frame.name() === "active-frame" || frame.name() === "pending-frame"), { timeout: 30_000 }).toBe(true)
  const content = page.frames().find((frame) => frame.name() === "active-frame" || frame.name() === "pending-frame")!
  await content.locator('[contenteditable="true"]').waitFor({ timeout: 30_000 })
  await content.getByText("saved file.cpp", { exact: false }).first().waitFor({ timeout: 30_000 })
  const report = await Bun.file(join(fixture.project, "vscode-api.json")).json() as { context: EditorContext }
  await content.locator('[contenteditable="true"]').fill("验证 VS Code GBK 当前文件附件")
  const response = page.waitForResponse(/\/api\/session\/[^/]+\/prompt(?:\?.*)?$/, { timeout: 30_000 })
  await content.locator('[data-action="composer-submit"]').click()
  const received = await response
  assert.equal(received.status(), 200, await received.text())
  const request = received.request().postDataJSON() as Pick<SessionPromptInput, "id" | "text" | "files">
  const admitted = (await received.json() as { data: SessionInboxUser }).data
  const snapshot = verifyEditorAttachment(request, admitted, report.context)
  await fixture.waitForModel(snapshot)
  await fixture.api.session.wait({ sessionID: admitted.sessionID }, { signal: AbortSignal.timeout(30_000) })
  assert.deepEqual(await readFile(join(fixture.project, fixture.contexts[0]!.context.path)), fixture.raw, "saved GBK source must retain its original bytes")
  await page.screenshot({ path: join(fixture.directory, "vscode-sent.png") })
  await Bun.write(join(root, "artifacts/vscode-smoke.json"), JSON.stringify({
    directory: fixture.directory,
    version: "0.1.1",
    editorDecodedGBK: true,
    sourceUnchanged: true,
    requestHasTextAttachment: true,
    serviceMime: admitted.payload.files![0]!.mime,
    modelReceived: true,
  }, null, 2))
  console.log("Real VS Code verified GBK editor capture, current file command, Send, service attachment and model input")
} finally {
  await browser.close()
  child.kill()
}
