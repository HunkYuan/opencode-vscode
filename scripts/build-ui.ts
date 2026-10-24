import { build } from "vite"
import { mkdir } from "node:fs/promises"
import { resolve, join } from "node:path"
import { uiManifest } from "../src/ui/manifest"
import { HOST_PROTOCOL } from "../src/protocol"
import { webviewWorkers } from "./workers"
import { hostAdapters } from "./adapters"
import { webviewSprites } from "./sprites"
import { buildNotices } from "./notices"

export async function buildUI() {
  const root = resolve(import.meta.dir, "..")
  const provenance = await Bun.file(join(root, "upstream.json")).json()
  const manifest = uiManifest.parse(await Bun.file(join(root, "ui-package.json")).json())
  if (manifest.upstreamVersion !== provenance.version || manifest.upstreamCommit !== provenance.commit || manifest.hostProtocol !== HOST_PROTOCOL)
    throw new Error("UI package declaration does not match its pinned source or host protocol")
  const { default: plugins } = await import("../.upstream/packages/app/vite.js")
  await build({
    configFile: false,
    root: join(root, "webview"),
    base: "./",
    publicDir: join(root, ".upstream/packages/app/public"),
    define: { __UI_PACKAGE__: JSON.stringify(manifest) },
    plugins: [webviewWorkers(), hostAdapters(root), webviewSprites(root), plugins],
    resolve: { dedupe: ["solid-js", "@solidjs/router"], alias: { "@ibm/plex/IBM-Plex-Mono/fonts/complete/woff2/IBMPlexMono-Text.woff2": join(root, ".upstream/assets/IBMPlexMono-Text.woff2") } },
    build: {
      outDir: join(root, "dist/webview"),
      emptyOutDir: true,
      target: "esnext",
      assetsDir: "assets",
      manifest: true,
      sourcemap: false,
    },
  })
  await mkdir(join(root, "dist"), { recursive: true })
  await Bun.write(join(root, "dist/webview/ui-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  await Bun.write(join(root, "dist/webview/upstream.json"), JSON.stringify(provenance, null, 2) + "\n")
  await Bun.write(join(root, "dist/upstream.json"), JSON.stringify(provenance, null, 2) + "\n")
  await buildNotices(join(root, "dist/webview/licenses"))
}

if (import.meta.main) await buildUI()
