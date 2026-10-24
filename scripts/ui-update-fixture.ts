import { createHash } from "node:crypto"
import { join, extname } from "node:path"
import { zipSync } from "fflate"
import { uiManifest, type UiRelease } from "../src/ui/manifest"

export async function createUIUpdateFixture(builtinDirectory: string) {
  const original = uiManifest.parse(await Bun.file(join(builtinDirectory, "ui-manifest.json")).json())
  const updated = { ...original, id: `opencode-${original.upstreamVersion}-vscode.${original.revision + 1}`, revision: original.revision + 1 }
  const files: Record<string, Uint8Array> = {}
  for (const path of new Bun.Glob("**/*").scanSync({ cwd: builtinDirectory, onlyFiles: true })) {
    const file = Bun.file(join(builtinDirectory, path))
    // 保留真实官方业务代码，仅更改编译进握手的包 ID，验证更新与缓存而非模拟 UI。
    files[path.replaceAll("\\", "/")] = path.endsWith(".js")
      ? Buffer.from((await file.text()).replaceAll(original.id, updated.id))
      : new Uint8Array(await file.arrayBuffer())
  }
  files["ui-manifest.json"] = Buffer.from(JSON.stringify(updated))
  const bytes = zipSync(files)
  let directory = builtinDirectory
  const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".wasm": "application/wasm" }
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request): Promise<Response> {
      const path = new URL(request.url).pathname
      if (path === "/stable.json") return Response.json({ schemaVersion: 1, releases: [release] })
      if (path === "/package.zip") return new Response(Buffer.from(bytes))
      const file = Bun.file(join(directory, path === "/" ? "index.html" : path))
      if (!await file.exists()) return new Response(null, { status: 404 })
      return new Response(file, { headers: { "content-type": types[extname(path === "/" ? "index.html" : path)] ?? "application/octet-stream", "cache-control": "no-store" } })
    },
  })
  const release: UiRelease = { ...updated, url: server.url.origin + "/package.zip", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }
  return {
    original,
    updated,
    release,
    server,
    use(next: string) { directory = next },
    [Symbol.dispose]() { server.stop(true) },
  }
}
