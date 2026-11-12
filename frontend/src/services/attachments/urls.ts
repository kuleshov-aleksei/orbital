// Presigned attachment URLs (docs/specs/CHAT_SYSTEM.md §7.12.6). <img> and
// <video> cannot send the Authorization header, so URLs are fetched in
// batches from POST /api/attachments/urls and cached until shortly before
// they expire.
import { onBeforeUnmount, ref, watch, type Ref } from "vue"
import { apiService } from "@/services/api"
import { isElectron } from "@/services/electron"
import type { AttachmentVariant } from "@/types/textChat"

const BATCH_DELAY_MS = 15
const MAX_BATCH = 100
/** Refetch this long before expiry, so a URL is never handed out stale. */
const EXPIRY_MARGIN_MS = 60_000

interface Waiter {
  resolve: (url: string | null) => void
  reject: (err: unknown) => void
}

const cache = new Map<string, { url: string; expiresAt: number }>()
/** Attachment ids the server reported as removed or not visible. */
const goneIds = new Set<string>()
const queue = new Map<string, Waiter[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const keyOf = (id: string, variant: AttachmentVariant) => `${id}:${variant}`

async function flush() {
  flushTimer = null
  const keys = Array.from(queue.keys()).slice(0, MAX_BATCH)
  const waiters = keys.map((k) => [k, queue.get(k)!] as const)
  keys.forEach((k) => queue.delete(k))
  if (queue.size) flushTimer = setTimeout(() => void flush(), 0)
  try {
    const res = await apiService.getAttachmentUrls(
      keys.map((k) => {
        const i = k.lastIndexOf(":")
        return { id: k.slice(0, i), variant: k.slice(i + 1) as AttachmentVariant }
      }),
    )
    res.gone.forEach((id) => goneIds.add(id))
    for (const [key, list] of waiters) {
      const hit = res.urls[key]
      if (hit) cache.set(key, { url: hit.url, expiresAt: hit.expires_at })
      list.forEach((w) => w.resolve(hit?.url ?? null))
    }
  } catch (err) {
    for (const [, list] of waiters) list.forEach((w) => w.reject(err))
  }
}

/** A presigned URL, or null when the file is gone or not visible. */
export function attachmentUrl(id: string, variant: AttachmentVariant): Promise<string | null> {
  if (goneIds.has(id)) return Promise.resolve(null)
  const key = keyOf(id, variant)
  const hit = cache.get(key)
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return Promise.resolve(hit.url)
  return new Promise((resolve, reject) => {
    const list = queue.get(key) ?? []
    list.push({ resolve, reject })
    queue.set(key, list)
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), BATCH_DELAY_MS)
  })
}

/** Drop cached URLs of a file (expired link, removal). */
export function forgetAttachmentUrls(id: string) {
  for (const key of cache.keys()) if (key.startsWith(`${id}:`)) cache.delete(key)
}

/**
 * Open a file in a new tab, or download it. Downloads navigate to a URL
 * served with Content-Disposition: attachment, so the page stays put (in
 * Electron, navigation and window.open go to the system browser).
 */
export async function openAttachment(id: string, variant: "original" | "download") {
  if (variant === "download") {
    const url = await attachmentUrl(id, "download")
    if (!url) return
    const a = document.createElement("a")
    a.href = url
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
    return
  }
  if (isElectron()) {
    const url = await attachmentUrl(id, "original")
    if (url) window.open(url, "_blank")
    return
  }
  // Open the tab synchronously so popup blockers allow it, then navigate.
  const win = window.open("", "_blank")
  if (win) win.opener = null
  const url = await attachmentUrl(id, "original")
  if (url && win) win.location.href = url
  else win?.close()
}

/** The storage page (/files), always in a new tab or app window. */
export function openStoragePage() {
  // Match the router's history mode, not isElectron(): the Electron dev build
  // loads the Vite server (path routing); only orbital:/file: use hash routes.
  const hashRouting =
    window.location.protocol === "orbital:" || window.location.protocol === "file:"
  const url = hashRouting
    ? `${window.location.href.split("#")[0]}#/files`
    : `${window.location.origin}/files`
  window.open(url, "_blank")
}

/**
 * Reactive presigned URL for an element's src. Call onError from the
 * element's error event: an expired URL is refetched once.
 */
export function useAttachmentUrl(
  id: () => string | null,
  variant: () => AttachmentVariant,
): { url: Ref<string | null>; gone: Ref<boolean>; onError: () => void } {
  const url = ref<string | null>(null)
  const gone = ref(false)
  let retried = false
  let alive = true
  onBeforeUnmount(() => (alive = false))

  async function load() {
    const current = id()
    if (!current) {
      url.value = null
      return
    }
    try {
      const next = await attachmentUrl(current, variant())
      if (!alive || current !== id()) return
      url.value = next
      gone.value = next === null
    } catch {
      // Transient (offline); the element shows its fallback.
    }
  }

  watch(
    [id, variant],
    () => {
      retried = false
      void load()
    },
    { immediate: true },
  )

  function onError() {
    const current = id()
    if (!current || retried) return
    retried = true
    forgetAttachmentUrls(current)
    void load()
  }

  return { url, gone, onError }
}
