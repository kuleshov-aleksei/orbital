import { AnimatedSprite, Application, Assets, Container, Graphics, Sprite } from "pixi.js"
import type { GameEvent, HalloweenGameEngine } from "./engine"
import type { HalloweenAssets } from "./assets"
import type { LoadedAtlas } from "./atlas"
import {
  COLUMN_SPACING,
  COLUMN_START_X,
  FIELD_HEIGHT,
  LANE_COUNT,
  LANE_HEIGHT,
  PLACEMENT_COLUMNS,
  columnForX,
  columnX,
  laneCenterY,
  laneForY,
} from "./engine"
import type { PumpkinType, SlugType } from "./types"

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
  shield: Graphics
}

interface ProjDisplay {
  container: Container
  body: Graphics
}

export interface MiniGameRenderer {
  init(container: HTMLElement): Promise<void>
  destroy(): void
  sync(): void
  onGameEvent(event: GameEvent): void
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null
  worldToScreen(x: number, y: number): { x: number; y: number }
}

// Animated pumpkin frames are 128px with ~101px of opaque content, so we scale
// the frame past radius*2 to make the pumpkin itself read at the right size.
const ANIM_FPS = 30
const PUMPKIN_ANIM_FIT = 128 / 101
// How long a finished corpse lingers while it fades out before removal.
const DEATH_FADE_MS = 350

export function createMiniGameRenderer(
  engine: HalloweenGameEngine,
  assets?: HalloweenAssets,
): MiniGameRenderer {
  let app: Application | null = null
  let world: Container | null = null
  let containerEl: HTMLElement | null = null
  let background: Graphics | null = null
  let cursorLayer: Container | null = null
  let effectLayer: Container | null = null

  const pumpkinAtlasFor = (type: PumpkinType): LoadedAtlas | undefined =>
    assets?.get(`pumpkin:${type}`)

  const pumpkins = new Map<number, PumpkinDisplay>()
  const slugs = new Map<number, SlugDisplay>()
  const projectiles = new Map<number, ProjDisplay>()

  let scale = 1
  let offsetX = 0
  let offsetY = 0
  let mouseWorld: { x: number; y: number } | null = null
  let pumpkinTexture: ReturnType<typeof Assets.get> | null = null
  let slugTexture: ReturnType<typeof Assets.get> | null = null

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
    background.clear()
    background.rect(0, 0, width(), FIELD_HEIGHT)
    background.fill({ color: 0x1a1f16 })
    // Only the placable grid positions are drawn: the 5×6 placement cells.
    // On round 1 only the 3 center lanes are active — locked lanes render dim.
    const gridX0 = COLUMN_START_X
    const gridW = PLACEMENT_COLUMNS * COLUMN_SPACING
    const active = new Set(engine.activeLanes())
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const open = active.has(lane)
      for (let col = 0; col < PLACEMENT_COLUMNS; col++) {
        const x = gridX0 + col * COLUMN_SPACING
        const y = lane * LANE_HEIGHT
        background.rect(x, y, COLUMN_SPACING, LANE_HEIGHT)
        background.fill({ color: 0x22301c, alpha: open ? 0.35 : 0.07 })
        background.rect(x, y, COLUMN_SPACING, LANE_HEIGHT)
        background.stroke({ width: 1, color: 0x3b4a2f, alpha: open ? 0.7 : 0.2 })
      }
    }
    background.rect(gridX0, 0, gridW, FIELD_HEIGHT)
    background.stroke({ width: 1, color: 0x3b4a2f, alpha: 0.9 })
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

  const spriteFor = (texture: ReturnType<typeof Assets.get>, height: number): Sprite => {
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    sprite.height = height
    sprite.scale.x = sprite.scale.y
    return sprite
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
    const body: Sprite | Graphics = slugTexture
      ? spriteFor(slugTexture, radius * 2)
      : new Graphics().circle(0, 0, radius).fill({ color: SLUG_TINTS[type] })
    body.tint = SLUG_TINTS[type]
    container.addChild(body)
    const bar = makeHealthBar(container, radius * 2, -radius - 10)
    const shield = new Graphics()
    container.addChild(shield)
    world?.addChild(container)
    slugs.set(id, { container, sprite: body, bar, shield })
  }

  const addProjectile = (id: number, kind: string) => {
    const container = new Container()
    const body = new Graphics()
    const color = kind === "heal" ? 0xbbf7d0 : kind === "missile" ? 0xc4b5fd : 0xfde68a
    body.circle(0, 0, kind === "missile" ? 6 : 4)
    body.fill({ color })
    container.addChild(body)
    world?.addChild(container)
    projectiles.set(id, { container, body })
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
      pumpkinTexture = await Assets.load("/assets/hw26/pumkins/pumkin_A.png")
    } catch {
      pumpkinTexture = null
    }
    try {
      slugTexture = await Assets.load("/assets/hw26/slugs/slug_A.png")
    } catch {
      slugTexture = null
    }

    world = new Container()
    app.stage.addChild(world)

    background = new Graphics()
    world.addChild(background)
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
      g.rect(cx - COLUMN_SPACING / 2, lane * LANE_HEIGHT, COLUMN_SPACING, LANE_HEIGHT)
      g.fill({ color: 0xffffff, alpha: 0.12 })
      g.rect(cx - COLUMN_SPACING / 2, lane * LANE_HEIGHT, COLUMN_SPACING, LANE_HEIGHT)
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
      fx.circle(g.x, g.y, 9)
      fx.fill({ color: 0xef4444 })
      effectLayer?.addChild(fx)
    }
    for (const cup of engine.beerCups) {
      const fx = new Graphics()
      fx.circle(cup.x, cup.y, cup.radius)
      fx.fill({ color: 0xfbbf24, alpha: 0.12 })
      fx.circle(cup.x, cup.y, 10)
      fx.fill({ color: 0xf59e0b })
      effectLayer?.addChild(fx)
    }
    for (const line of engine.saltLines) {
      const fx = new Graphics()
      fx.rect(line.x - line.width / 2, 0, line.width, FIELD_HEIGHT)
      fx.fill({ color: 0xe2e8f0, alpha: 0.35 })
      effectLayer?.addChild(fx)
    }
    for (const patch of engine.thornPatches) {
      const fx = new Graphics()
      fx.rect(patch.x - patch.width / 2, 0, patch.width, FIELD_HEIGHT)
      fx.fill({ color: 0x4d7c0f, alpha: 0.35 })
      effectLayer?.addChild(fx)
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
      }
      display.container.position.set(s.x, s.y)
      updateBar(display.bar, s.radius * 2, s.health, s.maxHealth)
      // Shield ring: cyan circle plus one tick per remaining shield.
      // No shields, no ring. Minimalism even Gilfoyle respects.
      display.shield.clear()
      if (s.shields > 0) {
        display.shield.circle(0, 0, s.radius + 5)
        display.shield.stroke({ width: 2.5, color: 0x67e8f9, alpha: 0.9 })
        for (let i = 0; i < s.shields; i++) {
          const a = (i / Math.max(1, s.maxShields)) * Math.PI * 2 - Math.PI / 2
          const r1 = s.radius + 8
          const r2 = s.radius + 12
          display.shield.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
          display.shield.lineTo(Math.cos(a) * r2, Math.sin(a) * r2)
        }
        display.shield.stroke({ width: 2, color: 0x67e8f9, alpha: 0.9 })
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
    }
  }

  // Engine events drive per-pumpkin animations precisely. Animated types play
  // fire/hurt/death; placeholder types simply ignore them.
  const onGameEvent = (event: GameEvent) => {
    switch (event.type) {
      case "fire": {
        const display = pumpkins.get(event.pumpkinId)
        if (display) playPumpkinState(display, "fire")
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
      default:
        break
    }
  }

  const destroy = () => {
    window.removeEventListener("resize", recomputeTransform)
    if (app) {
      app.destroy(true, { children: true })
      app = null
    }
    world = null
    containerEl = null
    pumpkinTexture = null
    slugTexture = null
    pumpkins.clear()
    slugs.clear()
    projectiles.clear()
  }

  return { init, destroy, sync, onGameEvent, screenToWorld, worldToScreen }
}
