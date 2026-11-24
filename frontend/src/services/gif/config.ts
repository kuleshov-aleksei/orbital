// The server's GIF search settings (docs/specs/CHAT_SYSTEM.md §7.17).
// The client key lives in memory only: it is not put in localStorage and not
// logged, and a 404 means the feature is off for this deployment.
import { apiService, type GIFSearchConfig } from "@/services/api"

let cached: GIFSearchConfig | null | undefined

/** The provider settings; null when GIF search is disabled. */
export async function loadGifConfig(): Promise<GIFSearchConfig | null> {
  if (cached !== undefined) return cached
  try {
    cached = await apiService.getGifConfig()
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      cached = null
      return cached
    }
    throw error
  }
  return cached
}

/** For tests: makes the next load ask the server again. */
export function resetGifConfigCache() {
  cached = undefined
}
