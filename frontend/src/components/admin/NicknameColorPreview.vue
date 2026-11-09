<template>
  <div data-testid="nickname-color-preview">
    <span class="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
      >Preview</span
    >
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
      <!-- Each tile sets data-theme so the raw --color-* tokens resolve to that theme -->
      <div
        v-for="theme in THEMES"
        :key="theme.id"
        ref="tiles"
        :data-theme="theme.id"
        class="rounded border px-3 py-2"
        :style="{
          backgroundColor: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border)',
        }">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-[11px] truncate" :style="{ color: 'var(--color-text-muted)' }">
            {{ theme.name }}
          </span>
          <PhWarning
            v-if="lowContrast[theme.id]"
            class="w-3.5 h-3.5 flex-shrink-0 text-amber-400"
            :title="`Hard to read on ${theme.name}`" />
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="w-6 h-6 rounded-full flex-shrink-0"
            :style="{ backgroundColor: 'var(--color-bg-tertiary)' }"></span>
          <span class="text-sm font-medium truncate" :style="nameStyle">{{ nickname }}</span>
        </div>
        <!-- Offline users show the role colour dimmed (see UserCard) -->
        <div class="flex items-center gap-2 min-w-0 mt-1 opacity-60">
          <span
            class="w-6 h-6 rounded-full flex-shrink-0"
            :style="{ backgroundColor: 'var(--color-bg-tertiary)' }"></span>
          <span class="text-sm font-medium truncate" :style="nameStyle">{{ nickname }}</span>
          <span class="text-[11px] flex-shrink-0" :style="{ color: 'var(--color-text-muted)' }"
            >offline</span
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, useTemplateRef } from "vue"
import { PhWarning } from "@phosphor-icons/vue"
import { THEMES, type Theme } from "@/stores/theme"

const props = defineProps<{
  /** #rrggbb, or empty for the theme's default text colour */
  color: string
  nickname: string
}>()

const nameStyle = computed(() => ({ color: props.color || "var(--color-text-primary)" }))

const tiles = useTemplateRef<HTMLElement[]>("tiles")
// Background per theme, read from the rendered tile so it always matches style.css
const backgrounds = ref<Partial<Record<Theme, string>>>({})

onMounted(() => {
  const out: Partial<Record<Theme, string>> = {}
  for (const el of tiles.value ?? []) {
    const id = el.dataset.theme as Theme
    out[id] = getComputedStyle(el).getPropertyValue("--color-bg-secondary").trim()
  }
  backgrounds.value = out
})

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

// WCAG contrast below 3:1 (large/bold text minimum) gets a warning icon
const lowContrast = computed(() => {
  const out: Partial<Record<Theme, boolean>> = {}
  const fg = props.color ? luminance(props.color) : null
  if (fg === null) return out
  for (const theme of THEMES) {
    const bgHex = backgrounds.value[theme.id]
    const bg = bgHex ? luminance(bgHex) : null
    if (bg === null) continue
    out[theme.id] = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) < 3
  }
  return out
})
</script>
