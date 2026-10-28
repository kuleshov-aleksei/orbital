// Drift guard: asserts the sim fixture (tools/halloween-balance/fixture.ts)
// matches the server-authoritative values in
// backend/internal/service/halloweenservice.go Config().
// Run: node tools/halloween-balance/check-drift.cjs
// Exits 1 with a diff-style report on mismatch.
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..", "..")
const GO = fs.readFileSync(
  path.join(ROOT, "backend", "internal", "service", "halloweenservice.go"),
  "utf8",
)
const TS = fs.readFileSync(path.join(__dirname, "fixture.ts"), "utf8")

let failures = 0
function check(label, goVal, tsVal) {
  const ok = goVal === tsVal
  if (!ok) {
    failures++
    console.error(`DRIFT ${label}: backend=${goVal} fixture=${tsVal}`)
  }
}

// --- spawn rounds: {Round: N, Interval: X, scout/marvin/gerald/dell, SpeedVariation, Shielded} ---
const goRounds = [
  ...GO.matchAll(
    /\{Round:\s*(\d+),\s*Interval:\s*([\d.]+),\s*Pool:\s*map\[string\]int\{"scout":\s*(\d+),\s*"marvin":\s*(\d+),\s*"gerald":\s*(\d+),\s*"dell":\s*(\d+)\},\s*SpeedVariation:\s*([\d.]+),\s*Shielded:\s*(\d+)\}/g,
  ),
].map((m) => m.slice(1).join(","))
const tsRounds = [
  ...TS.matchAll(
    /\{\s*round:\s*(\d+),\s*interval:\s*([\d.]+),\s*pool:\s*\{\s*scout:\s*(\d+),\s*marvin:\s*(\d+),\s*gerald:\s*(\d+),\s*dell:\s*(\d+)\s*\},\s*speed_variation:\s*([\d.]+),\s*shielded:\s*(\d+)\s*\}/g,
  ),
].map((m) => m.slice(1).join(","))
check("spawn_rounds.length", String(goRounds.length), String(tsRounds.length))
for (let i = 0; i < Math.max(goRounds.length, tsRounds.length); i++) {
  check(`spawn_rounds[${i}]`, goRounds[i] ?? "<missing>", tsRounds[i] ?? "<missing>")
}

// --- pumpkins: fire_rate, health, damage, speed, cost, draft_only ---
for (const name of ["ferdinand", "chunky", "herbert", "gwynevere", "cramer", "pearcer"]) {
  const go = GO.match(
    new RegExp(
      `"${name}":\\s*\\{\\s*FireRate:\\s*([\\d.]+),\\s*Health:\\s*([\\d.]+),\\s*DamagePerShot:\\s*([\\d.]+),\\s*ProjectileSpeed:\\s*([\\d.]+),\\s*Cost:\\s*(\\d+)(?:,\\s*CoinIntervalS:\\s*([\\d.]+),\\s*CoinsPerTick:\\s*(\\d+))?(?:,\\s*DraftOnly:\\s*(true|false))?`,
    ),
  )
  const ts = TS.match(
    new RegExp(
      `${name}:\\s*\\{\\s*fire_rate:\\s*([\\d.]+),\\s*health:\\s*([\\d.]+),\\s*damage_per_shot:\\s*([\\d.]+),\\s*projectile_speed:\\s*([\\d.]+),\\s*cost:\\s*(\\d+)(?:,\\s*coin_interval_s:\\s*([\\d.]+),\\s*coins_per_tick:\\s*(\\d+))?(?:,\\s*draft_only:\\s*(true|false))?`,
    ),
  )
  check(
    `pumpkins.${name}`,
    // Backend omits zero-value CoinIntervalS/CoinsPerTick; fixture spells out 0,0.
    // Absent DraftOnly means false on both sides.
    go ? [...go.slice(1, 6), go[6] ?? "0", go[7] ?? "0", go[8] ?? "false"].join(",") : "<missing>",
    ts ? [...ts.slice(1, 8), ts[8] ?? "false"].join(",") : "<missing>",
  )
}

// --- slugs: speed, health, damage, reward, kill_reward, xp_reward,
// positionally (scout, marvin, gerald, dell in both files). ---
const goSlugs = [
  ...GO.matchAll(
    /Speed:\s*([\d.]+),\s*Health:\s*([\d.]+),\s*DamageToPumpkin:\s*([\d.]+),\s*RewardPoints:\s*([\d.]+),\s*KillReward:\s*([\d.]+),\s*XpReward:\s*([\d.]+)/g,
  ),
].map((m) => m.slice(1).join(","))
const tsSlugs = [
  ...TS.matchAll(
    /(?:scout|marvin|gerald|dell):\s*\{\s*speed:\s*([\d.]+),\s*health:\s*([\d.]+),\s*damage_to_pumpkin:\s*([\d.]+),\s*reward_points:\s*([\d.]+),\s*kill_reward:\s*([\d.]+),\s*xp_reward:\s*([\d.]+)\s*\}/g,
  ),
].map((m) => m.slice(1).join(","))
check("slugs.length", String(goSlugs.length), String(tsSlugs.length))
for (let i = 0; i < Math.max(goSlugs.length, tsSlugs.length); i++) {
  check(`slugs[${i}]`, goSlugs[i] ?? "<missing>", tsSlugs[i] ?? "<missing>")
}

// --- pumkin levels: per-level health, fire_rate, damage, speed,
// coin tick, coins, blast radius (in type order) ---
const goLevels = [
  ...GO.matchAll(
    /\{Health:\s*([\d.]+),\s*FireRate:\s*([\d.]+),\s*DamagePerShot:\s*([\d.]+),\s*ProjectileSpeed:\s*([\d.]+),\s*CoinIntervalS:\s*([\d.]+),\s*CoinsPerTick:\s*([\d.]+),\s*BlastRadius:\s*([\d.]+)\}/g,
  ),
].map((m) => m.slice(1).join(","))
const tsLevels = [
  ...TS.matchAll(
    /\{\s*health:\s*([\d.]+),\s*fire_rate:\s*([\d.]+),\s*damage_per_shot:\s*([\d.]+),\s*projectile_speed:\s*([\d.]+),\s*coin_interval_s:\s*([\d.]+),\s*coins_per_tick:\s*([\d.]+),\s*blast_radius:\s*([\d.]+)\s*\}/g,
  ),
].map((m) => m.slice(1).join(","))
check("levels.length", String(goLevels.length), String(tsLevels.length))
for (let i = 0; i < Math.max(goLevels.length, tsLevels.length); i++) {
  check(`levels[${i}]`, goLevels[i] ?? "<missing>", tsLevels[i] ?? "<missing>")
}

// --- level costs (XP per level-up) ---
const goLevelCosts = (GO.match(/LevelCosts:\s*\[\]int\{([\d,\s]+)\}/) || [])[1]
const tsLevelCosts = (TS.match(/level_costs:\s*\[([\d,\s]+)\]/) || [])[1]
check(
  "level_costs",
  goLevelCosts ? goLevelCosts.replace(/\s/g, "") : "<missing>",
  tsLevelCosts ? tsLevelCosts.replace(/\s/g, "") : "<missing>",
)

// --- starting coins ---
const goCoins = (GO.match(/StartingCoins:\s*(\d+)/) || [])[1]
const tsCoins = (TS.match(/starting_coins:\s*(\d+)/) || [])[1]
check("starting_coins", goCoins ?? "<missing>", tsCoins ?? "<missing>")

// --- spawn scaling ---
const goScaling = (GO.match(
  /SpawnScaling:\s*HalloweenSpawnScalingConfig\{\s*Interval:\s*([\d.]+),\s*ScoutPerRound:\s*([\d.]+),\s*MarvinPerRound:\s*([\d.]+),\s*GeraldSqrt:\s*([\d.]+),\s*DellSqrt:\s*([\d.]+),\s*SpeedVariation:\s*([\d.]+),\s*ShieldPerRound:\s*([\d.]+)/,
) || []).slice(1).join(",")
const tsScaling = (TS.match(
  /spawn_scaling:\s*\{\s*interval:\s*([\d.]+),\s*scout_per_round:\s*([\d.]+),\s*marvin_per_round:\s*([\d.]+),\s*gerald_sqrt:\s*([\d.]+),\s*dell_sqrt:\s*([\d.]+),\s*speed_variation:\s*([\d.]+),\s*shield_per_round:\s*([\d.]+)/,
) || []).slice(1).join(",")
check("spawn_scaling", goScaling || "<missing>", tsScaling || "<missing>")

// --- shield bounds (each shielded slug rolls shield_min..shield_max) ---
const goShieldMin = (GO.match(/ShieldMin:\s*(\d+)/) || [])[1]
const tsShieldMin = (TS.match(/shield_min:\s*(\d+)/) || [])[1]
check("shield_min", goShieldMin ?? "<missing>", tsShieldMin ?? "<missing>")
const goShieldMax = (GO.match(/ShieldMax:\s*(\d+)/) || [])[1]
const tsShieldMax = (TS.match(/shield_max:\s*(\d+)/) || [])[1]
check("shield_max", goShieldMax ?? "<missing>", tsShieldMax ?? "<missing>")

// --- slug HP growth (compounds per round; R1 stays at base) ---
const goHP = (GO.match(/SlugHPGrowth:\s*([\d.]+)/) || [])[1]
const tsHP = (TS.match(/slug_hp_growth:\s*([\d.]+)/) || [])[1]
check("slug_hp_growth", goHP ?? "<missing>", tsHP ?? "<missing>")

// --- ability damage growth (compounds per round; R1 stays at base) ---
const goAbilityDamage = (GO.match(/AbilityDamageGrowth:\s*([\d.]+)/) || [])[1]
const tsAbilityDamage = (TS.match(/ability_damage_growth:\s*([\d.]+)/) || [])[1]
check("ability_damage_growth", goAbilityDamage ?? "<missing>", tsAbilityDamage ?? "<missing>")

if (failures > 0) {
  console.error(`\n${failures} drifted value(s). Update tools/halloween-balance/fixture.ts to match the backend.`)
  process.exit(1)
}
console.log("drift check OK: fixture matches backend Config()")
