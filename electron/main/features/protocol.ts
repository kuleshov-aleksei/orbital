import { protocol, net } from "electron"
import path from "node:path"
import fs from "node:fs"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"
import log from "electron-log"
import { RENDERER_DIST } from "../paths"

const scheme = "orbital"
const indexHtmlPath = path.join(RENDERER_DIST, "index.html")
const rangePattern = /^bytes=(\d*)-(\d*)$/

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

function contentTypeFor(filePath: string): string {
  return mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

export function setupAppProtocol() {
  protocol.handle(scheme, async (request) => {
    try {
      const { pathname } = new URL(request.url)
      const decodedPath = decodeURIComponent(pathname)

      if (decodedPath === "/" || decodedPath === "") {
        return serveRange(indexHtmlPath, request)
      }

      const filePath = path.join(RENDERER_DIST, decodedPath)
      const normalizedPath = path.normalize(filePath)

      if (!normalizedPath.startsWith(RENDERER_DIST + path.sep)) {
        return new Response("Forbidden", { status: 403 })
      }

      if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
        return serveRange(normalizedPath, request)
      }

      if (path.extname(decodedPath) === "") {
        return serveRange(indexHtmlPath, request)
      }

      return new Response("Not Found", { status: 404 })
    } catch (error) {
      log.error("[Protocol] Error handling request:", error)
      return new Response("Internal Server Error", { status: 500 })
    }
  })

  log.info(`[Protocol] Registered custom protocol handler for ${scheme}://`)
}

async function serveRange(filePath: string, request: Request): Promise<Response> {
  const stat = await fs.promises.stat(filePath)
  const fileSize = stat.size
  const rangeHeader = request.headers.get("range")

  if (rangeHeader) {
    const match = rangePattern.exec(rangeHeader.trim())
    if (match) {
      let start: number
      let end: number
      if (match[1] === "" && match[2] !== "") {
        start = Math.max(fileSize - parseInt(match[2], 10), 0)
        end = fileSize - 1
      } else {
        start = match[1] !== "" ? parseInt(match[1], 10) : 0
        end = match[2] !== "" ? parseInt(match[2], 10) : fileSize - 1
      }

      if (start >= fileSize || start > end) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } })
      }

      end = Math.min(end, fileSize - 1)
      const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>

      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": String(end - start + 1),
          "Content-Type": contentTypeFor(filePath),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
        },
      })
    }
  }

  const response = await net.fetch(pathToFileURL(filePath).toString())
  const headers = new Headers(response.headers)
  headers.set("Accept-Ranges", "bytes")
  if (filePath === indexHtmlPath) {
    headers.set("Content-Security-Policy", "frame-ancestors 'none'")
  }
  return new Response(response.body, { status: response.status, headers })
}