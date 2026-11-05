<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="flex items-center gap-2">
          <PhShieldCheck class="w-5 h-5 text-indigo-400" />

          <h2 class="text-lg font-semibold text-white">Security self-check</h2>
        </div>

        <p class="text-sm text-gray-400 mt-1">
          Checks the running backend configuration for common production risks. Secrets are never
          displayed.
        </p>
      </div>

      <button
        type="button"
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
        :disabled="loading"
        @click="loadReport">
        <PhArrowsClockwise class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        <span>{{ loading ? "Checking..." : "Refresh" }}</span>
      </button>
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-300">
      {{ error }}
    </div>

    <div
      v-if="loading && !report"
      class="rounded-lg border border-gray-700 bg-gray-800 p-8 text-center text-sm text-gray-400">
      Running configuration checks...
    </div>

    <template v-else-if="report">
      <div class="rounded-lg border p-4 flex items-start gap-3" :class="overallCardClass">
        <component :is="overallIcon" class="w-6 h-6 shrink-0 mt-0.5" :class="overallIconClass" />

        <div class="min-w-0 flex-1">
          <p class="font-semibold" :class="overallTextClass">{{ overallLabel }}</p>

          <p class="text-sm text-gray-300 mt-1">{{ summaryText }}</p>
        </div>

        <span class="text-xs text-gray-400 whitespace-nowrap">
          {{ report.checks.length }} checks
        </span>
      </div>

      <div class="space-y-3">
        <div
          v-for="check in report.checks"
          :key="check.id"
          class="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <div class="flex items-start gap-3">
            <component
              :is="iconFor(check.status)"
              class="w-5 h-5 shrink-0 mt-0.5"
              :class="statusTextClass(check.status)" />

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-medium text-white">{{ check.title }}</h3>

                <span
                  class="px-2 py-0.5 text-xs font-medium rounded border"
                  :class="statusBadgeClass(check.status)">
                  {{ statusLabel(check.status) }}
                </span>

                <span
                  class="px-2 py-0.5 text-xs font-medium rounded border"
                  :class="severityBadgeClass(check.severity)">
                  {{ severityLabel(check.severity) }}
                </span>
              </div>

              <p class="text-sm text-gray-300 mt-2">
                <template
                  v-for="(part, index) in inlineTextParts(check.message)"
                  :key="`message-${check.id}-${index}`">
                  <code
                    v-if="index % 2 === 1"
                    class="px-1 py-0.5 rounded bg-gray-900/70 font-mono text-xs text-gray-200">
                    {{ part }}
                  </code>
                  <span v-else>{{ part }}</span>
                </template>
              </p>

              <p class="text-sm text-gray-400 mt-2">
                <span class="font-medium text-gray-300">Recommendation:</span>

                <template
                  v-for="(part, index) in inlineTextParts(check.recommendation)"
                  :key="`recommendation-${check.id}-${index}`">
                  <code
                    v-if="index % 2 === 1"
                    class="px-1 py-0.5 rounded bg-gray-900/70 font-mono text-xs text-gray-200">
                    {{ part }}
                  </code>
                  <span v-else>{{ part }}</span>
                </template>
              </p>
            </div>
          </div>
        </div>
      </div>

      <p class="text-xs text-gray-500">
        Checked {{ formatDate(report.generated_at) }}. Results reflect the backend process
        environment; restart the backend after changing <code>.env</code>.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { apiService } from "@/services/api"
import {
  PhArrowsClockwise,
  PhCheckCircle,
  PhInfo,
  PhShieldCheck,
  PhWarning,
  PhXCircle,
} from "@phosphor-icons/vue"
import type { SecurityCheckSeverity, SecurityCheckStatus, SecuritySelfCheckReport } from "@/types"

const report = ref<SecuritySelfCheckReport | null>(null)
const loading = ref(false)
const error = ref("")

const loadReport = async () => {
  loading.value = true
  error.value = ""

  try {
    report.value = await apiService.getSecuritySelfCheck()
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to run the security self-check."
  } finally {
    loading.value = false
  }
}

const counts = computed(() => {
  const result: Record<SecurityCheckStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    info: 0,
  }

  for (const check of report.value?.checks ?? []) {
    result[check.status]++
  }

  return result
})

const overallLabel = computed(() => {
  switch (report.value?.overall_status) {
    case "fail":
      return "Action required"
    case "warn":
      return "Needs attention"
    default:
      return "All checks passed"
  }
})

const summaryText = computed(() => {
  const current = counts.value
  const parts = [`${current.pass} passed`]

  if (current.warn > 0) {
    parts.push(`${current.warn} warning${current.warn === 1 ? "" : "s"}`)
  }
  if (current.fail > 0) {
    parts.push(`${current.fail} failed`)
  }
  if (current.info > 0) {
    parts.push(`${current.info} informational`)
  }

  return parts.join(" · ")
})

const overallCardClass = computed(() => {
  switch (report.value?.overall_status) {
    case "fail":
      return "border-red-700 bg-red-900/20"
    case "warn":
      return "border-amber-700 bg-amber-900/20"
    default:
      return "border-green-700 bg-green-900/20"
  }
})

const overallIcon = computed(() => {
  switch (report.value?.overall_status) {
    case "fail":
      return PhXCircle
    case "warn":
      return PhWarning
    default:
      return PhCheckCircle
  }
})

const overallIconClass = computed(() => {
  switch (report.value?.overall_status) {
    case "fail":
      return "text-red-400"
    case "warn":
      return "text-amber-400"
    default:
      return "text-green-400"
  }
})

const overallTextClass = computed(() => {
  switch (report.value?.overall_status) {
    case "fail":
      return "text-red-300"
    case "warn":
      return "text-amber-300"
    default:
      return "text-green-300"
  }
})

const iconFor = (status: SecurityCheckStatus) => {
  switch (status) {
    case "pass":
      return PhCheckCircle
    case "warn":
      return PhWarning
    case "fail":
      return PhXCircle
    default:
      return PhInfo
  }
}

const statusTextClass = (status: SecurityCheckStatus) => {
  switch (status) {
    case "pass":
      return "text-green-400"
    case "warn":
      return "text-amber-400"
    case "fail":
      return "text-red-400"
    default:
      return "text-sky-400"
  }
}

const statusBadgeClass = (status: SecurityCheckStatus) => {
  switch (status) {
    case "pass":
      return "border-green-700 bg-green-500/15 text-green-300"
    case "warn":
      return "border-amber-700 bg-amber-500/15 text-amber-300"
    case "fail":
      return "border-red-700 bg-red-500/15 text-red-300"
    default:
      return "border-sky-700 bg-sky-500/15 text-sky-300"
  }
}

const severityBadgeClass = (severity: SecurityCheckSeverity) => {
  switch (severity) {
    case "critical":
      return "border-red-700 bg-red-600/20 text-red-300"
    case "high":
      return "border-orange-700 bg-orange-600/20 text-orange-300"
    case "medium":
      return "border-amber-700 bg-amber-600/20 text-amber-300"
    case "low":
      return "border-sky-700 bg-sky-600/20 text-sky-300"
    default:
      return "border-gray-600 bg-gray-600/30 text-gray-300"
  }
}

const statusLabel = (status: SecurityCheckStatus) => {
  switch (status) {
    case "pass":
      return "Pass"
    case "warn":
      return "Warning"
    case "fail":
      return "Fail"
    default:
      return "Info"
  }
}

const severityLabel = (severity: SecurityCheckSeverity) => {
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}

const inlineTextParts = (value: string) => value.split("`")

const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

onMounted(loadReport)
</script>
