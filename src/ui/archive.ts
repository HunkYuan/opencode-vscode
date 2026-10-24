import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { unzipSync } from "fflate"
import { packagePath, uiIntegrity, uiManifest } from "./manifest"

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
  if (!files["ui-manifest.json"] || !files["ui-integrity.json"])
    throw new Error("UI ZIP 缺少声明或完整性清单，请使用当前源码的 build:ui 重新构建。")
  const manifest = uiManifest.parse(JSON.parse(Buffer.from(files["ui-manifest.json"]).toString("utf8")))
  const integrity = uiIntegrity.parse(JSON.parse(Buffer.from(files["ui-integrity.json"]).toString("utf8")))
  const entries = Object.entries(files).filter(([name]) => name !== "ui-integrity.json")
  const paths = entries.map(([name]) => name).sort()
  if (JSON.stringify(paths) !== JSON.stringify(Object.keys(integrity.files).sort()))
    throw new Error("UI archive file list differs from its integrity manifest")
  entries.forEach(([name, content]) => {
    if (createHash("sha256").update(content).digest("hex") !== integrity.files[name])
      throw new Error(`UI archive checksum mismatch: ${name}`)
  })
  if (!files[manifest.entry]) throw new Error("UI archive entry file is missing")
  // 全部内容校验完成后才写文件；逐批写入避免大量资源占满 Windows 文件句柄。
  const output = Object.entries(files)
  for (let start = 0; start < output.length; start += 64) {
    await Promise.all(output.slice(start, start + 64).map(async ([name, content]) => {
      const path = resolve(root, name)
      if (!path.startsWith(root + sep)) throw new Error("UI archive leaves its installation directory")
      await mkdir(resolve(path, ".."), { recursive: true })
      await writeFile(path, content)
    }))
  }
  return manifest
}
