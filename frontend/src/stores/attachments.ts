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
import { compressImage } from "@/utils/compressImage"
import { editImage, type ImageEdit } from "@/utils/editImage"
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
  /** What gets uploaded: the picked file, or its edited copy. */
  file: File
  /** The file as picked; edits always start from it. */
  sourceFile: File
  /** The current image edit (crop/rotation), null when unedited. */
  edit: ImageEdit | null
  /** Images and videos: shown behind a spoiler cover. */
  spoiler: boolean
  kind: AttachmentKind
  /** Object URL for local image previews. */
  previewUrl: string | null
  progress: number
  status: "uploading" | "done" | "error"
  error: string | null
  uploadId: string | null
  attachment: TextAttachment | null
  abort: AbortController
  /** Images: send uncompressed (full resolution, original format). */
  original: boolean
  /** Bytes actually sent (after client-side compression), once known. */
  sentBytes: number | null
}

/** Images the user can choose to send uncompressed (not GIFs, which are kept as is). */
export function canSendOriginal(u: ComposerUpload): boolean {
  return u.kind === "image" && u.file.type !== "image/gif" && !/\.gif$/i.test(u.file.name)
}

/** Images and videos can be sent as spoilers. */
export function canSpoiler(u: ComposerUpload): boolean {
  return u.kind === "image" || u.kind === "video"
}

/** Still images can be cropped/rotated (GIFs would lose their animation). */
export function canEdit(u: ComposerUpload): boolean {
  return canSendOriginal(u)
}

/** Finished uploads handed to a message being sent. */
export interface ReadyFiles {
  ids: string[]
  attachments: TextAttachment[]
  /** The subset of ids sent as spoilers. */
  spoilerIds: string[]
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
    // setOriginal swaps item.abort while this run is in flight: keep ours.
    const signal = item.abort.signal
    try {
      const meta = await measure(item.file, item.kind)
      let toSend = item.file
      if (item.kind === "image") {
        if (item.original) meta.original = true
        else toSend = (await compressImage(item.file)) ?? item.file
        if (signal.aborted) return
      }
      const sending = find(item.localId)
      if (sending) sending.sentBytes = toSend.size
      const res = await uploadTextAttachment(
        item.roomId,
        toSend,
        meta,
        (p) => (find(item.localId)!.progress = p),
        signal,
      )
      const cur = find(item.localId)
      if (!cur || signal.aborted) return
      cur.status = "done"
      cur.progress = 1
      cur.uploadId = res.upload_id
      cur.attachment = res.attachment
      usage.value = res.usage
      noteEviction(res.evicted)
    } catch (err) {
      const cur = find(item.localId)
      if (!cur || signal.aborted || (err instanceof DOMException && err.name === "AbortError"))
        return
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
        sourceFile: file,
        edit: null,
        spoiler: false,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
        progress: 0,
        status: "uploading",
        error: null,
        uploadId: null,
        attachment: null,
        abort: new AbortController(),
        original: false,
        sentBytes: null,
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

  /**
   * Drop the current upload (deleting a finished one frees its quota) and
   * send the item again, after its file or quality changed.
   */
  function restart(item: ComposerUpload) {
    if (item.status === "uploading") item.abort.abort()
    if (item.uploadId) {
      const id = item.uploadId
      void apiService.deleteAttachment(id).catch(() => {}) // expires on the server anyway
    }
    item.status = "uploading"
    item.error = null
    item.progress = 0
    item.uploadId = null
    item.attachment = null
    item.sentBytes = null
    item.abort = new AbortController()
    void start(item)
  }

  /** Switch an image between compressed and original quality. */
  function setOriginal(localId: string, original: boolean) {
    const item = find(localId)
    if (!item || item.original === original || !canSendOriginal(item)) return
    item.original = original
    restart(item)
  }

  function setSpoiler(localId: string, spoiler: boolean) {
    const item = find(localId)
    if (item && canSpoiler(item)) item.spoiler = spoiler
  }

  /**
   * Crop/rotate an image (null resets to the picked file) and upload the
   * result instead. Throws when the image can't be edited.
   */
  async function applyEdit(localId: string, edit: ImageEdit | null) {
    const item = find(localId)
    if (!item || !canEdit(item)) return
    const file = edit ? await editImage(item.sourceFile, edit) : item.sourceFile
    const cur = find(localId)
    if (!cur) return // removed while encoding
    const unchanged = file === cur.sourceFile
    if (file === cur.file) {
      cur.edit = unchanged ? null : edit
      return
    }
    if (cur.previewUrl) URL.revokeObjectURL(cur.previewUrl)
    cur.file = file
    cur.edit = unchanged ? null : edit
    cur.previewUrl = URL.createObjectURL(file)
    restart(cur)
  }

  const busy = (roomId: string) => forRoom(roomId).some((u) => u.status === "uploading")

  /** Hand the finished uploads of a room to a message being sent. */
  function takeReady(roomId: string): ReadyFiles {
    const ready = forRoom(roomId).filter((u) => u.status === "done" && u.uploadId && u.attachment)
    ready.forEach(release)
    const ids = new Set(ready.map((u) => u.localId))
    uploads.value = uploads.value.filter((u) => !ids.has(u.localId))
    const spoilers = ready.filter((u) => u.spoiler && canSpoiler(u))
    return {
      ids: ready.map((u) => u.uploadId!),
      // The optimistic message renders these, so they carry the flag too.
      attachments: ready.map((u) =>
        u.spoiler && canSpoiler(u) ? { ...u.attachment!, spoiler: true } : u.attachment!,
      ),
      spoilerIds: spoilers.map((u) => u.uploadId!),
    }
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
    setOriginal,
    setSpoiler,
    applyEdit,
    busy,
    takeReady,
    loadUsage,
    dismissEviction,
  }
})
