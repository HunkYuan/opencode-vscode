import { expect, test } from "bun:test"
import { createPatch } from "diff"
import { diffSides } from "../src/diff"

test("native review reconstructs both snapshots including CRLF and missing final newline", () => {
  for (const [before, after] of [
    ["old\n", "new\n"],
    ["old", "new"],
    ["old\n", "new"],
    ["", "added\n"],
    ["deleted", ""],
    ["keep\r\nold\r\n", "keep\r\nnew\r\n"],
  ]) {
    expect(diffSides(createPatch("file.ts", before!, after!, "", "", { context: Number.MAX_SAFE_INTEGER }))).toEqual({ before, after })
  }
})
test("review refuses partial patches rather than showing incomplete file contents", () => {
  const before = Array.from({ length: 30 }, (_, i) => "line " + i).join("\n") + "\n"
  const after = before.replace("line 15\n", "changed\n")
  expect(() => diffSides(createPatch("file.ts", before, after, "", "", { context: 2 }))).toThrow("完整文件")
})
