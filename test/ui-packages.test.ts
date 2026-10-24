import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unzipSync, zipSync } from "fflate"
import { UiPackages } from "../src/ui/packages"
import { compatible, uiManifest, type UiManifest } from "../src/ui/manifest"
import { extractUI } from "../src/ui/archive"
import { createUIArchive } from "../scripts/ui-package"

const manifest: UiManifest = {
  schemaVersion: 1, id: "opencode-2.1.2-vscode.1", revision: 1,
  upstreamVersion: "2.1.2", upstreamCommit: "c93aaae37157d785f76a8e9a9243a6560e286468",
  hostProtocol: 1, serviceRange: "2.1.2", entry: "index.html",
}

test("local UI import preserves the running bundle, applies after reload and supports rollback and failed startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-local-ui-"))
  const builtin = join(root, "builtin")
  await mkdir(builtin)
  await writeFile(join(builtin, "ui-manifest.json"), JSON.stringify(manifest))
  await writeFile(join(builtin, "index.html"), "builtin")
  const updated = { ...manifest, id: "opencode-2.1.2-vscode.2", revision: 2 }
  const files = {
    "ui-manifest.json": Buffer.from(JSON.stringify(updated)),
    "index.html": Buffer.from("updated"),
    "assets/中文.txt": Buffer.from("中文"),
  }
  const bytes = createUIArchive(files)
  expect(createUIArchive(files)).toEqual(bytes)
  const zip = join(root, "local-ui.zip")
  await writeFile(zip, bytes)
  const options = { directory: join(root, "cache"), builtinDirectory: builtin, hostProtocol: 1, log: () => {} }
  const packages = new UiPackages(options)
  const current = await packages.select("2.1.2")
  await packages.loaded(current)
  const [first, second] = await Promise.all([packages.importPackage(zip, "2.1.2"), packages.importPackage(zip, "2.1.2")])
  expect(first.manifest.id).toBe(updated.id)
  expect(second.directory).toBe(first.directory)
  expect(first.archive?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"))
  expect(current.manifest.id).toBe(manifest.id)
  expect(await readFile(join(first.directory, "assets/中文.txt"), "utf8")).toBe("中文")
  expect((await readdir(options.directory)).filter((name) => name.startsWith("import-"))).toEqual([])
  const restarted = new UiPackages(options)
  const selected = await restarted.select("2.1.2")
  expect(selected.manifest.id).toBe(updated.id)
  await restarted.loaded(selected)
  expect(await restarted.pending()).toBeUndefined()
  await restarted.rollback("2.1.2")
  expect((await new UiPackages(options).select("2.1.2")).manifest.id).toBe(manifest.id)
  const requested = await restarted.importPackage(zip, "2.1.2")
  expect((await restarted.pending())?.manifest.id).toBe(updated.id)
  await restarted.failed(requested)
  expect((await restarted.select("2.1.2")).manifest.id).toBe(manifest.id)
  const retry = await restarted.importPackage(zip, "2.1.2")
  expect((await restarted.select("2.1.2")).manifest.id).toBe(updated.id)
  await restarted.loaded(retry)
  const changed = createUIArchive({ ...files, "index.html": Buffer.from("same id, changed bytes") })
  await writeFile(zip, changed)
  await expect(restarted.importPackage(zip, "2.1.2")).rejects.toThrow("相同 ID")
  expect(await readFile(join(retry.directory, "index.html"), "utf8")).toBe("updated")
})

test("damaged content, mismatched versions and missing entries leave the current UI usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-local-ui-reject-"))
  const builtin = join(root, "builtin")
  await mkdir(builtin)
  await writeFile(join(builtin, "ui-manifest.json"), JSON.stringify(manifest))
  await writeFile(join(builtin, "index.html"), "builtin")
  const updated = { ...manifest, id: "opencode-2.1.2-vscode.2", revision: 2 }
  const bytes = createUIArchive({ "ui-manifest.json": Buffer.from(JSON.stringify(updated)), "index.html": Buffer.from("original") })
  const files = unzipSync(bytes)
  files["index.html"] = Buffer.from("corrupted")
  const zip = join(root, "rejected.zip")
  await writeFile(zip, zipSync(files))
  const packages = new UiPackages({ directory: join(root, "cache"), builtinDirectory: builtin, hostProtocol: 1, log: () => {} })
  await expect(packages.importPackage(zip, "2.1.2")).rejects.toThrow("checksum mismatch")
  await writeFile(zip, bytes)
  await expect(packages.importPackage(zip, "2.1.3")).rejects.toThrow("不兼容")
  const protocol = createUIArchive({
    "ui-manifest.json": Buffer.from(JSON.stringify({ ...updated, hostProtocol: 2 })),
    "index.html": Buffer.from("wrong host"),
  })
  await writeFile(zip, protocol)
  await expect(packages.importPackage(zip, "2.1.2")).rejects.toThrow("不兼容")
  await writeFile(zip, createUIArchive({ "ui-manifest.json": Buffer.from(JSON.stringify(manifest)), "index.html": Buffer.from("builtin id") }))
  await expect(packages.importPackage(zip, "2.1.2")).rejects.toThrow("内置版本")
  await writeFile(zip, zipSync({ "ui-manifest.json": Buffer.from(JSON.stringify(updated)), "index.html": Buffer.from("no integrity") }))
  await expect(packages.importPackage(zip, "2.1.2")).rejects.toThrow("完整性清单")
  const missing = unzipSync(bytes)
  delete missing["index.html"]
  await writeFile(zip, zipSync(missing))
  await expect(packages.importPackage(zip, "2.1.2")).rejects.toThrow("file list differs")
  await writeFile(zip, Buffer.from("broken zip"))
  await expect(packages.importPackage(zip, "2.1.2")).rejects.toThrow()
  expect((await packages.select("2.1.2")).manifest.id).toBe(manifest.id)
  expect(await packages.pending()).toBeUndefined()
  expect((await readdir(join(root, "cache"))).filter((name) => name.startsWith("import-"))).toEqual([])
})

test("old online-update state retains its active selection without fetching a catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-local-ui-legacy-"))
  const builtin = join(root, "builtin")
  const cache = join(root, "cache")
  const legacy = { ...manifest, id: "opencode-2.1.2-vscode.2", revision: 2 }
  await mkdir(builtin)
  await mkdir(join(cache, "packages", legacy.id), { recursive: true })
  await writeFile(join(builtin, "ui-manifest.json"), JSON.stringify(manifest))
  await writeFile(join(builtin, "index.html"), "builtin")
  await writeFile(join(cache, "packages", legacy.id, "ui-manifest.json"), JSON.stringify(legacy))
  await writeFile(join(cache, "packages", legacy.id, "index.html"), "legacy")
  await writeFile(join(cache, "state.json"), JSON.stringify({
    lastGood: legacy.id, previous: manifest.id, lastCheck: 1,
    catalog: [{ ...legacy, url: "https://retired.invalid/package.zip" }],
  }))
  const packages = new UiPackages({ directory: cache, builtinDirectory: builtin, hostProtocol: 1, log: () => {} })
  expect((await packages.select("2.1.2")).manifest.id).toBe(legacy.id)
  await packages.rollback("2.1.2")
  expect((await packages.select("2.1.2")).manifest.id).toBe(manifest.id)
  const saved = JSON.parse(await readFile(join(cache, "state.json"), "utf8")) as Record<string, unknown>
  expect(saved.catalog).toBeUndefined()
  expect(saved.lastCheck).toBeUndefined()
})

test("archive installation rejects escaping and case-insensitive duplicate paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-local-ui-path-"))
  await expect(extractUI(zipSync({ "../outside.txt": Buffer.from("escape") }), root)).rejects.toThrow("inside")
  await expect(extractUI(zipSync({ "A.txt": Buffer.from("1"), "a.txt": Buffer.from("2") }), root)).rejects.toThrow("duplicate")
  expect(compatible(manifest, "2.1.2", 1)).toBe(true)
  expect(compatible(manifest, "2.1.3", 1)).toBe(false)
  expect(compatible(manifest, "2.1.2", 2)).toBe(false)
  expect(() => uiManifest.parse({ ...manifest, entry: "../index.html" })).toThrow()
})
