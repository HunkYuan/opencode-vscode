import { execFile } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { delimiter, join, extname } from "node:path"
import { promisify } from "node:util"
import { homedir } from "node:os"
import { z } from "zod"

const execute = promisify(execFile)
const health = z.object({ version: z.string(), pid: z.number().int().nonnegative(), urls: z.array(z.string()), paths: z.object({ tmp: z.string() }) })
export type Endpoint = { url: string; password: string; version: string }
export class ServiceDisabled extends Error {}
export class ServiceStopped extends Error {}

export class LocalService {
  private executable?: string
  private pending?: Promise<Endpoint>
  private endpoint?: Endpoint

  constructor(private readonly options: { cliPath: () => string; autoStart: () => boolean; log: (message: string) => void }) {}

  async command(args: string[]) {
    const executable = this.executable ??= await locateCli(this.options.cliPath())
    const result = await execute(executable, args, { windowsHide: true, timeout: 130_000, maxBuffer: 256 * 1024 })
      .catch((error: unknown) => {
        // 命令输出可能含凭据；失败提示只保留命令名称，密码永不进入日志。
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown"
        throw new Error(`OpenCode ${args.slice(0, 2).join(" ")} failed (${code}). Check the configured CLI path and OpenCode logs.`)
      })
    return result.stdout.trim()
  }

  connect() {
    if (this.pending) return this.pending
    this.pending = this.resolve().catch((error: unknown) => { this.endpoint = undefined; throw error }).finally(() => { this.pending = undefined })
    return this.pending
  }

  async enable() {
    await this.command(["service", "set", "disabled", "false"])
    return this.connect()
  }

  current() {
    return this.endpoint
  }

  private async resolve() {
    const disabled = await this.command(["service", "get", "disabled"])
    if (disabled !== "true" && disabled !== "false") throw new Error("OpenCode returned an invalid disabled setting.")
    if (disabled === "true") throw new ServiceDisabled("The shared OpenCode service is disabled.")
    const status = await this.command(["service", "status"])
    const url = status === "stopped"
      ? await this.start()
      : status
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
      throw new Error("The shared service must advertise a local loopback URL.")
    const password = await this.command(["service", "get", "password"])
    const response = await fetch(new URL("/api/info", url), {
      headers: { Authorization: "Basic " + Buffer.from("opencode:" + password).toString("base64") },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`OpenCode service health check failed (HTTP ${response.status}). Update OpenCode if its API is incompatible.`)
    const result = health.safeParse(await response.json())
    if (!result.success) throw new Error("OpenCode did not provide a compatible service API. Update OpenCode and reconnect.")
    const info = result.data
    this.endpoint = { url, password, version: info.version }
    this.options.log(`Connected to shared OpenCode ${info.version} at ${url}`)
    return this.endpoint
  }

  private async start() {
    if (!this.options.autoStart()) throw new ServiceStopped("The shared service is stopped and automatic startup is disabled.")
    this.options.log("Starting the shared service with the installed OpenCode CLI")
    return this.command(["service", "start"])
  }
}

export async function locateCli(configured: string) {
  if (configured) {
    await access(configured)
    if (process.platform === "win32" && [".cmd", ".bat", ".ps1"].includes(extname(configured).toLowerCase())) {
      const content = await readFile(configured, "utf8")
      const npmRoot = configured.slice(0, Math.max(configured.lastIndexOf("\\"), configured.lastIndexOf("/")))
      const executable = join(npmRoot, "node_modules", "@opencode", "cli", "bin", "opencode.exe")
      if (content.includes("@opencode/cli") && await access(executable).then(() => true, () => false)) return executable
      throw new Error("Configure opencodeSidebar.cliPath with opencode.exe rather than a shell wrapper.")
    }
    return configured
  }
  const candidates = process.platform === "win32"
    ? [
      ...((process.env.PATH ?? "").split(delimiter).map((path) => join(path, "opencode.exe"))),
      join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), "npm/node_modules/@opencode/cli/bin/opencode.exe"),
      join(homedir(), ".opencode/bin/opencode.exe"),
    ]
    : [...((process.env.PATH ?? "").split(delimiter).map((path) => join(path, "opencode"))), join(homedir(), ".opencode/bin/opencode")]
  for (const path of candidates) {
    if (await access(path).then(() => true, () => false)) return path
  }
  throw new Error("OpenCode CLI was not found. Install it or configure opencodeSidebar.cliPath.")
}
