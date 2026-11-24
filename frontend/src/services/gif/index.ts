// GIF provider selection. The picker and the composer depend only on
// GifProvider; adding a provider means adding an adapter here.
import type { GIFSearchConfig } from "@/services/api"
import { createGiphyProvider } from "./giphy"
import { createKlipyProvider } from "./klipy"
import type { GifProvider } from "./types"

/** Builds the configured provider; null when the settings are incomplete. */
export function createGifProvider(config: GIFSearchConfig): GifProvider | null {
  if (!config.api_key) return null
  switch (config.provider) {
    case "klipy":
      return createKlipyProvider(config.api_key)
    case "giphy":
      return createGiphyProvider(config.api_key, config.rating)
    default:
      return null
  }
}

export { GifSearchError, type Gif, type GifPage, type GifProvider, type GifTile } from "./types"
