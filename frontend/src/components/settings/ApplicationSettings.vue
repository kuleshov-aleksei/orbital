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

      <!-- Keyboard Shortcuts Section -->
      <div class="pt-2 border-t border-theme-border">
        <h4 class="text-sm font-medium text-theme-text-primary mb-3">Keyboard Shortcuts</h4>

        <!-- Wayland Notice -->
        <div
          v-if="showWaylandNotice"
          class="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-2">
          <PhWarning class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div class="text-sm text-yellow-200">
            <p class="font-medium">Wayland detected</p>
            <p class="text-xs mt-1 opacity-80">
              Hotkey changes require app restart. After setting a new hotkey, close and reopen the
              app for changes to take effect.
            </p>
          </div>
        </div>

        <div class="space-y-3">
          <!-- Mute Toggle -->
          <div class="flex items-center justify-between">
            <span class="text-sm text-theme-text-secondary">Mute / Unmute</span>
            <HotkeyInput
              :enabled="hotkeys.mute.enabled"
              :accelerator="hotkeys.mute.accelerator"
              :can-capture="true"
              :show-reset="hotkeys.mute.accelerator !== defaultHotkeys.mute.accelerator"
              @update:enabled="(val) => updateHotkey('mute', { ...hotkeys.mute, enabled: val })"
              @update:accelerator="
                (val) => updateHotkey('mute', { ...hotkeys.mute, accelerator: val })
              "
              @reset="resetHotkey('mute')" />
          </div>

          <!-- Deafen Toggle -->
          <div class="flex items-center justify-between">
            <span class="text-sm text-theme-text-secondary">Deafen / Undeafen</span>
            <HotkeyInput
              :enabled="hotkeys.deafen.enabled"
              :accelerator="hotkeys.deafen.accelerator"
              :can-capture="true"
              :show-reset="hotkeys.deafen.accelerator !== defaultHotkeys.deafen.accelerator"
              @update:enabled="(val) => updateHotkey('deafen', { ...hotkeys.deafen, enabled: val })"
              @update:accelerator="
                (val) => updateHotkey('deafen', { ...hotkeys.deafen, accelerator: val })
              "
              @reset="resetHotkey('deafen')" />
          </div>

          <!-- Push to Talk -->
          <div class="flex items-center justify-between">
            <span class="text-sm text-theme-text-secondary">Push to Talk</span>
            <HotkeyInput
              :enabled="hotkeys.ptt.enabled"
              :accelerator="hotkeys.ptt.accelerator"
              :can-capture="true"
              :show-reset="hotkeys.ptt.accelerator !== defaultHotkeys.ptt.accelerator"
              @update:enabled="(val) => updateHotkey('ptt', { ...hotkeys.ptt, enabled: val })"
              @update:accelerator="
                (val) => updateHotkey('ptt', { ...hotkeys.ptt, accelerator: val })
              "
              @reset="resetHotkey('ptt')" />
          </div>

          <!-- Reset All -->
          <div v-if="hasCustomHotkeys" class="flex justify-end pt-2">
            <button
              type="button"
              class="text-sm text-theme-accent hover:underline"
              @click="resetAllHotkeys">
              Reset all shortcuts
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useAppSettingsStore, type HotkeySetting } from "@/stores/appSettings"
import {
  isElectron,
  getCloseToTray,
  setCloseToTray,
  hasSelectedCloseBehavior,
  setHotkeys,
  resetHotkeys,
  getHotkeys,
  pauseHotkeys,
  resumeHotkeys,
  getIsWayland,
  type HotkeysConfig,
} from "@/services/electron"
import { PhMonitor, PhWarning } from "@phosphor-icons/vue"
import HotkeyInput from "./HotkeyInput.vue"

defineProps<{
  hideHeader?: boolean
}>()

const appSettingsStore = useAppSettingsStore()

const closeToTray = computed(() => appSettingsStore.closeToTray)
const hotkeys = computed(() => appSettingsStore.hotkeys)
const hasCustomHotkeys = computed(() => appSettingsStore.hasCustomHotkeys)
const isWayland = ref(false)
const showWaylandNotice = ref(false)

const defaultHotkeys: HotkeysConfig = {
  mute: { enabled: true, accelerator: "CommandOrControl+M" },
  deafen: { enabled: true, accelerator: "CommandOrControl+D" },
  ptt: { enabled: true, accelerator: "CommandOrControl+Space" },
}

onMounted(async () => {
  if (isElectron()) {
    isWayland.value = await getIsWayland()

    if (isWayland.value) {
      showWaylandNotice.value = true
    } else {
      await pauseHotkeys()
    }

    const mainCloseToTray = await getCloseToTray()
    const mainHasSelected = await hasSelectedCloseBehavior()

    if (mainHasSelected) {
      appSettingsStore.settings.closeToTray = mainCloseToTray ?? true
      appSettingsStore.settings.hasSelectedCloseBehavior = true
    }

    const mainHotkeys = await getHotkeys()
    if (mainHotkeys) {
      appSettingsStore.settings.hotkeys = mainHotkeys
    }
  }
})

onUnmounted(async () => {
  if (isElectron() && !isWayland.value) {
    await resumeHotkeys()
  }
})

async function toggleCloseToTray() {
  const newValue = !closeToTray.value
  appSettingsStore.setCloseToTray(newValue)

  if (isElectron()) {
    await setCloseToTray(newValue)
  }
}

async function updateHotkey(action: keyof HotkeysConfig, setting: HotkeySetting) {
  const newHotkeys: HotkeysConfig = JSON.parse(
    JSON.stringify({ ...hotkeys.value, [action]: setting }),
  )
  appSettingsStore.settings.hotkeys = newHotkeys
  appSettingsStore.saveSettings()

  if (isElectron()) {
    await setHotkeys(newHotkeys)
  }
}

async function resetHotkey(action: keyof HotkeysConfig) {
  const newHotkeys: HotkeysConfig = JSON.parse(
    JSON.stringify({ ...hotkeys.value, [action]: defaultHotkeys[action] }),
  )
  appSettingsStore.settings.hotkeys = newHotkeys
  appSettingsStore.saveSettings()

  if (isElectron()) {
    await setHotkeys(newHotkeys)
  }
}

async function resetAllHotkeys() {
  appSettingsStore.resetHotkeys()

  if (isElectron()) {
    await resetHotkeys()
  }
}
</script>
