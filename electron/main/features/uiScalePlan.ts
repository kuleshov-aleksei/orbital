// Pure UI-scale decisions for touch handhelds (Steam Deck, Legion Go), kept
// free of Electron imports so `node --test` can run them. The Electron side
// (reading DMI, applying the zoom) lives in uiScale.ts.

export interface DmiInfo {
  sysVendor: string
  productName: string
  productVersion: string
}

export interface HandheldInputs {
  platform: NodeJS.Platform
  dmi: DmiInfo | null
  env: Record<string, string | undefined>
  hasTouchscreen: boolean
}

export const MIN_UI_SCALE = 1
export const MAX_UI_SCALE = 2
/** The `lg` breakpoint: the desktop layout needs at least this many CSS px. */
export const TARGET_CSS_WIDTH = 1024

export type UiScaleSetting = "auto" | number

/** Returns a short device label when this looks like a touch handheld, else null. */
export function detectHandheld(input: HandheldInputs): string | null {
  if (input.platform !== "linux") return null

  const dmi = input.dmi
  if (dmi) {
    const vendor = dmi.sysVendor.trim().toLowerCase()
    const product = dmi.productName.trim()
    // Valve codenames: Jupiter = Steam Deck LCD, Galileo = Steam Deck OLED.
    if (vendor === "valve" && /^(jupiter|galileo)$/i.test(product)) return "steam-deck"
    // Lenovo keeps the marketing name in product_version ("Legion Go 8APU1", "Legion Go S 8ARP1").
    if (vendor === "lenovo" && /legion go/i.test(dmi.productVersion)) return "legion-go"
  }

  // SteamOS sets these in its sessions; gamescope alone also covers desktop
  // PCs running Big Picture, hence the touchscreen requirement.
  if (input.env.SteamDeck === "1") return "steamos"
  if (input.env.XDG_CURRENT_DESKTOP?.toLowerCase() === "gamescope" && input.hasTouchscreen) {
    return "gamescope-touch"
  }
  return null
}

/**
 * The largest scale in 0.25 steps that still leaves TARGET_CSS_WIDTH of layout
 * width, clamped to [1, 2]. Width is in DIP, so an OS-level scale is already
 * included. Deck 1280 → 1.25, Legion Go 2560 → 2, Go S 1920 → 1.75.
 */
export function autoFactor(handheld: boolean, widthDip: number): number {
  if (!handheld || !Number.isFinite(widthDip) || widthDip <= 0) return 1
  const steps = Math.floor((widthDip / TARGET_CSS_WIDTH) * 4) / 4
  return clampScale(steps)
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, value))
}

/** Normalizes a stored or IPC-provided setting; anything invalid falls back to "auto". */
export function normalizeSetting(value: unknown): UiScaleSetting {
  if (typeof value === "number" && Number.isFinite(value)) return clampScale(value)
  return "auto"
}

export function effectiveScale(setting: UiScaleSetting, auto: number): number {
  return setting === "auto" ? auto : clampScale(setting)
}
