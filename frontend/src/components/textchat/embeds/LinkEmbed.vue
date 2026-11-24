<template>
  <!-- A bare image link: just the (proxied) picture. -->
  <a
    v-if="embed.kind === 'image' && imageSrc"
    :href="embed.url"
    target="_blank"
    rel="noopener noreferrer nofollow"
    class="block overflow-hidden rounded-lg bg-theme-bg-tertiary border border-theme-border/60 max-w-full"
    :style="largeBox"
    :title="embed.url"
    data-testid="link-embed"
    @click="openLinkExternally($event, embed.url)">
    <img
      :src="imageSrc"
      :alt="embed.site_name || 'Image'"
      :width="embed.image_width"
      :height="embed.image_height"
      class="w-full h-full object-cover"
      loading="lazy"
      draggable="false" />
  </a>

  <div
    v-else
    class="relative flex gap-3 rounded-md border-l-4 border-theme-accent bg-theme-bg-secondary p-3 w-full max-w-[432px] min-w-0"
    data-testid="link-embed">
    <div class="min-w-0 flex-1 flex flex-col gap-1">
      <span v-if="embed.site_name" class="text-xs text-theme-text-muted truncate">
        {{ embed.site_name }}
      </span>
      <a
        v-if="embed.title"
        :href="embed.url"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="font-semibold text-theme-accent hover:underline break-words line-clamp-2"
        @click="openLinkExternally($event, embed.url)"
        >{{ embed.title }}</a
      >
      <p
        v-if="embed.description && embed.kind !== 'video'"
        class="text-sm text-theme-text-secondary break-words line-clamp-3 whitespace-pre-line">
        {{ embed.description }}
      </p>

      <!-- YouTube: thumbnail first, the player only after a click. -->
      <div
        v-if="embed.kind === 'video' && embed.video_id"
        class="relative mt-1 w-full overflow-hidden rounded-md bg-black aspect-video">
        <iframe
          v-if="playing"
          :src="playerSrc"
          :title="embed.title || 'Video'"
          class="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin" />
        <button
          v-else
          type="button"
          class="group/play absolute inset-0 w-full h-full"
          :aria-label="`Play ${embed.title || 'video'}`"
          data-testid="embed-play"
          @click="playing = true">
          <img
            v-if="imageSrc"
            :src="imageSrc"
            alt=""
            class="w-full h-full object-cover"
            loading="lazy"
            draggable="false" />
          <span
            class="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white transition-transform group-hover/play:scale-110">
            <PhPlay weight="fill" class="h-6 w-6" />
          </span>
        </button>
      </div>

      <a
        v-else-if="imageSrc && large"
        :href="embed.url"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="mt-1 block overflow-hidden rounded-md bg-theme-bg-tertiary"
        :style="{ aspectRatio: aspect }"
        tabindex="-1"
        @click="openLinkExternally($event, embed.url)">
        <img
          :src="imageSrc"
          alt=""
          :width="embed.image_width"
          :height="embed.image_height"
          class="w-full h-full object-cover"
          loading="lazy"
          draggable="false" />
      </a>
    </div>

    <!-- Small images sit beside the text, as in Telegram/Discord. -->
    <a
      v-if="imageSrc && !large && embed.kind === 'link'"
      :href="embed.url"
      target="_blank"
      rel="noopener noreferrer nofollow"
      class="shrink-0 h-20 w-20 overflow-hidden rounded-md bg-theme-bg-tertiary"
      tabindex="-1"
      @click="openLinkExternally($event, embed.url)">
      <img
        :src="imageSrc"
        alt=""
        class="w-full h-full object-cover"
        loading="lazy"
        draggable="false" />
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhPlay } from "@phosphor-icons/vue"
import { resolveUrl } from "@/services/api"
import { openLinkExternally } from "@/utils/externalLink"
import type { TextEmbed } from "@/types/textChat"

const props = defineProps<{ embed: TextEmbed }>()

const playing = ref(false)

// Thumbnails are proxied by our backend: viewers never contact the site.
const imageSrc = computed(() =>
  props.embed.image_id
    ? resolveUrl(`/api/embeds/${encodeURIComponent(props.embed.image_id)}/image`)
    : null,
)

const width = computed(() => props.embed.image_width || 0)
const height = computed(() => props.embed.image_height || 0)
const aspect = computed(() =>
  width.value && height.value ? `${width.value} / ${height.value}` : "16 / 9",
)

// Wide images go full-width under the text; small/square ones to the side.
const large = computed(
  () => width.value >= 400 && height.value > 0 && width.value / height.value > 1.3,
)

// Bare image links: sized by aspect ratio, at most 400×300.
const largeBox = computed(() => {
  if (!width.value || !height.value) return { width: "300px", aspectRatio: "4 / 3" }
  const scale = Math.min(1, 400 / width.value, 300 / height.value)
  return {
    width: `${Math.round(width.value * scale)}px`,
    aspectRatio: `${width.value} / ${height.value}`,
  }
})

const playerSrc = computed(
  () =>
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(props.embed.video_id ?? "")}?autoplay=1&rel=0`,
)
</script>
