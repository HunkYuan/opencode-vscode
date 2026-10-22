import { cp, mkdir, writeFile } from "node:fs/promises"
import { resolve, join, dirname } from "node:path"
import { execFileSync } from "node:child_process"

const root = resolve(import.meta.dir, "..")
const pinned = await Bun.file(join(root, "upstream.json")).json()
const source = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, ".upstream", "sources", pinned.commit)

// 默认从固定 commit 获取官方源码，所有下载和构建文件都留在插件目录。
if (!process.argv[2] && !(await Bun.file(join(source, ".ready")).exists())) {
  const archive = join(root, ".upstream", "source-" + pinned.commit + ".tar.gz")
  await mkdir(source, { recursive: true })
  if (!(await Bun.file(archive).exists())) {
    console.log(`Downloading OpenCode ${pinned.version} at ${pinned.commit.slice(0, 12)}`)
    const response = await fetch(`${pinned.repository}/archive/${pinned.commit}.tar.gz`, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`Could not download pinned OpenCode source (HTTP ${response.status})`)
    await Bun.write(archive, response)
  }
  const prefix = "opencode-" + pinned.commit + "/"
  const required = [
    "package.json",
    "patches",
    "packages/desktop/icons",
    ...pinned.packages.map((name: string) => "packages/" + name.slice("@opencode/".length)),
  ]
  const links = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.startsWith("l")) return []
      const start = line.indexOf(prefix)
      const end = line.lastIndexOf(" -> ")
      if (start < 0 || end < start) throw new Error("Could not decode upstream symbolic link")
      return [{ path: line.slice(start, end), target: line.slice(end + 4) }]
    })
  // Windows 不要求创建 symlink 权限：先提取普通文件，再把固定源码中的链接实体化。
  execFileSync("tar", [
    "-xzf", archive, "--strip-components=1", "-C", source,
    ...links.map((link) => "--exclude=" + link.path),
    ...required.map((path) => prefix + path),
  ], { stdio: "inherit" })
  for (const link of links) {
    const path = link.path.slice(prefix.length)
    if (!required.some((entry) => path === entry || path.startsWith(entry + "/"))) continue
    const destination = join(source, path)
    const target = resolve(dirname(destination), link.target)
    if (!target.startsWith(source + "/") && !target.startsWith(source + "\\"))
      throw new Error("Upstream link leaves the source directory")
    await cp(target, destination, { recursive: true })
  }
  await writeFile(join(source, ".ready"), pinned.commit + "\n", "utf8")
}

if (process.argv[2]) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim()
  if (commit !== pinned.commit) throw new Error(`OpenCode source must be at ${pinned.commit}; found ${commit}`)
}
const manifest = await Bun.file(join(source, "package.json")).json()
if (manifest.version !== pinned.version) throw new Error(`Expected OpenCode ${pinned.version}; found ${manifest.version}`)

const packages = new Map<string, { directory: string; manifest: Record<string, unknown> }>()
for (const path of new Bun.Glob("packages/*/package.json").scanSync({ cwd: source })) {
  const pkg = await Bun.file(join(source, path)).json()
  packages.set(pkg.name, { directory: dirname(path), manifest: pkg })
}
const pending = ["@opencode/app", "@opencode/client", "@opencode/ui"]
const included = new Set<string>()
while (pending.length) {
  const name = pending.pop()!
  if (included.has(name)) continue
  const pkg = packages.get(name)
  if (!pkg) throw new Error(`Missing upstream workspace package: ${name}`)
  included.add(name)
  const dependencies = {
    ...(pkg.manifest.dependencies as Record<string, string> | undefined),
    ...(pkg.manifest.peerDependencies as Record<string, string> | undefined),
  }
  Object.entries(dependencies).forEach(([dependency, version]) => {
    if (version.startsWith("workspace:")) pending.push(dependency)
  })
  const destination = join(root, ".upstream", pkg.directory)
  await mkdir(dirname(destination), { recursive: true })
  await cp(join(source, pkg.directory), destination, {
    recursive: true,
    filter: (path) => !/(?:^|[\\/])(?:node_modules|dist|out|\.git)(?:[\\/]|$)/.test(path),
  })
  // 只调整隔离快照的安装清单；官方源码、固定来源和插件清单保持可复现。
  const runtime = { ...pkg.manifest }
  delete runtime.devDependencies
  delete runtime.scripts
  if (name === "@opencode/app") delete (runtime.dependencies as Record<string, string>)["@ibm/plex"]
  await writeFile(join(destination, "package.json"), JSON.stringify(runtime, null, 2) + "\n")
}
if (JSON.stringify([...included].sort()) !== JSON.stringify(pinned.packages))
  throw new Error("Pinned upstream workspace inventory does not match the downloaded source")

await mkdir(join(root, ".upstream", "patches"), { recursive: true })
await cp(join(source, "patches"), join(root, ".upstream", "patches"), { recursive: true })
await mkdir(join(root, ".upstream/packages/desktop/icons"), { recursive: true })
await cp(join(source, "packages/desktop/icons/dev"), join(root, ".upstream/packages/desktop/icons/dev"), { recursive: true })
await cp(join(source, "packages/desktop/icons/beta"), join(root, ".upstream/packages/desktop/icons/beta"), { recursive: true })
await mkdir(join(root, ".upstream/assets"), { recursive: true })
await cp(join(root, "resources/fonts"), join(root, ".upstream/assets"), { recursive: true })
console.log(`Prepared official UI ${pinned.version} at ${pinned.commit.slice(0, 12)} (${included.size} workspaces)`)
console.log("Next: bun install --frozen-lockfile")
