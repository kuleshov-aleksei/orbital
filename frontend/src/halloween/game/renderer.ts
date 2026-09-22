import { Application, Assets, Container, Graphics, Sprite } from "pixi.js"
import type { HalloweenGameEngine } from "./engine"
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
  silas: 0xdc2626,
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
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null
  worldToScreen(x: number, y: number): { x: number; y: number }
}

export function createMiniGameRenderer(engine: HalloweenGameEngine): MiniGameRenderer {
  let app: Application | null = null
  let world: Container | null = null
  let containerEl: HTMLElement | null = null
  let background: Graphics | null = null
  let cursorLayer: Container | null = null
  let effectLayer: Container | null = null

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

  const spriteFor = (texture: ReturnType<typeof Assets.get>, height: number): Sprite => {
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    sprite.height = height
    sprite.scale.x = sprite.scale.y
    return sprite
  }

  const addPumpkin = (id: number, type: PumpkinType, radius: number) => {
    const container = new Container()
    const body: Sprite | Graphics = pumpkinTexture
      ? spriteFor(pumpkinTexture, radius * 2)
      : new Graphics().circle(0, 0, radius).fill({ color: PUMPKIN_TINTS[type] })
    body.tint = PUMPKIN_TINTS[type]
    container.addChild(body)
    const bar = makeHealthBar(container, radius * 2, -radius - 12)
    world?.addChild(container)
    pumpkins.set(id, { container, sprite: body, bar })
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

    // pumpkins
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
      display.container.position.set(p.x, p.y)
      updateBar(display.bar, p.radius * 2, p.health, p.maxHealth)
      display.sprite.alpha = p.health > 0 ? 1 : 0.3
      if (p.health <= 0) display.sprite.tint = 0x444444
    }

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

  return { init, destroy, sync, screenToWorld, worldToScreen }
}
