// Composer uploads, storage usage and auto-removal notices for text channel
// attachments (docs/specs/CHAT_SYSTEM.md §7.12). The backend enforces every
// limit; the checks here only give early, friendly errors.
import { defineStore } from "pinia"
import { computed, ref } from "vue"
import {
  apiService,
  AttachmentUploadError,
  uploadTextAttachment,
  type AttachmentUploadMeta,
} from "@/services/api"
import { analyzeAudioFile, analyzeVideoFile } from "@/utils/audioPeaks"
import { formatBytes } from "@/utils/formatBytes"
import type {
  AttachmentKind,
  AttachmentUsage,
  EvictedAttachment,
  TextAttachment,
} from "@/types/textChat"
import { useConfigStore } from "./config"

export interface ComposerUpload {
  localId: string
  roomId: string
  file: File
  kind: AttachmentKind
  /** Object URL for local image previews. */
  previewUrl: string | null
  progress: number
  status: "uploading" | "done" | "error"
  error: string | null
  uploadId: string | null
  attachment: TextAttachment | null
  abort: AbortController
}

export interface EvictionNotice {
  count: number
  bytes: number
  files: string[]
}

const ALLOWED_EXT: Record<string, AttachmentKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  mp4: "video",
}

/** Kind from the extension/MIME type (a hint; the server sniffs bytes). */
export function guessKind(file: File): AttachmentKind | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (ALLOWED_EXT[ext]) return ALLOWED_EXT[ext]
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return "image"
  if (/^audio\/(mpeg|mp3|wav|x-wav|wave|ogg)$/.test(file.type)) return "audio"
  if (file.type === "video/mp4") return "video"
  return null
}

const ERROR_TEXT: Record<string, string> = {
  unsupported_type: "This file type is not supported (images, mp3/wav/ogg audio and mp4 video).",
  file_too_large: "This file is too large.",
  file_exceeds_quota: "This file is larger than your whole storage.",
  quota_protected_full:
    "Your protected files fill your storage. Unprotect or delete some files to upload more.",
  invalid_image: "This image could not be read.",
  forbidden: "You don't have permission to attach files here.",
  not_found: "This channel is no longer available.",
  rate_limited: "You are uploading too fast. Try again later.",
  storage_unavailable: "File storage is unavailable right now. Try again later.",
  network_error: "Upload failed. Check your connection.",
}

export function uploadErrorText(code: string): string {
  return ERROR_TEXT[code] ?? "Upload failed."
}

let nextLocalId = 1

export const useAttachmentsStore = defineStore("attachments", () => {
  const configStore = useConfigStore()
  const uploads = ref<ComposerUpload[]>([])
  const usage = ref<AttachmentUsage | null>(null)
  const evictionNotice = ref<EvictionNotice | null>(null)
  /** A rejected file (type, size, count) to show in the composer. */
  const composerError = ref<string | null>(null)

  const enabled = computed(() => configStore.attachments !== null)
  const usageRatio = computed(() =>
    usage.value && usage.value.quota_bytes > 0
      ? usage.value.used_bytes / usage.value.quota_bytes
      : 0,
  )

  function forRoom(roomId: string): ComposerUpload[] {
    return uploads.value.filter((u) => u.roomId === roomId)
  }

  function maxBytes(kind: AttachmentKind): number {
    const cfg = configStore.attachments
    if (!cfg) return 0
    return kind === "image"
      ? cfg.max_image_bytes
      : kind === "audio"
        ? cfg.max_audio_bytes
        : cfg.max_video_bytes
  }

  async function measure(file: File, kind: AttachmentKind): Promise<AttachmentUploadMeta> {
    if (kind === "audio") {
      const a = await analyzeAudioFile(file)
      return a ? { peaks: a.peaks, durationMs: a.durationMs } : {}
    }
    if (kind === "video") {
      return (await analyzeVideoFile(file)) ?? {}
    }
    return {}
  }

  function noteEviction(evicted: EvictedAttachment[]) {
    if (!evicted.length) return
    const prev = evictionNotice.value
    evictionNotice.value = {
      count: (prev?.count ?? 0) + evicted.length,
      bytes: (prev?.bytes ?? 0) + evicted.reduce((s, e) => s + e.stored_bytes, 0),
      files: [...(prev?.files ?? []), ...evicted.map((e) => e.filename)],
    }
  }

  async function start(item: ComposerUpload) {
    try {
      const meta = await measure(item.file, item.kind)
      const res = await uploadTextAttachment(
        item.roomId,
        item.file,
        meta,
        (p) => (find(item.localId)!.progress = p),
        item.abort.signal,
      )
      const cur = find(item.localId)
      if (!cur) return
      cur.status = "done"
      cur.progress = 1
      cur.uploadId = res.upload_id
      cur.attachment = res.attachment
      usage.value = res.usage
      noteEviction(res.evicted)
    } catch (err) {
      const cur = find(item.localId)
      if (!cur || (err instanceof DOMException && err.name === "AbortError")) return
      cur.status = "error"
      cur.error = uploadErrorText(err instanceof AttachmentUploadError ? err.code : "upload_failed")
    }
  }

  function find(localId: string): ComposerUpload | undefined {
    return uploads.value.find((u) => u.localId === localId)
  }

  /** Validate and start uploading picked, pasted or dropped files. */
  function addFiles(roomId: string, files: File[]) {
    composerError.value = null
    const cfg = configStore.attachments
    if (!cfg) return
    for (const file of files) {
      if (forRoom(roomId).length >= cfg.max_per_message) {
        composerError.value = `You can attach up to ${cfg.max_per_message} files to a message.`
        break
      }
      const kind = guessKind(file)
      if (!kind) {
        composerError.value = `${file.name}: ${ERROR_TEXT.unsupported_type}`
        continue
      }
      if (file.size > maxBytes(kind)) {
        composerError.value = `${file.name} is larger than the ${formatBytes(maxBytes(kind))} limit for ${kind} files.`
        continue
      }
      const item: ComposerUpload = {
        localId: `u${nextLocalId++}`,
        roomId,
        file,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
        progress: 0,
        status: "uploading",
        error: null,
        uploadId: null,
        attachment: null,
        abort: new AbortController(),
      }
      uploads.value.push(item)
      void start(find(item.localId)!)
    }
  }

  function release(item: ComposerUpload) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }

  /** Cancel or drop one upload (a pending upload expires on the server). */
  function remove(localId: string) {
    const item = find(localId)
    if (!item) return
    if (item.status === "uploading") item.abort.abort()
    release(item)
    uploads.value = uploads.value.filter((u) => u.localId !== localId)
  }

  function retry(localId: string) {
    const item = find(localId)
    if (!item || item.status !== "error") return
    item.status = "uploading"
    item.error = null
    item.progress = 0
    item.abort = new AbortController()
    void start(item)
  }

  const busy = (roomId: string) => forRoom(roomId).some((u) => u.status === "uploading")

  /** Hand the finished uploads of a room to a message being sent. */
  function takeReady(roomId: string): { ids: string[]; attachments: TextAttachment[] } {
    const ready = forRoom(roomId).filter((u) => u.status === "done" && u.uploadId && u.attachment)
    ready.forEach(release)
    const ids = new Set(ready.map((u) => u.localId))
    uploads.value = uploads.value.filter((u) => !ids.has(u.localId))
    return { ids: ready.map((u) => u.uploadId!), attachments: ready.map((u) => u.attachment!) }
  }

  let usageLoading = false
  /** Load storage usage once (for the composer's quota warning). */
  async function loadUsage(force = false) {
    if (!enabled.value || usageLoading || (usage.value && !force)) return
    usageLoading = true
    try {
      usage.value = await apiService.getMyAttachmentUsage()
    } catch {
      // The warning chip is optional.
    } finally {
      usageLoading = false
    }
  }

  function dismissEviction() {
    evictionNotice.value = null
  }

  return {
    uploads,
    usage,
    usageRatio,
    evictionNotice,
    composerError,
    enabled,
    forRoom,
    addFiles,
    remove,
    retry,
    busy,
    takeReady,
    loadUsage,
    dismissEviction,
  }
})
