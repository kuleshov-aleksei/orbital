import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { TextAttachment } from "@/types/textChat"

// Realistic attachment ids (generated like other server ids).
const IDS = ["20261118101500AtTqKz", "20261118101501BvRmLp", "20261118101502CwSnMq"]

const api = vi.hoisted(() => ({
  uploads: [] as { name: string; meta: unknown }[],
  deleted: [] as string[],
}))
vi.mock("@/services/api", () => ({
  apiService: {
    deleteAttachment: vi.fn(async (id: string) => void api.deleted.push(id)),
    getMyAttachmentUsage: vi.fn(),
  },
  AttachmentUploadError: class extends Error {
    code = "upload_failed"
  },
  uploadTextAttachment: vi.fn(async (_room: string, file: File, meta: unknown) => {
    const id = IDS[api.uploads.length]
    api.uploads.push({ name: file.name, meta })
    const attachment: TextAttachment = {
      id,
      kind: file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "image",
      mime: file.type,
      size: file.size,
      filename: file.name,
      has_thumb: false,
      protected: false,
    }
    return { upload_id: id, attachment, evicted: [], usage: null }
  }),
}))
vi.mock("@/utils/compressImage", () => ({ compressImage: vi.fn(async () => null) }))
vi.mock("@/utils/audioPeaks", () => ({
  analyzeAudioFile: vi.fn(async () => null),
  analyzeVideoFile: vi.fn(async () => null),
}))
const edited = vi.hoisted(() => ({ calls: 0 }))
vi.mock("@/utils/editImage", () => ({
  editImage: vi.fn(async (file: File) => {
    edited.calls++
    return new File(["cropped"], file.name, { type: file.type })
  }),
}))
vi.mock("./config", () => ({
  useConfigStore: () => ({
    attachments: {
      max_per_message: 10,
      max_image_bytes: 1 << 20,
      max_audio_bytes: 1 << 20,
      max_video_bytes: 1 << 20,
    },
  }),
}))

import { useAttachmentsStore } from "./attachments"

const ROOM = "20261110145113MiTbtB"
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("attachments store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api.uploads = []
    api.deleted = []
    edited.calls = 0
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x")
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  it("hands spoiler ids (images and videos only) to the message", async () => {
    const store = useAttachmentsStore()
    store.addFiles(ROOM, [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.mp4", { type: "video/mp4" }),
      new File(["c"], "c.mp3", { type: "audio/mpeg" }),
    ])
    await flush()
    const [img, vid, aud] = store.forRoom(ROOM)
    store.setSpoiler(img.localId, true)
    store.setSpoiler(vid.localId, true)
    store.setSpoiler(aud.localId, true) // ignored: audio can't be a spoiler
    const ready = store.takeReady(ROOM)
    expect(ready.ids).toEqual(IDS)
    expect(ready.spoilerIds).toEqual([IDS[0], IDS[1]])
    expect(ready.attachments.map((a) => !!a.spoiler)).toEqual([true, true, false])
  })

  it("re-uploads an edited image and resets to the picked file", async () => {
    const store = useAttachmentsStore()
    const picked = new File(["original"], "p.jpg", { type: "image/jpeg" })
    store.addFiles(ROOM, [picked])
    await flush()
    const u = store.forRoom(ROOM)[0]
    const edit = { rotation: 90 as const, crop: { x: 0, y: 0, w: 10, h: 10 } }

    await store.applyEdit(u.localId, edit)
    await flush()
    let cur = store.forRoom(ROOM)[0]
    expect(edited.calls).toBe(1)
    expect(cur.file).not.toBe(picked)
    expect(cur.sourceFile).toBe(picked)
    expect(cur.edit).toEqual(edit)
    expect(cur.status).toBe("done")
    expect(api.deleted).toEqual([IDS[0]]) // the first upload is dropped
    expect(cur.uploadId).toBe(IDS[1])

    await store.applyEdit(u.localId, null)
    await flush()
    cur = store.forRoom(ROOM)[0]
    expect(cur.file).toBe(picked)
    expect(cur.edit).toBeNull()
    expect(cur.uploadId).toBe(IDS[2])
  })
})
