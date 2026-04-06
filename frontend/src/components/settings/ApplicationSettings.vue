<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhMonitor class="w-5 h-5 text-theme-accent" />
      Application Settings
    </h3>

    <p v-if="!isElectron()" class="text-sm text-theme-text-muted">
      These settings apply to the Orbital desktop application.
    </p>

    <div v-if="!isElectron()" class="bg-theme-bg-tertiary rounded-lg p-4">
      <p class="text-sm text-theme-text-muted">
        Orbital is currently running in a browser. Some settings are only available in the desktop
        application.
      </p>
    </div>

    <template v-else>
      <!-- Close Behavior Setting -->
      <div class="flex items-center justify-between pt-2 border-t border-theme-border">
        <div>
          <label class="text-sm font-medium text-theme-text-primary block">
            Hide to tray on close
          </label>

          <p class="text-xs text-theme-text-muted mt-0.5">
            When closing the window, Orbital will continue running in the system tray. Uncheck to
            quit the application completely.
          </p>
        </div>

        <button
          type="button"
          class="relative inline-flex h-6 w-12 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
          :class="closeToTray ? 'bg-theme-accent' : 'bg-theme-bg-hover'"
          @click="toggleCloseToTray">
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="closeToTray ? 'translate-x-7' : 'translate-x-1'" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue"
import { useAppSettingsStore } from "@/stores/appSettings"
import { isElectron, getCloseToTray, setCloseToTray, hasSelectedCloseBehavior, setHasSelectedCloseBehavior } from "@/services/electron"
import { PhMonitor } from "@phosphor-icons/vue"

defineProps<{
  hideHeader?: boolean
}>()

const appSettingsStore = useAppSettingsStore()

const closeToTray = computed(() => appSettingsStore.closeToTray)

onMounted(async () => {
  if (isElectron()) {
    const mainCloseToTray = await getCloseToTray()
    const mainHasSelected = await hasSelectedCloseBehavior()
    
    if (mainHasSelected) {
      appSettingsStore.settings.closeToTray = mainCloseToTray ?? true
      appSettingsStore.settings.hasSelectedCloseBehavior = true
    }
  }
})

async function toggleCloseToTray() {
  const newValue = !closeToTray.value
  appSettingsStore.setCloseToTray(newValue)
  
  if (isElectron()) {
    await setCloseToTray(newValue)
  }
}
</script>
