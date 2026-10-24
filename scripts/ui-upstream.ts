import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import semver from "semver"
import { uiManifest } from "../src/ui/manifest"
import { github, UI_REPOSITORY } from "./github"

type OfficialRelease = { tag_name: string; draft: boolean; prerelease: boolean }
type Pull = { number: number; head: { sha: string; ref: string }; base: { ref: string }; state: string }
type Reference = { object: { sha: string; type: string } }
const root = resolve(".")
const pinned = await Bun.file(join(root, "upstream.json")).json() as { repository: string; commit: string; version: string; packages: string[] }
const api = github()

async function output(values: Record<string, string>) {
  console.log(JSON.stringify(values))
  if (process.env.GITHUB_OUTPUT) {
    const previous = await Bun.file(process.env.GITHUB_OUTPUT).text().catch(() => "")
    await Bun.write(process.env.GITHUB_OUTPUT, previous + Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""))
  }
}

function git(args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim()
}

if (process.argv[2] === "prepare") {
  const releases = await api.request<OfficialRelease[]>("/repos/anomalyco/opencode/releases?per_page=100")
  const npmResponse = await fetch("https://registry.npmjs.org/@opencode%2fcli/latest", { signal: AbortSignal.timeout(30_000) })
  assert.equal(npmResponse.status, 200)
  const npm = await npmResponse.json() as { name: string; version: string }
  assert.equal(npm.name, "@opencode/cli")
  const versions = [
    ...(releases ?? []).filter((release) => !release.draft && !release.prerelease).map((release) => release.tag_name.replace(/^v/, "")),
    npm.version,
  ].filter((version) => !!semver.valid(version) && !semver.prerelease(version) && semver.gt(version, pinned.version)).sort(semver.rcompare)
  const version = versions[0]
  if (!version) { await output({ changed: "false", version: pinned.version }); process.exit(0) }
  const branch = `ui-upstream-${version}`
  const pulls = await api.request<Pull[]>(`/repos/${UI_REPOSITORY}/pulls?head=HunkYuan:${branch}&state=open`)
  const previous = pulls?.[0]
  if (previous) {
    await output({ changed: "true", source: previous.head.sha, pull: String(previous.number), branch, version })
    process.exit(0)
  }

  const ref = await api.request<Reference>(`/repos/anomalyco/opencode/git/ref/tags/v${version}`, { optional: true }) ??
    await api.request<Reference>(`/repos/anomalyco/opencode/git/ref/tags/${version}`, { optional: true })
  if (!ref) throw new Error(`Official ${version} is published but its immutable source tag is missing; update stopped`)
  const commit = ref.object.type === "tag"
    ? (await api.request<Reference>("/repos/anomalyco/opencode/git/tags/" + ref.object.sha))!.object.sha
    : ref.object.sha
  assert.match(commit, /^[a-f0-9]{40}$/)
  const archive = join(root, ".upstream", "source-" + commit + ".tar.gz")
  await mkdir(join(root, ".upstream"), { recursive: true })
  if (!await Bun.file(archive).exists()) {
    const response = await fetch(`${pinned.repository}/archive/${commit}.tar.gz`, { signal: AbortSignal.timeout(120_000) })
    assert.equal(response.status, 200)
    await Bun.write(archive, response)
  }
  const readManifest = (path: string) => JSON.parse(execFileSync("tar", ["-xOzf", archive, `opencode-${commit}/${path}/package.json`], { encoding: "utf8" })) as { name: string; version: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; workspaces?: { catalog: Record<string, string> }; patchedDependencies?: Record<string, string> }
  const official = JSON.parse(execFileSync("tar", ["-xOzf", archive, `opencode-${commit}/package.json`], { encoding: "utf8" })) as ReturnType<typeof readManifest>
  assert.equal(official.version, version)
  const pending = ["@opencode/app", "@opencode/client", "@opencode/ui"]
  const packages = new Set<string>()
  while (pending.length) {
    const name = pending.pop()!
    if (packages.has(name)) continue
    const manifest = readManifest("packages/" + name.slice("@opencode/".length))
    assert.equal(manifest.name, name)
    packages.add(name)
    Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies }).forEach(([name, value]) => { if (value.startsWith("workspace:")) pending.push(name) })
  }

  git(["switch", "-c", branch])
  const local = await Bun.file(join(root, "package.json")).json() as { workspaces: { catalog: Record<string, string> }; devDependencies: Record<string, string>; patchedDependencies: Record<string, string> }
  local.workspaces.catalog = official.workspaces!.catalog
  for (const name of ["solid-js", "@solidjs/router", "@playwright/test", "vite-plugin-solid"]) {
    const version = official.workspaces!.catalog[name]
    if (version && local.devDependencies[name] && local.devDependencies[name] !== "catalog:") local.devDependencies[name] = version
  }
  local.patchedDependencies = Object.fromEntries(Object.entries(official.patchedDependencies ?? {}).map(([name, path]) => [name, ".upstream/" + path]))
  const manifest = uiManifest.parse(await Bun.file(join(root, "ui-package.json")).json())
  await Bun.write(join(root, "upstream.json"), JSON.stringify({ ...pinned, version, commit, packages: [...packages].sort() }, null, 2) + "\n")
  await Bun.write(join(root, "ui-package.json"), JSON.stringify({ ...manifest, id: `opencode-${version}-vscode.1`, revision: 1, upstreamVersion: version, upstreamCommit: commit, serviceRange: version }, null, 2) + "\n")
  await Bun.write(join(root, "package.json"), JSON.stringify(local, null, 2) + "\n")
  const setup = spawnSync(process.execPath, ["run", "setup"], { cwd: root, stdio: "inherit", windowsHide: true })
  const install = setup.status === 0 ? spawnSync(process.execPath, ["install"], { cwd: root, stdio: "inherit", windowsHide: true }) : undefined
  git(["add", "--", "upstream.json", "ui-package.json", "package.json", "bun.lock"])
  git(["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", `chore(ui): update OpenCode to ${version} (UI-001)`])
  git(["push", "origin", branch])
  const source = git(["rev-parse", "HEAD"])
  const pull = await api.request<Pull>(`/repos/${UI_REPOSITORY}/pulls`, {
    method: "POST",
    body: {
      head: branch, base: "dev", title: `chore(ui): update OpenCode to ${version}`,
      body: `Update the official UI and client source to OpenCode ${version} at ${commit}.\n\nThe automation validates this exact candidate commit on Windows and Linux before merging and publishing its UI package. Failed candidates leave the current UI catalog unchanged.\n\nSource preparation: ${setup.status === 0 && install?.status === 0 ? "completed" : "failed; inspect the workflow and repair this candidate"}.\nTask: UI-001.`,
    },
  })
  await output({ changed: "true", source, pull: String(pull!.number), branch, version })
}

if (process.argv[2] === "merge") {
  const source = process.env.UI_SOURCE_SHA
  const number = process.env.UI_PULL_NUMBER
  assert.match(source ?? "", /^[a-f0-9]{40}$/)
  assert.match(number ?? "", /^\d+$/)
  const pull = await api.request<Pull>(`/repos/${UI_REPOSITORY}/pulls/${number}`)
  assert.equal(pull!.state, "open")
  assert.equal(pull!.head.sha, source, "candidate changed since its validation")
  assert.equal(pull!.base.ref, "dev")
  const files = await api.request<{ filename: string }[]>(`/repos/${UI_REPOSITORY}/pulls/${number}/files?per_page=100`)
  assert.ok(files!.every((file) => ["upstream.json", "ui-package.json", "package.json", "bun.lock"].includes(file.filename)), "candidate contains changes outside the automatic source update")
  const result = await api.request<{ merged: boolean; sha: string }>(`/repos/${UI_REPOSITORY}/pulls/${number}/merge`, {
    method: "PUT", body: { sha: source, merge_method: "squash", commit_title: `chore(ui): merge validated upstream update (UI-001)` },
  })
  assert.equal(result!.merged, true)
  await output({ merged: result!.sha, source: source! })
}
