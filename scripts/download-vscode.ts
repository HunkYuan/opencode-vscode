import { downloadAndUnzipVSCode } from "@vscode/test-electron"
import { resolve } from "node:path"
const executable = await downloadAndUnzipVSCode({ version: "1.94.0", platform: "win32-x64-archive", cachePath: resolve(import.meta.dir, "../artifacts/vscode-download"), timeout: 25000 })
console.log("Portable VS Code:", executable)
