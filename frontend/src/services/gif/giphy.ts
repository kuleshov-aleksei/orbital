// GIPHY adapter (docs/specs/CHAT_SYSTEM.md §7.17). GIPHY requires the
// "Powered by GIPHY" mark wherever its content is shown, hence the
// placeholder. The key travels in the query, so URLs are never logged.
import {
  fetchGifJSON,
  GIF_PAGE_SIZE,
  toGif,
  type GifPage,
  type GifProvider,
  type GifTile,
} from "./types"

const API_BASE = "https://api.giphy.com/v1/gifs"

interface GiphyRendition {
  url?: string
  webp?: string
  width?: string
  height?: string
  mp4?: string
}

interface GiphyItem {
  id?: string
  title?: string
  images?: Record<string, GiphyRendition | undefined>
}

interface GiphyResponse {
  data?: GiphyItem[]
  pagination?: { total_count?: number; count?: number; offset?: number }
}

/** The animation, smallest first: mp4 is a fraction of the gif's size. */
const PLAYBACK = ["downsized", "fixed_height", "original"]

function pickPlayback(item: GiphyItem): string | null {
  for (const name of PLAYBACK) {
    const rendition = item.images?.[name]
    if (rendition?.mp4) return rendition.mp4
    if (rendition?.url) return rendition.url
  }
  return null
}

function pickStill(item: GiphyItem): string | null {
  for (const name of ["fixed_width_still", "fixed_height_still", "downsized_still"]) {
    const url = item.images?.[name]?.url
    if (url) return url
  }
  return null
}

/** A small animated rendition for the picker grid (webp when offered). */
function pickTile(item: GiphyItem): string | null {
  for (const name of ["fixed_width_small", "fixed_width", "preview_gif", "downsized"]) {
    const rendition = item.images?.[name]
    if (rendition?.webp) return rendition.webp
    if (rendition?.url) return rendition.url
  }
  return null
}

/** Maps one API item; exported for tests. */
export function mapGiphyItem(item: GiphyItem): GifTile | null {
  if (!item.id) return null
  const url = pickPlayback(item)
  if (!url) return null
  const preview = pickStill(item) ?? item.images?.preview_gif?.url ?? url
  const meta = item.images?.downsized ?? item.images?.fixed_height ?? item.images?.original
  const gif = toGif(
    "giphy",
    item.id,
    url,
    preview,
    Number(meta?.width ?? 0),
    Number(meta?.height ?? 0),
    item.title,
  )
  // Without an animated small rendition the still is the best preview.
  return { ...gif, picker_url: pickTile(item) ?? preview }
}

function mapPage(response: GiphyResponse): GifPage {
  const items = (response.data ?? [])
    .map(mapGiphyItem)
    .filter((gif): gif is GifTile => gif !== null)
  const p = response.pagination
  const nextOffset = (p?.offset ?? 0) + (p?.count ?? items.length)
  return { items, hasNext: p?.total_count !== undefined && nextOffset < p.total_count }
}

function createGiphyProvider(apiKey: string, rating: string): GifProvider {
  async function load(path: string, page: number, query?: string): Promise<GifPage> {
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: String(GIF_PAGE_SIZE),
      offset: String((page - 1) * GIF_PAGE_SIZE),
    })
    if (rating) params.set("rating", rating)
    if (query) params.set("q", query)
    const url = `${API_BASE}/${path}?${params.toString()}`
    return mapPage(await fetchGifJSON<GiphyResponse>(url))
  }

  return {
    name: "giphy",
    searchPlaceholder: "Search GIPHY",
    search: (query, page) => load("search", page, query.trim()),
    trending: (page) => load("trending", page),
  }
}

export { createGiphyProvider }
