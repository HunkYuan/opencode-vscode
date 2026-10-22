import { chromium } from "@playwright/test"
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createServer } from "node:net"

const root = resolve(import.meta.dir, "..")
const executable = join(root, "artifacts/vscode-1.94/Code.exe")
const extensions = join(root, "artifacts/installed-extensions")
const user = join(root, "artifacts/installed-user")
await mkdir(extensions, { recursive: true })
await mkdir(user, { recursive: true })
await promisify(execFile)(executable, [
 join(root, "artifacts/vscode-1.94/resources/app/out/cli.js"),
 "--user-data-dir=" + user, "--extensions-dir=" + extensions,
 "--install-extension", join(root, "opencode-sidebar-0.1.0.vsix"), "--force",
], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 60000 })
console.log("Installed VSIX into isolated test profile")
const manifest = await Bun.file(join(extensions, "opencode-local.opencode-sidebar-0.1.0/package.json")).json()
if (manifest.version !== "0.1.0") throw new Error("VSIX install manifest mismatch")
const probe = createServer()
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
const address = probe.address()
if (!address || typeof address === "string") throw new Error("No test debug port")
await new Promise<void>((resolve) => probe.close(() => resolve()))
const url = `http://127.0.0.1:${address.port}`
const child = spawn(executable, [
 "--user-data-dir=" + user, "--extensions-dir=" + extensions,
 "--extensionDevelopmentPath=" + join(extensions, "opencode-local.opencode-sidebar-0.1.0"),
 "--extensionTestsPath=" + join(root, "artifacts/vscode-tests.cjs"),
 "--remote-debugging-port=" + address.port, "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-workspace-trust", "--disable-gpu", "--no-sandbox", root,
], { windowsHide: true, env: { ...process.env, OPENCODE_TEST_ROOT: root }, stdio: "ignore", detached: true })
child.unref()
for (let attempt = 0; attempt < 100; attempt++) {
 if (await fetch(url + "/json/version").then((r) => r.ok, () => false)) break
 await Bun.sleep(100)
}
const browser = await chromium.connectOverCDP(url)
try {
 for (let attempt = 0; attempt < 100 && !browser.contexts()[0]?.pages().length; attempt++) await Bun.sleep(100)
 const page = browser.contexts()[0]!.pages()[0]!
 for (let attempt = 0; attempt < 200; attempt++) {
  if (page.frames().some((frame) => frame.name() === "pending-frame" || frame.name() === "active-frame")) break
  await Bun.sleep(100)
 }
 const content = page.frames().find((frame) => frame.name() === "pending-frame" || frame.name() === "active-frame")
 if (!content) throw new Error("Installed Webview did not load")
 await content.locator('[contenteditable="true"]').waitFor({ timeout: 30000 })
 await content.getByText("service.ts", { exact: false }).first().waitFor()
 await page.screenshot({ path: join(root, "artifacts/installed-window.png") })
 await writeFile(join(root, "artifacts/installed-smoke.txt"), "VSIX installed in isolated profile; official Webview rendered and current file command passed\n" + await content.locator("body").innerText())
 console.log("Installed VSIX official UI and editor attachment verified")
} finally {
 await browser.close()
 child.kill()
}
