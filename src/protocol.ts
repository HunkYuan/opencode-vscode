import { z } from "zod"

export const editorContext = z.object({
  directory: z.string(),
  path: z.string(),
  content: z.string(),
  dirty: z.boolean(),
  selection: z.object({
    startLine: z.number().int().positive(),
    startChar: z.number().int().nonnegative(),
    endLine: z.number().int().positive(),
    endChar: z.number().int().nonnegative(),
  }).optional(),
})

export type EditorContext = z.infer<typeof editorContext>
export type ServiceState = {
  status: "connecting" | "ready" | "disabled" | "stopped" | "error"
  message?: string
  url?: string
  serviceVersion?: string
  uiVersion: string
  mismatch?: boolean
}

export const request = z.discriminatedUnion("method", [
  z.object({ id: z.string(), method: z.literal("ready"), origin: z.string() }),
  z.object({ id: z.string(), method: z.literal("uiReady") }),
  z.object({ id: z.string(), method: z.literal("editorReady"), ready: z.boolean() }),
  z.object({ id: z.string(), method: z.literal("interfaceReady"), ready: z.boolean() }),
  z.object({ id: z.string(), method: z.literal("reconnect") }),
  z.object({ id: z.string(), method: z.literal("enableService") }),
  z.object({ id: z.string(), method: z.literal("openExternal"), url: z.string() }),
  z.object({ id: z.string(), method: z.literal("openFile"), path: z.string(), directory: z.string().optional(), line: z.number().int().positive().optional(), character: z.number().int().nonnegative().optional() }),
  z.object({ id: z.string(), method: z.literal("fileExists"), path: z.string(), directory: z.string().optional() }),
  z.object({ id: z.string(), method: z.literal("pickDirectory") }),
  z.object({ id: z.string(), method: z.literal("clipboard"), text: z.string() }),
  z.object({ id: z.string(), method: z.literal("storageRead"), name: z.string() }),
  z.object({ id: z.string(), method: z.literal("storageWrite"), name: z.string(), values: z.record(z.string(), z.string().nullable()) }),
  z.object({ id: z.string(), method: z.literal("draftGet"), key: z.string() }),
  z.object({ id: z.string(), method: z.literal("draftSet"), key: z.string(), value: z.string(), strict: z.boolean() }),
  z.object({ id: z.string(), method: z.literal("draftRemove"), key: z.string() }),
  z.object({ id: z.string(), method: z.literal("blobPut"), data: z.string(), mime: z.string() }),
  z.object({ id: z.string(), method: z.literal("blobGet"), key: z.string() }),
  z.object({ id: z.string(), method: z.literal("route"), route: z.string(), sessionID: z.string().optional(), directory: z.string().optional() }),
  z.object({ id: z.string(), method: z.literal("review"), sessionID: z.string(), directory: z.string() }),
  z.object({ id: z.string(), method: z.literal("log"), message: z.string() }),
])

export type Request = z.infer<typeof request>
export type Bootstrap = {
  service: ServiceState
  directory?: string
  route: string
  windowID: string
  locale: string
  theme: "light" | "dark"
  followTheme: boolean
}
export type HostMessage =
  | { type: "result"; id: string; value?: unknown; error?: string }
  | { type: "service"; service: ServiceState }
  | { type: "context"; context: EditorContext }
  | { type: "newSession"; directory?: string }
  | { type: "theme"; theme: "light" | "dark"; followTheme: boolean }
