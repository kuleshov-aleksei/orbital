<template>
  <div class="space-y-4" data-testid="search-indexing-admin">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="flex items-center gap-2">
          <PhScan class="w-5 h-5 text-indigo-400" />
          <h2 class="text-lg font-semibold text-white">Search indexing</h2>
        </div>
        <p class="text-sm text-gray-400 mt-1">
          Images in text channels are read by Immich ML (text with OCR, meaning with CLIP) so that
          search finds them. Refreshes every few seconds.
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
        :disabled="loading"
        @click="load">
        <PhArrowsClockwise class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        <span>Refresh</span>
      </button>
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-300">
      {{ error }}
    </div>

    <div
      v-if="!status && !error"
      class="rounded-lg border border-gray-700 bg-gray-800 p-8 text-center text-sm text-gray-400">
      Loading…
    </div>

    <template v-else-if="status">
      <!-- Overall state -->
      <div class="rounded-lg border p-4 flex items-start gap-3" :class="overall.card">
        <component :is="overall.icon" class="w-6 h-6 shrink-0 mt-0.5" :class="overall.text" />
        <div class="min-w-0 flex-1">
          <p class="font-semibold" :class="overall.text">{{ overall.title }}</p>
          <p class="text-sm text-gray-300 mt-1 break-words">{{ overall.detail }}</p>
          <p v-if="status.models" class="text-xs text-gray-500 mt-2 break-all">
            {{ modelsLabel }}
          </p>
        </div>
      </div>

      <!-- Counts -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          v-for="tile in tiles"
          :key="tile.label"
          class="rounded-lg border border-gray-700 bg-gray-800 p-3">
          <p class="text-2xl font-semibold tabular-nums" :class="tile.class">{{ tile.value }}</p>
          <p class="text-xs text-gray-400 mt-0.5">{{ tile.label }}</p>
          <p v-if="tile.hint" class="text-[11px] text-gray-500 mt-0.5">{{ tile.hint }}</p>
        </div>
      </div>

      <div v-if="total > 0">
        <div class="flex h-2 rounded overflow-hidden bg-gray-700" aria-hidden="true">
          <div class="bg-green-500" :style="{ width: pct(status.done) }" />
          <div class="bg-yellow-500" :style="{ width: pct(left - status.waiting) }" />
          <div class="bg-orange-500" :style="{ width: pct(status.waiting) }" />
          <div class="bg-red-500" :style="{ width: pct(status.failed) }" />
        </div>
        <p class="text-xs text-gray-500 mt-1.5">
          {{ status.done }} of {{ total }} images indexed · {{ status.with_text }} with text ·
          {{ status.with_vector }} with an embedding
          <template v-if="status.last_done_at">
            · last {{ formatTime(status.last_done_at) }}
          </template>
        </p>
      </div>

      <!-- Problems -->
      <div class="rounded-lg border border-gray-700 bg-gray-800">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-700">
          <h3 class="font-medium text-white">Recent errors</h3>
          <button
            v-if="status.failed > 0"
            type="button"
            class="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50"
            :disabled="retrying"
            data-testid="search-indexing-retry-failed"
            @click="retryFailed">
            Retry {{ status.failed }} failed
          </button>
        </div>
        <p v-if="!status.problems.length" class="px-4 py-3 text-sm text-gray-400">No errors.</p>
        <ul v-else class="divide-y divide-gray-700">
          <li v-for="p in status.problems" :key="p.id" class="px-4 py-3 text-sm">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                class="px-2 py-0.5 text-xs font-medium rounded border"
                :class="
                  p.status === 'failed'
                    ? 'border-red-700 text-red-300 bg-red-900/20'
                    : 'border-orange-700 text-orange-300 bg-orange-900/20'
                ">
                {{ p.status === "failed" ? "Gave up" : "Will retry" }}
              </span>
              <span class="text-white truncate max-w-[16rem]">{{ p.filename }}</span>
              <span class="text-gray-400"> in <EmojiText :text="p.room_name || p.room_id" /> </span>
              <span class="text-xs text-gray-500">
                {{ p.attempts }} attempt{{ p.attempts === 1 ? "" : "s" }}
                <template v-if="p.status === 'pending' && p.next_attempt_at">
                  · next {{ formatTime(p.next_attempt_at) }}
                </template>
                <template v-else> · {{ formatTime(p.updated_at) }}</template>
              </span>
            </div>
            <p class="mt-1 font-mono text-xs text-gray-300 break-words">{{ p.last_error }}</p>
          </li>
        </ul>
      </div>
      <p v-if="retryNote" class="text-xs text-gray-400">{{ retryNote }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import {
  PhArrowsClockwise,
  PhCheckCircle,
  PhCircleNotch,
  PhPauseCircle,
  PhProhibit,
  PhScan,
  PhWarning,
} from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import { apiService, type ExtractionStatus } from "@/services/api"

const REFRESH_MS = 5000

const status = ref<ExtractionStatus | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const retrying = ref(false)
const retryNote = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

/** Images still to read: not queued yet, ready now, or waiting to retry. */
const left = computed(() =>
  status.value ? status.value.unqueued + status.value.due + status.value.waiting : 0,
)
const total = computed(() =>
  status.value ? status.value.done + status.value.failed + left.value : 0,
)

function pct(n: number): string {
  return total.value ? `${(n / total.value) * 100}%` : "0%"
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString()
}

const modelsLabel = computed(() => {
  const parts = (status.value?.models ?? "").split(";").slice(1)
  const label = parts
    .map((p) => p.split("="))
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()} ${v}`)
    .join(" · ")
  return label || status.value?.models
})

const tiles = computed(() => {
  const s = status.value
  if (!s) return []
  return [
    { label: "Indexed", value: s.done, class: "text-green-400", hint: "" },
    {
      label: "Left to process",
      value: s.unqueued + s.due,
      class: s.unqueued + s.due ? "text-yellow-300" : "text-white",
      hint: s.outdated ? `${s.outdated} from older models` : "",
    },
    {
      label: "Waiting to retry",
      value: s.waiting,
      class: s.waiting ? "text-orange-300" : "text-white",
      hint: "after an error",
    },
    {
      label: "Failed",
      value: s.failed,
      class: s.failed ? "text-red-400" : "text-white",
      hint: "gave up after 6 attempts",
    },
  ]
})

const overall = computed(() => {
  const s = status.value!
  if (!s.enabled)
    return {
      icon: PhProhibit,
      card: "border-gray-700 bg-gray-800",
      text: "text-gray-300",
      title: "Turned off",
      detail: "Set CHAT_ML_URL on the backend to index images (see .env.example).",
    }
  if (s.paused_since)
    return {
      icon: PhPauseCircle,
      card: "border-red-700 bg-red-900/20",
      text: "text-red-300",
      title: `Paused since ${formatTime(s.paused_since)}: the ML service is unreachable`,
      detail: `${s.pause_error} — the worker tries again every minute; no attempts are used up.`,
    }
  const busy = s.unqueued + s.due
  if (busy > 0)
    return {
      icon: PhCircleNotch,
      card: "border-yellow-700 bg-yellow-900/20",
      text: "text-yellow-300",
      title: `Processing: ${busy} image${busy === 1 ? "" : "s"} left`,
      detail: lastRunText(s),
    }
  if (s.failed > 0 || s.waiting > 0)
    return {
      icon: PhWarning,
      card: "border-orange-700 bg-orange-900/20",
      text: "text-orange-300",
      title: "Up to date, with errors",
      detail: `${s.failed} failed, ${s.waiting} waiting to retry. ${lastRunText(s)}`,
    }
  return {
    icon: PhCheckCircle,
    card: "border-green-700 bg-green-900/20",
    text: "text-green-300",
    title: "Up to date",
    detail: lastRunText(s),
  }
})

function lastRunText(s: ExtractionStatus): string {
  return s.last_run_at
    ? `Worker last ran at ${formatTime(s.last_run_at)} (every 30 s and after each upload).`
    : "The worker has not run yet since the server started."
}

async function load() {
  loading.value = true
  try {
    status.value = await apiService.getExtractionStatus()
    error.value = null
  } catch {
    error.value = "Could not load the indexing status."
  } finally {
    loading.value = false
  }
}

async function retryFailed() {
  retrying.value = true
  try {
    const res = await apiService.retryFailedExtractions()
    retryNote.value = `${res.requeued} image${res.requeued === 1 ? "" : "s"} queued again.`
    await load()
  } catch {
    retryNote.value = "Could not queue the failed images."
  } finally {
    retrying.value = false
  }
}

onMounted(() => {
  load()
  timer = setInterval(() => {
    if (!document.hidden) load()
  }, REFRESH_MS)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
