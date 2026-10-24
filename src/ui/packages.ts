import { createHash, randomUUID } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"
import { z } from "zod"
import { extractUI } from "./archive"
import { compatible, newer, uiArchive, uiManifest, type UiManifest, type UiArchive } from "./manifest"

export type UiBundle = { directory: string; manifest: UiManifest; archive?: UiArchive }
const stateSchema = z.object({
  installed: z.array(uiArchive).default([]),
  lastGood: z.string().optional(),
  previous: z.string().optional(),
  pending: z.string().optional(),
  pinned: z.string().optional(),
  failed: z.array(z.string()).default([]),
})
type State = z.infer<typeof stateSchema>

export class UiPackages {
  private writing = Promise.resolve()
  private importing = Promise.resolve()
  private builtin?: Promise<UiBundle>

  constructor(private readonly options: {
    directory: string
    builtinDirectory: string
    hostProtocol: number
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
    const installed = state.installed.filter((archive) => !state.failed.includes(archive.id) && compatible(archive, serviceVersion, this.options.hostProtocol)).sort((a, b) => newer(b, a))
    for (const archive of installed) {
      const bundle = await this.bundle(archive.id).catch(() => undefined)
      if (bundle) return bundle
    }
    // service 版本尚未验证时保留已有 UI，不替换正在运行的 service。
    this.options.log(`No local UI compatibility declaration for OpenCode ${serviceVersion ?? "unknown"}; using the last available UI`)
    const last = state.lastGood && !state.failed.includes(state.lastGood) ? await this.bundle(state.lastGood).catch(() => undefined) : undefined
    return last ?? builtin
  }

  importPackage(file: string, serviceVersion?: string) {
    const next = this.importing.then(() => this.importLocal(file, serviceVersion))
    this.importing = next.then(() => {}, () => {})
    return next
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
    for (const id of [state.previous, builtin.manifest.id]) {
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

  private async importLocal(file: string, serviceVersion?: string): Promise<UiBundle> {
    const info = await stat(file)
    if (!info.isFile() || info.size === 0 || info.size > 128 * 1024 * 1024)
      throw new Error("请选择不超过 128 MiB 的本地 UI ZIP 文件。")
    const bytes = await readFile(file)
    if (bytes.byteLength > 128 * 1024 * 1024) throw new Error("UI ZIP exceeds the installation size limit")
    await mkdir(this.options.directory, { recursive: true })
    const temporary = await mkdtemp(join(this.options.directory, "import-"))
    const root = resolve(this.options.directory)
    if (!resolve(temporary).startsWith(root + sep)) throw new Error("Temporary import directory leaves the UI cache")
    try {
      const content = join(temporary, "content")
      const manifest = await extractUI(bytes, content)
      if (!compatible(manifest, serviceVersion, this.options.hostProtocol))
        throw new Error(`UI ${manifest.id} 不兼容：需要宿主协议 ${manifest.hostProtocol}，声明的服务范围为 ${manifest.serviceRange}。`)
      const builtin = await this.bundled()
      if (manifest.id === builtin.manifest.id)
        throw new Error("UI 包 ID 与内置版本相同。请执行 ui:upstream 增加修订号后重新构建。")
      const archive = uiArchive.parse({
        ...manifest, fileName: basename(file),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      })
      const destination = this.cachePath(manifest.id)
      const installed = await this.readBundle(destination).catch(() => undefined)
      if (installed && installed.archive?.sha256 !== archive.sha256)
        throw new Error("已有相同 ID 的 UI 包且内容不同，请增加修订号后重新构建。")
      if (!installed) {
        await writeFile(join(content, "ui-install.json"), JSON.stringify(archive) + "\n")
        await mkdir(resolve(destination, ".."), { recursive: true })
        await rename(content, destination).catch(async (error: unknown) => {
          // 多窗口可能导入同一包；只接受已完整安装且校验一致的内容。
          const complete = await this.readBundle(destination).catch(() => undefined)
          if (complete?.archive?.sha256 !== archive.sha256) throw error
        })
      }
      const bundle = await this.readBundle(destination)
      await this.update((state) => ({
        ...state,
        installed: [archive, ...state.installed.filter((item) => item.id !== archive.id)],
        pending: archive.id,
        pinned: undefined,
        failed: state.failed.filter((id) => id !== archive.id),
      }))
      this.options.log(`Local UI ${manifest.id} imported and verified; it will be used on the next sidebar reload`)
      return bundle
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
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
    const raw = await readFile(join(directory, "ui-install.json"), "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    return { directory, manifest, archive: raw ? uiArchive.parse(JSON.parse(raw)) : undefined }
  }

  private async state(): Promise<State> {
    const raw = await readFile(join(this.options.directory, "state.json"), "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
      throw error
    })
    // 0.2.0 的 catalog/lastCheck 等线上字段不再使用，其余选包和回退记录仍可读取。
    return raw ? stateSchema.parse(JSON.parse(raw)) : stateSchema.parse({})
  }

  private update(change: (state: State) => State) {
    const next = this.writing.then(async () => {
      await mkdir(this.options.directory, { recursive: true })
      const file = join(this.options.directory, `state-${randomUUID()}.json`)
      await writeFile(file, JSON.stringify(change(await this.state())) + "\n", "utf8")
      await rename(file, join(this.options.directory, "state.json"))
    })
    this.writing = next.catch(() => {})
    return next
  }
}
