import { commands, extensions, workspace, Uri } from "vscode"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
export async function run() {
  const root = process.env.OPENCODE_TEST_ROOT
  if (!root) throw new Error("OPENCODE_TEST_ROOT must point to the test workspace")
  const extension = extensions.getExtension("opencode-local.opencode-sidebar")
  if (!extension) throw new Error("Development extension not registered")
  await extension.activate()
  const document = await workspace.openTextDocument(Uri.file(join(root, "src/service.ts")))
  await commands.executeCommand("vscode.open", document.uri)
  await commands.executeCommand("opencodeSidebar.open")
  await commands.executeCommand("opencodeSidebar.addFile")
  await writeFile(join(root, "artifacts/vscode-api.txt"), "Real VS Code extension activation, sidebar command and editor file command passed\n")
  console.log("Extension API commands passed")
  // 保留窗口供 CDP 检查 Webview，测试文件不属于 VSIX。
  await new Promise<void>(() => {})
}
