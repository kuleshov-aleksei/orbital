<template>
  <div class="space-y-4" data-testid="email-admin">
    <div>
      <div class="flex items-center gap-2">
        <PhEnvelopeSimple class="w-5 h-5 text-indigo-400" />
        <h2 class="text-lg font-semibold text-white">Emails</h2>
      </div>
      <p class="text-sm text-gray-400 mt-1">
        Account emails the server sent (verification, password reset), kept for 30 days. Links in
        them are shown as <code class="text-gray-300">[redacted]</code>: the log never holds a
        working link.
      </p>
    </div>

    <div
      v-if="!loading && !enabled"
      class="rounded-lg border border-amber-700 bg-amber-900/20 p-4 text-sm text-amber-200"
      data-testid="email-disabled">
      Email is off: set <code>SMTP_HOST</code> and <code>SMTP_FROM</code> on the server to turn it
      on.
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-300"
      data-testid="email-error">
      {{ error }}
    </div>

    <div v-if="enabled" class="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-3">
      <h3 class="text-sm font-semibold text-white">Send a test email</h3>
      <form class="flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="sendTest">
        <label class="flex-1 text-sm text-gray-300">
          Recipient
          <input
            v-model.trim="testTo"
            type="email"
            required
            placeholder="you@example.com"
            class="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
            data-testid="email-test-to" />
        </label>
        <button
          type="submit"
          class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
          :disabled="testing || !testTo"
          data-testid="email-test-send">
          {{ testing ? "Sending…" : "Send" }}
        </button>
      </form>
      <p
        v-if="testResult"
        class="text-sm break-words"
        :class="testResult.ok ? 'text-green-400' : 'text-red-400'"
        data-testid="email-test-result">
        {{ testResult.ok ? "Sent." : `Failed: ${testResult.error}` }}
      </p>
    </div>

    <div class="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 class="text-sm font-semibold text-white">Sent mail</h3>
        <button
          type="button"
          class="text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          :disabled="loading"
          data-testid="email-refresh"
          @click="load()">
          Refresh
        </button>
      </div>
      <p v-if="!loading && entries.length === 0" class="p-4 text-sm text-gray-400">
        No emails sent yet.
      </p>
      <ul class="divide-y divide-gray-700">
        <li v-for="entry in entries" :key="entry.id" data-testid="email-entry">
          <button
            type="button"
            class="w-full text-left px-4 py-3 hover:bg-gray-700/50 transition-colors"
            @click="toggle(entry.id)">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                class="px-1.5 py-0.5 rounded text-xs font-medium"
                :class="
                  entry.status === 'sent'
                    ? 'bg-green-900/40 text-green-300'
                    : 'bg-red-900/40 text-red-300'
                ">
                {{ entry.status }}
              </span>
              <span class="text-gray-300">{{
                PURPOSE_LABELS[entry.purpose] ?? entry.purpose
              }}</span>
              <span class="text-white break-all">{{ entry.to }}</span>
              <span class="ml-auto text-xs text-gray-400">{{ formatDate(entry.created_at) }}</span>
            </div>
            <p v-if="entry.error" class="mt-1 text-xs text-red-300 break-words">
              {{ entry.error }}
            </p>
          </button>
          <div v-if="expanded.has(entry.id)" class="px-4 pb-3">
            <p class="text-xs text-gray-400 mb-1">{{ entry.subject }}</p>
            <pre
              class="whitespace-pre-wrap break-words rounded bg-gray-900 border border-gray-700 p-3 text-xs text-gray-200"
              >{{ entry.body }}</pre>
          </div>
        </li>
      </ul>
      <div v-if="hasMore" class="px-4 py-3 border-t border-gray-700">
        <button
          type="button"
          class="text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          :disabled="loading"
          @click="load(true)">
          {{ loading ? "Loading…" : "Load older" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { PhEnvelopeSimple } from "@phosphor-icons/vue"
import { apiService, type EmailLogEntry, type TestEmailResult } from "@/services/api"

const PAGE_SIZE = 50
const PURPOSE_LABELS: Record<string, string> = {
  verify: "Verification",
  reset: "Password reset",
  test: "Test",
}

const entries = ref<EmailLogEntry[]>([])
const enabled = ref(true)
const loading = ref(false)
const hasMore = ref(false)
const error = ref<string | null>(null)
const expanded = reactive(new Set<number>())

const testTo = ref("")
const testing = ref(false)
const testResult = ref<TestEmailResult | null>(null)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function toggle(id: number) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

async function load(older = false) {
  loading.value = true
  error.value = null
  try {
    const before = older ? entries.value[entries.value.length - 1]?.id : undefined
    const page = await apiService.getEmailLog(before)
    enabled.value = page.enabled
    entries.value = older ? [...entries.value, ...page.entries] : page.entries
    hasMore.value = page.entries.length >= PAGE_SIZE
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to load emails"
  } finally {
    loading.value = false
  }
}

async function sendTest() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await apiService.sendTestEmail(testTo.value)
  } catch (err) {
    testResult.value = {
      ok: false,
      error: err instanceof Error && err.message ? err.message : "Request failed",
    }
  } finally {
    testing.value = false
    void load()
  }
}

onMounted(() => void load())
</script>
