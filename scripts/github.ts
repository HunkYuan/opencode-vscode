export function github() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN is required for repository automation")
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  async function request<T>(path: string, options: { method?: string; body?: unknown; optional?: boolean } = {}): Promise<T | undefined> {
    const response = await fetch("https://api.github.com" + path, {
      method: options.method ?? "GET",
      headers: { ...headers, ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    if (options.optional && response.status === 404) return undefined
    if (!response.ok) {
      const error = await response.json() as { message?: string }
      throw new Error(`GitHub ${options.method ?? "GET"} ${path} failed (HTTP ${response.status}): ${error.message ?? "request failed"}`)
    }
    return response.status === 204 ? undefined : await response.json() as T
  }
  return { headers, request }
}

export const UI_REPOSITORY = "HunkYuan/opencode-vscode"
