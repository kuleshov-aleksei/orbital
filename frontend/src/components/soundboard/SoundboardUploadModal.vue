<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50 p-4"
      @click.self="close"
      @keydown.esc="close">
      <div
        data-testid="soundboard-upload-modal"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-theme-text-primary">Upload a sound</h2>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="submit">
          <!-- File -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">
              Audio file
            </label>
            <input
              ref="fileInput"
              type="file"
              accept="audio/*,.mp3,.ogg,.opus,.wav,.flac,.m4a"
              class="hidden"
              @change="onFileChange" />
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
                :disabled="isDecoding"
                @click="fileInput?.click()">
                {{ decoded ? "Change file" : "Choose file" }}
              </button>
              <span v-if="sourceName" class="text-xs text-theme-text-secondary truncate flex-1">
                {{ sourceName }}
                <template v-if="decoded"> · {{ decoded.duration.toFixed(1) }}s</template>
                <template v-else-if="isDecoding"> · decoding…</template>
              </span>
            </div>
            <p v-if="!decoded" class="mt-1 text-[11px] text-theme-text-muted">
              Any audio file up to {{ MAX_SOURCE_S }} seconds. You'll trim it to
              {{ MAX_DURATION_S }} seconds next.
            </p>
          </div>

          <SoundboardAudioEditor v-if="decoded" ref="editor" :audio="decoded" />

          <!-- Emoji + name -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">Name</label>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="h-9 w-9 shrink-0 rounded flex items-center justify-center bg-theme-bg-tertiary hover:bg-theme-bg-hover"
                title="Pick an emoji"
                @click="isPickerOpen = !isPickerOpen">
                <EmojiGlyph v-if="emoji" :emoji-ref="emoji" :size="20" />
                <PhSmiley v-else class="w-5 h-5 text-theme-text-muted" />
              </button>
              <input
                v-model="name"
                type="text"
                :maxlength="MAX_NAME"
                placeholder="Airhorn"
                class="flex-1 px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary" />
            </div>
            <EmojiPicker
              v-if="isPickerOpen"
              class="mt-1.5"
              @select="selectEmoji"
              @close="isPickerOpen = false" />
          </div>

          <!-- Aliases -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">
              Aliases <span class="text-theme-text-muted font-normal">(optional, for search)</span>
            </label>
            <div
              class="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border rounded focus-within:border-theme-accent">
              <span
                v-for="alias in aliases"
                :key="alias"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-theme-bg-hover text-xs text-theme-text-primary">
                {{ alias }}
                <button
                  type="button"
                  class="text-theme-text-muted hover:text-theme-text-primary"
                  :title="`Remove ${alias}`"
                  @click="removeAlias(alias)">
                  <PhX class="w-3 h-3" />
                </button>
              </span>
              <input
                v-if="aliases.length < MAX_ALIASES"
                v-model="aliasDraft"
                type="text"
                :maxlength="MAX_NAME"
                :placeholder="aliases.length ? '' : 'horn, mlg'"
                class="flex-1 min-w-[6rem] bg-transparent text-sm focus:outline-none text-theme-text-primary"
                @keydown="onAliasKeydown"
                @blur="commitAlias" />
            </div>
            <p class="mt-1 text-[11px] text-theme-text-muted">
              Press Enter or comma to add. Up to {{ MAX_ALIASES }}.
            </p>
          </div>

          <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
              @click="close">
              Cancel
            </button>
            <button
              type="submit"
              class="px-4 py-2 text-sm rounded bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!canSubmit">
              {{ isUploading ? "Uploading…" : "Upload" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef } from "vue"
import { PhSmiley, PhX } from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import SoundboardAudioEditor from "@/components/soundboard/SoundboardAudioEditor.vue"
import type { EmojiRef } from "@/services/emoji"
import { decodeAudioFile, type DecodedAudio } from "@/services/audioDecode"
import { useSoundboardStore } from "@/stores"

const emit = defineEmits<{ close: [] }>()
// Keep in sync with backend/internal/service/soundboard{service,opus}.go.
const MAX_UPLOAD_BYTES = 1024 * 1024
const MAX_DURATION_S = 5
const MAX_NAME = 32
const MAX_ALIASES = 10
// Limits for the source file; it is trimmed before upload.
const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_SOURCE_S = 30

const soundboardStore = useSoundboardStore()

const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const editor = useTemplateRef<InstanceType<typeof SoundboardAudioEditor>>("editor")
const sourceName = ref<string | null>(null)
const decoded = ref<DecodedAudio | null>(null)
const isDecoding = ref(false)

const name = ref("")
const emoji = ref<EmojiRef>("")
const isPickerOpen = ref(false)
const aliases = ref<string[]>([])
const aliasDraft = ref("")
const error = ref<string | null>(null)
const isUploading = ref(false)

const canSubmit = computed(
  () =>
    !!decoded.value &&
    (editor.value?.hasValidSelection ?? false) &&
    name.value.trim() !== "" &&
    !isUploading.value,
)

function resetFile() {
  decoded.value = null
  sourceName.value = null
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ""
  if (!picked) return
  resetFile()
  error.value = null

  if (picked.size > MAX_SOURCE_BYTES) {
    error.value = "File is larger than 10 MB."
    return
  }
  sourceName.value = picked.name
  isDecoding.value = true
  let audio: DecodedAudio
  try {
    audio = await decodeAudioFile(await picked.arrayBuffer())
  } catch {
    sourceName.value = null
    error.value = "Couldn't read this file. Use a common audio format (MP3, OGG, WAV, FLAC)."
    return
  } finally {
    isDecoding.value = false
  }
  if (audio.duration > MAX_SOURCE_S) {
    sourceName.value = null
    error.value = `File is ${audio.duration.toFixed(0)}s long. Use one under ${MAX_SOURCE_S} seconds.`
    return
  }

  decoded.value = audio
  if (!name.value.trim()) {
    name.value = picked.name.replace(/\.[^.]+$/, "").slice(0, MAX_NAME)
  }
}

function selectEmoji(ref: EmojiRef) {
  emoji.value = ref
  isPickerOpen.value = false
}

function commitAlias() {
  const value = aliasDraft.value.trim().toLowerCase()
  aliasDraft.value = ""
  if (!value || aliases.value.includes(value) || aliases.value.length >= MAX_ALIASES) return
  aliases.value.push(value)
}

function removeAlias(alias: string) {
  aliases.value = aliases.value.filter((a) => a !== alias)
}

function onAliasKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault()
    commitAlias()
  } else if (event.key === "Backspace" && aliasDraft.value === "" && aliases.value.length) {
    aliases.value.pop()
  }
}

async function submit() {
  commitAlias()
  if (!canSubmit.value) return
  const wav = editor.value?.exportWav()
  if (!wav) return
  if (wav.byteLength > MAX_UPLOAD_BYTES) {
    error.value = "Selection is too large to upload."
    return
  }
  const file = new File([wav], `${name.value.trim() || "sound"}.wav`, { type: "audio/wav" })
  isUploading.value = true
  error.value = null
  try {
    await soundboardStore.upload({
      file,
      name: name.value.trim(),
      emoji: emoji.value,
      aliases: aliases.value,
    })
    close()
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Upload failed"
  } finally {
    isUploading.value = false
  }
}

function close() {
  resetFile()
  emit("close")
}

onUnmounted(resetFile)
</script>
