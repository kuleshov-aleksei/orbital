// Config override helpers for balance sims. The default fixture itself lives
// in ./fixture.ts (browser-safe, no node imports) so the dev visual can
// share it; it is re-exported here to keep existing imports working.
import { readFileSync } from "fs"
import type { HalloweenGameConfig } from "../../frontend/src/halloween/types"

export { defaultConfig } from "./fixture"

// Deep-merge a partial override into a full config. Arrays (spawn_rounds,
// proximity, reward_brackets) replace wholesale when present; plain objects
// (pumpkins, slugs, spawn_scaling, ...) merge by key so sweeps can tweak a
// single knob, e.g. --config-override '{"spawn_rounds":[...]}' or
// '{"starting_coins":40}'. Accepts a JSON string or a '@path/to/file.json'.
export function applyConfigOverride(
  base: HalloweenGameConfig,
  overrideJson: string,
): HalloweenGameConfig {
  const raw = overrideJson.startsWith("@")
    ? readFileSync(overrideJson.slice(1), "utf8")
    : overrideJson
  const patch = JSON.parse(raw) as Record<string, unknown>
  return deepMerge(base as unknown as Record<string, unknown>, patch) as unknown as HalloweenGameConfig
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v)
    else out[k] = v
  }
  return out
}
