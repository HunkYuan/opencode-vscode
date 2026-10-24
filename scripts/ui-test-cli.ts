import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { chmod, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

const root = resolve(import.meta.dir, "..")
const pinned = await Bun.file(join(root, "upstream.json")).json()
const version = process.argv[2] ?? pinned.version
const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"
const name = `@opencode/cli-${platform}-${process.arch}`
const directory = join(root, "artifacts/test-cli", version, platform + "-" + process.arch)
await mkdir(directory, { recursive: true })
const manifestResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(30_000) })
assert.equal(manifestResponse.status, 200, "pinned official CLI platform package is unavailable")
const metadata = await manifestResponse.json() as { version: string; dist: { tarball: string; integrity: string } }
assert.equal(metadata.version, version)
const archive = join(directory, "package.tgz")
if (!await Bun.file(archive).exists()) {
  const response = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(120_000) })
  assert.equal(response.status, 200)
  await Bun.write(archive, response)
}
const bytes = await Bun.file(archive).arrayBuffer()
assert.equal("sha512-" + createHash("sha512").update(Buffer.from(bytes)).digest("base64"), metadata.dist.integrity)
await promisify(execFile)("tar", ["-xzf", archive, "-C", directory], { windowsHide: true })
const binary = [...new Bun.Glob(process.platform === "win32" ? "**/opencode.exe" : "**/opencode").scanSync({ cwd: directory })][0]
assert.ok(binary, "official CLI archive contains no executable")
const executable = join(directory, binary)
if (process.platform !== "win32") await chmod(executable, 0o755)
const result = await promisify(execFile)(executable, ["--version"], { windowsHide: true, timeout: 30_000 })
assert.ok(result.stdout.includes(version), "downloaded CLI does not match its pinned version")
await Bun.write(join(root, "artifacts/test-cli-path.txt"), executable)
if (process.env.GITHUB_ENV) {
  const previous = await Bun.file(process.env.GITHUB_ENV).text().catch(() => "")
  await Bun.write(process.env.GITHUB_ENV, previous + "\nOPENCODE_TEST_CLI_PATH=" + executable + "\n")
}
console.log(`Prepared official OpenCode ${version} CLI: ${executable}`)
