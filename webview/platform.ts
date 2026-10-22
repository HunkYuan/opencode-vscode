import type { Platform } from "@opencode/app"
import type { Bootstrap } from "../src/protocol"
import { call } from "./bridge"
import { createStorage, createDrafts } from "./storage"

export function createPlatform(initial: Bootstrap): Platform {
  return {
    platform: "desktop",
    // 宿主已提供标题栏，使用现有无原生窗口控件的平台分支。
    os: "linux",
    version: initial.service.uiVersion,
    windowID: initial.windowID,
    storage: createStorage(),
    draftStore: createDrafts(),
    openExternal: (url) => { void call({ method: "openExternal", url }) },
    openBrowser: async (url) => { await call({ method: "openExternal", url }); return true },
    openPath: async (path) => { await call({ method: "openFile", path }) },
    openLocalFile: (url) => { void call({ method: "openExternal", url }) },
    revealPath: async (path) => { await call({ method: "openFile", path }); return true },
    openDirectoryPickerDialog: () => call<string | null>({ method: "pickDirectory" }),
    restart: async () => { await call({ method: "reconnect" }) },
    notify: async (title, description) => { await call({ method: "log", message: [title, description].filter(Boolean).join(": ") }) },
    writeClipboardText: async (text) => { await call({ method: "clipboard", text }) },
    recordFatalRendererError: async (error) => { await call({ method: "log", message: error.error }) },
  }
}
