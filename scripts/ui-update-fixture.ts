import { mkdtemp, writeFile } from "node:fs/promises"
import { join, extname, resolve } from "node:path"
import { uiManifest } from "../src/ui/manifest"
import { createUIArchive } from "./ui-package"

export async function createUIUpdateFixture(builtinDirectory: string) {
  const root = resolve(import.meta.dir, "..")
  const output = await mkdtemp(join(root, "artifacts/local-ui-"))
  const original = uiManifest.parse(await Bun.file(join(builtinDirectory, "ui-manifest.json")).json())
  const updated = { ...original, id: `opencode-${original.upstreamVersion}-vscode.${original.revision + 1}`, revision: original.revision + 1 }
  const files: Record<string, Uint8Array> = {}
  for (const path of new Bun.Glob("**/*").scanSync({ cwd: builtinDirectory, onlyFiles: true })) {
    const file = Bun.file(join(builtinDirectory, path))
    // 保留真实官方业务代码，仅更改编译进握手的包 ID，验证本地导入和缓存。
    files[path.replaceAll("\\", "/")] = path.endsWith(".js")
      ? Buffer.from((await file.text()).replaceAll(original.id, updated.id))
      : new Uint8Array(await file.arrayBuffer())
  }
  files["ui-manifest.json"] = Buffer.from(JSON.stringify(updated))
  const zip = join(output, "local-ui.zip")
  await writeFile(zip, createUIArchive(files))
  let directory = builtinDirectory
  const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".wasm": "application/wasm" }
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request): Promise<Response> {
      const path = new URL(request.url).pathname
      const file = Bun.file(join(directory, path === "/" ? "index.html" : path))
      if (!await file.exists()) return new Response(null, { status: 404 })
      return new Response(file, { headers: { "content-type": types[extname(path === "/" ? "index.html" : path)] ?? "application/octet-stream", "cache-control": "no-store" } })
    },
  })
  return {
    original, updated, zip, server,
    use(next: string) { directory = next },
    [Symbol.dispose]() { server.stop(true) },
  }
}
