import { parsePatch } from "diff"

export function diffSides(patch: string) {
  if (/^(?:Binary files .+ differ|GIT binary patch)$/m.test(patch)) throw new Error("二进制文件请使用官方 UI 的文件预览。")
  const parsed = parsePatch(patch)
  const file = parsed[0]
  if (!file || parsed.length !== 1) throw new Error("无法从这份 patch 打开单文件审阅。请使用官方 UI 的 diff 面板。")
  const before: string[] = []
  const after: string[] = []
  let oldNewline = true
  let newNewline = true
  let previous = ""
  file.hunks.forEach((hunk) => {
    if ((hunk.oldLines > 0 && hunk.oldStart !== before.length + 1) || (hunk.newLines > 0 && hunk.newStart !== after.length + 1))
      throw new Error("服务返回的 patch 不包含完整文件内容。请使用官方 UI 的 diff 面板。")
    hunk.lines.forEach((line) => {
      if (line.startsWith("\\ No newline")) {
        if (previous === "-" || previous === " ") oldNewline = false
        if (previous === "+" || previous === " ") newNewline = false
        return
      }
      previous = line[0] ?? ""
      if (previous === " ") { before.push(line.slice(1)); after.push(line.slice(1)) }
      if (previous === "-") before.push(line.slice(1))
      if (previous === "+") after.push(line.slice(1))
    })
  })
  return {
    before: before.join("\n") + (before.length && oldNewline ? "\n" : ""),
    after: after.join("\n") + (after.length && newNewline ? "\n" : ""),
  }
}
