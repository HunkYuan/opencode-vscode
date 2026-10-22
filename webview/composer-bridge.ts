import { createEffect, onCleanup } from "solid-js"
import type { ComposerAdapter } from "@/composer/adapter"
import { usePlatform } from "@/runtime/platform/platform"
import { editorAttachment } from "./editor-attachment"
import { call, listen } from "./bridge"

export function attachComposer(adapter: ComposerAdapter) {
  const platform = usePlatform()
  let input = Promise.resolve()
  onCleanup(listen((message) => {
    if (message.type !== "context") return
    input = input.then(async () => {
      const snapshot = editorAttachment(message.context)
      const blob = await platform.draftStore!.putBlob(snapshot.blob)
      // 官方通用附件（内部类型名为 image）支持 text/plain，并负责草稿、重试和发送。
      adapter.state.set([
        ...adapter.state.current().filter((part) => part.type !== "image" || part.id !== snapshot.id),
        {
          type: "image",
          id: snapshot.id,
          filename: snapshot.filename,
          sourcePath: snapshot.sourcePath,
          mime: snapshot.mime,
          blob,
        },
      ], adapter.state.cursor())
    }).catch((error: unknown) => {
      void call({ method: "log", message: error instanceof Error ? error.message : "Failed to attach editor context" })
    })
  }))
  createEffect(() => { void call({ method: "editorReady", ready: adapter.ready() }) })
  onCleanup(() => { void call({ method: "editorReady", ready: false }) })
}
