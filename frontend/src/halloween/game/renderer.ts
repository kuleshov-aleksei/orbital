import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  type Texture,
} from "pixi.js"
import type { GameEvent, HalloweenGameEngine } from "./engine"
import type { HalloweenAssets } from "./assets"
import {
  HALLOWEEN_BACKGROUND_URL,
  ITEM_ART,
  PROJECTILE_ART,
  SHIELD_SPARK_URL,
  SHIELD_URL,
} from "./assets"
import type { LoadedAtlas } from "./atlas"
import { FIELD_HEIGHT, FIELD_LAYOUT, columnForX, columnX, laneCenterY, laneForY } from "./engine"
import type { ProjectileKind, PumpkinType, SlugType } from "./types"

const PUMPKIN_TINTS: Record<PumpkinType, number> = {
  ferdinand: 0xf97316,
  chunky: 0xb45309,
  herbert: 0x4ade80,
  gwynevere: 0x8b5cf6,
  cramer: 0xfbbf24,
  pearcer: 0xdc2626,
}

const SLUG_TINTS: Record<SlugType, number> = {
  scout: 0x84cc16,
  marvin: 0x65a30d,
  gerald: 0x3f6212,
  dell: 0xb45309,
}

interface PumpkinDisplay {
  container: Container
  sprite: Sprite | Graphics
  bar: Graphics
  pips: Graphics
  // Animated pumpkins (atlas-backed) carry their sheet + current state so
  // engine events can drive idle/fire/hurt without diffing state.
  animated?: boolean
  anim?: AnimatedSprite
  atlas?: LoadedAtlas
  action?: string
  // Death lifecycle: once the death one-shot finishes we fade the whole wreck
  // and hide it, then release the pumpkin back to the engine.
  fadeStart?: number
  hidden?: boolean
}

interface SlugDisplay {
  container: Container
  sprite: Sprite | Graphics
  bar: Graphics
  // Shield bubble + charge sparks (hw26 effects art), drawn over the slug.
  // Rebuilt only when the charge count or visual size changes — see sync().
  shield: Container
  shieldCount?: number
  shieldDiameter?: number
  // Animated slugs (atlas-backed) mirror the pumpkin state machine, except
  // the locomotion loop is per-type: crawlers loop `crawl`, Dell loops `idle`
  // (he doesn't move — `motion` is ignored). One-shots return to `base`.
  kind: SlugType
  animated?: boolean
  anim?: AnimatedSprite
  atlas?: LoadedAtlas
  action?: string
  base?: string
  // Throttle for the hurt one-shot (see HURT_GAP_MS): hits landing inside
  // this window are swallowed so rapid damage can't chain hurt back-to-back.
  hurtUntil?: number
}

interface ProjDisplay {
  container: Container
  body: Graphics | Sprite
  kind: ProjectileKind
  // Last seen position — rotation is derived from frame-to-frame displacement
  // (not vx/vy: arc projectiles keep vy at 0 while visibly climbing/diving).
  lx: number | null
  ly: number | null
}

// Item art is 256x256 — these are the on-field draw heights (field units).
// Projectiles read as bullets, not icons: small and fast.
const PROJECTILE_SPRITE_HEIGHT: Record<ProjectileKind, number> = {
  seed: 20,
  heal: 20,
  missile: 30,
}
const GRENADE_SPRITE_SIZE = 40
const BEER_CUP_SPRITE_SIZE = 44
// Shield bubble diameter = (visualR + SHIELD_PAD) * 2; sparks sit on the rim.
// Renderer caps spark sprites at 6 — game logic never exceeds it either.
const SHIELD_PAD = 5
const SHIELD_SPARK_SIZE = 18
const SHIELD_SPARK_RIM_GAP = 8
const MAX_RENDERED_SHIELDS = 6

export interface MiniGameRenderer {
  init(container: HTMLElement): Promise<void>
  destroy(): void
  sync(): void
  onGameEvent(event: GameEvent): void
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null
  worldToScreen(x: number, y: number): { x: number; y: number }
  toggleGrid(): void
}

// Animated pumpkin frames are 128px with ~101px of opaque content, so we scale
// the frame past radius*2 to make the pumpkin itself read at the right size.
const ANIM_FPS = 30
const PUMPKIN_ANIM_FIT = 128 / 101
// How long a finished corpse lingers while it fades out before removal.
const DEATH_FADE_MS = 350
// Slug frames are authored at a proper 128x128 — drawn 1:1 at a uniform size
// for every type, no per-type radius scaling.
const SLUG_SPRITE_SIZE = 86
// Placement-grid overlay opacity over the background art.
const GRID_OVERLAY_ALPHA = 1.0
// Minimum breathing room after a finished hurt one-shot before hurt may
// trigger again. Hits landing mid-hurt or inside this gap are swallowed —
// without it, rapid damage (thorn ticks every frame, focused fire) chains
// hurt back-to-back and the locomotion loop never reads.
const HURT_GAP_MS = 600

export function createMiniGameRenderer(
  engine: HalloweenGameEngine,
  assets?: HalloweenAssets,
): MiniGameRenderer {
  let app: Application | null = null
  let world: Container | null = null
  let containerEl: HTMLElement | null = null
  let background: Graphics | null = null
  let gridOverlay: Graphics | null = null
  let bgSprite: Sprite | null = null
  // Placement grid starts visible; hotkey O toggles it.
  let showGrid = true
  let cursorLayer: Container | null = null
  let effectLayer: Container | null = null

  const pumpkinAtlasFor = (type: PumpkinType): LoadedAtlas | undefined =>
    assets?.get(`pumpkin:${type}`)

  const slugAtlasFor = (type: SlugType): LoadedAtlas | undefined => assets?.get(`slug:${type}`)

  // Locomotion loop per slug type. Crawlers loop `crawl`; Dell doesn't move
  // so he loops `idle` (`motion` is ignored). Missing states simply yield no
  // animation — e.g. Dell's death/hurt arrive in a later asset drop.
  const baseLoopFor = (type: SlugType, atlas: LoadedAtlas): string | undefined => {
    if (type === "dell") {
      if (atlas.animations.idle?.length) return "idle"
      if (atlas.animations.crawl?.length) return "crawl"
      return undefined
    }
    if (atlas.animations.crawl?.length) return "crawl"
    if (atlas.animations.idle?.length) return "idle"
    return undefined
  }

  const pumpkins = new Map<number, PumpkinDisplay>()
  const slugs = new Map<number, SlugDisplay>()
  const projectiles = new Map<number, ProjDisplay>()

  let scale = 1
  let offsetX = 0
  let offsetY = 0
  let mouseWorld: { x: number; y: number } | null = null
  let pumpkinTexture: Texture | null = null
  let slugTexture: Texture | null = null

  const width = () => engine.getWidth()

  const recomputeTransform = () => {
    if (!app || !containerEl) return
    const w = app.screen.width
    const h = app.screen.height
    scale = Math.min(w / width(), h / FIELD_HEIGHT)
    offsetX = (w - width() * scale) / 2
    offsetY = (h - FIELD_HEIGHT * scale) / 2
    if (world) {
      world.scale.set(scale)
      world.position.set(offsetX, offsetY)
    }
  }

  const drawBackground = () => {
    if (!background) return
    // Opaque base fill: backdrop behind the art (also covers the letterbox
    // bars when the art is shorter than the field).
    background.clear()
    background.rect(0, 0, width(), FIELD_HEIGHT)
    background.fill({ color: 0x1a1f16 })
    drawGrid()
  }

  const drawGrid = () => {
    if (!gridOverlay) return
    gridOverlay.clear()
    if (!showGrid) return
    // Only the placable grid positions are drawn: the placement cells.
    // On round 1 only the 3 center lanes are active — locked lanes render dim.
    // Grid geometry comes from FIELD_LAYOUT so it stays in sync with the art.
    const {
      gridX0,
      colSpacing,
      colGap,
      placementCols,
      laneCount,
      laneYOffset,
      laneHeight,
      rowGap,
    } = FIELD_LAYOUT
    // Columns and rows both stack as cell, gap, cell… — pitches include
    // their dead-strip gaps.
    const colPitch = colSpacing + colGap
    const rowPitch = laneHeight + rowGap
    const gridW = placementCols * colSpacing + (placementCols - 1) * colGap
    const gridH = laneCount * laneHeight + (laneCount - 1) * rowGap
    // Cells are centered on pumpkin positions: columnX(col) = gridX0 + col *
    // colPitch is the cell center, so the left edge is half a cell back.
    const blockX0 = gridX0 - colSpacing / 2
    const active = new Set(engine.activeLanes())
    for (let lane = 0; lane < laneCount; lane++) {
      const open = active.has(lane)
      for (let col = 0; col < placementCols; col++) {
        const x = blockX0 + col * colPitch
        const y = laneYOffset + lane * rowPitch
        gridOverlay.rect(x, y, colSpacing, laneHeight)
        gridOverlay.fill({ color: 0x22301c, alpha: open ? 0.35 : 0.07 })
        gridOverlay.rect(x, y, colSpacing, laneHeight)
        gridOverlay.stroke({ width: 1, color: 0x3b4a2f, alpha: open ? 0.7 : 0.2 })
      }
    }
    gridOverlay.rect(blockX0, laneYOffset, gridW, gridH)
    gridOverlay.stroke({ width: 1, color: 0x3b4a2f, alpha: 0.9 })
  }

  const toggleGrid = () => {
    showGrid = !showGrid
    if (gridOverlay) gridOverlay.visible = showGrid
    drawGrid()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "o" && e.key !== "O") return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    )
      return
    toggleGrid()
  }

  const makeHealthBar = (container: Container, w: number, y: number): Graphics => {
    const bar = new Graphics()
    bar.position.set(-w / 2, y)
    container.addChild(bar)
    return bar
  }

  const updateBar = (bar: Graphics, w: number, health: number, maxHealth: number) => {
    const ratio = Math.max(0, Math.min(1, health / maxHealth))
    bar.clear()
    bar.rect(0, 0, w, 4)
    bar.fill({ color: 0x111111, alpha: 0.7 })
    const color = ratio > 0.5 ? 0x4ade80 : ratio > 0.25 ? 0xfacc15 : 0xf87171
    bar.rect(0, 0, w * ratio, 4)
    bar.fill({ color })
  }

  // Level pips: one dot per pumkin level under the body. L1 is a single dim
  // dot; L2+ glow emerald so leveled pumpkins read at a glance.
  const updatePips = (pips: Graphics, radius: number, level: number) => {
    pips.clear()
    const n = Math.max(1, Math.min(3, level))
    const color = n > 1 ? 0x34d399 : 0x4b5563
    const spacing = 9
    const y = radius + 8
    for (let i = 0; i < n; i++) {
      pips.circle((i - (n - 1) / 2) * spacing, y, 2.5)
      pips.fill({ color, alpha: n > 1 ? 0.95 : 0.6 })
    }
  }

  const spriteFor = (texture: Texture, height: number): Sprite => {
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    sprite.height = height
    sprite.scale.x = sprite.scale.y
    return sprite
  }

  // Sprite from a preloaded item/projectile URL. The preloader warms Pixi's
  // global cache, so Assets.get hits synchronously — null when the load
  // failed and the caller must fall back to vector graphics.
  const itemSpriteFor = (url: string, height: number): Sprite | null => {
    try {
      const texture = Assets.get<Texture>(url)
      if (!texture) return null
      return spriteFor(texture, height)
    } catch {
      return null
    }
  }

  // Vertical ground strip (salt lines, thorn patches) tiled from the item
  // art. Square tiles keep the 256px source undistorted; a thin vector edge
  // underneath preserves the gameplay read.
  const stripSpriteFor = (url: string, width: number, alpha: number): TilingSprite | null => {
    try {
      const texture = Assets.get<Texture>(url)
      if (!texture) return null
      const tile = new TilingSprite({ texture, width, height: FIELD_HEIGHT })
      tile.position.set(-width / 2, 0)
      tile.tileScale.set(width / 256)
      tile.alpha = alpha
      return tile
    } catch {
      return null
    }
  }

  // Drives an animated pumpkin's state machine. `idle` loops; fire/hurt are
  // one-shots that return to idle, death is terminal (it holds its last frame).
  const playPumpkinState = (display: PumpkinDisplay, state: string) => {
    const anim = display.anim
    const atlas = display.atlas
    if (!anim || !atlas) return
    // Death is terminal — nothing overrides a dying pumpkin.
    if (display.action === "death") return
    const frames = atlas.animations[state]
    if (!frames || frames.length === 0) return
    if (display.action === state && anim.playing) return
    display.action = state
    anim.textures = frames
    anim.loop = state === "idle"
    anim.animationSpeed = ANIM_FPS / 60
    anim.gotoAndPlay(0)
  }

  // Slug counterpart of playPumpkinState. One-shots (attack/hurt/create)
  // return to the type's locomotion loop (`base`); death never plays on the
  // entity — kills spawn a detached effect via spawnSlugDeath instead.
  const playSlugState = (display: SlugDisplay, state: string) => {
    const anim = display.anim
    const atlas = display.atlas
    if (!anim || !atlas) return
    const frames = atlas.animations[state]
    if (!frames || frames.length === 0) return
    if (display.action === state && anim.playing) return
    // One-shots (attack/hurt/create) never interrupt each other — a running
    // one-shot always plays to completion. Only the return to the base loop
    // (driven by onComplete) may replace a finished one-shot.
    if (state !== display.base && display.action !== display.base && anim.playing) return
    display.action = state
    anim.textures = frames
    anim.loop = state === display.base
    anim.animationSpeed = ANIM_FPS / 60
    anim.gotoAndPlay(0)
  }

  // Detached death one-shot at the kill position. The engine removes slugs
  // immediately on death (unlike pumpkins, which linger as corpses), so the
  // effect lives on `world` directly — NOT effectLayer, which sync() clears
  // every frame — and destroys itself when finished.
  const spawnSlugDeath = (type: SlugType, x: number, y: number) => {
    const atlas = slugAtlasFor(type)
    const frames = atlas?.animations.death
    if (!world || !frames || frames.length === 0) return
    const anim = new AnimatedSprite(frames)
    anim.anchor.set(0.5)
    anim.position.set(x, y)
    anim.height = SLUG_SPRITE_SIZE
    anim.scale.x = anim.scale.y
    anim.animationSpeed = ANIM_FPS / 60
    anim.loop = false
    anim.onComplete = () => {
      world?.removeChild(anim)
      anim.destroy()
    }
    world.addChild(anim)
    anim.play()
  }

  const addPumpkin = (id: number, type: PumpkinType, radius: number) => {
    const container = new Container()
    const atlas = pumpkinAtlasFor(type)
    let body: Sprite | Graphics
    let animated = false
    let anim: AnimatedSprite | undefined
    if (atlas && atlas.animations.idle?.length) {
      // Real art: never tinted — the sprite carries its own colors.
      animated = true
      anim = new AnimatedSprite(atlas.animations.idle)
      anim.anchor.set(0.5)
      anim.height = radius * 2 * PUMPKIN_ANIM_FIT
      anim.scale.x = anim.scale.y
      anim.animationSpeed = ANIM_FPS / 60
      anim.loop = true
      anim.play()
      body = anim
    } else if (pumpkinTexture) {
      body = spriteFor(pumpkinTexture, radius * 2)
      body.tint = PUMPKIN_TINTS[type]
    } else {
      // Placeholder fallback for types that have no atlas yet — tinted.
      body = new Graphics().circle(0, 0, radius).fill({ color: PUMPKIN_TINTS[type] })
    }
    container.addChild(body)
    const bar = makeHealthBar(container, radius * 2, -radius - 12)
    const pips = new Graphics()
    container.addChild(pips)
    world?.addChild(container)
    const display: PumpkinDisplay = {
      container,
      sprite: body,
      bar,
      pips,
      animated,
      anim,
      atlas,
      action: animated ? "idle" : undefined,
    }
    if (anim)
      anim.onComplete = () => {
        // A finished death one-shot holds its last frame and hands off to the
        // fade-out; every other state returns the pumpkin to idle.
        if (display.action === "death") {
          display.fadeStart = performance.now()
        } else {
          playPumpkinState(display, "idle")
        }
      }
    pumpkins.set(id, display)
  }

  const addSlug = (id: number, type: SlugType, radius: number) => {
    const container = new Container()
    const atlas = slugAtlasFor(type)
    const base = atlas ? baseLoopFor(type, atlas) : undefined
    let body: Sprite | Graphics
    let animated = false
    let anim: AnimatedSprite | undefined
    let opener: string | undefined
    if (atlas && base && atlas.animations[base]?.length) {
      // Real art: never tinted — the sprite carries its own colors.
      // Dell materializes with a `create` one-shot before settling into idle;
      // crawlers start in their loop from birth. (The slug_spawned event fires
      // before sync() creates the display, so the opener lives here.)
      opener = type === "dell" && atlas.animations.create?.length ? "create" : base
      animated = true
      anim = new AnimatedSprite(atlas.animations[opener])
      anim.anchor.set(0.5)
      anim.height = SLUG_SPRITE_SIZE
      anim.scale.x = anim.scale.y
      anim.animationSpeed = ANIM_FPS / 60
      anim.loop = opener === base
      anim.play()
      body = anim
    } else if (slugTexture) {
      body = spriteFor(slugTexture, radius * 2)
      body.tint = SLUG_TINTS[type]
    } else {
      // Placeholder fallback for types that have no atlas yet — tinted.
      body = new Graphics().circle(0, 0, radius).fill({ color: SLUG_TINTS[type] })
    }
    container.addChild(body)
    // HUD tracks the visual body: uniform sprite size for animated slugs,
    // engine radius for the placeholder fallback.
    const hudW = animated ? SLUG_SPRITE_SIZE : radius * 2
    const hudY = animated ? -SLUG_SPRITE_SIZE / 2 - 12 : -radius - 10
    const bar = makeHealthBar(container, hudW, hudY)
    // Shield art draws over the slug body (translucent bubble + rim sparks).
    const shield = new Container()
    container.addChild(shield)
    world?.addChild(container)
    const display: SlugDisplay = {
      container,
      sprite: body,
      bar,
      shield,
      kind: type,
      animated,
      anim,
      atlas,
      action: animated ? (opener ?? base) : undefined,
      base,
    }
    if (anim)
      anim.onComplete = () => {
        // Every one-shot returns to the locomotion loop. A finished hurt
        // opens a short gap before hurt may trigger again (see HURT_GAP_MS).
        if (display.action !== display.base) {
          const wasHurt = display.action === "hurt"
          playSlugState(display, display.base ?? "")
          if (wasHurt) display.hurtUntil = performance.now() + HURT_GAP_MS
        }
      }
    slugs.set(id, display)
  }

  const addProjectile = (id: number, kind: string) => {
    const container = new Container()
    const artKind = (kind === "heal" || kind === "missile" ? kind : "seed") as ProjectileKind
    const sprite = itemSpriteFor(PROJECTILE_ART[artKind], PROJECTILE_SPRITE_HEIGHT[artKind] ?? 20)
    let body: Graphics | Sprite
    if (sprite) {
      body = sprite
    } else {
      // Placeholder fallback — tinted dot when the art failed to preload.
      body = new Graphics()
      const color = kind === "heal" ? 0xbbf7d0 : kind === "missile" ? 0xc4b5fd : 0xfde68a
      body.circle(0, 0, kind === "missile" ? 6 : 4)
      body.fill({ color })
    }
    container.addChild(body)
    world?.addChild(container)
    projectiles.set(id, { container, body, kind: artKind, lx: null, ly: null })
  }

  const init = async (container: HTMLElement) => {
    containerEl = container
    app = new Application()
    await app.init({
      resizeTo: container,
      background: 0x0d0f0a,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    container.appendChild(app.canvas as HTMLCanvasElement)

    try {
      pumpkinTexture = await Assets.load<Texture>("/assets/hw26/pumkins/pumkin_A.png")
    } catch {
      pumpkinTexture = null
    }
    try {
      slugTexture = await Assets.load<Texture>("/assets/hw26/slugs/slug_A.png")
    } catch {
      slugTexture = null
    }

    world = new Container()
    app.stage.addChild(world)

    background = new Graphics()
    world.addChild(background)

    // Battlefield backdrop above the opaque base fill, below the grid.
    // Fit-width, centered vertically. Optional art — a failed load keeps
    // the flat fill so the game stays playable.
    try {
      const bgTexture = await Assets.load<Texture>(HALLOWEEN_BACKGROUND_URL)
      bgSprite = new Sprite(bgTexture)
      const fit = width() / bgTexture.width
      bgSprite.scale.set(fit)
      bgSprite.position.set(0, (FIELD_HEIGHT - bgTexture.height * fit) / 2)
      world.addChild(bgSprite)
    } catch {
      bgSprite = null
    }

    gridOverlay = new Graphics()
    gridOverlay.alpha = GRID_OVERLAY_ALPHA
    gridOverlay.visible = showGrid
    world.addChild(gridOverlay)
    drawBackground()

    effectLayer = new Container()
    world.addChild(effectLayer)

    cursorLayer = new Container()
    world.addChild(cursorLayer)

    recomputeTransform()

    app.canvas.addEventListener("pointermove", (e: PointerEvent) => {
      // Hover detection is handled by the field wrapper (MiniGame.vue) so the
      // tooltip can keep a hover frozen while the pointer is over it.
      mouseWorld = eventToWorld(e)
      renderCursor()
    })

    app.canvas.addEventListener("pointerleave", () => {
      // Note: hover is NOT cleared here — the pointer may simply have moved
      // onto the hover tooltip that sits above the canvas. The field wrapper
      // clears hover on pointerleave (see MiniGame.vue).
      mouseWorld = null
      renderCursor()
    })

    app.canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      const w = eventToWorld(e)
      if (w) engine.onWorldClick(w.x, w.y)
    })

    window.addEventListener("resize", recomputeTransform)
    window.addEventListener("keydown", onKeyDown)
  }

  const eventToWorld = (e: { clientX: number; clientY: number }) => {
    if (!containerEl) return null
    const rect = containerEl.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    return {
      x: (cx - offsetX) / scale,
      y: (cy - offsetY) / scale,
    }
  }

  const worldToScreen = (x: number, y: number) => ({
    x: offsetX + x * scale,
    y: offsetY + y * scale,
  })

  const screenToWorld = (clientX: number, clientY: number) => eventToWorld({ clientX, clientY })

  const renderCursor = () => {
    if (!cursorLayer) return
    cursorLayer.removeChildren()
    if (!mouseWorld) return
    const { x, y } = mouseWorld
    const g = new Graphics()

    if (engine.mode === "place-pumpkin") {
      const col = columnForX(x)
      const lane = laneForY(y)
      const cx = columnX(col)
      const cy = laneCenterY(lane)
      const tint = engine.activeLanes().includes(lane) ? 0xffffff : 0xef4444
      const cellY =
        FIELD_LAYOUT.laneYOffset + lane * (FIELD_LAYOUT.laneHeight + FIELD_LAYOUT.rowGap)
      g.rect(
        cx - FIELD_LAYOUT.colSpacing / 2,
        cellY,
        FIELD_LAYOUT.colSpacing,
        FIELD_LAYOUT.laneHeight,
      )
      g.fill({ color: 0xffffff, alpha: 0.12 })
      g.rect(
        cx - FIELD_LAYOUT.colSpacing / 2,
        cellY,
        FIELD_LAYOUT.colSpacing,
        FIELD_LAYOUT.laneHeight,
      )
      g.stroke({ width: 2, color: tint, alpha: 0.5 })
      g.circle(cx, cy, 28)
      g.stroke({ width: 2, color: tint, alpha: 0.6 })
    } else if (engine.mode === "ability-point" && engine.pendingAbilityId) {
      g.circle(x, y, 6)
      g.fill({ color: 0xfff3c4 })
      const radius = engine.pendingAbilityId === "holy_grenade" ? 300 : 70
      g.circle(x, y, radius)
      g.stroke({ width: 2, color: 0xfff3c4, alpha: 0.6 })
    }
    cursorLayer.addChild(g)
  }

  const sync = () => {
    if (!world || !app) return
    recomputeTransform()
    drawBackground()

    // effects (grenades, beer cups, salt lines)
    effectLayer?.removeChildren()
    for (const g of engine.grenades) {
      const fx = new Graphics()
      const pulse = 0.6 + 0.4 * Math.sin(g.fuse * 4)
      fx.circle(g.x, g.y, g.blastRadius)
      fx.fill({ color: 0xfca5a5, alpha: 0.12 * pulse })
      effectLayer?.addChild(fx)
      const bomb = itemSpriteFor(ITEM_ART.holy_grenade, GRENADE_SPRITE_SIZE)
      if (bomb) {
        bomb.position.set(g.x, g.y)
        effectLayer?.addChild(bomb)
      } else {
        const dot = new Graphics()
        dot.circle(g.x, g.y, 9)
        dot.fill({ color: 0xef4444 })
        effectLayer?.addChild(dot)
      }
    }
    for (const cup of engine.beerCups) {
      const fx = new Graphics()
      fx.circle(cup.x, cup.y, cup.radius)
      fx.fill({ color: 0xfbbf24, alpha: 0.12 })
      effectLayer?.addChild(fx)
      const mug = itemSpriteFor(ITEM_ART.beer, BEER_CUP_SPRITE_SIZE)
      if (mug) {
        mug.position.set(cup.x, cup.y)
        effectLayer?.addChild(mug)
      } else {
        const dot = new Graphics()
        dot.circle(cup.x, cup.y, 10)
        dot.fill({ color: 0xf59e0b })
        effectLayer?.addChild(dot)
      }
    }
    for (const line of engine.saltLines) {
      const fx = new Graphics()
      fx.rect(line.x - line.width / 2, 0, line.width, FIELD_HEIGHT)
      fx.fill({ color: 0xe2e8f0, alpha: 0.18 })
      effectLayer?.addChild(fx)
      const strip = stripSpriteFor(ITEM_ART.salt_line, line.width, 0.85)
      if (strip) {
        const holder = new Container()
        holder.position.set(line.x, 0)
        holder.addChild(strip)
        effectLayer?.addChild(holder)
      }
    }
    for (const patch of engine.thornPatches) {
      const fx = new Graphics()
      fx.rect(patch.x - patch.width / 2, 0, patch.width, FIELD_HEIGHT)
      fx.fill({ color: 0x4d7c0f, alpha: 0.18 })
      effectLayer?.addChild(fx)
      const strip = stripSpriteFor(ITEM_ART.thorn_patch, patch.width, 0.9)
      if (strip) {
        const holder = new Container()
        holder.position.set(patch.x, 0)
        holder.addChild(strip)
        effectLayer?.addChild(holder)
      }
    }

    // pumpkins
    const toRelease: number[] = []
    const alivePumpkins = new Set(engine.pumpkins.map((p) => p.id))
    for (const [id, display] of pumpkins) {
      if (!alivePumpkins.has(id)) {
        world.removeChild(display.container)
        display.container.destroy({ children: true })
        pumpkins.delete(id)
      }
    }
    for (const p of engine.pumpkins) {
      let display = pumpkins.get(p.id)
      if (!display) {
        addPumpkin(p.id, p.type, p.radius)
        display = pumpkins.get(p.id)!
      }
      if (display.hidden) continue
      display.container.position.set(p.x, p.y)
      updateBar(display.bar, p.radius * 2, p.health, p.maxHealth)
      updatePips(display.pips, p.radius, p.level)

      if (p.health <= 0) {
        // Animated types play their death one-shot first; everything else
        // fades immediately. Once faded, the corpse is released to the engine.
        if (display.animated) playPumpkinState(display, "death")
        const stillDying = display.action === "death" && display.fadeStart == null
        if (!stillDying) {
          if (display.fadeStart == null) display.fadeStart = performance.now()
          const t = (performance.now() - display.fadeStart) / DEATH_FADE_MS
          display.container.alpha = Math.max(0, 1 - t)
          if (t >= 1) {
            display.container.visible = false
            display.hidden = true
            toRelease.push(p.id)
          }
        }
      } else {
        // Real art is never tinted — only the placeholder fallback keeps a tint.
        display.sprite.alpha = 1
        if (!display.animated) display.sprite.tint = PUMPKIN_TINTS[p.type]
      }
    }
    // Release corpses only after iterating: removePumpkin mutates the array.
    for (const id of toRelease) engine.removePumpkin(id)

    // slugs
    const aliveSlugs = new Set(engine.slugs.map((s) => s.id))
    for (const [id, display] of slugs) {
      if (!aliveSlugs.has(id)) {
        world.removeChild(display.container)
        display.container.destroy({ children: true })
        slugs.delete(id)
      }
    }
    for (const s of engine.slugs) {
      let display = slugs.get(s.id)
      if (!display) {
        addSlug(s.id, s.type, s.radius)
        display = slugs.get(s.id)!
      } else if (display.kind !== s.type) {
        // A retired Dell converts to Gerald in place (same id, new type and
        // radius) — rebuild the display so the new type's atlas takes over.
        world.removeChild(display.container)
        display.container.destroy({ children: true })
        slugs.delete(s.id)
        addSlug(s.id, s.type, s.radius)
        display = slugs.get(s.id)!
      }
      display.container.position.set(s.x, s.y)
      // Slug art faces left; direction is -1 (crawling left) or +1 (reversed).
      display.container.scale.x = -s.direction
      // Animated slugs render at the uniform sprite size; the placeholder
      // fallback renders at engine radius — HUD follows whichever applies.
      const visualR = display.animated ? SLUG_SPRITE_SIZE / 2 : s.radius
      updateBar(display.bar, visualR * 2, s.health, s.maxHealth)
      // Real art is never tinted — only the placeholder fallback keeps a tint.
      if (!display.animated) display.sprite.tint = SLUG_TINTS[s.type]
      // Shield bubble (translucent art over the slug) plus one spark sprite
      // per remaining charge, placed on the rim like the old tick marks.
      // No shields, no art. Rebuilt only when count/size changes — the
      // textures are shared so rebuilds stay cheap.
      const wantShields = s.shields > 0 ? Math.min(s.shields, MAX_RENDERED_SHIELDS) : 0
      const shieldDiameter = (visualR + SHIELD_PAD) * 2
      if (wantShields <= 0) {
        display.shield.visible = false
        display.shieldCount = 0
        display.shieldDiameter = shieldDiameter
      } else if (
        !display.shield.visible ||
        display.shieldCount !== wantShields ||
        display.shieldDiameter !== shieldDiameter
      ) {
        display.shield.removeChildren()
        const bubble = itemSpriteFor(SHIELD_URL, shieldDiameter)
        if (bubble) display.shield.addChild(bubble)
        const denom = Math.max(1, Math.min(s.maxShields, MAX_RENDERED_SHIELDS))
        for (let i = 0; i < wantShields; i++) {
          const spark = itemSpriteFor(SHIELD_SPARK_URL, SHIELD_SPARK_SIZE)
          if (!spark) continue
          const a = (i / denom) * Math.PI * 2 - Math.PI / 2
          spark.position.set(
            Math.cos(a) * (visualR + SHIELD_SPARK_RIM_GAP),
            Math.sin(a) * (visualR + SHIELD_SPARK_RIM_GAP),
          )
          display.shield.addChild(spark)
        }
        display.shield.visible = true
        display.shieldCount = wantShields
        display.shieldDiameter = shieldDiameter
      }
    }

    // projectiles
    const aliveProj = new Set(engine.projectiles.map((p) => p.id))
    for (const [id, display] of projectiles) {
      if (!aliveProj.has(id)) {
        world.removeChild(display.container)
        display.container.destroy({ children: true })
        projectiles.delete(id)
      }
    }
    for (const p of engine.projectiles) {
      let display = projectiles.get(p.id)
      if (!display) {
        addProjectile(p.id, p.kind)
        display = projectiles.get(p.id)!
      }
      display.container.position.set(p.x, p.y)
      // Gwyn's missile art flies nose-first: rotate the sprite onto its
      // actual frame-to-frame travel direction (homing missiles curve and
      // arc missiles dive while vy stays 0 — displacement never lies).
      // The art points +x natively, so atan2 maps directly. First frame has
      // no displacement yet and keeps rotation 0. Seeds/heals stay unrotated.
      if (display.kind === "missile" && display.body instanceof Sprite) {
        if (display.lx != null && display.ly != null) {
          const dx = p.x - display.lx
          const dy = p.y - display.ly
          if (dx !== 0 || dy !== 0) display.body.rotation = Math.atan2(dy, dx)
        }
        display.lx = p.x
        display.ly = p.y
      }
    }
  }

  // Engine events drive per-pumpkin animations precisely. Animated types play
  // fire/produce/hurt/death; placeholder types simply ignore them.
  const onGameEvent = (event: GameEvent) => {
    switch (event.type) {
      case "fire": {
        const display = pumpkins.get(event.pumpkinId)
        if (display) playPumpkinState(display, "fire")
        break
      }
      case "cramer_produce": {
        const display = pumpkins.get(event.pumpkinId)
        if (display) playPumpkinState(display, "produce")
        break
      }
      case "pumpkin_damaged": {
        const display = pumpkins.get(event.pumpkinId)
        if (display) playPumpkinState(display, "hurt")
        break
      }
      case "pumpkin_destroyed": {
        const display = pumpkins.get(event.pumpkinId)
        if (display) playPumpkinState(display, "death")
        break
      }
      case "slug_spawned": {
        // Dell materializes with a `create` one-shot, then settles into idle.
        // Crawlers start in their loop from birth — nothing to do.
        if (event.slugType === "dell") {
          const display = slugs.get(event.slugId)
          if (display) playSlugState(display, "create")
        }
        break
      }
      case "slug_attacked": {
        const display = slugs.get(event.slugId)
        if (display) playSlugState(display, "attack")
        break
      }
      case "shield_break":
      case "slug_damaged": {
        const display = slugs.get(event.slugId)
        if (!display?.anim) break
        // Never restart hurt mid-play, and respect the post-hurt gap — a hit
        // landing here is swallowed, not queued.
        if (display.action === "hurt" && display.anim.playing) break
        if ((display.hurtUntil ?? 0) > performance.now()) break
        playSlugState(display, "hurt")
        break
      }
      case "slug_destroyed": {
        // Slugs are removed immediately — play death as a detached effect at
        // the kill position. Missing frames (Dell, until the next asset drop)
        // are a silent no-op.
        spawnSlugDeath(event.slugType, event.x, event.y)
        break
      }
      default:
        break
    }
  }

  const destroy = () => {
    window.removeEventListener("resize", recomputeTransform)
    window.removeEventListener("keydown", onKeyDown)
    if (app) {
      app.destroy(true, { children: true })
      app = null
    }
    world = null
    containerEl = null
    background = null
    gridOverlay = null
    bgSprite = null
    pumpkinTexture = null
    slugTexture = null
    pumpkins.clear()
    slugs.clear()
    projectiles.clear()
  }

  return { init, destroy, sync, onGameEvent, screenToWorld, worldToScreen, toggleGrid }
}
