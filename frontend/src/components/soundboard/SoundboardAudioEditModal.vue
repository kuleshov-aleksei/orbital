<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50 p-4"
      @click.self="close"
      @keydown.esc="close">
      <div
        data-testid="soundboard-audio-edit-modal"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-theme-text-primary flex items-center gap-2 min-w-0">
            <EmojiGlyph v-if="sound.emoji" :emoji-ref="sound.emoji" :size="20" />
            <span class="truncate">Edit audio · {{ sound.name }}</span>
          </h2>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <p v-if="isLoading" class="py-10 text-center text-sm text-theme-text-muted">
          Loading audio…
        </p>
        <SoundboardAudioEditor v-else-if="decoded" ref="editor" :audio="decoded" />

        <p class="mt-3 text-[11px] text-theme-text-muted">
          Saving replaces the clip for everyone. Name, emoji and aliases are kept.
        </p>
        <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-4">
          <button
            type="button"
            class="px-4 py-2 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
            @click="close">
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm rounded bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!canSave"
            @click="save">
            {{ isSaving ? "Saving…" : "Save audio" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue"
import { PhX } from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import SoundboardAudioEditor from "@/components/soundboard/SoundboardAudioEditor.vue"
import { apiService } from "@/services/api"
import { decodeAudioFile, type DecodedAudio } from "@/services/audioDecode"
import { useSoundboardStore } from "@/stores"
import type { SoundboardSound } from "@/types"

const props = defineProps<{ sound: SoundboardSound }>()
const emit = defineEmits<{ close: [] }>()
// Keep in sync with MaxSoundboardFileSize in backend/internal/service/soundboardservice.go.
const MAX_UPLOAD_BYTES = 1024 * 1024

const soundboardStore = useSoundboardStore()
const editor = useTemplateRef<InstanceType<typeof SoundboardAudioEditor>>("editor")
const decoded = ref<DecodedAudio | null>(null)
const isLoading = ref(true)
const isSaving = ref(false)
const error = ref<string | null>(null)

const canSave = computed(
  () => !!decoded.value && (editor.value?.hasValidSelection ?? false) && !isSaving.value,
)

async function load() {
  isLoading.value = true
  error.value = null
  try {
    const response = await fetch(apiService.getSoundboardAudioUrl(props.sound))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    decoded.value = await decodeAudioFile(await response.arrayBuffer())
  } catch (err) {
    console.error(`[Soundboard] Failed to load ${props.sound.id} for editing:`, err)
    error.value = "Couldn't load this sound's audio."
  } finally {
    isLoading.value = false
  }
}

async function save() {
  if (!canSave.value) return
  const wav = editor.value?.exportWav()
  if (!wav) return
  if (wav.byteLength > MAX_UPLOAD_BYTES) {
    error.value = "Selection is too large to upload."
    return
  }
  isSaving.value = true
  error.value = null
  try {
    await soundboardStore.replaceAudio(
      props.sound.id,
      new File([wav], `${props.sound.name}.wav`, { type: "audio/wav" }),
    )
    emit("close")
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to save audio"
  } finally {
    isSaving.value = false
  }
}

function close() {
  emit("close")
}

onMounted(load)
</script>
