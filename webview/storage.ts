import { createDraftStore } from "@opencode/app/desktop"
import type { AsyncStorage } from "@solid-primitives/storage"
import { call } from "./bridge"

export function createStorage() {
  const namespaces = new Map<string, AsyncStorage>()
  return (name = "default"): AsyncStorage => {
    const existing = namespaces.get(name)
    if (existing) return existing
    let values: Record<string, string> | undefined
    let loading: Promise<Record<string, string>> | undefined
    const load = () => values ? Promise.resolve(values) : loading ??= call<Record<string, string>>({ method: "storageRead", name }).then((result) => values = result)
    const storage: AsyncStorage = {
      async getItem(key) { return (await load())[key] ?? null },
      async setItem(key, value) {
        const current = await load()
        current[key] = value
        await call({ method: "storageWrite", name, values: { [key]: value } })
      },
      async removeItem(key) {
        const current = await load()
        delete current[key]
        await call({ method: "storageWrite", name, values: { [key]: null } })
      },
      async clear() {
        const current = await load()
        await call({ method: "storageWrite", name, values: Object.fromEntries(Object.keys(current).map((key) => [key, null])) })
        values = {}
      },
      async key(index: number) { return Object.keys(await load())[index] },
      get length() { return load().then((value) => Object.keys(value).length) },
    }
    namespaces.set(name, storage)
    return storage
  }
}

export function createDrafts() {
  return createDraftStore({
    get: (key) => call<string | null>({ method: "draftGet", key }),
    set: (key, value, strict) => call<string[]>({ method: "draftSet", key, value, strict }),
    remove: (key) => call<void>({ method: "draftRemove", key }),
    async putBlob(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const chunks = Array.from({ length: Math.ceil(bytes.length / 8192) }, (_, i) => String.fromCharCode(...bytes.subarray(i * 8192, (i + 1) * 8192)))
      return call<string>({ method: "blobPut", data: btoa(chunks.join("")), mime: blob.type })
    },
    async getBlob(key) {
      const result = await call<{ data: string; mime: string } | null>({ method: "blobGet", key })
      return result ? new Blob([Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))], { type: result.mime }) : null
    },
  })
}
