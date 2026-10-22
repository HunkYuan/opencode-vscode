import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { expect } from "@playwright/test"
import { OpenCode, type SessionInboxUser, type SessionPromptInput } from "@opencode/client/promise"
import type { EditorContext } from "../src/protocol"
import { locateCli } from "../src/service"

type ProviderRequest = {
  messages: { role: string; content: string | { type: string; text?: string }[] }[]
}

export async function createAttachmentFixture() {
  const root = resolve(import.meta.dir, "..")
  await mkdir(join(root, "artifacts"), { recursive: true })
  const directory = await mkdtemp(join(root, "artifacts/attachment-test-"))
  const project = join(directory, "project")
  const environment = {
    ...process.env,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_DATA_HOME: join(directory, "data"),
    XDG_CACHE_HOME: join(directory, "cache"),
    XDG_STATE_HOME: join(directory, "state"),
  }
  const requests: ProviderRequest[] = []
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.json() as ProviderRequest)
      const chunk = { id: "chatcmpl_fixture", object: "chat.completion.chunk", created: 1, model: "snapshot" }
      return new Response([
        "data: " + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "附件验证完成。" }, finish_reason: null }] }),
        "data: " + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        "data: [DONE]",
        "",
      ].join("\n\n"), { headers: { "content-type": "text/event-stream" } })
    },
  })
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const execute = promisify(execFile)
  const executable = await locateCli("")
  const command = async (...args: string[]) =>
    (await execute(executable, args, { env: environment, windowsHide: true, timeout: 130_000 })).stdout.trim()

  await mkdir(join(environment.XDG_CONFIG_HOME, "opencode"), { recursive: true })
  await mkdir(join(project, "中文 # %"), { recursive: true })
  await execute("git", ["init", "--quiet", project], { windowsHide: true })
  await writeFile(join(environment.XDG_CONFIG_HOME, "opencode/service.json"), JSON.stringify({ port }))
  await writeFile(join(environment.XDG_CONFIG_HOME, "opencode/opencode.json"), JSON.stringify({
    model: "attachment-fixture/snapshot",
    agents: { build: { mode: "primary", system: "Reply with a brief confirmation. Do not use tools.", steps: 1 } },
    snapshots: false,
    warming: false,
    policies: [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "attachment-fixture", effect: "allow" },
    ],
    providers: {
      "attachment-fixture": {
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: provider.url.origin + "/v1", apiKey: "fixture" },
        models: {
          snapshot: {
            name: "Attachment fixture",
            capabilities: { tools: false, input: ["text"], output: ["text"], reasoning: { supported: false } },
            limit: { context: 200_000, output: 1_000 },
          },
        },
      },
    },
  }))
  const raw = Buffer.concat([Buffer.from("// "), Buffer.from("d6d0cec4", "hex"), Buffer.from("\r\nconst int saved_marker = 42;\r\n")])
  const saved = { directory: project, path: "中文 # %/saved file.cpp", content: new TextDecoder("gbk", { fatal: true }).decode(raw), dirty: false }
  await writeFile(join(project, saved.path), raw)
  await writeFile(join(project, "utf8.cpp"), "// UTF-8 中文 😀\nconst int utf8_marker = 8;\n", "utf8")
  await writeFile(join(project, "empty.cpp"), "")
  const contexts: { label: string; context: EditorContext }[] = [
    { label: "saved-gbk", context: saved },
    { label: "saved-utf8", context: { directory: project, path: "utf8.cpp", content: "// UTF-8 中文 😀\nconst int utf8_marker = 8;\n", dirty: false } },
    { label: "unsaved-file", context: { ...saved, content: saved.content + "const int unsaved_marker = 99;\r\n", dirty: true } },
    { label: "saved-selection", context: { ...saved, content: "const int saved_marker = 42;", selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 28 } } },
    { label: "unsaved-selection", context: { ...saved, content: "const int unsaved_marker = 99;", dirty: true, selection: { startLine: 3, startChar: 0, endLine: 3, endChar: 30 } } },
    { label: "empty-file", context: { directory: project, path: "empty.cpp", content: "", dirty: false } },
  ]

  const url = await command("service", "start").catch((error: unknown) => { provider.stop(true); throw error })
  const password = await command("service", "get", "password")
  const endpoint = { url, password, version: "2.1.2" }
  const api = OpenCode.make({ baseUrl: url, headers: { Authorization: "Basic " + Buffer.from("opencode:" + password).toString("base64") } })

  // 新 location 首次加载插件是异步的；等待专用 Agent 完成配置，再挂载 UI。
  await api.session.create({ location: { directory: project }, title: "Attachment fixture bootstrap", agent: "build", model: { providerID: "attachment-fixture", id: "snapshot" } })
  await expect.poll(async () => (await api.agent.list({ location: { directory: project } })).data.some((agent) => agent.id === "build" && agent.steps === 1), { timeout: 30_000 }).toBe(true)

  return {
    directory,
    project,
    environment,
    endpoint,
    api,
    contexts,
    raw,
    requests,
    async waitForModel(snapshot: string) {
      await expect.poll(() => requests.some((request) => providerText(request).includes(snapshot)), { timeout: 30_000 }).toBe(true)
    },
    async [Symbol.asyncDispose]() {
      await command("service", "stop").finally(() => provider.stop(true))
    },
  }
}

export function verifyEditorAttachment(
  request: Pick<SessionPromptInput, "id" | "text" | "files">,
  admitted: SessionInboxUser,
  context: EditorContext,
) {
  assert.equal(request.files?.length, 1, "sending must include exactly one editor snapshot")
  const file = request.files![0]!
  assert.ok(file.uri.startsWith("data:text/plain;base64,"), "editor content must travel as UTF-8 text rather than a server-read file URI")
  const snapshot = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(file.uri.slice(file.uri.indexOf(",") + 1), "base64"))
  const path = context.directory.replaceAll("\\", "/").replace(/\/$/, "") + "/" + context.path.replaceAll("\\", "/")
  assert.equal(file.name, path, "attachment name must preserve the absolute editor path")
  assert.ok(snapshot.includes("\nFile: " + path + "\n"), "model-visible snapshot must name the source file")
  assert.ok(snapshot.endsWith("\n\n" + context.content), "snapshot must preserve exactly the captured editor content")
  assert.ok(snapshot.includes(context.dirty ? "State: unsaved editor content" : "State: saved editor content"))
  if (context.selection)
    assert.ok(snapshot.includes(`Selection: ${context.selection.startLine}:${context.selection.startChar + 1}-${context.selection.endLine}:${context.selection.endChar + 1}`))
  assert.equal(admitted.id, request.id)
  assert.equal(admitted.payload.files?.length, 1)
  assert.equal(admitted.payload.files![0]!.mime, "text/plain", "service must recognize the snapshot as model-readable text")
  assert.equal(Buffer.from(admitted.payload.files![0]!.data, "base64").toString("utf8"), snapshot)
  return snapshot
}

function providerText(request: ProviderRequest) {
  return request.messages.filter((message) => message.role === "user").map((message) =>
    typeof message.content === "string" ? message.content : message.content.map((part) => part.text ?? "").join("\n"),
  ).join("\n")
}
