import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import esbuild from "esbuild"

export async function buildHost() {
  const root = resolve(import.meta.dir, "..")
  await mkdir(join(root, "dist"), { recursive: true })
  const result = await esbuild.build({
    entryPoints: [join(root, "src/extension.ts")],
    outfile: join(root, "dist/extension.cjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    sourcemap: true,
    metafile: true,
  })
  if (Object.keys(result.metafile.inputs).some((path) => path.includes(".upstream/") || path.includes("@opencode/")))
    throw new Error("Extension Host must not depend on the OpenCode SDK or official UI")
  await mkdir(join(root, "artifacts"), { recursive: true })
  await Bun.write(join(root, "artifacts/host-inputs.json"), JSON.stringify(Object.keys(result.metafile.inputs), null, 2))
  console.log("Built stable extension Host without OpenCode runtime dependencies")
}

if (import.meta.main) await buildHost()
