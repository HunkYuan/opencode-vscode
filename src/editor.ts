import { window, workspace, commands, Uri, Position, Range, Selection, type TextDocumentContentProvider, FileType } from "vscode"
import { isAbsolute, relative, resolve } from "node:path"
import { OpenCode } from "@opencode/client/promise"
import type { EditorContext } from "./protocol"
import type { Endpoint } from "./service"
import { diffSides } from "./diff"

export function activeDirectory() {
  const editor = window.activeTextEditor
  const folder = editor && workspace.getWorkspaceFolder(editor.document.uri)
  if (folder) return folder.uri.fsPath
  if (workspace.workspaceFolders?.length === 1) return workspace.workspaceFolders[0]!.uri.fsPath
}

export function captureContext(selectionOnly: boolean): EditorContext {
  const editor = window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== "file") throw new Error("请先打开一个本地代码文件。")
  const directory = workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
  if (!directory) throw new Error("当前文件不在 VS Code 工作区中。")
  if (selectionOnly && editor.selection.isEmpty) throw new Error("请先选择要发送的代码。")
  const selection = selectionOnly ? editor.selection : undefined
  return {
    directory,
    path: relative(directory, editor.document.uri.fsPath).replaceAll("\\", "/"),
    content: selection ? editor.document.getText(selection) : editor.document.getText(),
    dirty: editor.document.isDirty,
    selection: selection ? {
      startLine: selection.start.line + 1,
      startChar: selection.start.character,
      endLine: selection.end.line + 1,
      endChar: selection.end.character,
    } : undefined,
  }
}

export async function openFile(path: string, directory?: string, line?: number, character?: number) {
  const target = isAbsolute(path) ? path : resolve(directory ?? activeDirectory() ?? "", path)
  const stat = await workspace.fs.stat(Uri.file(target))
  if (stat.type === FileType.Directory) { await commands.executeCommand("revealInExplorer", Uri.file(target)); return }
  const editor = await window.showTextDocument(Uri.file(target), { preview: true, preserveFocus: false })
  if (line) {
    const position = editor.document.validatePosition(new Position(line - 1, character ?? 0))
    editor.selection = new Selection(position, position)
    editor.revealRange(new Range(position, position))
  }
}

export function createReview() {
  const documents = new Map<string, string>()
  const provider: TextDocumentContentProvider = { provideTextDocumentContent: (uri) => documents.get(uri.toString()) ?? "" }
  const registration = workspace.registerTextDocumentContentProvider("opencode-review", provider)
  return {
    async open(endpoint: Endpoint, sessionID: string) {
      const api = OpenCode.make({ baseUrl: endpoint.url, headers: { Authorization: "Basic " + Buffer.from("opencode:" + endpoint.password).toString("base64") } })
      const changes = await api.session.diff({ sessionID })
      if (!changes.length) { await window.showInformationMessage("当前会话这一轮没有文件改动。"); return }
      const selected = changes.length === 1 ? changes[0]! : await window.showQuickPick(
        changes.map((change) => ({ label: change.file, description: `+${change.additions} −${change.deletions}`, change })),
        { placeHolder: "选择要审阅的文件" },
      ).then((item) => item?.change)
      if (!selected) return
      const content = diffSides(selected.patch)
      const revision = Date.now()
      const before = Uri.from({ scheme: "opencode-review", path: `/${sessionID}/before/${selected.file}`, query: String(revision) })
      const after = Uri.from({ scheme: "opencode-review", path: `/${sessionID}/after/${selected.file}`, query: String(revision) })
      documents.set(before.toString(), content.before)
      documents.set(after.toString(), content.after)
      await commands.executeCommand("vscode.diff", before, after, selected.file, { preview: true })
    },
    dispose() { registration.dispose(); documents.clear() },
  }
}
