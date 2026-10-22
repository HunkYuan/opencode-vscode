import { createEffect, onCleanup } from "solid-js"
import type { ComposerAdapter } from "@/composer/adapter"
import { call, listen } from "./bridge"

export function attachComposer(adapter: ComposerAdapter) {
  let input = Promise.resolve()
  onCleanup(listen((message) => {
    if (message.type !== "context") return
    input = input.then(async () => {
      const context = message.context
      adapter.state.context.add({
        type: "file",
        path: context.directory.replaceAll("\\", "/").replace(/\/$/, "") + "/" + context.path,
        selection: context.selection,
        preview: context.selection ? context.content : undefined,
        comment: context.dirty ? "VS Code 当前未保存的编辑器内容：\n" + context.content :
          context.selection ? "VS Code 所选代码：\n" + context.content : undefined,
      })
    }).catch((error: unknown) => {
      void call({ method: "log", message: error instanceof Error ? error.message : "Failed to attach editor context" })
    })
  }))
  createEffect(() => { void call({ method: "editorReady", ready: adapter.ready() }) })
  onCleanup(() => { void call({ method: "editorReady", ready: false }) })
}
