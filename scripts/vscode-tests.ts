import assert from "node:assert/strict"
import { commands, extensions, workspace, window, Uri, ConfigurationTarget, Selection } from "vscode"
import { watch } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { captureContext } from "../src/editor"

export async function run() {
  const root = process.env.OPENCODE_TEST_ROOT
  if (!root) throw new Error("OPENCODE_TEST_ROOT must point to the test workspace")
  const extension = extensions.getExtension("opencode-local.opencode-sidebar")
  if (!extension) throw new Error("Development extension not registered")
  if (process.env.OPENCODE_TEST_CLI_PATH)
    await workspace.getConfiguration("opencodeSidebar").update("cliPath", process.env.OPENCODE_TEST_CLI_PATH, ConfigurationTarget.Workspace)
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

  let input = Promise.resolve()
  const watcher = watch(root, (_event, name) => {
    if (name !== "vscode-command.json") return
    input = input.then(async () => {
      const request = JSON.parse(await readFile(join(root, "vscode-command.json"), "utf8")) as { id: string; command: string }
      if (request.id === completed) return
      completed = request.id
      const perform = async () => {
        if (request.command === "addFile") {
          await window.showTextDocument(document)
          const context = captureContext(false)
          await commands.executeCommand("opencodeSidebar.addFile")
          return { context }
        }
        if (request.command === "addSelection") {
          const editor = await window.showTextDocument(document)
          await editor.edit((edit) => edit.insert(document.positionAt(document.getText().length), "const int unsaved_marker = 99;\r\n"))
          editor.selection = new Selection(2, 0, 2, 30)
          const selection = captureContext(true)
          await commands.executeCommand("opencodeSidebar.addSelection")
          return { context: selection }
        }
        if (request.command === "review") {
          await commands.executeCommand("opencodeSidebar.review")
          const diff = window.tabGroups.all.flatMap((group) => group.tabs).find((tab) => tab.label.includes("sample.cpp"))
          assert.ok(diff, "native diff editor must open the requested file")
          const documents = workspace.textDocuments.filter((document) => document.uri.scheme === "opencode-review")
          return { diff: true, contents: documents.map((document) => document.getText()) }
        }
        if (request.command === "apply") { await commands.executeCommand("opencodeSidebar.applyUIUpdate"); return { applied: true } }
        if (request.command === "rollback") { await commands.executeCommand("opencodeSidebar.rollbackUI"); return { rolledBack: true } }
        return { editor: window.activeTextEditor?.document.uri.fsPath, line: window.activeTextEditor?.selection.start.line }
      }
      const result = await perform().catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
      await writeFile(join(root, "vscode-command-result.json"), JSON.stringify({ id: request.id, ...result }))
    })
  })
  let completed = ""
  console.log("Real VS Code activation, GBK decoding and current file command passed")
  // 隔离测试窗口保持运行，文件事件只用于父脚本驱动真实命令，不改变插件 API。
  await new Promise<void>(() => {})
  watcher.close()
}
