<template>
  <div class="space-y-4">
    <!-- Summary -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-white">Usage Analytics</h2>

      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-400">{{ report?.total_users ?? 0 }} users</span>

        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="loading"
          @click="loadReport">
          <span v-if="loading">Loading...</span>
          <span v-else>Refresh</span>
        </button>
      </div>
    </div>
    <!-- Summary cards -->
    <div v-if="report" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <p class="text-sm text-gray-400">Total users</p>

        <p class="text-2xl font-bold text-white mt-1">{{ report.total_users }}</p>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <p class="text-sm text-gray-400">Total time in calls</p>

        <p class="text-2xl font-bold text-white mt-1">
          {{ formatDuration(report.total_duration_seconds) }}
        </p>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <p class="text-sm text-gray-400">Average session length</p>

        <p class="text-2xl font-bold text-white mt-1">
          {{
            report.total_sessions > 0
              ? formatDuration(Math.round(report.total_duration_seconds / report.total_sessions))
              : "—"
          }}
        </p>
      </div>
    </div>

    <!-- Platform distribution pie chart -->
    <div
      v-if="systemPie.values.length > 0"
      class="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-gray-300">Users by system</h3>

        <span class="text-xs text-gray-500">Distinct users per browser / OS</span>
      </div>

      <div class="mx-auto max-w-md" style="height: 220px">
        <PieChart
          :labels="systemPie.labels"
          :values="systemPie.values"
          :colors="systemPie.colors"
          :height="220"
          :format-value="formatUsers" />
      </div>
    </div>

    <!-- Sankey diagrams -->
    <div v-if="report && report.total_sessions > 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <SankeyDiagram
          title="Users per platform"
          :subtitle="usersSankeySubtitle"
          :nodes="report.users_sankey.nodes"
          :links="report.users_sankey.links"
          :height="320"
          :format-value="formatUsers" />
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <SankeyDiagram
          title="Time in calls per platform"
          subtitle="Total time spent connected"
          :nodes="report.time_sankey.nodes"
          :links="report.time_sankey.links"
          :height="320"
          :format-value="formatDuration" />
      </div>
    </div>
    <!-- Platform breakdown table -->
    <div
      v-if="report && report.platforms.length > 0"
      class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="p-4 border-b border-gray-700 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">Platform breakdown</h2>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400 border-b border-gray-700">
              <th class="px-4 py-2 font-medium">Platform</th>

              <th class="px-4 py-2 font-medium">System</th>

              <th class="px-4 py-2 font-medium text-right">Users</th>

              <th class="px-4 py-2 font-medium text-right">Sessions</th>

              <th class="px-4 py-2 font-medium text-right">Total time</th>
            </tr>
          </thead>

          <tbody class="divide-y divide-gray-700">
            <tr v-for="stat in report.platforms" :key="`${stat.platform}:${stat.system_name}`">
              <td class="px-4 py-2 text-gray-300">
                <span
                  class="px-2 py-0.5 text-xs rounded"
                  :class="
                    stat.platform === 'electron'
                      ? 'bg-purple-600/20 text-purple-400'
                      : stat.platform.startsWith('web')
                        ? 'bg-indigo-600/20 text-indigo-400'
                        : 'bg-gray-600/20 text-gray-400'
                  ">
                  {{ displayName(stat.platform) }}
                </span>
              </td>

              <td class="px-4 py-2 text-white">{{ displayName(stat.system_name) }}</td>

              <td class="px-4 py-2 text-gray-300 text-right">{{ stat.users }}</td>

              <td class="px-4 py-2 text-gray-300 text-right">{{ stat.sessions }}</td>

              <td class="px-4 py-2 text-gray-300 text-right">
                {{ formatDuration(stat.duration_seconds) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="report && !loading"
      class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <PhChartBar class="w-12 h-12 text-gray-600 mx-auto mb-4" />

      <p class="text-gray-400">No session data yet</p>

      <p class="text-gray-500 text-sm mt-1">Sessions are recorded when users join a call.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { apiService } from "@/services/api"
import { PhChartBar } from "@phosphor-icons/vue"
import type { AnalyticsReport } from "@/types"
import SankeyDiagram from "@/components/admin/SankeyDiagram.vue"
import PieChart from "@/components/admin/PieChart.vue"

const report = ref<AnalyticsReport | null>(null)
const loading = ref(false)

const usersSankeySubtitle = computed(() => {
  if (!report.value || report.value.both_platforms_users === 0) {
    return "Distinct users by platform"
  }
  return `${report.value.both_platforms_users} user${report.value.both_platforms_users === 1 ? "" : "s"} active on multiple platforms or devices`
})

const pieColorPalette = [
  "#818cf8",
  "#34d399",
  "#f472b6",
  "#fbbf24",
  "#60a5fa",
  "#a78bfa",
  "#f87171",
  "#2dd4bf",
  "#fb923c",
  "#e879f9",
  "#94a3b8",
  "#4ade80",
]

const colorForNode = (key: string): string => {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return pieColorPalette[hash % pieColorPalette.length]
}

const systemPie = computed(() => {
  const reportData = report.value
  if (!reportData) {
    return { labels: [] as string[], values: [] as number[], colors: [] as string[] }
  }

  const byLabel = new Map<string, number>()

  for (const link of reportData.users_sankey.links) {
    if (link.source === "all") continue

    const node = reportData.users_sankey.nodes.find((n) => n.id === link.target)
    const label = node?.name ?? link.target
    byLabel.set(label, (byLabel.get(label) ?? 0) + Math.round(link.value))
  }

  const labels: string[] = []
  const values: number[] = []
  const colors: string[] = []

  for (const [label, value] of byLabel) {
    labels.push(label)
    values.push(value)
    colors.push(colorForNode(label))
  }

  return { labels, values, colors }
})

const loadReport = async () => {
  loading.value = true
  try {
    report.value = await apiService.getAnalyticsReport()
  } catch (error) {
    console.error("Failed to load analytics report:", error)
  } finally {
    loading.value = false
  }
}

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

const formatUsers = (value: number): string => {
  const count = Math.round(value)
  return `${count} user${count === 1 ? "" : "s"}`
}

const displayNames: Record<string, string> = {
  web: "Web",
  "web-desktop": "Web Desktop",
  "web-mobile": "Web Mobile",
  electron: "Electron",
  windows: "Windows",
  windows_nt: "Windows",
  win32: "Windows",
  darwin: "macOS",
  macos: "macOS",
  mac: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
}

const displayName = (key: string): string => {
  if (!key) return "Unknown"
  return displayNames[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

onMounted(() => {
  void loadReport()
})
</script>
