import type { Plugin } from "vite"

export function webviewWorkers(): Plugin {
  return {
    name: "opencode-vscode-workers",
    enforce: "pre",
    transform(code, id) {
      // VS Code 的 Webview 只允许 blob/data Worker；Vite 内联 Worker 保留官方计算逻辑。
      if (id.endsWith("/session-ui/src/pierre/worker.ts")) {
        return code
          .replace('import DiffsWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"',
            'import DiffsWorker from "@pierre/diffs/worker/worker.js?worker&inline"')
          .replace(/new Worker\(DiffsWorkerUrl,\s*\{\s*type:\s*"module"\s*\}\)/,
            "new DiffsWorker()")
      }
      if (id.endsWith("/session-ui/src/components/markdown-worker.ts")) {
        return 'import MarkdownWorker from "./markdown.worker.ts?worker&inline"\n' +
          code.replace(/new Worker\(new URL\("\.\/markdown\.worker\.ts",\s*import\.meta\.url\),\s*\{\s*type:\s*"module"\s*\}\)/,
            "new MarkdownWorker()")
      }
    },
  }
}
