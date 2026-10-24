import { launchBrowser } from "./browser"
import { createServer } from "node:http"
import net from "node:net"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve, extname } from "node:path"
import { OpenCode, type JsonValue } from "@opencode/client/promise"
import { locateCli } from "../src/service"
import { createTransport } from "../src/transport"

const root = resolve(import.meta.dir, "..")
const ui = await Bun.file(join(process.env.OPENCODE_TEST_WEBVIEW ?? join(root, "dist/webview"), "ui-manifest.json")).json()
const isolated = await mkdtemp(join(root, "artifacts/session-test-"))
const environment = { ...process.env, XDG_CONFIG_HOME: join(isolated, "config"), XDG_DATA_HOME: join(isolated, "data"), XDG_CACHE_HOME: join(isolated, "cache"), XDG_STATE_HOME: join(isolated, "state") }
const probe = net.createServer()
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
const address = probe.address()
if (!address || typeof address === "string") throw new Error("No test port")
await new Promise<void>((resolve) => probe.close(() => resolve()))
const executable = await locateCli(process.env.OPENCODE_TEST_CLI_PATH ?? "")
const execute = promisify(execFile)
const command = async (...args: string[]) => (await execute(executable, args, { env: environment, windowsHide: true, timeout: 130000 })).stdout.trim()
await mkdir(join(environment.XDG_CONFIG_HOME, "opencode"), { recursive: true })
await writeFile(join(environment.XDG_CONFIG_HOME, "opencode/service.json"), JSON.stringify({ port: address.port }))
const url = await command("service", "start")
const password = await command("service", "get", "password")
const api = OpenCode.make({ baseUrl: url, headers: { Authorization: "Basic " + Buffer.from("opencode:" + password).toString("base64") } })
const transport = await createTransport({ resolve: async () => ({ url, password, version: "2.1.2" }), log: console.warn })
const http = createServer(async (request, response) => {
 const path = new URL(request.url ?? "/", "http://localhost").pathname
 const file = join(root, "dist/webview", path === "/" ? "index.html" : path)
 const bytes = await readFile(file).catch(() => undefined)
 const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".wasm": "application/wasm" }
 if (!bytes) { response.writeHead(404).end(); return }
 response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(bytes)
})
await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
const httpAddress = http.address()
if (!httpAddress || typeof httpAddress === "string") throw new Error("No browser port")
const origin = `http://127.0.0.1:${httpAddress.port}`
transport.setOrigin(origin)
const browser = await launchBrowser()
try {
 const info = await api.session.create({ location: { directory: root }, title: "VS Code fixture verification", agent: "build", model: { providerID: "fixture", id: "fixture" }, permissions: [{ action: "*", resource: "*", effect: "ask" }] })
 const now = Date.now()
 const messages: JsonValue[] = [
  { id: "msg_fixture_user", type: "user" as const, time: { created: now }, text: "检查下面的示例文件，展示执行过程。" },
  { id: "msg_fixture_assistant", type: "assistant" as const, agent: "build", model: { providerID: "fixture", id: "fixture" }, time: { created: now + 1, completed: now + 2 }, finish: "stop" as const, content: [
    { type: "reasoning" as const, text: "读取示例并验证边界条件。" },
    { type: "tool" as const, id: "tool_fixture", name: "read", time: { created: now + 1, completed: now + 2 }, state: { status: "completed" as const, input: { filePath: join(root, "src/service.ts") }, metadata: { title: "src/service.ts" }, content: [{ type: "text" as const, text: 'const example = "fixture";' }] } },
    { type: "text" as const, text: "验证完成。\n\n```typescript\nconst example = 42\n```\n\n可以打开 [service.ts](src/service.ts:1) 查看代码。" },
  ] },
  { id: "msg_fixture_idle", type: "idle" as const, outcome: "succeeded" as const, time: { created: now + 3 } },
 ]
 const imported = await api.session.import({ info: { ...info, id: "ses_fixture_" + crypto.randomUUID() }, messages })
 const route = "/server/" + Buffer.from("sidecar").toString("base64url") + "/session/" + imported.id
 const page = await browser.newPage({ viewport: { width: 440, height: 900 } })
 const errors: string[] = []
 page.on("pageerror", (error) => { errors.push(error.message); console.error("Page:", error.message) })
 page.on("console", (message) => { if (message.type() === "error") console.error(message.text().slice(0, 500)) })
 const storage = new Map<string, Record<string, string>>()
 await page.exposeFunction("hostMessage", async (input: Record<string, unknown>) => {
  const result = () => {
   if (input.method === "ready") return { hostProtocol: 1, uiId: ui.id, service: { status: "ready", url: transport.url, serviceVersion: "2.1.2", uiVersion: "2.1.2" }, route, directory: root, windowID: "session-test", locale: "zh", theme: "dark", followTheme: true }
   if (input.method === "storageRead") return storage.get(String(input.name)) ?? {}
   if (input.method === "storageWrite") { storage.set(String(input.name), { ...storage.get(String(input.name)), ...input.values as Record<string, string> }); return }
   if (input.method === "draftGet") return null
   if (input.method === "draftSet") return []
   if (input.method === "fileExists") return true
   if (input.method === "log") console.log("UI:", input.message)
  }
  await page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "result", id: input.id, value: result() })
 })
 await page.addInitScript(() => Object.assign(window, { acquireVsCodeApi: () => ({ postMessage: (message: unknown) => { void (window as unknown as { hostMessage: (message: unknown) => Promise<void> }).hostMessage(message) } }) }))
 await page.goto(origin, { waitUntil: "domcontentloaded" })
 await page.getByText("验证完成。", { exact: false }).first().waitFor({ timeout: 30000 })
 await page.locator("code").filter({ hasText: "example" }).first().waitFor()
 await page.screenshot({ path: join(root, "artifacts/session-fixture.png") })
 const permission = api.permission.create({ sessionID: imported.id, id: "per_fixture_ui", action: "tool.shell", resources: ["echo fixture"], metadata: { command: "echo fixture" } })
 await page.getByText("echo fixture", { exact: false }).first().waitFor()
 await page.screenshot({ path: join(root, "artifacts/permission-fixture.png") })
 const buttons = await page.getByRole("button").allTextContents()
 console.log("Permission actions", buttons.join(" | "))
 await page.getByRole("button", { name: "允许一次", exact: true }).click()
 await permission
 console.log("Permission reply completed")
 const form = await api.session.form.create({ sessionID: imported.id, id: "frm_fixture_ui", title: "选择测试选项", metadata: { kind: "question" }, fields: [{ key: "choice", title: "继续执行方式", type: "string", required: true, options: [{ value: "continue", label: "继续" }, { value: "stop", label: "停止" }] }] })
 console.log("Form created", form.id)
 await page.screenshot({ path: join(root, "artifacts/form-before.png") })
 console.log("Form page", (await page.locator("body").innerText()).slice(-2000))
 await page.getByText("继续执行方式", { exact: false }).first().waitFor({ timeout: 10000 })
 await page.screenshot({ path: join(root, "artifacts/form-fixture.png") })
 await api.session.form.reply({ sessionID: imported.id, formID: form.id, answer: { choice: "continue" } })
 await writeFile(join(root, "artifacts/session-smoke.txt"), "Official session transcript, Markdown code worker, tool, permission and form UI passed\n" + errors.join("\n"))
 if (errors.length) throw new Error(errors.join("\n"))
 console.log("Real isolated service verified transcript, Markdown, tool, permission and form UI")
} finally {
 await browser.close()
 transport.close()
 http.closeAllConnections()
 http.close()
 await command("service", "stop").catch(() => undefined)
}
