import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { join, resolve, basename } from "node:path"
import { uiCatalog, uiRelease, newer } from "../src/ui/manifest"
import { github, UI_REPOSITORY } from "./github"

type Asset = { id: number; name: string; state: string; size: number; browser_download_url: string; digest?: string }
type Release = { id: number; tag_name: string; draft: boolean; upload_url: string; assets: Asset[]; html_url: string }
type Reference = { object: { sha: string } }
type GitCommit = { sha: string; tree: { sha: string } }
const root = resolve(".")
const directory = join(root, "artifacts/ui")
const manifest = uiRelease.parse(await Bun.file(join(directory, "release.json")).json())
const source = process.env.UI_SOURCE_SHA
assert.equal(manifest.sourceCommit, source, "UI artifact must match the candidate that completed validation")
assert.match(source ?? "", /^[a-f0-9]{40}$/)
const name = basename(new URL(manifest.url).pathname)
const tag = `ui-${manifest.upstreamVersion}-vscode.${manifest.revision}`
assert.equal(manifest.url, `https://github.com/${UI_REPOSITORY}/releases/download/${tag}/${name}`)
const bytes = new Uint8Array(await Bun.file(join(directory, name)).arrayBuffer())
assert.equal(bytes.byteLength, manifest.size)
assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256)
const api = github()
const releases = await api.request<Release[]>(`/repos/${UI_REPOSITORY}/releases?per_page=100`)
const old = releases?.find((release) => release.tag_name === tag)
const release = old ?? await api.request<Release>(`/repos/${UI_REPOSITORY}/releases`, {
  method: "POST", body: {
    tag_name: tag, target_commitish: source, name: `OpenCode UI ${manifest.upstreamVersion} / VS Code adapter ${manifest.revision}`,
    draft: true, prerelease: false, make_latest: "false",
    body: `Independent official OpenCode UI package for the VS Code extension.\n\n- Host protocol: ${manifest.hostProtocol}\n- Verified service versions: ${manifest.serviceRange}\n- Official source: ${manifest.upstreamCommit}\n- Validated extension source: ${source}\n- SHA256: ${manifest.sha256}\n\nThe extension downloads this package automatically. This release contains UI assets, not a VSIX.\n\nTask: UI-001.`,
  },
})
assert.ok(release)
const assetNames = [name, "ui-release.json", "SHA256SUMS.txt"]
assert.ok(release.assets.every((asset) => assetNames.includes(asset.name)), "UI release has unexpected assets")
const assets = [
  { name, bytes: Buffer.from(bytes), type: "application/octet-stream" },
  { name: "ui-release.json", bytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n"), type: "application/json" },
  { name: "SHA256SUMS.txt", bytes: Buffer.from(manifest.sha256 + "  " + name + "\n"), type: "text/plain" },
]
for (const asset of assets) {
  const existing: Asset | undefined = release.assets.find((entry) => entry.name === asset.name)
  if (existing) {
    assert.equal(existing.size, asset.bytes.length, "UI asset version is immutable")
    if (existing.digest) assert.equal(existing.digest, "sha256:" + createHash("sha256").update(asset.bytes).digest("hex"), "UI asset id was reused with different bytes")
    continue
  }
  assert.equal(release.draft, true, "cannot change assets of a published UI release")
  const response: Response = await fetch(release.upload_url.split("{")[0] + "?name=" + encodeURIComponent(asset.name), {
    method: "POST", headers: { ...api.headers, "Content-Type": asset.type }, body: asset.bytes, signal: AbortSignal.timeout(180_000),
  })
  assert.equal(response.status, 201, "UI release asset upload failed")
}
const published = release.draft
  ? await api.request<Release>(`/repos/${UI_REPOSITORY}/releases/${release.id}`, { method: "PATCH", body: { draft: false, make_latest: "false" } })
  : release
assert.equal(published!.draft, false)
const download = await fetch(manifest.url, { signal: AbortSignal.timeout(180_000) })
assert.equal(download.status, 200, "published UI package is not publicly downloadable")
const publicBytes = Buffer.from(await download.arrayBuffer())
assert.equal(publicBytes.length, manifest.size)
assert.equal(createHash("sha256").update(publicBytes).digest("hex"), manifest.sha256)

// 资产已公开且重新下载校验后，才让客户端更新清单可见。
const reference = await api.request<Reference>(`/repos/${UI_REPOSITORY}/git/ref/heads/ui-updates`, { optional: true })
const current = reference
  ? await api.request<{ content: string }>(`/repos/${UI_REPOSITORY}/contents/stable.json?ref=ui-updates`)
  : undefined
const previous = current ? uiCatalog.parse(JSON.parse(Buffer.from(current.content, "base64").toString("utf8"))) : { schemaVersion: 1, releases: [] }
const duplicate = previous.releases.find((entry) => entry.id === manifest.id)
if (duplicate) assert.equal(duplicate.sha256, manifest.sha256, "UI catalog cannot republish an id with different bytes")
const catalog = uiCatalog.parse({ schemaVersion: 1, releases: [manifest, ...previous.releases.filter((entry) => entry.id !== manifest.id)].sort((a, b) => newer(b, a)).slice(0, 200) })
const encoded = JSON.stringify(catalog, null, 2) + "\n"
const blob = await api.request<{ sha: string }>(`/repos/${UI_REPOSITORY}/git/blobs`, { method: "POST", body: { content: encoded, encoding: "utf-8" } })
const tree = await api.request<{ sha: string }>(`/repos/${UI_REPOSITORY}/git/trees`, { method: "POST", body: { tree: [{ path: "stable.json", mode: "100644", type: "blob", sha: blob!.sha }] } })
const commit = await api.request<GitCommit>(`/repos/${UI_REPOSITORY}/git/commits`, {
  method: "POST", body: { message: `chore(ui): publish ${manifest.id} (UI-001)`, tree: tree!.sha, parents: reference ? [reference.object.sha] : [] },
})
if (reference)
  await api.request(`/repos/${UI_REPOSITORY}/git/refs/heads/ui-updates`, { method: "PATCH", body: { sha: commit!.sha, force: false } })
if (!reference)
  await api.request(`/repos/${UI_REPOSITORY}/git/refs`, { method: "POST", body: { ref: "refs/heads/ui-updates", sha: commit!.sha } })
await Bun.write(join(directory, "published.json"), JSON.stringify({ release: published!.html_url, catalogCommit: commit!.sha, manifest }, null, 2))
console.log(JSON.stringify({ release: published!.html_url, catalog: "https://raw.githubusercontent.com/" + UI_REPOSITORY + "/ui-updates/stable.json", id: manifest.id, sha256: manifest.sha256 }))
