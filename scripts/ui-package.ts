import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { zipSync } from "fflate"
import { uiArchive, uiIntegrity, uiManifest } from "../src/ui/manifest"

export function createUIArchive(files: Record<string, Uint8Array>) {
  const content = Object.fromEntries(Object.entries(files).filter(([name]) => !["ui-integrity.json", "ui-install.json", "ui-release.json"].includes(name)))
  const manifest = uiManifest.parse(JSON.parse(Buffer.from(content["ui-manifest.json"] ?? []).toString("utf8")))
  if (!content[manifest.entry]) throw new Error("UI entry file is missing")
  const integrity = uiIntegrity.parse({
    schemaVersion: 1,
    files: Object.fromEntries(Object.entries(content).map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")])),
  })
  content["ui-integrity.json"] = Buffer.from(JSON.stringify(integrity, null, 2) + "\n")
  const entries: Record<string, [Uint8Array, { level: 6; mtime: Date }]> = {}
  Object.keys(content).sort().forEach((path) => {
    entries[path] = [content[path]!, { level: 6, mtime: new Date("2020-01-01T00:00:00Z") }]
  })
  return zipSync(entries)
}

export async function packageUI() {
  const root = resolve(import.meta.dir, "..")
  const directory = join(root, "dist/webview")
  const manifest = uiManifest.parse(await Bun.file(join(directory, "ui-manifest.json")).json())
  const files: Record<string, Uint8Array> = {}
  for (const path of [...new Bun.Glob("**/*").scanSync({ cwd: directory, onlyFiles: true })].sort())
    files[path.replaceAll("\\", "/")] = new Uint8Array(await Bun.file(join(directory, path)).arrayBuffer())
  files["LICENSE"] = new Uint8Array(await Bun.file(join(root, "LICENSE")).arrayBuffer())
  files["THIRD_PARTY_NOTICES.md"] = new Uint8Array(await Bun.file(join(root, "THIRD_PARTY_NOTICES.md")).arrayBuffer())
  const bytes = createUIArchive(files)
  const output = join(root, "artifacts/ui")
  await mkdir(output, { recursive: true })
  const archive = uiArchive.parse({
    ...manifest,
    fileName: `opencode-ui-${manifest.upstreamVersion}-vscode.${manifest.revision}.zip`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  })
  await Bun.write(join(output, archive.fileName), bytes)
  await Bun.write(join(output, "ui-package.json"), JSON.stringify(archive, null, 2) + "\n")
  await Bun.write(join(output, "SHA256SUMS.txt"), archive.sha256 + "  " + archive.fileName + "\n")
  console.log(`Packaged local ${archive.fileName} (${bytes.length} bytes, SHA256 ${archive.sha256})`)
  return archive
}

if (import.meta.main) await packageUI()
