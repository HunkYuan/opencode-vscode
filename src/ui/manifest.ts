import { z } from "zod"
import semver from "semver"

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

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const uiArchive = uiManifest.extend({
  fileName: packagePath,
  sha256,
  size: z.number().int().positive().max(128 * 1024 * 1024),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
})
export type UiArchive = z.infer<typeof uiArchive>
export const uiIntegrity = z.object({ schemaVersion: z.literal(1), files: z.record(packagePath, sha256) })

export function compatible(manifest: UiManifest, serviceVersion: string | undefined, hostProtocol: number) {
  return manifest.hostProtocol === hostProtocol &&
    (!serviceVersion || (!!semver.valid(serviceVersion) && semver.satisfies(serviceVersion, manifest.serviceRange)))
}

export function newer(left: UiManifest, right: UiManifest) {
  return semver.compare(left.upstreamVersion, right.upstreamVersion) || left.revision - right.revision
}
