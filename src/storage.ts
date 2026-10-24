import { mkdir, readFile, writeFile, access, unlink } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { Memento } from "vscode"
import type { JsonValue } from "./protocol"

export class Storage {
  private readonly writes = new Map<string, Promise<void>>()
  private readonly drafts = new Map<string, Promise<unknown>>()
  constructor(private readonly state: Memento, private readonly directory: string) {}

  read(name: string) { return this.state.get<Record<string, string>>("ui." + name, {}) }

  write(name: string, values: Record<string, string | null>) {
    const next = (this.writes.get(name) ?? Promise.resolve()).then(async () => {
      const current = { ...this.read(name) }
      Object.entries(values).forEach(([key, value]) => {
        if (value === null) delete current[key]
        if (value !== null) current[key] = value
      })
      await this.state.update("ui." + name, current)
    })
    this.writes.set(name, next)
    return next.finally(() => { if (this.writes.get(name) === next) this.writes.delete(name) })
  }

  async draftGet(key: string) {
    await this.drafts.get(key)
    return readFile(join(this.directory, "drafts", hash(key)), "utf8").catch(() => null)
  }

  draftSet(key: string, value: string, strict: boolean) {
    return this.serializeDraft(key, async () => {
      // 官方草稿包含图片 blob.id 与大文本 blob.ids；缺少任何引用时严格写入保留上一份草稿。
      const references = blobReferences(JSON.parse(value) as JsonValue)
      const missing = (await Promise.all(references.map(async (id) =>
        await access(join(this.directory, "blobs", id)).then(() => undefined, () => id)))).filter((id): id is string => !!id)
      if (strict && missing.length) return missing
      await mkdir(join(this.directory, "drafts"), { recursive: true })
      await writeFile(join(this.directory, "drafts", hash(key)), value, "utf8")
      return missing
    })
  }

  draftRemove(key: string) {
    return this.serializeDraft(key, () => unlink(join(this.directory, "drafts", hash(key))).catch(() => undefined))
  }

  async putBlob(data: string, mime: string) {
    const bytes = Buffer.from(data, "base64")
    const id = hash(bytes)
    await mkdir(join(this.directory, "blobs"), { recursive: true })
    await writeFile(join(this.directory, "blobs", id), bytes)
    await writeFile(join(this.directory, "blobs", id + ".mime"), mime, "utf8")
    return id
  }

  async getBlob(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid blob identifier.")
    const bytes = await readFile(join(this.directory, "blobs", id)).catch(() => undefined)
    if (!bytes) return null
    const mime = await readFile(join(this.directory, "blobs", id + ".mime"), "utf8").catch(() => "application/octet-stream")
    return { data: bytes.toString("base64"), mime }
  }

  private serializeDraft<T>(key: string, action: () => Promise<T>) {
    const next = (this.drafts.get(key) ?? Promise.resolve()).then(action)
    this.drafts.set(key, next)
    return next.finally(() => { if (this.drafts.get(key) === next) this.drafts.delete(key) })
  }
}
function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex") }

function blobReferences(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.flatMap(blobReferences)
  if (!value || typeof value !== "object") return []
  const blob = value.blob
  if (blob && typeof blob === "object" && !Array.isArray(blob)) {
    return [blob.id, ...(Array.isArray(blob.ids) ? blob.ids : [])].filter((id): id is string => typeof id === "string").map((id) => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid draft blob identifier.")
      return id
    })
  }
  return Object.values(value).flatMap(blobReferences)
}
