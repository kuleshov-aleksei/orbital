<template>
  <div class="space-y-6">
    <!-- Socket layout editor -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-lg font-semibold text-white">Pumpkin socket studio</h2>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="loading"
          @click="reload">
          <span v-if="loading">Loading...</span>
          <span v-else>Refresh</span>
        </button>
      </div>
      <p class="text-sm text-gray-400 mb-4">
        Pick a base, drag each socket into place (or fine-tune with numbers), then save. Clients
        compose pumpkins from these anchors.
      </p>

      <div class="flex flex-wrap items-center gap-3 mb-4">
        <label class="text-xs font-medium text-gray-400">
          Base
          <select
            v-model="selectedBaseId"
            class="ml-1 bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5">
            <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }} ({{ b.id }})</option>
          </select>
        </label>
        <span v-if="!bases.length" class="text-xs text-amber-400">
          No live bases — create a base item below first.
        </span>
        <span v-if="dirty" class="text-xs text-amber-400">Unsaved changes</span>
        <span v-if="layoutMessage" class="text-xs text-emerald-400">{{ layoutMessage }}</span>
        <span v-if="layoutError" class="text-xs text-red-400">{{ layoutError }}</span>
      </div>

      <div v-if="baseItem" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Preview stage -->
        <div
          ref="stageEl"
          tabindex="0"
          class="relative mx-auto rounded-lg bg-gray-900 border border-gray-700 overflow-hidden select-none focus:outline-none focus:border-orange-500"
          :style="{ width: STAGE + 'px', height: STAGE + 'px' }"
          @keydown="onStageKey">
          <!-- base -->
          <img
            ref="baseImg"
            :src="resolveUrl(baseItem.asset_path || PUMPKIN_SOCKET_PLACEHOLDER.base)"
            alt="pumpkin base"
            draggable="false"
            class="absolute"
            :style="baseStyle"
            @load="onBaseLoad" />
          <!-- overlays -->
          <div
            v-for="socket in OVERLAY_SOCKETS"
            :key="socket"
            class="absolute"
            :class="
              activeSocket === socket
                ? 'outline outline-2 outline-orange-500 rounded'
                : 'pointer-events-none opacity-60'
            "
            :style="overlayStyle(socket)"
            @pointerdown="startDrag($event, socket)">
            <img
              v-if="previewArt(socket)"
              :src="previewArt(socket)"
              :alt="socket"
              draggable="false"
              class="block w-full h-full cursor-grab active:cursor-grabbing"
              @load="onOverlayLoad($event, socket)" />
            <div
              v-else
              class="cursor-grab active:cursor-grabbing border-2 border-dashed border-gray-500 rounded text-gray-400 text-xs flex items-center justify-center"
              :style="{ width: '64px', height: '64px' }">
              {{ socket }}
            </div>
          </div>
        </div>

        <!-- Numeric controls -->
        <div class="space-y-4">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="socket in OVERLAY_SOCKETS"
              :key="socket"
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors"
              :class="
                activeSocket === socket
                  ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                  : 'border-gray-700 text-gray-300 hover:border-orange-400'
              "
              @click="activeSocket = socket">
              {{ socket }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label class="text-xs font-medium text-gray-400">
              {{ activeSocket }} offset x (−1…1)
              <input
                v-model.number="offsets[activeSocket].offset_x"
                type="number"
                min="-1"
                max="1"
                step="0.01"
                class="mt-1 w-full bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5"
                @input="markDirty" />
              <input
                v-model.number="offsets[activeSocket].offset_x"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                class="mt-2 w-full"
                @input="markDirty" />
            </label>
            <label class="text-xs font-medium text-gray-400">
              {{ activeSocket }} offset y (−1…1)
              <input
                v-model.number="offsets[activeSocket].offset_y"
                type="number"
                min="-1"
                max="1"
                step="0.01"
                class="mt-1 w-full bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5"
                @input="markDirty" />
              <input
                v-model.number="offsets[activeSocket].offset_y"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                class="mt-2 w-full"
                @input="markDirty" />
            </label>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-400 mb-1">
              Preview art for {{ activeSocket }}
            </label>
            <select
              v-model="previewItemId[activeSocket]"
              class="w-full bg-gray-900 border border-gray-700 rounded text-sm text-white px-3 py-2">
              <option value="">Placeholder</option>
              <option v-for="item in liveItemsOf(activeSocket)" :key="item.id" :value="item.id">
                {{ item.name }} (z {{ item.z_index }})
              </option>
            </select>
          </div>

          <div v-if="activePreviewItem">
            <label class="block text-xs font-medium text-gray-400 mb-1">
              z-index for {{ activePreviewItem.name }} (negative draws behind the base)
            </label>
            <div class="flex gap-2">
              <input
                v-model.number="activePreviewItem.z_index"
                type="number"
                class="flex-1 bg-gray-900 border border-gray-700 rounded text-sm text-white px-3 py-2"
                @input="syncPreviewZ" />
            </div>
            <label class="block text-xs font-medium text-gray-400 mb-1 mt-3">
              scale for {{ activePreviewItem.name }} (accessory size, 1 = natural)
            </label>
            <div class="flex gap-2 items-center">
              <input
                v-model.number="activePreviewItem.scale"
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                class="flex-1 accent-indigo-500"
                @input="syncPreviewScale" />
              <input
                v-model.number="activePreviewItem.scale"
                type="number"
                min="0.25"
                max="2"
                step="0.05"
                class="w-20 bg-gray-900 border border-gray-700 rounded text-sm text-white px-3 py-2"
                @input="syncPreviewScale" />
              <button
                type="button"
                class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50"
                :disabled="savingItem === activePreviewItem.id"
                @click="saveItem(activePreviewItem)">
                <span v-if="savingItem === activePreviewItem.id">Saving...</span>
                <span v-else>Save item</span>
              </button>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              type="button"
              class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50"
              :disabled="saving || !selectedBaseId"
              @click="saveLayouts">
              <span v-if="saving">Saving...</span>
              <span v-else>Save anchors</span>
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
              @click="resetOffsets">
              Reset to center
            </button>
          </div>
          <p class="text-xs text-gray-500">
            Select a socket with the buttons above, then drag it on the preview — only the selected
            socket is grabbable. Click the preview once and use arrow keys to nudge (Shift for
            bigger steps). Offsets are fractions of the base size from its center. z-order is edited
            per item in the catalog below.
          </p>
        </div>
      </div>
    </div>

    <!-- Catalog CRUD -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h2 class="text-lg font-semibold text-white mb-1">Decoration catalog</h2>
      <p class="text-sm text-gray-400 mb-4">
        Bases, hats, eyes, smiles and feet. Deletes are soft — rows stay in the database but are
        hidden from clients.
      </p>

      <div v-if="catalogError" class="text-xs text-red-400 mb-3">{{ catalogError }}</div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-500 text-xs uppercase">
              <th class="pb-2 pr-3">Art</th>
              <th class="pb-2 pr-3">ID</th>
              <th class="pb-2 pr-3">Name</th>
              <th class="pb-2 pr-3">Socket</th>
              <th class="pb-2 pr-3">Rarity</th>
              <th class="pb-2 pr-3">z-index</th>
              <th class="pb-2 pr-3">Scale</th>
              <th class="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-700">
            <tr
              v-for="item in editedItems"
              :key="item.id"
              :class="item.is_deleted ? 'opacity-50' : ''">
              <td class="py-2 pr-3">
                <img
                  :src="resolveUrl(item.asset_path || PUMPKIN_SOCKET_PLACEHOLDER[item.socket])"
                  :alt="item.id"
                  class="w-10 h-10 object-contain bg-gray-900 rounded" />
              </td>
              <td class="py-2 pr-3 text-gray-400 font-mono text-xs">{{ item.id }}</td>
              <td class="py-2 pr-3">
                <input
                  v-model="item.name"
                  type="text"
                  :disabled="item.is_deleted"
                  class="w-32 bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1" />
              </td>
              <td class="py-2 pr-3">
                <select
                  v-model="item.socket"
                  :disabled="item.is_deleted"
                  class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1">
                  <option value="base">base</option>
                  <option value="hat">hat</option>
                  <option value="eyes">eyes</option>
                  <option value="mouth">mouth</option>
                  <option value="feet">feet</option>
                </select>
              </td>
              <td class="py-2 pr-3">
                <select
                  v-model="item.rarity"
                  :disabled="item.is_deleted"
                  class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1">
                  <option value="regular">regular</option>
                  <option value="common">common</option>
                  <option value="uncommon">uncommon</option>
                  <option value="rare">rare</option>
                </select>
              </td>
              <td class="py-2 pr-3">
                <input
                  v-model.number="item.z_index"
                  type="number"
                  :disabled="item.is_deleted"
                  title="Render layer: negative draws behind the base"
                  class="w-16 bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1" />
              </td>
              <td class="py-2 pr-3">
                <input
                  v-model.number="item.scale"
                  type="number"
                  min="0.25"
                  max="2"
                  step="0.05"
                  :disabled="item.is_deleted"
                  title="Accessory size multiplier (1 = natural size)"
                  class="w-16 bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1" />
              </td>
              <td class="py-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <button
                    v-if="!item.is_deleted"
                    type="button"
                    class="px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded"
                    :disabled="savingItem === item.id"
                    @click="saveItem(item)">
                    Save
                  </button>
                  <label
                    v-if="!item.is_deleted"
                    class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded cursor-pointer">
                    Upload PNG
                    <input
                      type="file"
                      accept="image/png"
                      class="hidden"
                      @change="uploadAsset(item, $event)" />
                  </label>
                  <button
                    v-if="!item.is_deleted"
                    type="button"
                    class="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                    @click="removeItem(item)">
                    Delete
                  </button>
                  <button
                    v-else
                    type="button"
                    class="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded"
                    @click="restoreItem(item)">
                    Restore
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Create form -->
      <div class="mt-4 border-t border-gray-700 pt-4">
        <h3 class="text-sm font-semibold text-white mb-3">Add new item</h3>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input
            v-model="newItem.id"
            type="text"
            placeholder="id (e.g. hat_witch)"
            class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5" />
          <input
            v-model="newItem.name"
            type="text"
            placeholder="Display name"
            class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5" />
          <select
            v-model="newItem.socket"
            class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5">
            <option value="base">base</option>
            <option value="hat">hat</option>
            <option value="eyes">eyes</option>
            <option value="mouth">mouth</option>
            <option value="feet">feet</option>
          </select>
          <select
            v-model="newItem.rarity"
            class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5">
            <option value="regular">regular</option>
            <option value="common">common</option>
            <option value="uncommon">uncommon</option>
            <option value="rare">rare</option>
          </select>
          <input
            v-model.number="newItem.z_index"
            type="number"
            placeholder="z-index"
            class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5" />
          <input
            v-model.number="newItem.scale"
            type="number"
            min="0.25"
            max="2"
            step="0.05"
            placeholder="scale (1)"
            title="Accessory size multiplier (1 = natural size)"
            class="bg-gray-900 border border-gray-700 rounded text-sm text-white px-2 py-1.5" />
        </div>
        <button
          type="button"
          class="mt-3 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50"
          :disabled="creating || !newItem.id || !newItem.name"
          @click="createItem">
          <span v-if="creating">Creating...</span>
          <span v-else>Add item (upload art afterwards)</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useTemplateRef, watch } from "vue"
import { apiService, resolveUrl } from "@/services/api"
import { useHalloweenStore } from "@/stores/halloween"
import { PUMPKIN_SOCKET_PLACEHOLDER, PUMPKIN_SOCKET_DEFAULT_Z } from "@/halloween/assets"
import type {
  HalloweenItem,
  HalloweenRarity,
  PumpkinOverlaySocket,
  PumpkinSocket,
} from "@/halloween/types"

const OVERLAY_SOCKETS: PumpkinOverlaySocket[] = ["hat", "eyes", "mouth", "feet"]
const STAGE = 300
const BASE_H = 200

const halloweenStore = useHalloweenStore()

const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const layoutMessage = ref("")
const layoutError = ref("")
const catalogError = ref("")
const savingItem = ref<string | null>(null)
const creating = ref(false)

const items = ref<HalloweenItem[]>([])
const editedItems = ref<HalloweenItem[]>([])
const selectedBaseId = ref("base_a")
const activeSocket = ref<PumpkinOverlaySocket>("hat")

const offsets = reactive<Record<PumpkinOverlaySocket, { offset_x: number; offset_y: number }>>({
  hat: { offset_x: 0, offset_y: -0.45 },
  eyes: { offset_x: 0, offset_y: -0.05 },
  mouth: { offset_x: 0, offset_y: 0.2 },
  feet: { offset_x: 0, offset_y: 0.48 },
})

// Preview art choice per socket (item id or "" for placeholder).
const previewItemId = reactive<Record<PumpkinOverlaySocket, string>>({
  hat: "",
  eyes: "",
  mouth: "",
  feet: "",
})

// Measured display geometry (px).
const baseDisplay = reactive({ w: 0, h: BASE_H })
// Zero means "not measured yet" — readers must not scale off it.
const baseNatural = reactive({ w: 0, h: 0 })
const overlayNatural = reactive<Record<string, { w: number; h: number }>>({})
// Frozen overlay display sizes, keyed by item + base art. Computed once both
// sides are measured, then never recomputed for that combination — moving an
// accessory must never resize it. Both the wrapper and the img get definite
// sizes: an auto-width absolutely-positioned wrapper shrink-wraps against the
// remaining stage space, so dragging right/down would otherwise shrink it
// (and the img's max-width:100% with it).
const overlaySize = reactive<Record<string, { w: number; h: number }>>({})
const measuredBaseArt = ref("")

const newItem = reactive({
  id: "",
  name: "",
  socket: "hat" as PumpkinSocket,
  rarity: "regular" as HalloweenRarity,
  z_index: 20,
  scale: 1,
})

const bases = computed(() => items.value.filter((i) => i.socket === "base" && !i.is_deleted))
const baseItem = computed(
  () => items.value.find((i) => i.id === selectedBaseId.value) ?? bases.value[0],
)

const liveItemsOf = (socket: PumpkinOverlaySocket): HalloweenItem[] =>
  items.value.filter((i) => i.socket === socket && !i.is_deleted)

const previewItemOf = (socket: PumpkinOverlaySocket): HalloweenItem | undefined => {
  const id = previewItemId[socket]
  return id ? items.value.find((i) => i.id === id) : undefined
}

// Live catalog row behind the active socket's preview art. Editing its
// z-index updates the stage immediately (the preview reads live rows).
const activePreviewItem = computed(() => previewItemOf(activeSocket.value))

// Keep the catalog table's edit copy in sync so a later table save can't
// clobber the z-index edited here.
const syncPreviewZ = () => {
  const live = activePreviewItem.value
  if (!live) return
  const row = editedItems.value.find((i) => i.id === live.id)
  if (row) row.z_index = Number(live.z_index) || 0
}

// Same for scale, plus the stage preview must re-freeze its size: the frozen
// entry is keyed by item + base art (scale isn't part of the key), so purge it
// and re-measure immediately for live feedback.
const syncPreviewScale = () => {
  const live = activePreviewItem.value
  if (!live) return
  const scale = Number(live.scale) || 1
  const row = editedItems.value.find((i) => i.id === live.id)
  if (row) row.scale = scale
  delete overlaySize[overlaySizeKey(activeSocket.value)]
  ensureOverlaySize(activeSocket.value)
}

const previewArt = (socket: PumpkinOverlaySocket): string => {
  const item = previewItemOf(socket)
  const path = item?.asset_path || PUMPKIN_SOCKET_PLACEHOLDER[socket]
  return resolveUrl(path)
}

const markDirty = () => {
  dirty.value = true
  layoutMessage.value = ""
}

const baseStyle = computed(() => ({
  left: `${STAGE / 2}px`,
  top: `${STAGE / 2}px`,
  height: `${BASE_H}px`,
  transform: "translate(-50%, -50%)",
  zIndex: 10,
}))

const overlaySizeKey = (socket: PumpkinOverlaySocket): string => {
  const item = previewItemOf(socket)
  const b = baseItem.value
  if (!item || !b) return ""
  return `${item.id}|${resolveUrl(b.asset_path || PUMPKIN_SOCKET_PLACEHOLDER.base)}`
}

const overlayWidth = (socket: PumpkinOverlaySocket): number => {
  // Frozen at measure time (see ensureOverlaySize): moves never resize.
  return overlaySize[overlaySizeKey(socket)]?.w ?? 64
}

const overlayHeight = (socket: PumpkinOverlaySocket): number => {
  return overlaySize[overlaySizeKey(socket)]?.h ?? 64
}

const overlayStyle = (socket: PumpkinOverlaySocket) => {
  const o = offsets[socket]
  const item = previewItemOf(socket)
  // CSS boxes can't be negative z-index above the stage background, so shift up.
  const z = (item?.z_index ?? PUMPKIN_SOCKET_DEFAULT_Z[socket]) + 10
  // Fall back to a square-base assumption when the base hasn't been measured
  // yet — x positioning must degrade, never freeze.
  const w = baseDisplay.w || BASE_H
  // Definite wrapper size: never shrink-to-fit, so position can't affect size.
  const ow = overlayWidth(socket)
  const oh = overlayHeight(socket)
  return {
    left: `${STAGE / 2 + o.offset_x * w}px`,
    top: `${STAGE / 2 + o.offset_y * baseDisplay.h}px`,
    width: `${ow}px`,
    height: `${oh}px`,
    transform: "translate(-50%, -50%)",
    zIndex: z,
    touchAction: "none",
  }
}

// Measure the base from the rendered <img> element. Unlike the load event,
// this also works when the image was already cached or its src didn't change
// (no load event fires then) — the natural size stays readable.
const baseImgEl = useTemplateRef<HTMLImageElement>("baseImg")

const ensureBaseMeasured = () => {
  const img = baseImgEl.value
  if (img && img.naturalWidth && img.naturalHeight) {
    baseNatural.w = img.naturalWidth
    baseNatural.h = img.naturalHeight
    baseDisplay.h = BASE_H
    baseDisplay.w = Math.round((img.naturalWidth * BASE_H) / img.naturalHeight)
    measuredBaseArt.value = resolveUrl(
      baseItem.value?.asset_path || PUMPKIN_SOCKET_PLACEHOLDER.base,
    )
    for (const s of OVERLAY_SOCKETS) ensureOverlaySize(s)
  }
}

const onBaseLoad = () => {
  ensureBaseMeasured()
}

const onOverlayLoad = (e: Event, socket: PumpkinOverlaySocket) => {
  // Read the size straight off the displayed image — no second fetch, so the
  // width is known the moment the art appears instead of jumping later.
  const img = e.target as HTMLImageElement
  const item = previewItemOf(socket)
  if (!item || !img.naturalWidth || !img.naturalHeight) return
  const prev = overlayNatural[item.id]
  if (!prev || prev.w !== img.naturalWidth || prev.h !== img.naturalHeight) {
    overlayNatural[item.id] = { w: img.naturalWidth, h: img.naturalHeight }
    // Same item, new art dimensions: drop frozen widths so they re-freeze.
    for (const k of Object.keys(overlaySize)) {
      if (k.startsWith(item.id + "|")) delete overlaySize[k]
    }
  }
  ensureOverlaySize(socket)
}

// --- drag handling (pointer events, px deltas → normalized offsets) ---
const dragState = ref<{ socket: PumpkinOverlaySocket; startX: number; startY: number } | null>(null)

// Freeze an accessory's display width once both its own art and the current
// base art are measured. Deferred while a drag is active, so a late-arriving
// measurement can never resize the accessory being moved.
const ensureOverlaySize = (socket: PumpkinOverlaySocket) => {
  if (dragState.value) return
  const key = overlaySizeKey(socket)
  if (!key || overlaySize[key]) return
  const item = previewItemOf(socket)
  const nat = item ? overlayNatural[item.id] : undefined
  const baseArt = resolveUrl(baseItem.value?.asset_path || PUMPKIN_SOCKET_PLACEHOLDER.base)
  if (!nat || !baseNatural.w || !baseNatural.h || measuredBaseArt.value !== baseArt) return
  const w = Math.round(((nat.w * BASE_H) / baseNatural.h) * (item?.scale || 1))
  overlaySize[key] = { w, h: Math.round((w * nat.h) / nat.w) }
}

const startDrag = (e: PointerEvent, socket: PumpkinOverlaySocket) => {
  // Pointer interaction never changes the selection: overlays overlap, so
  // clicks would mis-select. Selection happens only via the socket buttons.
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragState.value = { socket, startX: e.clientX, startY: e.clientY }
  const move = (ev: PointerEvent) => {
    const st = dragState.value
    if (!st || st.socket !== socket) return
    const o = offsets[socket]
    o.offset_x = clamp1(o.offset_x + (ev.clientX - st.startX) / (baseDisplay.w || BASE_H))
    if (baseDisplay.h > 0) {
      o.offset_y = clamp1(o.offset_y + (ev.clientY - st.startY) / baseDisplay.h)
    }
    st.startX = ev.clientX
    st.startY = ev.clientY
    markDirty()
  }
  const up = () => {
    dragState.value = null
    // A measurement deferred mid-drag settles now that the move is over.
    ensureOverlaySize(socket)
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
}

const clamp1 = (v: number): number => Math.min(1, Math.max(-1, Math.round(v * 100) / 100))

// Arrow-key nudging for the active socket. The stage must be focused (click
// it once); inputs keep their native arrow behavior.
const onStageKey = (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null
  if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return

  const step = e.shiftKey ? 0.1 : 0.01
  const o = offsets[activeSocket.value]
  switch (e.key) {
    case "ArrowLeft":
      o.offset_x = clamp1(o.offset_x - step)
      break
    case "ArrowRight":
      o.offset_x = clamp1(o.offset_x + step)
      break
    case "ArrowUp":
      o.offset_y = clamp1(o.offset_y - step)
      break
    case "ArrowDown":
      o.offset_y = clamp1(o.offset_y + step)
      break
    default:
      return
  }
  e.preventDefault()
  markDirty()
}

const resetOffsets = () => {
  for (const s of OVERLAY_SOCKETS) {
    offsets[s] = { offset_x: 0, offset_y: 0 }
  }
  markDirty()
}

// --- data loading ---
const reload = async () => {
  loading.value = true
  layoutError.value = ""
  catalogError.value = ""
  try {
    items.value = await apiService.getHalloweenAdminItems()
    editedItems.value = items.value.map((i) => ({ ...i }))
    if (!items.value.some((i) => i.id === selectedBaseId.value) && bases.value.length) {
      selectedBaseId.value = bases.value[0].id
    }
    // Default preview art: first live item per socket.
    for (const s of OVERLAY_SOCKETS) {
      if (!previewItemId[s]) {
        previewItemId[s] = liveItemsOf(s)[0]?.id ?? ""
      }
    }
    await loadLayouts()
    // The base <img> may have kept an identical src (no load event), so
    // re-measure from the DOM after render (this also freezes overlay sizes).
    await nextTick()
    ensureBaseMeasured()
    for (const s of OVERLAY_SOCKETS) ensureOverlaySize(s)
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "Failed to load catalog"
  } finally {
    loading.value = false
  }
}

const loadLayouts = async () => {
  if (!selectedBaseId.value) return
  try {
    const rows = await apiService.getHalloweenBaseLayouts(selectedBaseId.value)
    for (const s of OVERLAY_SOCKETS) {
      const found = rows.find((r) => r.socket === s)
      offsets[s] = found
        ? { offset_x: found.offset_x, offset_y: found.offset_y }
        : { offset_x: 0, offset_y: 0 }
    }
    dirty.value = false
  } catch (error) {
    layoutError.value = error instanceof Error ? error.message : "Failed to load anchors"
  }
}

watch(selectedBaseId, () => {
  layoutMessage.value = ""
  layoutError.value = ""
  void loadLayouts()
})

watch(baseItem, (b, prev) => {
  // Catalog reloads replace every row object, so this watcher fires on each
  // save/upload — but the base art usually didn't change and its <img> won't
  // reload (no load event for an identical src). Resetting the measurement
  // unconditionally would freeze x positioning (it scales by baseDisplay.w),
  // so only reset when the art itself changed.
  const artOf = (it: HalloweenItem | undefined) =>
    it ? resolveUrl(it.asset_path || PUMPKIN_SOCKET_PLACEHOLDER.base) : ""
  if (b && artOf(b) === artOf(prev)) {
    ensureBaseMeasured()
    return
  }
  // Reset measured geometry so the new base art re-measures on load.
  baseDisplay.w = 0
  baseDisplay.h = BASE_H
  void nextTick(() => ensureBaseMeasured())
  if (b && !items.value.some((i) => i.id === selectedBaseId.value)) {
    selectedBaseId.value = b.id
  }
})

const saveLayouts = async () => {
  if (!selectedBaseId.value) return
  saving.value = true
  layoutError.value = ""
  layoutMessage.value = ""
  try {
    await apiService.saveHalloweenBaseLayouts({
      base_id: selectedBaseId.value,
      sockets: OVERLAY_SOCKETS.map((s) => ({
        base_id: selectedBaseId.value,
        socket: s,
        offset_x: clamp1(offsets[s].offset_x),
        offset_y: clamp1(offsets[s].offset_y),
      })),
    })
    dirty.value = false
    layoutMessage.value = "Anchors saved"
    // Refresh live clients' composition data.
    await halloweenStore.fetchState()
  } catch (error) {
    layoutError.value = error instanceof Error ? error.message : "Failed to save anchors"
  } finally {
    saving.value = false
  }
}

// --- catalog CRUD ---
const refreshAfterCatalogChange = async () => {
  await reload()
  await halloweenStore.fetchState()
}

const saveItem = async (item: HalloweenItem) => {
  savingItem.value = item.id
  catalogError.value = ""
  try {
    await apiService.updateHalloweenItem(item.id, {
      name: item.name,
      socket: item.socket,
      rarity: item.rarity,
      z_index: Number(item.z_index) || 0,
      scale: Number(item.scale) || 1,
    })
    await refreshAfterCatalogChange()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "Failed to save item"
  } finally {
    savingItem.value = null
  }
}

const removeItem = async (item: HalloweenItem) => {
  catalogError.value = ""
  try {
    await apiService.deleteHalloweenItem(item.id)
    await refreshAfterCatalogChange()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "Failed to delete item"
  }
}

const restoreItem = async (item: HalloweenItem) => {
  catalogError.value = ""
  try {
    await apiService.restoreHalloweenItem(item.id)
    await refreshAfterCatalogChange()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "Failed to restore item"
  }
}

const uploadAsset = async (item: HalloweenItem, e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  catalogError.value = ""
  try {
    await apiService.uploadHalloweenItemAsset(item.id, file)
    await refreshAfterCatalogChange()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "Failed to upload art"
  }
}

const createItem = async () => {
  creating.value = true
  catalogError.value = ""
  try {
    await apiService.createHalloweenItem({
      id: newItem.id.trim(),
      name: newItem.name.trim(),
      socket: newItem.socket,
      rarity: newItem.rarity,
      z_index: Number(newItem.z_index) || 0,
      scale: Number(newItem.scale) || 1,
    })
    newItem.id = ""
    newItem.name = ""
    await refreshAfterCatalogChange()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "Failed to create item"
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  void reload()
})
</script>
