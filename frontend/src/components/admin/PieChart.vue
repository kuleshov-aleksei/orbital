<template>
  <div :style="height ? { height: height + 'px' } : undefined">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch, onUnmounted, useTemplateRef } from "vue"
import { Chart, ArcElement, PieController, Tooltip, Legend } from "chart.js"

const props = defineProps<{
  labels: string[]
  values: number[]
  colors: string[]
  height?: number
  formatValue?: (value: number) => string
}>()

Chart.register(ArcElement, PieController, Tooltip, Legend)

const canvasRef = useTemplateRef<HTMLCanvasElement>("canvasRef")
let chartInstance: Chart<"pie"> | null = null

const renderChart = () => {
  if (!canvasRef.value) return

  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }

  const ctx = canvasRef.value.getContext("2d")
  if (!ctx) return

  try {
    chartInstance = new Chart(ctx, {
      type: "pie",
      data: {
        labels: props.labels,
        datasets: [
          {
            data: props.values,
            backgroundColor: props.colors,
            borderColor: "#1f2937",
            borderWidth: 2,
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
              label: (context) => {
                const value = context.parsed
                return props.formatValue ? props.formatValue(value) : String(value)
              },
            },
          },
          legend: {
            display: true,
            position: "right",
            labels: {
              color: "#9ca3af",
              boxWidth: 12,
              boxHeight: 12,
            },
          },
        },
      },
    })
  } catch (error) {
    console.error("Failed to render pie chart:", error)
    chartInstance = null
  }
}

watch(
  () => [props.labels, props.values, props.colors],
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
