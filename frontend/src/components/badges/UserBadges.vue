<template>
  <span
    v-if="badges.length"
    class="inline-flex items-center gap-1"
    :class="wrap ? 'flex-wrap' : 'shrink-0'"
    data-testid="user-badges">
    <BadgeIcon
      v-for="badge in badges"
      :key="badge.id"
      :badge="badge"
      :size="size"
      :title="badgeTitle(badge)"
      :data-testid="`user-badge-${badge.id}`" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue"
import BadgeIcon from "@/components/badges/BadgeIcon.vue"
import { useBadgesStore, type HeldBadge } from "@/stores"

// Badges of one user. `featured` renders just the one shown next to the
// nickname (their pinned badge, or their newest award); otherwise every badge
// is rendered — the profile card uses that. Hovering a badge shows its name,
// description and when it was awarded.
const props = withDefaults(
  defineProps<{
    userId: string
    size?: number
    /** Show only the badge displayed next to the nickname. */
    featured?: boolean
    /** Wrap onto several lines instead of staying on one (profile card). */
    wrap?: boolean
  }>(),
  { size: 15, featured: false, wrap: false },
)

const badgesStore = useBadgesStore()

const badges = computed<HeldBadge[]>(() => {
  if (!props.featured) return badgesStore.badgesOf(props.userId)
  const displayed = badgesStore.displayedBadgeOf(props.userId)
  return displayed ? [displayed] : []
})

function awardedLabel(badge: HeldBadge): string {
  const date = new Date(badge.assignedAt)
  if (isNaN(date.getTime())) return "Awarded"
  return `Awarded ${date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`
}

function badgeTitle(badge: HeldBadge): string {
  return [badge.name, badge.description, awardedLabel(badge)].filter(Boolean).join(" — ")
}
</script>
