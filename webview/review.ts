import { OpenCode } from "@opencode/client/promise"
import type { ReviewChange } from "../src/protocol"

export async function readReview(url: string, sessionID: string): Promise<ReviewChange[]> {
  const api = OpenCode.make({ baseUrl: url })
  const changes = await api.session.diff({ sessionID })
  return changes.map((change) => ({
    file: change.file,
    additions: change.additions,
    deletions: change.deletions,
    patch: change.patch,
  }))
}
