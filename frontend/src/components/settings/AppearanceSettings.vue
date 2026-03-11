<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhPalette class="w-5 h-5 text-theme-accent" />
      Appearance
    </h3>

    <p class="text-sm text-theme-text-muted">Customize the look and feel of the application.</p>

    <div class="space-y-3 pt-2">
      <label class="text-sm font-medium text-theme-text-primary block"> Color Theme </label>

      <div class="space-y-2">
        <button
          v-for="theme in themes"
          :key="theme.id"
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all duration-200"
          :class="
            currentTheme === theme.id
              ? 'border-theme-accent bg-theme-accent/10'
              : 'border-theme-border hover:border-theme-bg-hover hover:bg-theme-bg-hover'
          "
          @click="selectTheme(theme.id)">
          <div
            class="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
            :style="{ background: theme.previewGradient }">
            <component :is="theme.icon" class="w-5 h-5 text-white drop-shadow-lg" />
          </div>

          <div class="flex-1 text-left">
            <div class="text-sm font-medium text-theme-text-primary">{{ theme.name }}</div>
            <div class="text-xs text-theme-text-muted mt-0.5">{{ theme.description }}</div>
          </div>

          <div
            v-if="currentTheme === theme.id"
            class="w-5 h-5 rounded-full bg-theme-accent flex items-center justify-center">
            <PhCheck class="w-3 h-3 text-white" />
          </div>
        </button>
      </div>
    </div>

    <div class="pt-4 border-t border-theme-border">
      <p class="text-xs text-theme-text-muted">
        Theme preference is saved locally and will persist across sessions.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from "vue"
import { useThemeStore, type Theme } from "@/stores/theme"
import { PhPalette, PhCheck } from "@phosphor-icons/vue"

defineProps<{
  hideHeader?: boolean
}>()

const themeStore = useThemeStore()
const currentTheme = computed(() => themeStore.currentTheme)

function selectTheme(theme: Theme) {
  themeStore.setTheme(theme)
}

const SunIcon = {
  render: () =>
    h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        stroke: "currentColor",
      },
      [
        h("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-width": 2,
          d: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
        }),
      ],
    ),
}

const MoonIcon = {
  render: () =>
    h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        stroke: "currentColor",
      },
      [
        h("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-width": 2,
          d: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
        }),
      ],
    ),
}

const SparkleIcon = {
  render: () =>
    h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        stroke: "currentColor",
      },
      [
        h("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-width": "2",
          d: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
        }),
      ],
    ),
}

const themes = [
  {
    id: "default" as Theme,
    name: "Default",
    description: "Classic dark theme with gray tones",
    previewGradient: "linear-gradient(135deg, #111827 0%, #374151 100%)",
    icon: SunIcon,
  },
  {
    id: "true-black" as Theme,
    name: "True Black",
    description: "Pure black for OLED displays",
    previewGradient: "linear-gradient(135deg, #000000 0%, #171717 100%)",
    icon: MoonIcon,
  },
  {
    id: "retrowave" as Theme,
    name: "Retrowave",
    description: "Sunset vibes with warm orange accents",
    previewGradient: "linear-gradient(135deg, #0d0221 0%, #ff6b35 100%)",
    icon: SparkleIcon,
  },
  {
    id: "catppuccin" as Theme,
    name: "Catppuccin",
    description: "Soft pastel with pink accents",
    previewGradient: "linear-gradient(135deg, #24273a 0%, #ea76cb 100%)",
    icon: SparkleIcon,
  },
  {
    id: "solarized" as Theme,
    name: "Solarized",
    description: "Warm earth tones with orange accents",
    previewGradient: "linear-gradient(135deg, #001a21 0%, #cb4b16 100%)",
    icon: SunIcon,
  },
]
</script>
