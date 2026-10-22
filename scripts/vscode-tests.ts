import assert from "node:assert/strict"
import { commands, extensions, workspace, window, Uri, ConfigurationTarget } from "vscode"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { captureContext } from "../src/editor"

export async function run() {
  const root = process.env.OPENCODE_TEST_ROOT
  if (!root) throw new Error("OPENCODE_TEST_ROOT must point to the test workspace")
  const extension = extensions.getExtension("opencode-local.opencode-sidebar")
  if (!extension) throw new Error("Development extension not registered")
  await extension.activate()
  const file = process.env.OPENCODE_TEST_FILE
  if (file) await workspace.getConfiguration("files").update("encoding", "gbk", ConfigurationTarget.Workspace)
  const document = await workspace.openTextDocument(Uri.file(join(root, file ?? "src/service.ts")))
  await window.showTextDocument(document)
  const context = captureContext(false)
  if (file) {
    assert.ok(context.content.includes("// 中文\r\n"), "VS Code must decode the saved GBK fixture")
    assert.ok(!context.content.includes("\ufffd"))
    assert.equal(context.dirty, false)
  }
  await commands.executeCommand("opencodeSidebar.open")
  await commands.executeCommand("opencodeSidebar.addFile")
  await writeFile(join(root, "vscode-api.json"), JSON.stringify({ context, activation: "passed", fileCommand: "passed" }, null, 2))
  console.log("Real VS Code activation, GBK decoding and current file command passed")
  // 保留隔离测试窗口，供父脚本检查 Webview 并实际点击发送。
  await new Promise<void>(() => {})
}
