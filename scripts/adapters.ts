import { resolve } from "node:path"
import type { Plugin } from "vite"

export function hostAdapters(root: string): Plugin {
  return {
    name: "opencode-vscode-host-adapters",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/app/src/runtime/extension/builtins.ts")) {
        return code.replace('import { builtins } from "@opencode/gui-extensions/renderer"',
          `import { definitions as builtins } from "${resolve(root, "webview/upstream.ts").replaceAll("\\", "/")}"`)
      }
      if (id.endsWith("/app/src/composer/model.ts")) {
        return `import { attachComposer } from "${resolve(root, "webview/composer-bridge.ts").replaceAll("\\", "/")}"\n` +
          code.replace("  const prompt = adapter.state", "  attachComposer(adapter)\n  const prompt = adapter.state")
      }
    },
  }
}
