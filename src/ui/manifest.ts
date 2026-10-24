import { z } from "zod"
import semver from "semver"

export const UI_INDEX_URL = "https://raw.githubusercontent.com/HunkYuan/opencode-vscode/ui-updates/stable.json"

export const packagePath = z.string().min(1).refine((path) =>
  !path.startsWith("/") && !path.includes("\\") && !path.includes(":") &&
  path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
  "UI package path must remain inside its directory",
)

export const uiManifest = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,100}$/),
  revision: z.number().int().positive(),
  upstreamVersion: z.string().refine((version) => !!semver.valid(version), "Invalid upstream version"),
  upstreamCommit: z.string().regex(/^[a-f0-9]{40}$/),
  hostProtocol: z.number().int().positive(),
  serviceRange: z.string().refine((range) => !!semver.validRange(range), "Invalid service compatibility range"),
  entry: packagePath,
})
export type UiManifest = z.infer<typeof uiManifest>

export const uiRelease = uiManifest.extend({
  url: z.string().url().refine((value) => {
    const url = new URL(value)
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  }, "UI packages require HTTPS or a local distribution server"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(128 * 1024 * 1024),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
})
export type UiRelease = z.infer<typeof uiRelease>
export const uiCatalog = z.object({ schemaVersion: z.literal(1), releases: z.array(uiRelease).max(200) })

export function compatible(manifest: UiManifest, serviceVersion: string | undefined, hostProtocol: number) {
  return manifest.hostProtocol === hostProtocol &&
    (!serviceVersion || (!!semver.valid(serviceVersion) && semver.satisfies(serviceVersion, manifest.serviceRange)))
}

export function newer(left: UiManifest, right: UiManifest) {
  return semver.compare(left.upstreamVersion, right.upstreamVersion) || left.revision - right.revision
}
