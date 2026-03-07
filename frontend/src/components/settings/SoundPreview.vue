<template>
  <div class="space-y-4">
    <h4 class="text-sm font-medium text-gray-300">Sound Preview</h4>
    <p class="text-xs text-gray-400 mb-3">Click to preview sounds from your selected pack</p>

    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewJoinRoom">
        <PhUserPlus class="w-4 h-4" />
        Join Room
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewLeaveRoom">
        <PhUserMinus class="w-4 h-4" />
        Leave Room
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewMute">
        <PhMicrophoneSlash class="w-4 h-4" />
        Mute
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewUnmute">
        <PhMicrophone class="w-4 h-4" />
        Unmute
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewDeafen">
        <PhSpeakerSlash class="w-4 h-4" />
        Deafen
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewUndeafen">
        <PhSpeakerHigh class="w-4 h-4" />
        Undeafen
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewCameraStart">
        <PhCamera class="w-4 h-4" />
        Camera Start
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewCameraStop">
        <PhCameraSlash class="w-4 h-4" />
        Camera Stop
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewScreenShareStart">
        <PhMonitorPlay class="w-4 h-4" />
        Screen Share Start
      </button>

      <button
        type="button"
        class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        @click="previewScreenShareStop">
        <PhMonitor class="w-4 h-4" />
        Screen Share Stop
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSounds } from "@/services/sounds"
import {
  PhUserPlus,
  PhUserMinus,
  PhMicrophoneSlash,
  PhMicrophone,
  PhSpeakerSlash,
  PhSpeakerHigh,
  PhCamera,
  PhCameraSlash,
  PhMonitorPlay,
  PhMonitor,
} from "@phosphor-icons/vue"

const {
  playJoinRoom,
  playLeaveRoom,
  playMute,
  playUnmute,
  playDeafen,
  playUndeafen,
  playCameraStart,
  playCameraStop,
  playScreenShareStart,
  playScreenShareStop,
} = useSounds()

function previewJoinRoom() {
  playJoinRoom()
}

function previewLeaveRoom() {
  playLeaveRoom()
}

function previewMute() {
  playMute()
}

function previewUnmute() {
  playUnmute()
}

function previewDeafen() {
  playDeafen()
}

function previewUndeafen() {
  playUndeafen()
}

function previewCameraStart() {
  playCameraStart()
}

function previewCameraStop() {
  playCameraStop()
}

function previewScreenShareStart() {
  playScreenShareStart()
}

function previewScreenShareStop() {
  playScreenShareStop()
}
</script>
