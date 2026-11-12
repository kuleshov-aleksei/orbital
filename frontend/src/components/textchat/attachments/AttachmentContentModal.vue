<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[60] p-4"
      @click.self="$emit('close')"
      @keydown.esc="$emit('close')">
      <div
        data-testid="attachment-content-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`What search sees in ${attachment.filename}`"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto text-sm">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-theme-text-primary">What search sees</h2>
            <p class="text-xs text-theme-text-muted truncate">{{ attachment.filename }}</p>
          </div>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="$emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <p v-if="loadError" class="text-red-400">{{ loadError }}</p>
        <p v-else-if="!info" class="text-theme-text-muted">Loading…</p>
        <p v-else-if="!info.enabled" class="text-theme-text-muted">
          Search by image contents is turned off on this server.
        </p>
        <template v-else>
          <!-- Status -->
          <div class="flex items-center gap-2 mb-1" data-testid="attachment-content-status">
            <span :class="['inline-block w-2 h-2 rounded-full', statusDot]" />
            <span class="text-theme-text-primary">{{ statusLabel }}</span>
          </div>
          <p v-if="info.last_error" class="text-xs text-red-400 break-words mb-1">
            {{ info.last_error }}
          </p>
          <p v-if="info.models" class="text-[11px] text-theme-text-muted break-all mb-4">
            {{ modelsLabel }}
            <span v-if="!info.current"> · older models, will be read again</span>
          </p>

          <template v-if="info.status === 'done' || info.text || info.vector">
            <!-- OCR -->
            <section class="mb-5">
              <div class="flex items-center justify-between mb-1.5">
                <h3 class="text-xs font-medium text-theme-text-secondary">
                  Text in the image (OCR)
                </h3>
                <button
                  v-if="info.text"
                  type="button"
                  class="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1"
                  @click="copyText">
                  <PhCopy class="w-3.5 h-3.5" /> {{ copied ? "Copied" : "Copy" }}
                </button>
              </div>
              <pre
                v-if="info.text"
                class="whitespace-pre-wrap break-words font-sans text-theme-text-primary bg-theme-bg-tertiary rounded p-2.5 max-h-56 overflow-y-auto"
                data-testid="attachment-content-text"
                >{{ info.text }}</pre>
              <p v-else class="text-theme-text-muted">No text found.</p>
            </section>

            <!-- CLIP -->
            <section v-if="info.vector">
              <h3 class="text-xs font-medium text-theme-text-secondary mb-1.5">
                Image meaning (CLIP embedding)
              </h3>
              <canvas
                ref="strip"
                class="w-full rounded bg-theme-bg-tertiary"
                :style="{
                  aspectRatio: `${STRIP_COLS} / ${stripRows}`,
                  imageRendering: 'pixelated',
                }"
                :aria-label="`${info.vector.dims} numbers describing the image`" />
              <p class="text-[11px] text-theme-text-muted mt-1 mb-3">
                {{ info.vector.dims }} numbers, one per cell (orange positive, blue negative,
                brighter = larger). They mean nothing one by one: search compares the whole set with
                your search text. Similar images give similar patterns.
              </p>

              <form class="flex gap-2" @submit.prevent="testPhrase">
                <input
                  v-model="phrase"
                  type="text"
                  maxlength="200"
                  placeholder="Try a search phrase, e.g. «кот на диване»"
                  data-testid="attachment-content-phrase"
                  class="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-theme-accent" />
                <button
                  type="submit"
                  :disabled="!phrase.trim() || testing"
                  class="px-3 py-1.5 rounded bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent disabled:opacity-50 disabled:cursor-not-allowed">
                  {{ testing ? "Checking…" : "Check" }}
                </button>
              </form>

              <div v-if="match" class="mt-3" data-testid="attachment-content-match">
                <p v-if="match.error" class="text-red-400 break-words">{{ match.error }}</p>
                <template v-else>
                  <div class="relative h-2 rounded bg-theme-bg-tertiary overflow-hidden">
                    <div
                      :class="[
                        'absolute inset-y-0 left-0',
                        match.matches ? 'bg-green-500' : 'bg-theme-text-muted',
                      ]"
                      :style="{ width: `${barPercent(match.score)}%` }" />
                    <div
                      class="absolute inset-y-0 w-0.5 bg-theme-text-primary"
                      :style="{ left: `${barPercent(match.threshold)}%` }"
                      title="Threshold" />
                  </div>
                  <p class="mt-1.5 text-theme-text-primary">
                    <template v-if="match.matches"
                      >Search for «{{ match.query }}» finds this image.</template
                    >
                    <template v-else
                      >Search for «{{ match.query }}» does not find this image by meaning.</template
                    >
                  </p>
                  <p class="text-[11px] text-theme-text-muted">
                    Score {{ match.score.toFixed(3) }}, threshold
                    {{ match.threshold.toFixed(2) }} (similarity {{ match.cosine.toFixed(3) }}).
                    Words from the OCR text are found by keyword search regardless.
                  </p>
                </template>
              </div>
            </section>
          </template>
        </template>

        <div class="flex justify-end gap-2 mt-5">
          <button
            v-if="info?.can_retry"
            type="button"
            :disabled="retrying || info.status === 'pending'"
            class="px-4 py-2 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="attachment-content-retry"
            @click="retry">
            Read again
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
            @click="$emit('close')">
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue"
import { PhCopy, PhX } from "@phosphor-icons/vue"
import { apiService, type AttachmentContent } from "@/services/api"
import type { TextAttachment } from "@/types/textChat"

const props = defineProps<{ attachment: TextAttachment }>()
defineEmits<{ close: [] }>()

const STRIP_COLS = 32
/** While a job waits, poll for its result. */
const POLL_MS = 3000

const info = ref<AttachmentContent | null>(null)
const loadError = ref<string | null>(null)
const phrase = ref("")
const testing = ref(false)
const match = ref<AttachmentContent["match"] | null>(null)
const retrying = ref(false)
const copied = ref(false)
const strip = useTemplateRef<HTMLCanvasElement>("strip")
let pollTimer: ReturnType<typeof setTimeout> | null = null

const stripRows = computed(() =>
  Math.max(1, Math.ceil((info.value?.vector?.dims ?? 0) / STRIP_COLS)),
)

const statusLabel = computed(() => {
  const i = info.value
  if (!i) return ""
  switch (i.status) {
    case "done":
      return `Read ${i.updated_at ? new Date(i.updated_at).toLocaleString() : ""}`.trim()
    case "failed":
      return `Could not be read (${i.attempts} attempts)`
    case "pending":
      if (i.attempts > 0 && i.next_attempt_at)
        return `Retrying at ${new Date(i.next_attempt_at).toLocaleTimeString()} (attempt ${i.attempts + 1})`
      return "Waiting to be read…"
    default:
      return "Queued, will be read within a minute…"
  }
})

const statusDot = computed(() => {
  switch (info.value?.status) {
    case "done":
      return "bg-green-500"
    case "failed":
      return "bg-red-500"
    default:
      return "bg-yellow-500 animate-pulse"
  }
})

/** "immich;ocr=X;clip=Y" → "OCR X · CLIP Y". */
const modelsLabel = computed(() => {
  const parts = (info.value?.models ?? "").split(";").slice(1)
  const label = parts
    .map((p) => p.split("="))
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()} ${v}`)
    .join(" · ")
  return label || info.value?.models
})

function barPercent(score: number): number {
  // Scores of real matches sit around 0.5–0.7; show that band wide.
  return Math.max(0, Math.min(100, ((score - 0.4) / 0.4) * 100))
}

async function load() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  try {
    info.value = await apiService.getAttachmentContent(props.attachment.id)
    loadError.value = null
  } catch {
    loadError.value = "Could not load what search knows about this file."
    return
  }
  if (info.value.enabled && info.value.status !== "done" && info.value.status !== "failed") {
    pollTimer = setTimeout(load, POLL_MS)
  }
}

async function testPhrase() {
  const q = phrase.value.trim()
  if (!q) return
  testing.value = true
  try {
    const res = await apiService.getAttachmentContent(props.attachment.id, q)
    match.value = res.match ?? null
  } catch {
    match.value = {
      query: q,
      cosine: 0,
      score: 0,
      threshold: 0,
      matches: false,
      error: "Check failed.",
    }
  } finally {
    testing.value = false
  }
}

async function retry() {
  retrying.value = true
  try {
    await apiService.retryAttachmentContent(props.attachment.id)
    match.value = null
    await load()
  } catch {
    loadError.value = "Could not queue the file again."
  } finally {
    retrying.value = false
  }
}

async function copyText() {
  if (!info.value?.text) return
  try {
    await navigator.clipboard.writeText(info.value.text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // Clipboard blocked; the text is selectable.
  }
}

/**
 * One cell per number: blue below zero, orange above, brighter = larger.
 * The scale is the same for every image (not each image's max): CLIP has a
 * few "outlier" dimensions that are large for every input (e.g. #534 of
 * XLM-Roberta-Large-Vit-B-16Plus), and scaling by them made every grid the
 * same faint noise with one bright cell. Embeddings are unit vectors, so a
 * typical number is about 1/sqrt(dims); 2.5× that is full brightness.
 */
function drawStrip() {
  const canvas = strip.value
  const values = info.value?.vector?.values
  if (!canvas || !values?.length) return
  const rows = stripRows.value
  canvas.width = STRIP_COLS
  canvas.height = rows
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1
  const full = 2.5 / Math.sqrt(values.length)
  const img = ctx.createImageData(STRIP_COLS, rows)
  values.forEach((v, i) => {
    const t = Math.min(1, Math.abs(v / norm) / full)
    const [r, g, b] = v < 0 ? [59, 130, 246] : [249, 115, 22]
    img.data.set([r, g, b, Math.round(255 * Math.sqrt(t))], i * 4)
  })
  ctx.putImageData(img, 0, 0)
}

watch(
  () => info.value?.vector,
  async () => {
    await nextTick()
    drawStrip()
  },
)

onMounted(load)
onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer)
})
</script>
