<template>
  <main
    v-if="!appStore.isMobile || appStore.mobileView === 'room'"
    class="flex-1 flex flex-col min-h-0 bg-gray-900">
    <WelcomeView
      v-if="!roomStore.activeRoomId"
      @room-selected="$emit('room-selected', $event)"
      @create-room="$emit('create-room')" />

    <VoiceCallView
      v-else-if="roomStore.activeRoomId"
      ref="voiceCallViewRef"
      v-model:model-value-muted="callStore.isMuted"
      v-model:model-value-deafened="callStore.isDeafened"
      v-model:model-value-screen-sharing="callStore.isScreenSharing"
      v-model:model-value-camera-enabled="callStore.isCameraEnabled"
      :room-id="roomStore.activeRoomId"
      :room-name="roomStore.activeRoomName"
      :users="roomStore.currentRoomUsers"
      :remote-stream-volumes="roomStore.remoteStreamVolumes"
      :is-mobile="appStore.isMobile"
      @leave-room="$emit('leave-room')"
      @show-room-list="appStore.showRoomsView()"
      @toggle-user-sidebar="appStore.toggleMobileUserSidebar()"
      @ping-update="(ping, quality) => $emit('ping-update', { ping, quality })"
      @request-screen-share="$emit('request-screen-share')" />
  </main>
</template>

<script setup lang="ts">
import { defineAsyncComponent, useTemplateRef } from "vue"
import { useRoomStore, useAppStore, useCallStore } from "@/stores"
import WelcomeView from "@/views/WelcomeView.vue"

defineEmits<{
  (e: "room-selected", roomId: string): void
  (e: "create-room"): void
  (e: "leave-room"): void
  (
    e: "ping-update",
    payload: { ping: number; quality: "excellent" | "good" | "fair" | "poor" },
  ): void
  (e: "request-screen-share"): void
}>()

const VoiceCallView = defineAsyncComponent(() => import("@/views/VoiceCallView.vue"))

const roomStore = useRoomStore()
const appStore = useAppStore()
const callStore = useCallStore()

const voiceCallViewRef = useTemplateRef<InstanceType<typeof VoiceCallView>>("voiceCallViewRef")

defineExpose({
  voiceCallViewRef,
})
</script>
