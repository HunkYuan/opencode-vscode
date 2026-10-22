import { builtins } from "../.upstream/packages/gui-extensions/src/renderer"
import { Extension, LinkHandler, type Setup } from "@opencode/gui-extensions/sdk"
import { parseFileLink } from "../.upstream/packages/gui-extensions/src/file/resolve-link"
import { call } from "./bridge"

const adapter = Extension.define({ id: "vscode-host" })
const setup: Setup<typeof adapter> = (ctx) => {
  ctx.add(LinkHandler, {
    priority: 10,
    match: (link) => link.origin !== "review" && !/^(?:https?:|mailto:|opencode:)/i.test(link.href),
    exists(link) {
      const parsed = parseFileLink(link.href)
      return call<boolean>({ method: "fileExists", path: parsed.path, directory: link.session?.location?.directory ?? link.base })
        .catch(() => false)
    },
    open(link) {
      const parsed = parseFileLink(link.href)
      void call({ method: "openFile", path: parsed.path, directory: link.session?.location?.directory ?? link.base, line: parsed.selection?.start })
    },
  })
}
export const definitions = [...builtins, { ...adapter, renderer: () => Promise.resolve({ default: setup }) }]
