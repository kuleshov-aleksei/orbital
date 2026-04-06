<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhInfo class="w-5 h-5 text-theme-accent" />
      About
    </h3>

    <!-- Application Version -->
    <div class="pt-2 border-t border-theme-border">
      <div class="flex items-center gap-2">
        <PhInfo class="w-4 h-4 text-theme-text-muted" />

        <span class="text-sm font-medium text-theme-text-secondary">Version</span>
      </div>

      <p class="text-sm text-theme-text-muted mt-1 font-mono">
        {{ appVersion }}
      </p>
    </div>

    <p class="text-sm text-theme-text-muted">
      This application uses the following open source libraries.
    </p>

    <div v-if="loading" class="py-4 text-center text-theme-text-muted">Loading licenses...</div>

    <div v-else-if="error" class="py-4 text-center text-red-400">
      {{ error }}
    </div>

    <div v-else class="space-y-2 max-h-96 overflow-y-auto pr-2">
      <div
        v-for="lib in licenses"
        :key="lib.name"
        class="p-3 bg-theme-bg-tertiary rounded-lg"
        :class="{ 'border-l-2 border-theme-accent': lib.custom }">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-theme-text-primary truncate">{{ lib.name }}</span>
            </div>
            <p v-if="lib.custom" class="text-sm text-theme-text-secondary mt-1">
              {{ lib.custom }}
            </p>
            <p
              v-else-if="lib.description"
              class="text-sm text-theme-text-muted mt-0.5 line-clamp-2">
              {{ lib.description }}
            </p>
          </div>
          <div class="flex-shrink-0 text-right">
            <span
              class="inline-block px-2 py-0.5 text-xs font-medium rounded"
              :class="getLicenseClass(lib.license)">
              {{ lib.license }}
            </span>
            <a
              v-if="lib.url"
              :href="lib.url"
              target="_blank"
              rel="noopener noreferrer"
              class="block mt-1 text-xs text-theme-accent hover:text-theme-accent/80">
              View Repo
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { PhInfo } from "@phosphor-icons/vue"
import { isElectron, getLicenses } from "@/services/electron"
import type { License } from "@/types"

defineProps<{
  hideHeader?: boolean
}>()

declare const __APP_VERSION__: string

const licenses = ref<License[]>([])
const loading = ref(true)
const error = ref("")

const appVersion = __APP_VERSION__

onMounted(async () => {
  try {
    if (isElectron()) {
      const electronLicenses = await getLicenses()
      if (electronLicenses) {
        licenses.value = electronLicenses
      }
    } else {
      const res = await fetch("/licenses.json")
      if (!res.ok) {
        throw new Error("Failed to load licenses")
      }
      licenses.value = await res.json()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Unknown error"
  } finally {
    loading.value = false
  }
})

function getLicenseClass(license: string) {
  const mit = ["MIT"]
  const apache = ["Apache-2.0", "Apache 2.0"]
  const bsd = ["BSD-2-Clause", "BSD-3-Clause", "BSD", "ISC"]
  const gpl = ["GPL", "GPL-3.0", "GPL-2.0", "AGPL-3.0"]
  const mpl = ["MPL-2.0", "Mozilla"]

  const upper = license.toUpperCase()
  if (mit.some((l) => upper.includes(l.toUpperCase()))) {
    return "bg-green-900 text-green-300"
  }
  if (apache.some((l) => upper.includes(l.toUpperCase()))) {
    return "bg-blue-900 text-blue-300"
  }
  if (bsd.some((l) => upper.includes(l.toUpperCase()))) {
    return "bg-purple-900 text-purple-300"
  }
  if (gpl.some((l) => upper.includes(l.toUpperCase()))) {
    return "bg-orange-900 text-orange-300"
  }
  if (mpl.some((l) => upper.includes(l.toUpperCase()))) {
    return "bg-red-900 text-red-300"
  }
  return "bg-gray-600 text-gray-300"
}
</script>
