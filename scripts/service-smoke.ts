import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer } from "node:net"
import { LocalService, ServiceDisabled, ServiceStopped, locateCli } from "../src/service"
import { OpenCode } from "@opencode/client/promise"

const root = resolve(import.meta.dir, "..")
await mkdir(join(root, "artifacts"), { recursive: true })
const executable = await locateCli("")
const execute = promisify(execFile)
const portProbe = createServer()
await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve))
const portAddress = portProbe.address()
if (!portAddress || typeof portAddress === "string") throw new Error("No test port")
const port = portAddress.port
await new Promise<void>((resolve) => portProbe.close(() => resolve()))
const isolated = await mkdtemp(join(root, "artifacts/service-test-"))
const environment = {
  XDG_CONFIG_HOME: join(isolated, "config"),
  XDG_DATA_HOME: join(isolated, "data"),
  XDG_CACHE_HOME: join(isolated, "cache"),
  XDG_STATE_HOME: join(isolated, "state"),
}
const wrappers = join(isolated, process.platform === "win32" ? "opencode.exe" : "opencode")
const runner = `#!/usr/bin/env bun
import { spawn } from "node:child_process"
const child = spawn(${JSON.stringify(executable)}, process.argv.slice(2), { windowsHide: true, env: { ...process.env, ...${JSON.stringify(environment)} }, stdio: "inherit" })
child.on("exit", (code) => process.exit(code ?? 1))
`
await Bun.write(join(isolated, "runner.ts"), runner)
const build = await Bun.build({ entrypoints: [join(isolated, "runner.ts")], compile: { outfile: wrappers } })
if (!build.success) throw new Error("Could not build isolated CLI wrapper.")
const commands = async (...args: string[]) => execute(executable, args, { windowsHide: true, env: { ...process.env, ...environment }, timeout: 130000 }).then((result) => result.stdout.trim())
await mkdir(environment.XDG_CONFIG_HOME + "/opencode", { recursive: true })
await writeFile(join(environment.XDG_CONFIG_HOME, "opencode/service.json"), JSON.stringify({ port }))
const log: string[] = []
const service = new LocalService({ cliPath: () => wrappers, autoStart: () => true, log: (message) => log.push(message) })
try {
  await commands("service", "set", "disabled", "true")
  await service.connect().then(() => { throw new Error("Disabled setting was ignored") }, (error) => {
    if (!(error instanceof ServiceDisabled)) throw error
  })
  await commands("service", "set", "disabled", "false")
  const stopped = new LocalService({ cliPath: () => wrappers, autoStart: () => false, log: () => {} })
  await stopped.connect().then(() => { throw new Error("Automatic startup setting was ignored") }, (error) => {
    if (!(error instanceof ServiceStopped)) throw error
  })
  const endpoints = await Promise.all([service.connect(), service.connect()])
  if (endpoints[0].url !== endpoints[1].url) throw new Error("Concurrent connects did not reuse one shared service")
  const first = endpoints[0]
  const api = OpenCode.make({ baseUrl: first.url, headers: { Authorization: "Basic " + Buffer.from("opencode:" + first.password).toString("base64") } })
  const info = await api.server.info()
  console.log("Isolated service startup:", info.version, first.url)
  const registration = await readFile(join(environment.XDG_STATE_HOME, "opencode/service.json"), "utf8").then(JSON.parse)
  const reused = await service.connect()
  const after = await readFile(join(environment.XDG_STATE_HOME, "opencode/service.json"), "utf8").then(JSON.parse)
  if (after.pid !== registration.pid || reused.url !== first.url) throw new Error("Existing shared service was replaced")
  await writeFile(join(isolated, "result.json"), JSON.stringify({ disabled: "passed", autoStartOff: "passed", missingStartup: "passed", reuse: "passed", serviceVersion: info.version, logs: log }, null, 2))
  console.log("Service disabled, autoStart=false, automatic startup and shared reuse verified")
} finally {
  await commands("service", "stop").catch(() => undefined)
}
