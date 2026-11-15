/**
 * On-disk LRU cache for chat attachment media (images, video, audio).
 *
 * The renderer points <img>/<video>/<audio> at orbital-media://cache/<key>,
 * adding ?src=<presigned S3 URL> when the key isn't cached yet. This handler
 * serves complete files from disk (with Range support), and otherwise proxies
 * the request to S3 from the main process (no CORS involved) while teeing the
 * received bytes into a sparse <key>.part file. Received byte ranges are
 * tracked in memory; once they cover the whole file it is promoted into the
 * cache. So images are cached after one load, and videos/audio once every
 * byte has been played or buffered.
 *
 * The Android app does the same in mobile/android/.../MediaCache.java; keep
 * the limits and the index format in step.
 */
import { app, protocol, net } from "electron"
import path from "node:path"
import fs from "node:fs"
import { Readable } from "node:stream"
import log from "electron-log"
import { fileRangeResponse } from "./protocol"
import { addRange, coversAll, parseContentRange, type Interval } from "./mediaRanges"

export const MEDIA_SCHEME = "orbital-media"

const MAX_BYTES = 1024 * 1024 * 1024
/** Eviction trims down to this, so not every insert evicts. */
const TARGET_BYTES = Math.floor(MAX_BYTES * 0.9)
/** Larger files stream through without being cached. */
const MAX_FILE_BYTES = 100 * 1024 * 1024
/** Partial downloads untouched for this long are dropped. */
const PART_IDLE_MS = 10 * 60 * 1000
const UPSTREAM_HEADERS_TIMEOUT_MS = 30_000
const INDEX_VERSION = 1
const INDEX_FILE = "index.json"
const KEY_PATTERN = /^[A-Za-z0-9=-]+_(original|thumb)$/

interface Entry {
  size: number
  mime: string
  lastUsed: number
}

interface Partial {
  /** Opened lazily; a promise so concurrent requests share one handle. */
  fh: Promise<fs.promises.FileHandle>
  total: number
  mime: string
  ranges: Interval[]
  pendingWrites: number
  lastTouch: number
  done: boolean
}

let dir = ""
const index = new Map<string, Entry>()
const partials = new Map<string, Partial>()
let saveTimer: ReturnType<typeof setTimeout> | null = null

const filePath = (key: string) => path.join(dir, key)
const partPath = (key: string) => path.join(dir, `${key}.part`)

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveIndex()
  }, 2000)
}

async function saveIndex() {
  const data = { version: INDEX_VERSION, entries: Object.fromEntries(index) }
  const tmp = path.join(dir, `${INDEX_FILE}.tmp`)
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(data))
    await fs.promises.rename(tmp, path.join(dir, INDEX_FILE))
  } catch (e) {
    log.warn("[MediaCache] Saving index failed:", e)
  }
}

/** Loads the index and drops anything it can't vouch for (stale entries, orphans, .part files). */
function loadIndex() {
  fs.mkdirSync(dir, { recursive: true })
  let entries: Record<string, Entry> = {}
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, INDEX_FILE), "utf8"))
    if (raw?.version === INDEX_VERSION && raw.entries && typeof raw.entries === "object") {
      entries = raw.entries
    } else {
      log.info("[MediaCache] Index format changed, wiping cache")
    }
  } catch {
    // Missing or corrupt index: start empty, orphans are removed below.
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === INDEX_FILE) continue
    const entry = entries[name]
    let keep = false
    if (entry && KEY_PATTERN.test(name)) {
      try {
        keep = fs.statSync(filePath(name)).size === entry.size
      } catch {
        keep = false
      }
    }
    if (keep) index.set(name, entry)
    else fs.rmSync(filePath(name), { force: true, recursive: true })
  }
  scheduleSave()
}

async function evictIfNeeded() {
  let total = 0
  for (const e of index.values()) total += e.size
  if (total <= MAX_BYTES) return
  const byAge = Array.from(index.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  let evicted = 0
  for (const [key, e] of byAge) {
    if (total <= TARGET_BYTES) break
    evicted++
    index.delete(key)
    total -= e.size
    await fs.promises.rm(filePath(key), { force: true })
  }
  log.info(`[MediaCache] LRU evicted ${evicted} file(s), now ${total} bytes`)
  scheduleSave()
}

async function dropPartial(key: string) {
  const p = partials.get(key)
  if (!p) return
  partials.delete(key)
  p.done = true
  await p.fh.then((fh) => fh.close()).catch(() => {})
  await fs.promises.rm(partPath(key), { force: true })
}

async function finalize(key: string, p: Partial) {
  p.done = true
  partials.delete(key)
  try {
    await (await p.fh).close()
    await fs.promises.rename(partPath(key), filePath(key))
    index.set(key, { size: p.total, mime: p.mime, lastUsed: Date.now() })
    scheduleSave()
    await evictIfNeeded()
  } catch (e) {
    log.warn("[MediaCache] Promoting", key, "failed:", e)
    await fs.promises.rm(partPath(key), { force: true })
  }
}

function partialFor(key: string, total: number, mime: string): Partial {
  const existing = partials.get(key)
  if (existing && existing.total === total && !existing.done) return existing
  // A different size means the file changed; start over.
  if (existing) {
    log.warn(`[MediaCache] Partial ${key} size changed ${existing.total} -> ${total}, restarting`)
    void dropPartial(key)
  }
  const fh = fs.promises.open(partPath(key), "w+")
  const p: Partial = { fh, total, mime, ranges: [], pendingWrites: 0, lastTouch: Date.now(), done: false }
  fh.catch((e) => {
    log.warn("[MediaCache] Opening part file failed:", e)
    if (partials.get(key) === p) partials.delete(key)
    p.done = true
  })
  partials.set(key, p)
  return p
}

/** Writes a received chunk at its file offset; promotes the file once complete. */
function record(key: string, p: Partial, chunk: Uint8Array, offset: number) {
  if (p.done) return
  p.pendingWrites++
  p.lastTouch = Date.now()
  p.fh
    .then((fh) => fh.write(chunk, 0, chunk.byteLength, offset))
    .then(() => {
      p.ranges = addRange(p.ranges, offset, offset + chunk.byteLength)
    })
    .catch((e) => log.warn(`[MediaCache] Write failed for ${key} at ${offset}:`, e))
    .finally(() => {
      p.pendingWrites--
      if (!p.done && p.pendingWrites === 0 && coversAll(p.ranges, p.total)) void finalize(key, p)
    })
}

async function serveCached(key: string, entry: Entry, request: Request): Promise<Response> {
  entry.lastUsed = Date.now()
  scheduleSave()
  const file = filePath(key)
  const ranged = fileRangeResponse(file, entry.size, request.headers.get("range"), entry.mime)
  if (ranged) return ranged
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(entry.size),
      "Accept-Ranges": "bytes",
    },
  })
}

const PASSTHROUGH_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"]

/**
 * Re-streams an upstream body to the renderer. Cancelling (the element stopped
 * reading, e.g. a video seek) aborts the upstream request: just cancelling
 * net.fetch's body stream does not release the connection, and Chromium allows
 * only 6 per HTTP/1.1 host, so leaked ones stall every later fetch to S3.
 */
function relay(
  upstream: ReadableStream<Uint8Array>,
  abort: AbortController,
  label: string,
  onChunk?: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader()
  let finished = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (finished) return
        if (done) {
          finished = true
          controller.close()
          return
        }
        onChunk?.(value)
        controller.enqueue(value)
      } catch (e) {
        if (finished) return
        finished = true
        log.warn(`[MediaCache] ${label} upstream read failed:`, e)
        controller.error(e)
      }
    },
    cancel() {
      finished = true
      abort.abort()
      reader.cancel().catch(() => {})
    },
  })
}

async function proxy(key: string, src: string, request: Request): Promise<Response> {
  const headers = new Headers()
  // Byte offsets must refer to the stored file: no transparent decompression.
  headers.set("Accept-Encoding", "identity")
  const range = request.headers.get("range")
  if (range) headers.set("Range", range)
  const abort = new AbortController()
  // A request that never gets headers would hold its element (and a connection) forever.
  const headersTimeout = setTimeout(() => abort.abort(), UPSTREAM_HEADERS_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await net.fetch(src, { headers, signal: abort.signal })
  } finally {
    clearTimeout(headersTimeout)
  }

  const outHeaders = new Headers()
  for (const name of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(name)
    if (v) outHeaders.set(name, v)
  }
  const respond = (body: ReadableStream<Uint8Array> | null) =>
    new Response(body, { status: upstream.status, headers: outHeaders })
  const passThrough = () => respond(upstream.body && relay(upstream.body, abort, key))

  // Errors (e.g. an expired link) pass through so the element's error handler refetches.
  if (!upstream.body || (upstream.status !== 200 && upstream.status !== 206)) {
    log.warn(`[MediaCache] ${key} upstream error ${upstream.status} passed through`)
    return passThrough()
  }

  let start = 0
  let total = Number(upstream.headers.get("content-length") ?? NaN)
  if (upstream.status === 206) {
    const cr = parseContentRange(upstream.headers.get("content-range"))
    if (!cr) {
      log.warn(`[MediaCache] ${key} unparsable Content-Range, not caching`)
      return passThrough()
    }
    start = cr.start
    total = cr.total
  }
  if (!Number.isFinite(total) || total <= 0 || total > MAX_FILE_BYTES) return passThrough()

  const mime = upstream.headers.get("content-type") ?? "application/octet-stream"
  const p = partialFor(key, total, mime)

  let offset = start
  return respond(
    relay(upstream.body, abort, key, (chunk) => {
      // Copy first: the consumer may transfer (detach) the enqueued buffer.
      record(key, p, chunk.slice(), offset)
      offset += chunk.byteLength
    }),
  )
}

export function setupMediaCache() {
  dir = path.join(app.getPath("userData"), "media-cache")
  try {
    loadIndex()
  } catch (e) {
    log.error("[MediaCache] Loading index failed:", e)
  }

  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
      if (!KEY_PATTERN.test(key)) {
        log.warn(`[MediaCache] Rejected media key ${key}`)
        return new Response("Bad Request", { status: 400 })
      }

      const entry = index.get(key)
      if (entry) {
        if (fs.existsSync(filePath(key))) return await serveCached(key, entry, request)
        log.warn(`[MediaCache] ${key} indexed but file missing`)
        index.delete(key)
        scheduleSave()
      }

      const src = url.searchParams.get("src")
      if (!src || !/^https?:\/\//i.test(src)) {
        log.warn(`[MediaCache] ${key} not cached and no src -> 404`)
        return new Response("Not Found", { status: 404 })
      }
      return await proxy(key, src, request)
    } catch (e) {
      log.warn(`[MediaCache] Request ${request.url.split("?")[0]} failed -> 502:`, e)
      return new Response("Bad Gateway", { status: 502 })
    }
  })

  setInterval(() => {
    const now = Date.now()
    for (const [key, p] of partials) {
      if (p.pendingWrites === 0 && now - p.lastTouch > PART_IDLE_MS) void dropPartial(key)
    }
  }, 60_000).unref()

  log.info(`[MediaCache] Ready (${index.size} files) in ${dir}`)
}

/** Keys of complete cached files. */
export function listMediaCache(): string[] {
  return Array.from(index.keys())
}

/** Removes every variant of an attachment (it was deleted). */
export async function evictMedia(id: string) {
  const prefix = `${id}_`
  for (const key of Array.from(index.keys())) {
    if (!key.startsWith(prefix)) continue
    index.delete(key)
    await fs.promises.rm(filePath(key), { force: true })
  }
  for (const key of Array.from(partials.keys())) if (key.startsWith(prefix)) await dropPartial(key)
  scheduleSave()
}

/** Empties the cache (logout). */
export async function clearMediaCache() {
  for (const key of Array.from(partials.keys())) await dropPartial(key)
  for (const key of Array.from(index.keys())) {
    index.delete(key)
    await fs.promises.rm(filePath(key), { force: true })
  }
  await saveIndex()
}
