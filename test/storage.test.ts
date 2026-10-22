import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Storage } from "../src/storage"
import type { Memento } from "vscode"

test("draft storage preserves complete image and text blob references and last-write order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-vscode-test-"))
  const values = new Map<string, unknown>()
  const memento: Memento = {
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback?: T) => (values.get(key) ?? fallback) as T,
    update: async (key, value) => { values.set(key, value) },
  }
  const store = new Storage(memento, directory)
  try {
    const id = await store.putBlob(Buffer.from("中文\n").toString("base64"), "text/plain")
    const previous = JSON.stringify({ prompt: [{ blob: { kind: "text", ids: [id] } }] })
    expect(await store.draftSet("draft", previous, true)).toEqual([])
    const missing = "0".repeat(64)
    expect(await store.draftSet("draft", JSON.stringify({ blob: { id: missing } }), true)).toEqual([missing])
    expect(await store.draftGet("draft")).toBe(previous)
    expect(await store.getBlob(id)).toEqual({ data: Buffer.from("中文\n").toString("base64"), mime: "text/plain" })
    await Promise.all([store.draftSet("draft", '"first"', true), store.draftSet("draft", '"second"', true)])
    expect(await store.draftGet("draft")).toBe('"second"')
    await Promise.all([store.write("tabs", { one: "1" }), store.write("tabs", { two: "2" })])
    expect(store.read("tabs")).toEqual({ one: "1", two: "2" })
    await store.draftRemove("draft")
    expect(await store.draftGet("draft")).toBeNull()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
