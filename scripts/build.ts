import { build } from "vite"
import esbuild from "esbuild"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { webviewWorkers } from "./workers"
import { hostAdapters } from "./adapters"
import { webviewSprites } from "./sprites"

const root = resolve(import.meta.dir, "..")
const provenance = await Bun.file(join(root, "upstream.json")).json()
const { default: plugins } = await import("../.upstream/packages/app/vite.js")
await mkdir(join(root, "dist"), { recursive: true })
await esbuild.build({
  entryPoints: [join(root, "src/extension.ts")],
  outfile: join(root, "dist/extension.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  define: { __OPENCODE_VERSION__: JSON.stringify(provenance.version) },
})
await build({
  configFile: false,
  root: join(root, "webview"),
  base: "./",
  publicDir: join(root, ".upstream/packages/app/public"),
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
await writeFile(join(root, "dist/upstream.json"), JSON.stringify(provenance, null, 2) + "\n")
await import("./notices.ts")
