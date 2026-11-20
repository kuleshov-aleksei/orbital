// Third-party GIF search (docs/specs/CHAT_SYSTEM.md §7.17). The search runs
// in this client: the providers forbid proxying their API, and their media
// must be loaded from the end-user client. Only the reference is stored in
// the message (see types/textChat.ts TextGIF).
import type { TextGIF } from "@/types/textChat"

export type Gif = TextGIF

/** A search result: the message reference plus a small animated rendition
 * used only by the picker (it never reaches a message). */
export interface GifTile extends Gif {
  /** Animated webp/gif for the grid; small enough to load a page of them. */
  picker_url: string
}

export interface GifPage {
  items: GifTile[]
  hasNext: boolean
}

export interface GifProvider {
  readonly name: Gif["provider"]
  /** Provider name in the search placeholder (required attribution). */
  readonly searchPlaceholder: string
  /** Wordmark for the attribution footer (replaces the provider name). */
  readonly attributionLogo?: string
  search(query: string, page: number): Promise<GifPage>
  trending(page: number): Promise<GifPage>
}

export type GifSearchErrorCode = "rate_limited" | "unavailable" | "timeout"

/** A failed search; the picker shows a retry instead of an empty grid. */
export class GifSearchError extends Error {
  constructor(
    readonly code: GifSearchErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "GifSearchError"
  }
}

export const GIF_PAGE_SIZE = 24
export const GIF_SEARCH_TIMEOUT_MS = 6000

/**
 * Fetches provider JSON with a deadline. URLs are never logged: provider keys
 * travel in the path (Klipy) or the query (Giphy).
 */
export async function fetchGifJSON<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GIF_SEARCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    if (response.status === 429) {
      throw new GifSearchError("rate_limited", "GIF search is rate limited.")
    }
    if (!response.ok) {
      throw new GifSearchError("unavailable", "GIF search is unavailable.")
    }
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof GifSearchError) throw error
    if (controller.signal.aborted) {
      throw new GifSearchError("timeout", "GIF search timed out.")
    }
    throw new GifSearchError("unavailable", "GIF search is unavailable.")
  } finally {
    clearTimeout(timer)
  }
}

/** Clamps provider metadata to what a message may store. */
export function toGif(
  provider: Gif["provider"],
  id: string | number,
  url: string,
  previewUrl: string,
  width: number,
  height: number,
  title: string | undefined,
): Gif {
  const bounded = (n: number) => (Number.isFinite(n) && n > 0 && n <= 4096 ? Math.round(n) : 0)
  return {
    provider,
    id: String(id).slice(0, 64),
    url,
    preview_url: previewUrl,
    width: bounded(width),
    height: bounded(height),
    title: (title ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
  }
}
