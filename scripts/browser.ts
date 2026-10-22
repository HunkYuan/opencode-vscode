import { chromium } from "@playwright/test"

export function launchBrowser() {
  if (process.env.OPENCODE_TEST_BROWSER)
    return chromium.launch({ executablePath: process.env.OPENCODE_TEST_BROWSER, headless: true })
  if (process.platform === "win32") return chromium.launch({ channel: "msedge", headless: true })
  return chromium.launch({ headless: true })
}
