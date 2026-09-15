<template>
  <div
    ref="containerEl"
    class="pumpkin-sprite"
    :style="{ width: size + 'px', height: size + 'px' }" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, useTemplateRef } from "vue"
import { Application, Container } from "pixi.js"
import type { EquippedCustomization } from "@/halloween/types"
import { createPumpkinSprite } from "@/halloween/pumpkinRenderer"

const props = withDefaults(
  defineProps<{
    equipped?: EquippedCustomization
    size?: number
  }>(),
  {
    equipped: () => ({}),
    size: 96,
  },
)

const containerEl = useTemplateRef<HTMLElement>("containerEl")
let app: Application | null = null
let pumpkin: Awaited<ReturnType<typeof createPumpkinSprite>> | null = null
let layer: Container | null = null

const init = async () => {
  if (!containerEl.value || app) return
  app = new Application()
  await app.init({
    width: props.size,
    height: props.size,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  })
  containerEl.value.appendChild(app.canvas as HTMLCanvasElement)

  layer = new Container()
  layer.sortableChildren = true
  app.stage.addChild(layer)

  pumpkin = await createPumpkinSprite(props.size)
  pumpkin.container.position.set(props.size / 2, props.size / 2)
  layer.addChild(pumpkin.container)
  pumpkin.setEquipped(props.equipped)
}

watch(
  () => props.equipped,
  (equipped) => {
    pumpkin?.setEquipped(equipped)
  },
  { deep: true },
)

onMounted(init)

onUnmounted(() => {
  pumpkin?.destroy()
  app?.destroy(true, { children: true })
  app = null
})
</script>
