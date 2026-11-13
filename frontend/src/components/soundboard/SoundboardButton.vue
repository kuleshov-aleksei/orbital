<template>
  <div class="inline-block" :class="{ relative: !fullWidth }">
    <div class="relative">
      <button
        type="button"
        data-testid="soundboard-button"
        class="control-button h-10 w-14 rounded-lg"
        :class="
          isLocked
            ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
            : isOpen
              ? 'bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent'
              : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary'
        "
        :title="buttonTitle"
        @click.stop="toggle">
        <PhMusicNotes class="w-5 h-5 pointer-events-none" />
      </button>

      <div
        v-if="isLocked"
        class="absolute bottom-1 right-1 bg-theme-bg-secondary rounded-full p-0.5 border border-theme-border pointer-events-none">
        <PhLock class="w-3 h-3 text-theme-text-muted" />
      </div>
    </div>

    <SoundboardPopover
      v-if="isOpen"
      :full-width="fullWidth"
      @close="isOpen = false"
      @upload="openUpload" />
    <div v-if="isOpen" class="fixed inset-0 z-40" @click="isOpen = false" />

    <SoundboardUploadModal v-if="isUploadOpen" @close="isUploadOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { PhLock, PhMusicNotes } from "@phosphor-icons/vue"
import SoundboardPopover from "./SoundboardPopover.vue"
import SoundboardUploadModal from "./SoundboardUploadModal.vue"
import { usePermissionsStore, useRoomStore, useSoundboardStore } from "@/stores"
import { Permission } from "@/types/permissions"

// fullWidth: anchor the popover to the nearest positioned ancestor (mobile call bar).
defineProps<{ fullWidth?: boolean }>()
const emit = defineEmits<{ "open-change": [open: boolean] }>()

const roomStore = useRoomStore()
const permissionsStore = usePermissionsStore()
const soundboardStore = useSoundboardStore()

const isOpen = ref(false)
const isUploadOpen = ref(false)

// UI hint only: the backend rejects play_sound without use_soundboard.
const isLocked = computed(
  () => !permissionsStore.can(Permission.UseSoundboard, { roomId: roomStore.activeRoomId }),
)

const buttonTitle = computed(() =>
  isLocked.value ? "You don't have permission to use the soundboard here" : "Soundboard",
)

const toggle = () => {
  if (isLocked.value) return
  isOpen.value = !isOpen.value
}

watch(isOpen, (open) => emit("open-change", open))

const openUpload = () => {
  isOpen.value = false
  isUploadOpen.value = true
}

// Close the popover if permission is revoked while it is open.
watch(isLocked, (locked) => {
  if (locked) isOpen.value = false
})

// The button only exists inside a call: preload the library so plays from
// others start instantly, even if this user never opens the soundboard.
onMounted(() => {
  void soundboardStore.ensureLoaded()
})
</script>
