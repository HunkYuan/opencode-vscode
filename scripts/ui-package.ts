import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { zipSync } from "fflate"
import { uiManifest, uiRelease } from "../src/ui/manifest"

export async function packageUI() {
  const root = resolve(import.meta.dir, "..")
  const directory = join(root, "dist/webview")
  const manifest = uiManifest.parse(await Bun.file(join(directory, "ui-manifest.json")).json())
  const files: Record<string, [Uint8Array, { level: 6; mtime: Date }]> = {}
  const paths = [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })].sort()
  for (const path of paths) {
    files[path.replaceAll("\\", "/")] = [new Uint8Array(await Bun.file(join(directory, path)).arrayBuffer()), { level: 6, mtime: new Date("2020-01-01T00:00:00Z") }]
  }
  files["LICENSE"] = [new Uint8Array(await Bun.file(join(root, "LICENSE")).arrayBuffer()), { level: 6, mtime: new Date("2020-01-01T00:00:00Z") }]
  files["THIRD_PARTY_NOTICES.md"] = [new Uint8Array(await Bun.file(join(root, "THIRD_PARTY_NOTICES.md")).arrayBuffer()), { level: 6, mtime: new Date("2020-01-01T00:00:00Z") }]
  const bytes = zipSync(files)
  const tag = `ui-${manifest.upstreamVersion}-vscode.${manifest.revision}`
  const name = `opencode-${tag}.zip`
  const output = join(root, "artifacts/ui")
  await mkdir(output, { recursive: true })
  const release = uiRelease.parse({
    ...manifest,
    url: `https://github.com/HunkYuan/opencode-vscode/releases/download/${tag}/${name}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  })
  await Bun.write(join(output, name), bytes)
  await Bun.write(join(output, "release.json"), JSON.stringify(release, null, 2) + "\n")
  console.log(`Packaged ${name} (${bytes.length} bytes, SHA256 ${release.sha256})`)
  return release
}

if (import.meta.main) await packageUI()
