<template>
  <div class="space-y-4" data-testid="app-versions-admin">
    <div>
      <div class="flex items-center gap-2">
        <PhDeviceMobile class="w-5 h-5 text-indigo-400" />
        <h2 class="text-lg font-semibold text-white">Android app versions</h2>
      </div>
      <p class="text-sm text-gray-400 mt-1">
        Android apps older than the minimum version are blocked with an "Update required" screen and
        can't use the API or WebSocket. Raise it when a backend change breaks older apps, after the
        release with the new APK is published.
      </p>
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-300"
      data-testid="app-versions-error">
      {{ error }}
    </div>

    <div class="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-4">
      <dl class="grid grid-cols-2 gap-2 text-sm">
        <dt class="text-gray-400">Latest published release</dt>
        <dd class="text-white">{{ loading ? "…" : versions?.latest_version || "unknown" }}</dd>
        <dt class="text-gray-400">Current minimum</dt>
        <dd class="text-white" data-testid="app-versions-current">
          {{ loading ? "…" : versions?.android_min_version || "none (all versions allowed)" }}
        </dd>
      </dl>

      <form class="flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="save">
        <label class="flex-1 text-sm text-gray-300">
          Minimum Android version
          <input
            v-model.trim="draft"
            type="text"
            inputmode="decimal"
            :placeholder="versions?.latest_version || '1.2.3'"
            class="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            data-testid="app-versions-input" />
        </label>
        <button
          type="submit"
          class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50"
          :disabled="saving || !draftValid || draft === (versions?.android_min_version ?? '')"
          data-testid="app-versions-save">
          {{ saving ? "Saving…" : "Save" }}
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
          :disabled="saving || !versions?.android_min_version"
          data-testid="app-versions-clear"
          @click="clear">
          Clear
        </button>
      </form>

      <p v-if="draft && !draftValid" class="text-xs text-red-400">Use the form 1.2.3.</p>
      <p v-else-if="draft && draftValid" class="text-xs text-yellow-400">
        Android apps older than {{ draft }} will stop working as soon as you save.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { PhDeviceMobile } from "@phosphor-icons/vue"
import { apiService, type ClientVersions } from "@/services/api"
import { parseVersion } from "@/services/appVersion"

const versions = ref<ClientVersions | null>(null)
const draft = ref("")
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const draftValid = computed(() => draft.value === "" || parseVersion(draft.value) !== null)

function errorText(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  // apiRequest puts the raw response body in the message.
  try {
    const body = JSON.parse(err.message) as { error?: string }
    return body.error || fallback
  } catch {
    return err.message || fallback
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    versions.value = await apiService.getClientVersions()
    draft.value = versions.value.android_min_version
  } catch (err) {
    error.value = errorText(err, "Failed to load app versions")
  } finally {
    loading.value = false
  }
}

async function submit(value: string) {
  saving.value = true
  error.value = null
  try {
    versions.value = await apiService.updateClientVersions(value)
    draft.value = versions.value.android_min_version
  } catch (err) {
    error.value = errorText(err, "Failed to save the minimum version")
  } finally {
    saving.value = false
  }
}

function save() {
  if (draftValid.value) void submit(draft.value)
}

function clear() {
  void submit("")
}

onMounted(load)
</script>
