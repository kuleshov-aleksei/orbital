// KLIPY GIF adapter (docs/specs/CHAT_SYSTEM.md §7.17). The key is part of the
// request path, so request URLs must never be logged.
import {
  fetchGifJSON,
  GIF_PAGE_SIZE,
  toGif,
  type GifPage,
  type GifProvider,
  type GifTile,
} from "./types"

const API_BASE = "https://api.klipy.com/api/v1"

interface KlipyRendition {
  url?: string
  width?: number
  height?: number
  size?: number
}

type KlipyFormat = "gif" | "webp" | "jpg" | "mp4" | "webm"
type KlipySize = "hd" | "md" | "sm" | "xs"

interface KlipyItem {
  id?: string | number
  slug?: string
  title?: string
  file?: Partial<Record<KlipySize, Partial<Record<KlipyFormat, KlipyRendition>>>>
}

interface KlipyResponse {
  result?: boolean
  data?: {
    data?: KlipyItem[]
    current_page?: number
    per_page?: number
    has_next?: boolean
  }
}

/** The animation, smallest first: mp4 is a fraction of the gif's size. */
const PLAYBACK: { size: KlipySize; format: KlipyFormat }[] = [
  { size: "md", format: "mp4" },
  { size: "md", format: "webp" },
  { size: "sm", format: "mp4" },
  { size: "sm", format: "webp" },
  { size: "md", format: "gif" },
  { size: "sm", format: "gif" },
  { size: "hd", format: "mp4" },
  { size: "hd", format: "gif" },
]

/** A still for the poster and the reduced-motion view. */
const POSTER: { size: KlipySize; format: KlipyFormat }[] = [
  { size: "sm", format: "jpg" },
  { size: "sm", format: "webp" },
  { size: "xs", format: "jpg" },
  { size: "md", format: "jpg" },
  { size: "hd", format: "jpg" },
]

/** A small animated rendition for the picker grid: webp is much smaller
 * than gif, and mp4 cannot go in an <img>. */
const TILE: { size: KlipySize; format: KlipyFormat }[] = [
  { size: "xs", format: "webp" },
  { size: "sm", format: "webp" },
  { size: "xs", format: "gif" },
  { size: "sm", format: "gif" },
  { size: "md", format: "webp" },
  { size: "md", format: "gif" },
]

function pick(
  file: KlipyItem["file"],
  order: { size: KlipySize; format: KlipyFormat }[],
): { url: string; width: number; height: number } | null {
  if (!file) return null
  for (const { size, format } of order) {
    const rendition = file[size]?.[format]
    if (rendition?.url) {
      return {
        url: rendition.url,
        width: rendition.width ?? 0,
        height: rendition.height ?? 0,
      }
    }
  }
  return null
}

/** Maps one API item; exported for tests. */
export function mapKlipyItem(item: KlipyItem): GifTile | null {
  if (item.id === undefined || item.id === null) return null
  const playback = pick(item.file, PLAYBACK)
  if (!playback) return null
  const poster = pick(item.file, POSTER) ?? playback
  const gif = toGif(
    "klipy",
    item.id,
    playback.url,
    poster.url,
    playback.width,
    playback.height,
    item.title || item.slug,
  )
  // Without an animated small rendition the still is the best preview.
  return { ...gif, picker_url: pick(item.file, TILE)?.url ?? poster.url }
}

function mapPage(response: KlipyResponse): GifPage {
  const items = (response.data?.data ?? [])
    .map(mapKlipyItem)
    .filter((gif): gif is GifTile => gif !== null)
  return { items, hasNext: response.data?.has_next === true }
}

function createKlipyProvider(apiKey: string): GifProvider {
  const base = `${API_BASE}/${encodeURIComponent(apiKey)}/gifs`

  async function load(path: string, page: number, query?: string): Promise<GifPage> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(GIF_PAGE_SIZE),
    })
    if (query) params.set("q", query)
    const url = `${base}/${path}?${params.toString()}`
    return mapPage(await fetchGifJSON<KlipyResponse>(url))
  }

  return {
    name: "klipy",
    searchPlaceholder: "Search KLIPY",
    attributionLogo: "/assets/attribution/klipy-logo.svg",
    search: (query, page) => load("search", page, query.trim()),
    trending: (page) => load("trending", page),
  }
}

export { createKlipyProvider }
