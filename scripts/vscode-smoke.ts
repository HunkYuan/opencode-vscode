import { chromium } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { createServer } from "node:net"
import esbuild from "esbuild"

const root = resolve(import.meta.dir, "..")
const directory = join(root, "artifacts/vscode-user-api")
await mkdir(directory, { recursive: true })
await mkdir(join(root, "artifacts/vscode-extensions"), { recursive: true })
const portServer = createServer()
await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve))
const address = portServer.address()
if (!address || typeof address === "string") throw new Error("No debug port")
const port = address.port
await new Promise<void>((resolve) => portServer.close(() => resolve()))
await esbuild.build({ entryPoints: [join(root, "scripts/vscode-tests.ts")], outfile: join(root, "artifacts/vscode-tests.cjs"), bundle: true, platform: "node", format: "cjs", external: ["vscode"] })
const child = spawn(process.argv[2] ?? join(root, "artifacts/vscode-1.94/Code.exe"), [
  "--user-data-dir=" + directory,
  "--extensions-dir=" + join(root, "artifacts/vscode-extensions"),
  "--extensionDevelopmentPath=" + root,
  "--extensionTestsPath=" + join(root, "artifacts/vscode-tests.cjs"),
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates",
  "--remote-debugging-port=" + port, "--disable-gpu", "--no-sandbox",
  root,
], { windowsHide: true, env: { ...process.env, OPENCODE_TEST_ROOT: root }, stdio: ["ignore", "ignore", "pipe"], detached: true })
child.unref()
child.stderr?.on("data", (data: Buffer) => {
  const text = data.toString()
  if (/Error|error/.test(text)) console.error(text.slice(0, 800))
})
const url = `http://127.0.0.1:${port}`
await Bun.write(join(root, "artifacts/vscode-smoke-process.json"), JSON.stringify({ pid: child.pid, url }))
for (let attempt = 0; attempt < 100; attempt++) { if (await fetch(url + "/json/version").then((response) => response.ok, () => false)) break; await Bun.sleep(100) }
const browser = await chromium.connectOverCDP(url, { timeout: 30000 })
try {
  for (let attempt = 0; attempt < 100 && !browser.contexts()[0]?.pages().length; attempt++) await Bun.sleep(100)
  const page = browser.contexts()[0]!.pages()[0]!
  page.on("console", (message) => { if (message.type() === "error") console.error("VS Code:", message.text().slice(0, 900)) })
  page.on("pageerror", (error) => console.error("Page:", error.message))
  await page.waitForSelector(".monaco-workbench", { timeout: 30000 })
  await page.waitForSelector('iframe.webview', { timeout: 30000 })
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].some((iframe) => iframe.src.includes("vscode-webview")))
  for (let attempt = 0; attempt < 200; attempt++) { if (page.frames().some((frame) => frame.name() === "active-frame" || frame.name() === "pending-frame")) break; await Bun.sleep(100) }
  console.log("All frames", page.frames().map((frame) => ({name:frame.name(), url:frame.url().slice(0,150)})))
  const content = page.frames().find((frame) => frame.name() === "active-frame" || frame.name() === "pending-frame")
  if (!content) throw new Error("Webview did not create its internal document")
  console.log("Webview content", (await content.locator("body").innerText()).slice(0,1200))
  console.log("CSP", await content.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content").catch(() => "missing"))
  await page.screenshot({ path: join(root, "artifacts/vscode-loading.png") })
  await content.locator('[contenteditable="true"]').waitFor({ timeout: 30000 })
  const frame = page.frames().find((frame) => frame.url().includes("vscode-webview"))!
  console.log("Webview frame", frame?.url().slice(0, 100))
  await page.screenshot({ path: join(root, "artifacts/vscode-window.png") })
  for (const frame of page.frames()) {
    console.log("Frame", frame.url().slice(0, 120))
    if (frame.url().includes("vscode-webview")) {
      console.log("Text", (await frame.locator("body").innerText().catch(() => "")).slice(0, 600))
    }
  }
  await writeFile(join(root, "artifacts/vscode-smoke.txt"), (await page.locator("body").innerText()).slice(0, 8000))
} finally {
  await browser.close()
  child.kill()
}
