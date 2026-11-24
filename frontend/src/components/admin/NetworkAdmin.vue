<template>
  <div class="space-y-4" data-testid="network-admin">
    <div>
      <div class="flex items-center gap-2">
        <PhGlobe class="w-5 h-5 text-indigo-400" />
        <h2 class="text-lg font-semibold text-white">Outbound proxy</h2>
      </div>
      <p class="text-sm text-gray-400 mt-1">
        The server's own requests to the internet go through this proxy. Today that's link previews
        in text channels. Use it when the server can't reach some sites directly. Supported:
        <code class="text-gray-300">http://</code>, <code class="text-gray-300">https://</code>,
        <code class="text-gray-300">socks5://</code>,
        <code class="text-gray-300">socks5h://</code> with an optional
        <code class="text-gray-300">user:password@</code>. Leave it empty to connect directly.
      </p>
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-300"
      data-testid="network-error">
      {{ error }}
    </div>

    <div class="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-4">
      <dl class="grid grid-cols-2 gap-2 text-sm">
        <dt class="text-gray-400">Current proxy</dt>
        <dd class="text-white break-all" data-testid="network-current">
          {{ loading ? "…" : saved || "none (direct connections)" }}
        </dd>
      </dl>

      <form class="flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="save">
        <label class="flex-1 text-sm text-gray-300">
          Proxy URL
          <input
            v-model.trim="draft"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="socks5://127.0.0.1:1080"
            class="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
            data-testid="network-proxy-input" />
        </label>
        <button
          type="submit"
          class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50"
          :disabled="saving || draft === saved"
          data-testid="network-save">
          {{ saving ? "Saving…" : "Save" }}
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
          :disabled="saving || !saved"
          data-testid="network-clear"
          @click="clear">
          Clear
        </button>
      </form>
      <p v-if="draft.includes('xxxxx')" class="text-xs text-gray-400">
        "xxxxx" stands for the saved password; leave it to keep the password.
      </p>
    </div>

    <div class="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-3">
      <h3 class="text-sm font-semibold text-white">Test connection</h3>
      <p class="text-xs text-gray-400">
        The server fetches the URL through the proxy typed above (it doesn't need to be saved).
      </p>
      <form class="flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="test">
        <label class="flex-1 text-sm text-gray-300">
          URL
          <input
            v-model.trim="testUrl"
            type="url"
            class="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
            data-testid="network-test-url" />
        </label>
        <button
          type="submit"
          class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
          :disabled="testing"
          data-testid="network-test">
          {{ testing ? "Testing…" : "Test" }}
        </button>
      </form>
      <p
        v-if="result"
        class="text-sm"
        :class="result.ok ? 'text-green-400' : 'text-red-400'"
        data-testid="network-test-result">
        <template v-if="result.error"
          >Failed after {{ result.elapsed_ms }} ms: {{ result.error }}</template
        >
        <template v-else>HTTP {{ result.status }} in {{ result.elapsed_ms }} ms</template>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { PhGlobe } from "@phosphor-icons/vue"
import { apiService, type OutboundProxyTestResult } from "@/services/api"

const saved = ref("")
const draft = ref("")
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const testUrl = ref("https://www.youtube.com/")
const testing = ref(false)
const result = ref<OutboundProxyTestResult | null>(null)

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
    saved.value = (await apiService.getOutboundProxy()).proxy_url
    draft.value = saved.value
  } catch (err) {
    error.value = errorText(err, "Failed to load the proxy setting")
  } finally {
    loading.value = false
  }
}

async function submit(value: string) {
  saving.value = true
  error.value = null
  try {
    saved.value = (await apiService.updateOutboundProxy(value)).proxy_url
    draft.value = saved.value
  } catch (err) {
    error.value = errorText(err, "Failed to save the proxy")
  } finally {
    saving.value = false
  }
}

function save() {
  void submit(draft.value)
}

function clear() {
  void submit("")
}

async function test() {
  testing.value = true
  result.value = null
  error.value = null
  try {
    result.value = await apiService.testOutboundProxy(draft.value, testUrl.value)
  } catch (err) {
    error.value = errorText(err, "Test failed")
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>
