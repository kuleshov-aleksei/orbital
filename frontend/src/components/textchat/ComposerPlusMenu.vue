<template>
  <!-- The composer's ➕ menu: upload a file or create a poll. A popover above
       the button on desktop, a bottom sheet on mobile. -->
  <div ref="root" class="relative flex-shrink-0" @keydown.escape="onEscape">
    <button
      type="button"
      class="w-8 h-8 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
      :class="{ 'text-theme-text-primary bg-theme-bg-hover': open }"
      title="Upload a file or create a poll"
      aria-label="More: upload a file or create a poll"
      aria-haspopup="menu"
      :aria-expanded="open"
      data-testid="composer-plus"
      @click="toggle">
      <PhPlusCircle class="w-5 h-5 transition-transform" :class="{ 'rotate-45': open }" />
    </button>

    <!-- Desktop popover -->
    <Transition name="pop">
      <div
        v-if="open && !isMobile"
        class="absolute bottom-full left-0 mb-2 z-30 w-60 rounded-lg border border-theme-border bg-theme-bg-secondary p-1 shadow-xl"
        role="menu"
        data-testid="composer-plus-menu">
        <button
          v-for="item in items"
          :key="item.key"
          type="button"
          role="menuitem"
          :class="rowDesktop"
          :disabled="item.disabled"
          :title="item.disabledReason"
          :data-testid="item.testid"
          @click="choose(item.key)">
          <component :is="item.icon" class="w-5 h-5 flex-shrink-0 text-theme-text-muted" />
          <span class="min-w-0">
            <span class="block">{{ item.label }}</span>
            <span
              v-if="item.disabledReason && item.disabled"
              class="block text-xs text-theme-text-muted"
              >{{ item.disabledReason }}</span
            >
          </span>
        </button>
      </div>
    </Transition>

    <!-- Mobile sheet -->
    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="open && isMobile"
          class="fixed inset-0 z-50 flex flex-col justify-end"
          @keydown.escape.prevent.stop="close">
          <div class="absolute inset-0 bg-black/50" @click="close" />
          <div
            class="sheet-panel relative rounded-t-2xl border-t border-theme-border bg-theme-bg-secondary shadow-2xl px-2 pb-2"
            role="menu"
            aria-label="Add to message"
            data-testid="composer-plus-sheet">
            <div
              class="mx-auto mt-2 mb-2 h-1 w-10 rounded-full bg-theme-border"
              aria-hidden="true" />
            <button
              v-for="item in items"
              :key="item.key"
              type="button"
              role="menuitem"
              :class="rowMobile"
              :disabled="item.disabled"
              :data-testid="item.testid"
              @click="choose(item.key)">
              <span
                class="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full bg-theme-bg-tertiary">
                <component :is="item.icon" class="w-5 h-5 text-theme-text-secondary" />
              </span>
              <span class="min-w-0">
                <span class="block">{{ item.label }}</span>
                <span class="block text-xs text-theme-text-muted">{{
                  item.disabled ? item.disabledReason : item.hint
                }}</span>
              </span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue"
import { PhChartBarHorizontal, PhPaperclip, PhPlusCircle } from "@phosphor-icons/vue"
import { pushBackHandler } from "@/services/backButton"
import { useAppStore } from "@/stores"

const props = defineProps<{
  canAttach: boolean
  canPoll: boolean
  /** Uploads need the server; polls queue in the outbox like messages. */
  online: boolean
}>()
const emit = defineEmits<{ attach: []; poll: [] }>()

const appStore = useAppStore()
const isMobile = computed(() => appStore.isMobile)

const rowDesktop =
  "w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left text-sm text-theme-text-primary hover:bg-theme-bg-hover disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed"
const rowMobile =
  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-[15px] text-theme-text-primary active:bg-theme-bg-hover disabled:opacity-50"

const items = computed(() => {
  const out = []
  if (props.canAttach) {
    out.push({
      key: "attach" as const,
      label: "Upload a file",
      hint: "Images, audio, mp4 video",
      icon: PhPaperclip,
      disabled: !props.online,
      disabledReason: props.online ? "" : "Uploads need a connection",
      testid: "attach-button",
    })
  }
  if (props.canPoll) {
    out.push({
      key: "poll" as const,
      label: "Create a poll",
      hint: "Ask a question with answers to pick",
      icon: PhChartBarHorizontal,
      disabled: false,
      disabledReason: "",
      testid: "create-poll-button",
    })
  }
  return out
})

const open = ref(false)
const root = useTemplateRef<HTMLDivElement>("root")

function toggle() {
  open.value = !open.value
}
function close() {
  open.value = false
}
function onEscape(e: KeyboardEvent) {
  if (!open.value) return
  e.preventDefault()
  e.stopPropagation()
  close()
}
function choose(key: "attach" | "poll") {
  close()
  if (key === "attach") emit("attach")
  else emit("poll")
}

// Desktop: a click elsewhere closes the popover. Mobile: the back button.
function onPointerdown(e: PointerEvent) {
  if (!isMobile.value && !root.value?.contains(e.target as Node)) close()
}
let stopBack: (() => void) | null = null
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", onPointerdown, true)
    if (isMobile.value) {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      stopBack = pushBackHandler(close)
    }
  } else {
    document.removeEventListener("pointerdown", onPointerdown, true)
    stopBack?.()
    stopBack = null
  }
})
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerdown, true)
  stopBack?.()
})
</script>

<style scoped>
.sheet-panel {
  padding-bottom: calc(0.5rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.2s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel,
.sheet-leave-to .sheet-panel {
  transform: translateY(100%);
}
</style>
