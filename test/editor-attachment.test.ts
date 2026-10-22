import { expect, test } from "bun:test"
import { editorAttachment } from "../webview/editor-attachment"

test("a decoded GBK editor snapshot sends UTF-8 text and the complete Windows path", async () => {
  const original = Buffer.concat([Buffer.from("// "), Buffer.from("d6d0cec4", "hex"), Buffer.from("\r\nconst int marker = 42;\r\n")])
  const snapshot = editorAttachment({
    directory: "d:\\P4WorkPath\\project\\",
    path: "中文 # %/sample file.cpp",
    content: new TextDecoder("gbk", { fatal: true }).decode(original),
    dirty: false,
  })
  const bytes = new Uint8Array(await snapshot.blob.arrayBuffer())
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)

  expect(snapshot.blob.type.split(";")[0]).toBe("text/plain")
  expect(snapshot.mime).toBe("text/plain")
  expect(snapshot.sourcePath).toBe("d:/P4WorkPath/project/中文 # %/sample file.cpp")
  expect(snapshot.filename).toBe("sample file.cpp")
  expect(text).toContain("\nFile: " + snapshot.sourcePath + "\n")
  expect(text).toEndWith("\n\n// 中文\r\nconst int marker = 42;\r\n")
  expect(text).not.toContain("\ufffd")
  expect(() => new TextDecoder("utf-8", { fatal: true }).decode(original)).toThrow()
})

test("adding the same file again replaces its snapshot while retaining unsaved edits", async () => {
  const context = { directory: "C:/project", path: "file.cpp", content: "saved", dirty: false }
  const saved = editorAttachment(context)
  const dirty = editorAttachment({ ...context, content: "changed in editor", dirty: true })

  expect(dirty.id).toBe(saved.id)
  expect(await dirty.blob.text()).toContain("State: unsaved editor content")
  expect(await dirty.blob.text()).toEndWith("\n\nchanged in editor")
  expect(await saved.blob.text()).toEndWith("\n\nsaved")
})

test("selection snapshots carry exact line and column positions and only selected text", async () => {
  const context = { directory: "C:/project", path: "file.h", content: "whole file", dirty: false }
  const file = editorAttachment(context)
  const selection = editorAttachment({
    ...context,
    content: "选中的代码",
    dirty: true,
    selection: { startLine: 100, startChar: 1, endLine: 115, endChar: 3 },
  })
  const text = await selection.blob.text()

  expect(selection.id).not.toBe(file.id)
  expect(text).toContain("Selection: 100:2-115:4 (line:column, end exclusive)")
  expect(text).toContain("State: unsaved editor content")
  expect(text).toEndWith("\n\n选中的代码")
  expect(text).not.toContain("whole file")
})

test.each([
  { directory: "/workspace/", path: "src/empty.cpp", expected: "/workspace/src/empty.cpp" },
  { directory: "/", path: "empty.cpp", expected: "/empty.cpp" },
  { directory: "\\\\server\\share", path: "src/empty.cpp", expected: "//server/share/src/empty.cpp" },
])("empty snapshots keep a readable file reference: $expected", async ({ directory, path, expected }) => {
  const snapshot = editorAttachment({ directory, path, content: "", dirty: false })
  const text = await snapshot.blob.text()

  expect(snapshot.sourcePath).toBe(expected)
  expect(text).toContain("\nFile: " + expected + "\n")
  expect(text).toContain("Scope: entire file")
  expect(text).toEndWith("\n\n")
})
