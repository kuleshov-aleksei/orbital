<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-gray-300">{{ title }}</h3>

      <span class="text-xs text-gray-500">{{ subtitle }}</span>
    </div>

    <div :style="height ? { height: height + 'px' } : undefined">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch, onUnmounted, useTemplateRef } from "vue"
import { Chart, Tooltip, LinearScale } from "chart.js"
import { SankeyController, Flow } from "chartjs-chart-sankey"
import type { SankeyDataPoint } from "chartjs-chart-sankey"
import type { AnalyticsNode, AnalyticsLink } from "@/types"

const props = defineProps<{
  title: string
  subtitle?: string
  nodes: AnalyticsNode[]
  links: AnalyticsLink[]
  height?: number
  formatValue?: (value: number) => string
}>()

Chart.register(SankeyController, Flow, Tooltip, LinearScale)

const nodeColorPalette = [
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
  return nodeColorPalette[hash % nodeColorPalette.length]
}

const canvasRef = useTemplateRef<HTMLCanvasElement>("canvasRef")
let chartInstance: Chart<"sankey"> | null = null

const renderChart = () => {
  if (!canvasRef.value) return

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

  const ctx = canvasRef.value.getContext("2d")
  if (!ctx) return

  const labels: Record<string, string> = {}
  for (const node of props.nodes) {
    labels[node.id] = node.name
  }

  try {
    chartInstance = new Chart(ctx, {
      type: "sankey",
      data: {
        datasets: [
          {
            data: props.links.map(
              (link): SankeyDataPoint => ({
                from: link.source,
                to: link.target,
                flow: link.value,
              }),
            ),
            colorFrom: (context) => colorForNode(context.raw.from),
            colorTo: (context) => colorForNode(context.raw.to),
            colorMode: "from",
            labels,
            nodeLabels: {
              color: "#9ca3af",
              font: { size: 11 },
            },
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          tooltip: {
            enabled: true,
            backgroundColor: "#1f2937",
            titleColor: "#f9fafb",
            bodyColor: "#d1d5db",
            borderColor: "#374151",
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                const item = items[0]
                const raw = item.raw as { from: string; to: string }
                return `${labels[raw.from] ?? raw.from} → ${labels[raw.to] ?? raw.to}`
              },
              label: (context) => {
                const raw = context.raw as { flow: number }
                const value = typeof raw === "number" ? raw : raw.flow
                return props.formatValue ? props.formatValue(value) : String(value)
              },
            },
          },
          legend: {
            display: false,
          },
        },
      },
    })
  } catch (error) {
    console.error("Failed to render sankey chart:", error)
    chartInstance = null
  }
}

watch(
  () => [props.nodes, props.links],
  () => {
    renderChart()
  },
  { deep: true },
)

onMounted(() => {
  renderChart()
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy()
  }
})
</script>
