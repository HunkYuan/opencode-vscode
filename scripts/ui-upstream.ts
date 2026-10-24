import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import semver from "semver"
import { uiManifest } from "../src/ui/manifest"

const root = resolve(import.meta.dir, "..")
const execute = promisify(execFile)
const version = semver.valid((process.argv[2] ?? "").replace(/^v/, ""))
if (!version) throw new Error("Usage: bun run ui:upstream <version> [local-opencode-source]")
const pinned = await Bun.file(join(root, "upstream.json")).json() as { repository: string; commit: string; version: string; packages: string[] }
const localSource = process.argv[3] ? resolve(process.argv[3]) : undefined
const commit = localSource
  ? (await execute("git", ["rev-parse", "HEAD"], { cwd: localSource, windowsHide: true })).stdout.trim()
  : await resolveTag(version)
assert.match(commit, /^[a-f0-9]{40}$/)
const archive = join(root, ".upstream", "source-" + commit + ".tar.gz")
if (!localSource && !await Bun.file(archive).exists()) {
  await mkdir(dirname(archive), { recursive: true })
  const response = await fetch(`${pinned.repository}/archive/${commit}.tar.gz`, { signal: AbortSignal.timeout(120_000) })
  assert.equal(response.status, 200, "Could not download pinned official source")
  await Bun.write(archive, response)
}
type SourcePackage = {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: { catalog: Record<string, string> }
  patchedDependencies?: Record<string, string>
}
async function readManifest(directory?: string): Promise<SourcePackage> {
  if (localSource) return await Bun.file(join(localSource, directory ?? "", "package.json")).json() as SourcePackage
  const path = `opencode-${commit}/${directory ? directory + "/" : ""}package.json`
  const result = await execute("tar", ["-xOzf", archive, path], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  return JSON.parse(result.stdout) as SourcePackage
}
const official = await readManifest()
assert.equal(official.version, version, "Official source version differs from the requested version")
const pending = ["@opencode/app", "@opencode/client", "@opencode/ui"]
const packages = new Set<string>()
while (pending.length) {
  const name = pending.pop()!
  if (packages.has(name)) continue
  const manifest = await readManifest("packages/" + name.slice("@opencode/".length))
  assert.equal(manifest.name, name)
  packages.add(name)
  Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies }).forEach(([dependency, value]) => {
    if (value.startsWith("workspace:")) pending.push(dependency)
  })
}
const local = await Bun.file(join(root, "package.json")).json() as { workspaces: { catalog: Record<string, string> }; devDependencies: Record<string, string>; patchedDependencies: Record<string, string> }
local.workspaces.catalog = official.workspaces!.catalog
for (const name of ["solid-js", "@solidjs/router", "@playwright/test", "vite-plugin-solid"]) {
  const value = official.workspaces!.catalog[name]
  if (value && local.devDependencies[name] && local.devDependencies[name] !== "catalog:") local.devDependencies[name] = value
}
local.patchedDependencies = Object.fromEntries(Object.entries(official.patchedDependencies ?? {}).map(([name, path]) => [name, ".upstream/" + path]))
const previous = uiManifest.parse(await Bun.file(join(root, "ui-package.json")).json())
const revision = previous.upstreamVersion === version ? previous.revision + 1 : 1
await Bun.write(join(root, "upstream.json"), JSON.stringify({ ...pinned, version, commit, packages: [...packages].sort() }, null, 2) + "\n")
await Bun.write(join(root, "ui-package.json"), JSON.stringify({
  ...previous, id: `opencode-${version}-vscode.${revision}`, revision,
  upstreamVersion: version, upstreamCommit: commit, serviceRange: version,
}, null, 2) + "\n")
await Bun.write(join(root, "package.json"), JSON.stringify(local, null, 2) + "\n")
// 所有修改均位于插件目录；本地官方源码仅作为只读来源，不提交或推送任何仓库。
await execute(process.execPath, ["scripts/setup.ts", ...(localSource ? [localSource] : [])], { cwd: root, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
const install = await execute(process.execPath, ["install"], { cwd: root, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
console.log(install.stdout.trim())
console.log(`Prepared local UI ${version}, revision ${revision}, source ${commit}. Next: bun run check && bun run build:ui`)

async function resolveTag(version: string) {
  const names = [`refs/tags/v${version}`, `refs/tags/v${version}^{}`, `refs/tags/${version}`, `refs/tags/${version}^{}`]
  const result = await execute("git", ["ls-remote", "--tags", pinned.repository, ...names], { windowsHide: true, timeout: 30_000 })
  const refs = result.stdout.trim().split(/\r?\n/).map((line) => line.split(/\s+/))
  const target = refs.find((entry) => entry[1]?.endsWith("^{}")) ?? refs.find((entry) => names.includes(entry[1] ?? ""))
  if (!target?.[0]) throw new Error(`Official source tag for ${version} was not found; pass a local Git source directory instead.`)
  return target[0]
}
