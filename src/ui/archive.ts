import { mkdir, writeFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { unzipSync } from "fflate"
import { packagePath } from "./manifest"

export async function extractUI(bytes: Uint8Array, directory: string) {
  const root = resolve(directory)
  const names = new Set<string>()
  let total = 0
  const files = unzipSync(bytes, {
    filter(info) {
      const name = info.name.endsWith("/") ? info.name.slice(0, -1) : info.name
      packagePath.parse(name)
      const key = name.toLowerCase()
      if (names.has(key)) throw new Error("UI archive contains duplicate paths")
      names.add(key)
      total += info.originalSize
      if (total > 512 * 1024 * 1024 || names.size > 10_000) throw new Error("UI archive exceeds installation limits")
      return !info.name.endsWith("/")
    },
  })
  // 逐批写入避免大量静态资源同时占满 Windows 文件句柄。
  const entries = Object.entries(files)
  for (let start = 0; start < entries.length; start += 64) {
    await Promise.all(entries.slice(start, start + 64).map(async ([name, content]) => {
      const path = resolve(root, name)
      if (!path.startsWith(root + sep)) throw new Error("UI archive leaves its installation directory")
      await mkdir(resolve(path, ".."), { recursive: true })
      await writeFile(path, content)
    }))
  }
}
