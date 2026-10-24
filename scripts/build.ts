import { buildHost } from "./build-host"
import { buildUI } from "./build-ui"
import { packageUI } from "./ui-package"

await buildHost()
await buildUI()
await packageUI()
