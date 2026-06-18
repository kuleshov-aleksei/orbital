<template>
  <div :style="height ? { height: height + 'px' } : undefined">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch, onUnmounted, useTemplateRef } from "vue"
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
} from "chart.js"

const props = defineProps<{
  data: {
    labels: string[]
    datasets: {
      label: string
      data: number[]
      borderColor: string
      backgroundColor: string
      borderWidth: number
      pointRadius: number
      pointHitRadius: number
      fill: boolean
      tension: number
    }[]
  }
  height?: number
  valueSuffix?: string
  formatValue?: (value: number) => string
}>()

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
)

const canvasRef = useTemplateRef<HTMLCanvasElement>("canvasRef")
let chartInstance: Chart | null = null

const renderChart = () => {
  if (!canvasRef.value) return

  if (chartInstance) {
    chartInstance.destroy()
  }

  const ctx = canvasRef.value.getContext("2d")
  if (!ctx) return

  chartInstance = new Chart(ctx, {
    type: "line",
    data: props.data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          display: true,
          ticks: {
            color: "#6b7280",
            font: { size: 10 },
            maxTicksLimit: 5,
          },
          grid: {
            color: "rgba(75, 85, 99, 0.3)",
          },
        },
        y: {
          display: true,
          ticks: {
            color: "#6b7280",
            font: { size: 10 },
            maxTicksLimit: 4,
            callback: (value: number | string) => {
              const num = typeof value === "string" ? parseFloat(value) : value
              if (props.formatValue) return props.formatValue(num)
              return num + (props.valueSuffix || "")
            },
          },
          grid: {
            color: "rgba(75, 85, 99, 0.3)",
          },
          beginAtZero: true,
        },
      },
      plugins: {
        tooltip: {
          enabled: true,
          backgroundColor: "#1f2937",
          titleColor: "#f9fafb",
          bodyColor: "#d1d5db",
          borderColor: "#374151",
          borderWidth: 1,
          callbacks: {
            label: (ctx: { parsed: { y: number } }) => {
              if (props.formatValue) return props.formatValue(ctx.parsed.y)
              return ctx.parsed.y.toFixed(2) + (props.valueSuffix || "")
            },
          },
        },
        legend: {
          display: false,
        },
      },
    },
  })
}

watch(
  () => props.data,
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
