import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { chromium, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { readFile, mkdir, writeFile, rename } from "node:fs/promises"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import http from "node:http"
import esbuild from "esbuild"
import { HOST_PROTOCOL, type EditorContext, type ReviewChange } from "../src/protocol"
import type { SessionInboxUser, SessionPromptInput } from "@opencode/client/promise"
import { UiPackages } from "../src/ui/packages"
import { locateCli } from "../src/service"
import { createAttachmentFixture, verifyEditorAttachment } from "./attachment-fixture"
import { createUIUpdateFixture } from "./ui-update-fixture"

const root = resolve(import.meta.dir, "..")
await using fixture = await createAttachmentFixture()
await using distribution = await createUIUpdateFixture(join(root, "dist/webview"))
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
const expected: ReviewChange[] = [{ file: "sample.cpp", additions: 1, deletions: 1, patch: "--- a/sample.cpp\n+++ b/sample.cpp\n@@ -1 +1 @@\n-before\n+after\n" }]
const service = http.createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", fixture.endpoint.url)
  if (/\/api\/session\/[^/]+\/diff$/.test(url.pathname)) {
    outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: expected }))
    return
  }
  const upstream = http.request(url, { method: incoming.method, headers: { ...incoming.headers, host: url.host } }, (response) => {
    outgoing.writeHead(response.statusCode ?? 500, response.headers)
    response.pipe(outgoing)
  })
  upstream.on("error", () => outgoing.writeHead(502).end())
  outgoing.on("close", () => upstream.destroy())
  incoming.pipe(upstream)
})
await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve))
const serviceAddress = service.address()
assert.ok(serviceAddress && typeof serviceAddress !== "string")
const serviceURL = `http://127.0.0.1:${serviceAddress.port}`
const executable = await locateCli(process.env.OPENCODE_TEST_CLI_PATH ?? "")
const wrapper = join(fixture.directory, process.platform === "win32" ? "service-cli.exe" : "service-cli")
await Bun.write(join(fixture.directory, "service-cli.ts"), `import { spawn } from "node:child_process"
const args = process.argv.slice(2)
if (args.join(" ") === "service status") { console.log(${JSON.stringify(serviceURL)}); process.exit(0) }
const child = spawn(${JSON.stringify(executable)}, args, { windowsHide: true, env: { ...process.env, ...${JSON.stringify(fixture.environment)} }, stdio: "inherit" })
child.on("exit", code => process.exit(code ?? 1))
`)
const compiled = await Bun.build({ entrypoints: [join(fixture.directory, "service-cli.ts")], compile: { outfile: wrapper } })
assert.equal(compiled.success, true)
const child = spawn(process.argv[2] ?? process.env.OPENCODE_TEST_VSCODE_PATH ?? join(root, "artifacts/vscode-1.94/Code.exe"), [
  "--user-data-dir=" + directory,
  "--extensions-dir=" + join(fixture.directory, "vscode-extensions"),
  "--extensionDevelopmentPath=" + root,
  "--extensionTestsPath=" + join(fixture.directory, "vscode-tests.cjs"),
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates",
  "--remote-debugging-port=" + port, "--disable-gpu", "--no-sandbox",
  fixture.project,
], {
  windowsHide: true,
  env: { ...fixture.environment, OPENCODE_TEST_CLI_PATH: wrapper, OPENCODE_TEST_ROOT: fixture.project, OPENCODE_TEST_FILE: fixture.contexts[0]!.context.path },
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
type CommandResult = { id: string; context?: EditorContext; error?: string; diff?: boolean; contents?: string[]; editor?: string; line?: number }
async function command(name: string): Promise<CommandResult> {
  console.log("VS Code command:", name)
  const id = randomUUID()
  const temporary = join(fixture.project, "command-" + id + ".json")
  await writeFile(temporary, JSON.stringify({ id, command: name, uiPath: distribution.zip }))
  await rename(temporary, join(fixture.project, "vscode-command.json"))
  const result = join(fixture.project, "vscode-command-result.json")
  await expect.poll(async () => {
    const raw = await readFile(result, "utf8").catch(() => undefined)
    return raw ? (JSON.parse(raw) as CommandResult).id : undefined
  }, { timeout: 30_000 }).toBe(id).catch(async (error: unknown) => {
    const page = browser.contexts()[0]!.pages()[0]!
    console.error("VS Code command failure:", (await page.locator("body").innerText()).slice(-2000))
    throw error
  })
  const value = JSON.parse(await readFile(result, "utf8")) as CommandResult
  console.log("VS Code command completed:", name)
  assert.equal(value.error, undefined)
  return value
}
try {
  await expect.poll(() => browser.contexts()[0]?.pages().length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0)
  const page = browser.contexts()[0]!.pages()[0]!
  page.on("pageerror", (error) => console.error("Page:", error.message))
  let agentsReady = false
  page.on("response", async (response) => {
    if (!/\/api\/agent\?/.test(response.url())) return
    const location = new URL(response.url()).searchParams.get("location[directory]")
    if (location?.toLowerCase() !== fixture.project.toLowerCase()) return
    const value = await response.json().catch(() => undefined) as { data: { id: string; mode: string }[] } | undefined
    agentsReady = value?.data.some((agent) => agent.id === "build" && agent.mode === "primary") ?? agentsReady
  })
  page.on("console", (message) => { if (message.type() === "error") console.error("UI console:", message.text().slice(0, 800)) })
  await page.locator(".monaco-workbench").waitFor({ timeout: 30_000 })
  const frame = () => page.frames().find((frame) => frame.name() === "active-frame" || frame.name() === "pending-frame")
  await expect.poll(() => !!frame(), { timeout: 30_000 }).toBe(true)
  await frame()!.locator('[contenteditable="true"]').waitFor({ timeout: 30_000 })
  await frame()!.getByText("saved file.cpp", { exact: false }).first().waitFor({ timeout: 30_000 })
  const report = await Bun.file(join(fixture.project, "vscode-api.json")).json() as { context: EditorContext }
  await expect.poll(() => agentsReady, { timeout: 30_000 }).toBe(true)
  fixture.reply.text = "附件验证完成。\n\n[查看文件](" + pathToFileURL(join(fixture.project, fixture.contexts[0]!.context.path)).href + "#L2)"
  async function send(context: EditorContext, text: string) {
    const content = frame()!
    await content.locator('[contenteditable="true"]').fill(text)
    const response = page.waitForResponse(/\/api\/session\/[^/]+\/prompt(?:\?.*)?$/, { timeout: 30_000 })
    await content.locator('[data-action="composer-submit"]').click()
    const received = await response.catch(async (error: unknown) => {
      console.error("VS Code UI:", await content.locator("body").innerText())
      await page.screenshot({ path: join(fixture.directory, "vscode-failure.png") })
      throw error
    })
    assert.equal(received.status(), 200, await received.text())
    const request = received.request().postDataJSON() as Pick<SessionPromptInput, "id" | "text" | "files">
    const admitted = (await received.json() as { data: SessionInboxUser }).data
    const snapshot = verifyEditorAttachment(request, admitted, context)
    await fixture.waitForModel(snapshot)
    await fixture.api.session.wait({ sessionID: admitted.sessionID }, { signal: AbortSignal.timeout(30_000) })
    await expect(content.locator('[contenteditable="true"]')).toHaveText("")
    return admitted
  }
  const admitted = await send(report.context, "验证 VS Code GBK 当前文件附件")
  await frame()!.getByRole("link", { name: "查看文件", exact: true }).click()
  await expect(page.locator('[id="status.editor.selection"]')).toHaveText(/Ln 2, Col 1/, { timeout: 10_000 })
  assert.equal((await command("editor")).line, 1)
  const reviewed = await command("review")
  assert.equal(reviewed.diff, true)
  assert.ok(reviewed.contents?.includes("before\n"))
  assert.ok(reviewed.contents?.includes("after\n"))
  const selection = (await command("addSelection")).context!
  assert.equal(selection.dirty, true)
  await frame()!.locator('[data-component="composer-attachments"]').getByText("saved file.cpp", { exact: false }).first().waitFor()
  await send(selection, "验证 VS Code 未保存选区")

  const packages = new UiPackages({
    directory: join(directory, "User/globalStorage/opencode-local.opencode-sidebar/ui"),
    builtinDirectory: join(root, "dist/webview"),
    hostProtocol: HOST_PROTOCOL,
    log: console.log,
  })
  await expect.poll(async () => {
    const state = Bun.file(join(directory, "User/globalStorage/opencode-local.opencode-sidebar/ui/state.json"))
    return await state.exists() ? (await state.json() as { lastGood?: string }).lastGood : undefined
  }).toBe(distribution.original.id)
  await command("import")
  assert.equal((await packages.pending())?.manifest.id, distribution.updated.id)
  await frame()!.locator('[contenteditable="true"]').fill("真实 VS Code 更新前草稿")
  agentsReady = false
  await command("apply")
  await expect.poll(async () => {
    const state = Bun.file(join(directory, "User/globalStorage/opencode-local.opencode-sidebar/ui/state.json"))
    return (await state.json() as { lastGood?: string }).lastGood
  }, { timeout: 30_000 }).toBe(distribution.updated.id)
  await expect(frame()!.locator('[contenteditable="true"]')).toHaveText("真实 VS Code 更新前草稿")
  await expect.poll(() => agentsReady, { timeout: 30_000 }).toBe(true)
  const updatedContext = (await command("addFile")).context!
  await frame()!.locator('[data-component="composer-attachments"]').getByText("saved file.cpp", { exact: false }).first().waitFor()
  await send(updatedContext, "验证更新后的 UI 仍能发送")
  await frame()!.locator('[contenteditable="true"]').fill("真实 VS Code 回退前草稿")
  agentsReady = false
  await command("rollback")
  await expect.poll(async () => {
    const state = Bun.file(join(directory, "User/globalStorage/opencode-local.opencode-sidebar/ui/state.json"))
    return (await state.json() as { lastGood?: string }).lastGood
  }, { timeout: 30_000 }).toBe(distribution.original.id)
  await expect(frame()!.locator('[contenteditable="true"]')).toHaveText("真实 VS Code 回退前草稿")
  await expect.poll(() => agentsReady, { timeout: 30_000 }).toBe(true)
  const rolledBackContext = (await command("addFile")).context!
  await frame()!.locator('[data-component="composer-attachments"]').getByText("saved file.cpp", { exact: false }).first().waitFor()
  await send(rolledBackContext, "验证回退后的 UI 仍能发送")
  assert.deepEqual(await readFile(join(fixture.project, fixture.contexts[0]!.context.path)), fixture.raw, "saved GBK source must retain its original bytes")
  await page.screenshot({ path: join(fixture.directory, "vscode-sent.png") })
  await Bun.write(join(root, "artifacts/vscode-smoke.json"), JSON.stringify({
    directory: fixture.directory,
    version: "0.3.0",
    editorDecodedGBK: true,
    unsavedSelection: true,
    fileJump: true,
    nativeDiff: true,
    sourceUnchanged: true,
    serviceMime: admitted.payload.files![0]!.mime,
    modelReceived: true,
    uiApplied: distribution.updated.id,
    uiRolledBack: distribution.original.id,
    draftPreserved: true,
  }, null, 2))
  console.log("Real VS Code verified GBK/selection sends, file links, native diff, local UI import, application and rollback with preserved drafts")
} finally {
  await browser.close()
  child.kill()
  service.closeAllConnections()
  service.close()
}
