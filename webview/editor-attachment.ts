import type { EditorContext } from "../src/protocol"

export function editorAttachment(context: EditorContext) {
  const path = context.directory.replaceAll("\\", "/").replace(/\/$/, "") + "/" + context.path.replaceAll("\\", "/")
  const selection = context.selection
    ? `${context.selection.startLine}:${context.selection.startChar + 1}-${context.selection.endLine}:${context.selection.endChar + 1}`
    : undefined
  const header = [
    "VS Code editor snapshot",
    "File: " + path,
    selection ? "Selection: " + selection + " (line:column, end exclusive)" : "Scope: entire file",
    context.dirty ? "State: unsaved editor content" : "State: saved editor content",
  ].join("\n")

  // VS Code 已按文件编码解码；发送内存文本，避免服务把 GBK 源码判成二进制并忽略。
  return {
    id: `vscode-editor:${path}:${selection ?? "file"}`,
    filename: path.split("/").at(-1)!,
    sourcePath: path,
    mime: "text/plain",
    blob: new Blob([header, "\n\n", context.content], { type: "text/plain" }),
  }
}
