<template>
  <template v-for="(node, i) in nodes" :key="i">
    <template v-if="node.type === 'text'">{{ node.text }}</template>
    <br v-else-if="node.type === 'br'" />
    <strong v-else-if="node.type === 'bold'" class="font-semibold"
      ><MessageNodes :nodes="node.children" :emoji-size="emojiSize"
    /></strong>
    <em v-else-if="node.type === 'italic'"
      ><MessageNodes :nodes="node.children" :emoji-size="emojiSize"
    /></em>
    <s v-else-if="node.type === 'strike'"
      ><MessageNodes :nodes="node.children" :emoji-size="emojiSize"
    /></s>
    <SpoilerText v-else-if="node.type === 'spoiler'"
      ><MessageNodes :nodes="node.children" :emoji-size="emojiSize"
    /></SpoilerText>
    <a
      v-else-if="node.type === 'link'"
      :href="node.href"
      target="_blank"
      rel="noopener noreferrer nofollow"
      class="text-theme-accent hover:underline break-all"
      @click="openLink($event, node.href)"
      >{{ node.text }}</a
    >
    <EmojiGlyph
      v-else-if="node.type === 'emoji'"
      :emoji-ref="`custom:${node.id}`"
      :size="emojiSize"
      pausable
      :title="`:${node.shortcode}:`" />
    <span
      v-else-if="node.type === 'mention'"
      class="rounded px-0.5 bg-theme-accent/20 text-theme-accent font-medium"
      >@{{ mentionName(node.kind, node.id) }}</span
    >
  </template>
</template>

<script setup lang="ts">
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import SpoilerText from "./SpoilerText.vue"
import type { MarkupNode } from "@/utils/messageMarkup"
import { isElectron, openExternal } from "@/services/electron"
import { usePermissionsStore, useUsersStore } from "@/stores"

withDefaults(defineProps<{ nodes: MarkupNode[]; emojiSize?: number }>(), { emojiSize: 22 })
defineOptions({ name: "MessageNodes" })
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()

// Mentions always show the current name (renames never touch stored text).
function mentionName(kind: "user" | "role", id: string): string {
  if (kind === "user") {
    return usersStore.allUsers.find((u) => u.id === id)?.nickname ?? "unknown-user"
  }
  return permissionsStore.roles.find((r) => r.id === id)?.name ?? "unknown-role"
}

function openLink(event: MouseEvent, href: string) {
  if (isElectron()) {
    event.preventDefault()
    void openExternal(href)
  }
}
</script>
