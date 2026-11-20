// On-device cache of chat attachment media (Electron and the Android app).
//
// Elements load cache URLs instead of presigned S3 URLs. The native side
// (electron/main/features/mediaCache.ts, mobile/.../MediaCache.java) serves a
// cached key from disk; on a miss the URL carries ?src=<presigned URL> and the
// native side fetches it (no CORS) and stores the bytes as they stream by.
// Here we only track which keys are cached, so hits skip the presign request.
import { mediaCacheNative } from "@/services/platform"
import { debugError, debugLog, debugWarn } from "@/utils/debug"
import type { AttachmentVariant } from "@/types/textChat"

/** After a miss, re-read the key list this long after the last one (files land in the cache meanwhile). */
const REFRESH_DELAY_MS = 5000

const cached = new Set<string>()
let ready: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

async function refresh() {
  try {
    const keys = await mediaCacheNative.list()
    cached.clear()
    keys.forEach((k) => cached.add(k))
  } catch (err) {
    debugWarn("[MediaCache] List failed:", err)
  }
}

export function mediaCacheAvailable(): boolean {
  return mediaCacheNative.available()
}

/** Resolves once the cached key list is loaded (first call loads it). */
export function initMediaCache(): Promise<void> {
  ready ??= refresh()
  return ready
}

/** Relays native (Android) cache logs into the app's debug log. Call once at startup. */
export function setupMediaCacheLogRelay() {
  void mediaCacheNative
    .onLog((level, message) => {
      const fn = level === "error" ? debugError : level === "warn" ? debugWarn : debugLog
      fn(`[MediaCache:native] ${message}`)
    })
    .catch((err) => debugWarn("[MediaCache] Log relay failed:", err))
}

export const mediaKey = (id: string, variant: AttachmentVariant) => `${id}_${variant}`

/** Native key validators allow only these characters before the variant suffix. */
const keySafe = (s: string) => s.replace(/[^A-Za-z0-9=-]/g, "-")

/**
 * Cache key of a custom emoji image. The version (the image_url `v` param)
 * is part of the key, so a re-encoded image is cached anew.
 */
export const emojiMediaKey = (id: string, version: string, still = false) =>
  `emoji-${keySafe(id)}-${keySafe(version)}_${still ? "emojistill" : "emoji"}`

/**
 * Cache key of a badge image. Like emojis, the image URL's `v` param (a fresh
 * filename per upload) is part of the key, so a replaced image is cached anew.
 */
export const badgeMediaKey = (id: string, version: string) =>
  `badge-${keySafe(id)}-${keySafe(version)}_badge`

export function isMediaCached(key: string): boolean {
  return cached.has(key)
}

/** URL for an element's src: the cached file, or (with src) a fetch-and-cache of it. */
export function mediaUrl(key: string, src?: string): string {
  const base = mediaCacheNative.urlFor(key)
  return src ? `${base}?src=${encodeURIComponent(src)}` : base
}

/** A miss was handed out; pick up the key once the native side has stored it. */
export function noteMediaMiss() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refresh()
  }, REFRESH_DELAY_MS)
}

/** The cached file failed to load (evicted by the OS or the LRU); use the network next time. */
export function markMediaMissing(key: string) {
  cached.delete(key)
}

/** Drop every variant of a removed attachment. */
export function evictMedia(id: string) {
  for (const key of cached) if (key.startsWith(`${id}_`)) cached.delete(key)
  if (mediaCacheAvailable()) void mediaCacheNative.evict(id).catch(() => {})
}

/** Empty the cache (logout). */
export async function clearMediaCache() {
  cached.clear()
  if (!mediaCacheAvailable()) return
  try {
    await mediaCacheNative.clear()
  } catch (err) {
    debugWarn("[MediaCache] Clear failed:", err)
  }
}
