<template>
  <div class="space-y-6">
    <h3 class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhSpeakerHigh class="w-5 h-5 text-theme-accent" />
      Sound Settings
    </h3>

    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium text-theme-text-primary block mb-2">
          Your Sound Pack
        </label>
        <p class="text-xs text-theme-text-muted mb-3">Choose the sound pack for your UI sounds</p>

        <select
          v-model="selectedPack"
          class="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent"
          @change="onPackChange">
          <option v-for="pack in availablePacks" :key="pack.id" :value="pack.id">
            {{ pack.name }}
          </option>
        </select>

        <p v-if="currentPack?.description" class="text-xs text-theme-text-muted mt-2">
          {{ currentPack.description }}
        </p>
      </div>

      <div>
        <label class="text-sm font-medium text-theme-text-primary block mb-2"> Sound Volume </label>
        <p class="text-xs text-theme-text-muted mb-3">Adjust the volume of UI sounds</p>

        <div class="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="volume"
            class="flex-1 h-2 bg-theme-bg-tertiary rounded-lg appearance-none cursor-pointer accent-theme-accent"
            @input="onVolumeChange" />
          <span class="text-sm text-theme-text-secondary w-10 text-right">
            {{ Math.round(volume * 100) }}%
          </span>
        </div>
      </div>

      <SoundPreview />

      <div class="pt-4 border-t border-theme-border">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-theme-text-primary block">
              Incoming User Sounds
            </label>
            <p class="text-xs text-theme-text-muted mt-0.5">Override sound packs of other users</p>
          </div>

          <button
            type="button"
            class="text-sm text-theme-accent hover:text-theme-accent/80 transition-colors"
            @click="showOverrideModal = true">
            Manage
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showOverrideModal"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      @click.self="showOverrideModal = false">
      <div class="bg-theme-bg-secondary rounded-xl shadow-xl w-full max-w-md mx-4 p-4">
        <div class="flex items-center justify-between mb-4">
          <h4 class="text-lg font-medium text-theme-text-primary">Sound Pack Overrides</h4>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            @click="showOverrideModal = false">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <p class="text-xs text-theme-text-muted mb-4">
          Enable this to hear default sounds instead of other users' custom sound packs when they
          mute/unmute, join/leave, etc.
        </p>

        <div class="flex items-center justify-between py-2">
          <span class="text-sm text-theme-text-primary">Use default sounds for all users</span>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
            :class="useDefaultForAll ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
            @click="toggleUseDefaultForAll">
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
              :class="useDefaultForAll ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div v-if="roomUsers.length > 0" class="mt-4 space-y-2 max-h-60 overflow-y-auto">
          <div
            v-for="user in roomUsers"
            :key="user.id"
            class="flex items-center justify-between py-2 px-3 bg-theme-bg-tertiary rounded-lg">
            <span class="text-sm text-theme-text-primary">{{ user.nickname }}</span>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
              :class="isOverridden(user.id) ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
              @click="toggleOverride(user.id)">
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                :class="isOverridden(user.id) ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>

        <p v-else class="text-xs text-theme-text-muted text-center py-4">
          No users in the current room
        </p>

        <button
          type="button"
          class="w-full mt-4 px-4 py-2 bg-theme-accent hover:bg-theme-accent/80 text-theme-text-on-accent text-sm rounded-lg transition-colors"
          @click="showOverrideModal = false">
          Done
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { storeToRefs } from "pinia"
import { useSoundPackStore, useRoomStore } from "@/stores"
import SoundPreview from "./SoundPreview.vue"
import { PhSpeakerHigh, PhX } from "@phosphor-icons/vue"

const soundPackStore = useSoundPackStore()
const roomStore = useRoomStore()
const { selectedPackId, availablePacks, volume } = storeToRefs(soundPackStore)

const selectedPack = ref(selectedPackId.value)
const showOverrideModal = ref(false)

const currentPack = computed(() => {
  return availablePacks.value.find((p) => p.id === selectedPack.value)
})

const roomUsers = computed(() => {
  return roomStore.currentRoomUsers || []
})

const useDefaultForAll = computed(() => {
  return soundPackStore.overrideIncomingAudioPacksWithDefault
})

function onPackChange() {
  soundPackStore.setSelectedPack(selectedPack.value)
}

function onVolumeChange(event: Event) {
  const target = event.target as HTMLInputElement
  soundPackStore.setVolume(parseFloat(target.value))
}

function isOverridden(userId: string): boolean {
  return soundPackStore.isOverridden(userId)
}

function toggleOverride(userId: string) {
  if (isOverridden(userId)) {
    soundPackStore.clearOverride(userId)
  } else {
    soundPackStore.setOverride(userId, true)
  }
}

function toggleUseDefaultForAll() {
  soundPackStore.setOverrideIncomingWithDefault(!useDefaultForAll.value)
}

onMounted(() => {
  selectedPack.value = selectedPackId.value
})
</script>
