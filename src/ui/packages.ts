import { createHash, randomUUID } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { z } from "zod"
import { extractUI } from "./archive"
import { compatible, newer, uiCatalog, uiManifest, uiRelease, UI_INDEX_URL, type UiManifest, type UiRelease } from "./manifest"

export type UiBundle = { directory: string; manifest: UiManifest; release?: UiRelease }
const stateSchema = z.object({
  lastCheck: z.number().optional(),
  catalog: z.array(uiRelease).default([]),
  lastGood: z.string().optional(),
  previous: z.string().optional(),
  pending: z.string().optional(),
  pinned: z.string().optional(),
  failed: z.array(z.string()).default([]),
})
type State = z.infer<typeof stateSchema>
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

export class UiPackages {
  private writing = Promise.resolve()
  private checking?: Promise<UiBundle | undefined>
  private readonly installs = new Map<string, Promise<UiBundle>>()
  private builtin?: Promise<UiBundle>

  constructor(private readonly options: {
    directory: string
    builtinDirectory: string
    hostProtocol: number
    indexURL?: string
    log: (message: string) => void
  }) {}

  bundled() {
    return this.builtin ??= this.readBundle(this.options.builtinDirectory)
  }

  async select(serviceVersion?: string): Promise<UiBundle> {
    const builtin = await this.bundled()
    const state = await this.state()
    for (const id of [state.pinned, state.pending, state.lastGood]) {
      if (!id || state.failed.includes(id)) continue
      const bundle = await this.bundle(id).catch(() => undefined)
      if (bundle && compatible(bundle.manifest, serviceVersion, this.options.hostProtocol)) return bundle
    }
    if (compatible(builtin.manifest, serviceVersion, this.options.hostProtocol)) return builtin
    const cached = state.catalog.filter((release) => !state.failed.includes(release.id) && compatible(release, serviceVersion, this.options.hostProtocol)).sort((a, b) => newer(b, a))
    for (const release of cached) {
      const bundle = await this.bundle(release.id).catch(() => undefined)
      if (bundle) return bundle
    }
    // service 版本尚未验证时保留已有 UI，不替换正在运行的 service。
    this.options.log(`No UI compatibility declaration for OpenCode ${serviceVersion ?? "unknown"}; using the last available UI`)
    const last = state.lastGood && !state.failed.includes(state.lastGood) ? await this.bundle(state.lastGood).catch(() => undefined) : undefined
    return last ?? builtin
  }

  check(serviceVersion: string | undefined, current: UiBundle, force = false) {
    if (this.checking) return this.checking
    this.checking = this.resolveUpdate(serviceVersion, current, force).finally(() => { this.checking = undefined })
    return this.checking
  }

  async loaded(bundle: UiBundle) {
    await this.update((state) => ({
      ...state,
      previous: state.lastGood && state.lastGood !== bundle.manifest.id ? state.lastGood : state.previous,
      lastGood: bundle.manifest.id,
      pending: state.pending === bundle.manifest.id ? undefined : state.pending,
    }))
  }

  async failed(bundle: UiBundle) {
    await this.update((state) => ({
      ...state,
      failed: [...new Set([...state.failed, bundle.manifest.id])],
      pending: state.pending === bundle.manifest.id ? undefined : state.pending,
      pinned: state.pinned === bundle.manifest.id ? undefined : state.pinned,
    }))
  }

  async rollback(serviceVersion?: string) {
    const state = await this.state()
    const builtin = await this.bundled()
    const choices = [state.previous, builtin.manifest.id]
    for (const id of choices) {
      if (!id || id === state.lastGood || state.failed.includes(id)) continue
      const bundle = await this.bundle(id).catch(() => undefined)
      if (!bundle || !compatible(bundle.manifest, serviceVersion, this.options.hostProtocol)) continue
      await this.update((value) => ({ ...value, pinned: id, pending: undefined }))
      return bundle
    }
    throw new Error("没有可回退的兼容 UI 包。")
  }

  async pending() {
    const state = await this.state()
    return state.pending ? this.bundle(state.pending) : undefined
  }

  private async resolveUpdate(serviceVersion: string | undefined, current: UiBundle, force: boolean) {
    const state = await this.state()
    if (state.pinned && !force) return undefined
    const fresh = force || !state.lastCheck || Date.now() - state.lastCheck >= CHECK_INTERVAL
    const releases = fresh
      ? uiCatalog.parse(await this.fetchJSON(this.options.indexURL ?? UI_INDEX_URL)).releases
      : state.catalog
    if (fresh) await this.update((value) => ({ ...value, lastCheck: Date.now(), catalog: releases, pinned: force ? undefined : value.pinned }))
    const target = releases.filter((release) =>
      !state.failed.includes(release.id) &&
      compatible(release, serviceVersion, this.options.hostProtocol) &&
      (newer(release, current.manifest) > 0 || !compatible(current.manifest, serviceVersion, this.options.hostProtocol)),
    ).sort((a, b) => newer(b, a))[0]
    if (!target) return undefined
    const bundle = await this.install(target)
    await this.update((value) => ({ ...value, pending: bundle.manifest.id }))
    this.options.log(`UI ${target.id} downloaded and verified; it will be used on the next sidebar reload`)
    return bundle
  }

  private install(release: UiRelease) {
    const existing = this.installs.get(release.id)
    if (existing) return existing
    const next = this.download(release).finally(() => this.installs.delete(release.id))
    this.installs.set(release.id, next)
    return next
  }

  private async download(release: UiRelease): Promise<UiBundle> {
    const destination = this.cachePath(release.id)
    const installed = await this.readBundle(destination).catch(() => undefined)
    if (installed) {
      if (installed.release?.sha256 !== release.sha256) throw new Error("A UI package version was republished with different contents")
      return installed
    }
    await mkdir(this.options.directory, { recursive: true })
    const directory = await mkdtemp(join(this.options.directory, "install-"))
    const response = await fetch(release.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`UI download failed (HTTP ${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== release.size || createHash("sha256").update(bytes).digest("hex") !== release.sha256)
      throw new Error("UI package checksum or download size does not match its release")
    await writeFile(join(directory, "download.zip"), bytes)
    const content = join(directory, "content")
    await mkdir(content)
    await extractUI(bytes, content)
    const candidate = await this.readBundle(content)
    if (JSON.stringify(candidate.manifest) !== JSON.stringify(uiManifest.parse(release)))
      throw new Error("UI archive manifest differs from the update catalog")
    await writeFile(join(content, "ui-release.json"), JSON.stringify(release) + "\n")
    await mkdir(resolve(destination, ".."), { recursive: true })
    await rename(content, destination).catch(async (error: unknown) => {
      // 多窗口可能同时安装相同不可变包；只复用内容校验一致的已完成安装。
      const complete = await this.readBundle(destination).catch(() => undefined)
      if (complete?.release?.sha256 !== release.sha256) throw error
    })
    return this.readBundle(destination)
  }

  private cachePath(id: string) {
    const root = resolve(this.options.directory, "packages")
    const target = resolve(root, id)
    if (!target.startsWith(root + sep)) throw new Error("UI package id leaves its cache")
    return target
  }

  private async bundle(id: string) {
    const builtin = await this.bundled()
    return id === builtin.manifest.id ? builtin : this.readBundle(this.cachePath(id))
  }

  private async readBundle(directory: string): Promise<UiBundle> {
    const manifest = uiManifest.parse(JSON.parse(await readFile(join(directory, "ui-manifest.json"), "utf8")))
    if (manifest.hostProtocol !== this.options.hostProtocol) throw new Error("UI package requires a different host protocol")
    await access(join(directory, manifest.entry))
    const raw = await readFile(join(directory, "ui-release.json"), "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    return { directory, manifest, release: raw ? uiRelease.parse(JSON.parse(raw)) : undefined }
  }

  private async state(): Promise<State> {
    const raw = await readFile(join(this.options.directory, "state.json"), "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    return raw ? stateSchema.parse(JSON.parse(raw)) : stateSchema.parse({})
  }

  private update(change: (state: State) => State) {
    const next = this.writing.then(async () => {
      const state = change(await this.state())
      await mkdir(this.options.directory, { recursive: true })
      const file = join(this.options.directory, `state-${randomUUID()}.json`)
      await writeFile(file, JSON.stringify(state) + "\n", "utf8")
      await rename(file, join(this.options.directory, "state.json"))
    })
    this.writing = next.catch(() => {})
    return next
  }

  private async fetchJSON(url: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`UI update catalog unavailable (HTTP ${response.status})`)
    return response.json()
  }
}
