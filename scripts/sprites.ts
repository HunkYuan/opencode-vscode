import { resolve } from "node:path"
import type { Plugin } from "vite"

export function webviewSprites(root: string): Plugin {
  return {
    name: "opencode-vscode-inline-sprites",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/ui/src/components/file-icon.tsx") && !id.endsWith("/ui/src/components/provider-icon.tsx")) return
      const kind = id.endsWith("/file-icon.tsx") ? "file" : "provider"
      // SVG use 跨域被 Chromium 拒绝；保留官方 sprite，只把 symbol 放到当前 Webview 文档。
      return code.replace(
        `import sprite from "./${kind}-icons/sprite.svg"`,
        `import spriteSource from "./${kind}-icons/sprite.svg?raw"\nimport { inlineSprite } from "${resolve(root, "webview/sprite.ts").replaceAll("\\", "/")}"\nconst sprite = inlineSprite(spriteSource, "opencode-${kind}-sprite")`,
      )
    },
  }
}
