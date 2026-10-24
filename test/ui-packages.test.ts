import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { zipSync } from "fflate"
import { UiPackages } from "../src/ui/packages"
import { compatible, uiCatalog, type UiManifest, type UiRelease } from "../src/ui/manifest"
import { extractUI } from "../src/ui/archive"

const manifest: UiManifest = {
  schemaVersion: 1, id: "opencode-2.1.2-vscode.1", revision: 1,
  upstreamVersion: "2.1.2", upstreamCommit: "c93aaae37157d785f76a8e9a9243a6560e286468",
  hostProtocol: 1, serviceRange: "2.1.2", entry: "index.html",
}

test("UI updates download a compatible package, preserve current selection, apply after reload and stay rolled back", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-ui-"))
  const builtin = join(root, "builtin")
  await mkdir(builtin)
  await writeFile(join(builtin, "ui-manifest.json"), JSON.stringify(manifest))
  await writeFile(join(builtin, "index.html"), "builtin")
  const updated = { ...manifest, id: "opencode-2.1.2-vscode.2", revision: 2 }
  const bytes = zipSync({
    "ui-manifest.json": Buffer.from(JSON.stringify(updated)),
    "index.html": Buffer.from("updated"),
    "assets/中文.txt": Buffer.from("中文"),
  })
  let downloads = 0
  let catalogReads = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request): Response {
      if (new URL(request.url).pathname === "/package.zip") { downloads++; return new Response(Buffer.from(bytes)) }
      catalogReads++
      return Response.json({ schemaVersion: 1, releases: [release, { ...release, id: "opencode-3.0.0-vscode.1", upstreamVersion: "3.0.0", serviceRange: "3.0.0" }] })
    },
  })
  const release: UiRelease = {
    ...updated, url: server.url.origin + "/package.zip",
    sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
  }
  const options = { directory: join(root, "cache"), builtinDirectory: builtin, hostProtocol: 1, indexURL: server.url.origin + "/stable.json", log: () => {} }
  const packages = new UiPackages(options)
  try {
    const current = await packages.select("2.1.2")
    await packages.loaded(current)
    const [first, second] = await Promise.all([packages.check("2.1.2", current), packages.check("2.1.2", current)])
    expect(first?.manifest.id).toBe(updated.id)
    expect(second?.directory).toBe(first?.directory)
    expect(downloads).toBe(1)
    expect(catalogReads).toBe(1)
    expect(current.manifest.id).toBe(manifest.id)
    expect(await readFile(join(first!.directory, "assets/中文.txt"), "utf8")).toBe("中文")
    const restarted = new UiPackages(options)
    const selected = await restarted.select("2.1.2")
    expect(selected.manifest.id).toBe(updated.id)
    await restarted.loaded(selected)
    expect(await restarted.pending()).toBeUndefined()
    await restarted.rollback("2.1.2")
    expect((await new UiPackages(options).select("2.1.2")).manifest.id).toBe(manifest.id)
    expect(await restarted.check("2.1.2", current)).toBeUndefined()
    const requested = await restarted.check("2.1.2", current, true)
    expect(requested?.manifest.id).toBe(updated.id)
    await restarted.failed(requested!)
    expect((await restarted.select("2.1.2")).manifest.id).toBe(manifest.id)
    expect(await restarted.check("2.1.2", current, true)).toBeUndefined()
    expect(downloads).toBe(1)
  } finally {
    server.stop(true)
  }
})

test("failed integrity or manifest checks leave the previous UI usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-ui-reject-"))
  const builtin = join(root, "builtin")
  await mkdir(builtin)
  await writeFile(join(builtin, "ui-manifest.json"), JSON.stringify(manifest))
  await writeFile(join(builtin, "index.html"), "builtin")
  const bytes = zipSync({ "ui-manifest.json": Buffer.from(JSON.stringify(manifest)), "index.html": Buffer.from("changed") })
  const updated = { ...manifest, id: "opencode-2.1.2-vscode.2", revision: 2 }
  let hash = "0".repeat(64)
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request): Response {
      if (new URL(request.url).pathname === "/package.zip") return new Response(Buffer.from(bytes))
      return Response.json({ schemaVersion: 1, releases: [{ ...updated, url: server.url.origin + "/package.zip", sha256: hash, size: bytes.length }] })
    },
  })
  const packages = new UiPackages({ directory: join(root, "cache"), builtinDirectory: builtin, hostProtocol: 1, indexURL: server.url.origin + "/stable.json", log: () => {} })
  try {
    const current = await packages.select("2.1.2")
    await expect(packages.check("2.1.2", current, true)).rejects.toThrow("checksum")
    hash = createHash("sha256").update(bytes).digest("hex")
    await expect(packages.check("2.1.2", current, true)).rejects.toThrow("manifest differs")
    expect((await packages.select("2.1.2")).manifest.id).toBe(manifest.id)
    expect(await packages.pending()).toBeUndefined()
  } finally {
    server.stop(true)
  }
})

test("archive installation rejects paths outside the cache and duplicate case-insensitive paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-ui-path-"))
  await expect(extractUI(zipSync({ "../outside.txt": Buffer.from("escape") }), root)).rejects.toThrow("inside")
  await expect(extractUI(zipSync({ "A.txt": Buffer.from("1"), "a.txt": Buffer.from("2") }), root)).rejects.toThrow("duplicate")
  expect(compatible(manifest, "2.1.2", 1)).toBe(true)
  expect(compatible(manifest, "2.1.3", 1)).toBe(false)
  expect(compatible(manifest, "2.1.2", 2)).toBe(false)
  expect(() => uiCatalog.parse({ schemaVersion: 1, releases: [{ ...manifest, entry: "../index.html" }] })).toThrow()
})
