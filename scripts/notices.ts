import { mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"

export async function buildNotices(output: string) {
  const root = resolve(import.meta.dir, "..")
  await mkdir(output, { recursive: true })
  await writeFile(join(output, "IBM-Plex.txt"), await readFile(join(root, "resources/fonts/IBM-Plex-LICENSE.txt"), "utf8"))
  const licenses: { name: string; version: string; license?: string }[] = []
  for (const dir of await readdir(join(root, "node_modules/.bun"))) {
    const modules = join(root, "node_modules/.bun", dir, "node_modules")
    const entries = await readdir(modules).catch(() => [])
    for (const name of entries) {
      const nested = name.startsWith("@") ? (await readdir(join(modules, name)).catch(() => [])).map((part) => name + "/" + part) : [name]
      for (const packageName of nested) {
        const directory = join(modules, packageName)
        const manifest = await Bun.file(join(directory, "package.json")).json().catch(() => undefined)
        if (!manifest || licenses.some((entry) => entry.name === manifest.name && entry.version === manifest.version)) continue
        licenses.push({ name: manifest.name, version: manifest.version, license: typeof manifest.license === "string" ? manifest.license : undefined })
        const license = (await readdir(directory).catch(() => [])).find((file) => /^(?:license|licence|copying)(?:\.[a-z]+)?$/i.test(file))
        if (!license) continue
        await writeFile(join(output, manifest.name.replaceAll("/", "_").replaceAll("@", "") + "-" + manifest.version + ".txt"), await readFile(join(directory, license)))
      }
    }
  }
  await writeFile(join(output, "dependencies.json"), JSON.stringify(licenses.sort((a, b) => a.name.localeCompare(b.name)), null, 2))
  console.log("Recorded", licenses.length, "dependency licenses")
}

if (import.meta.main) await buildNotices(resolve(import.meta.dir, "../dist/licenses"))
