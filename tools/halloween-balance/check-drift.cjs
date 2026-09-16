// Drift guard: asserts the sim fixture (tools/halloween-balance/config.ts)
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
const TS = fs.readFileSync(path.join(__dirname, "config.ts"), "utf8")

let failures = 0
function check(label, goVal, tsVal) {
  const ok = goVal === tsVal
  if (!ok) {
    failures++
    console.error(`DRIFT ${label}: backend=${goVal} fixture=${tsVal}`)
  }
}

// --- spawn rounds: {Round: N, Interval: X, scout/marvin/gerald/dell, SpeedVariation} ---
const goRounds = [
  ...GO.matchAll(
    /\{Round:\s*(\d+),\s*Interval:\s*([\d.]+),\s*Pool:\s*map\[string\]int\{"scout":\s*(\d+),\s*"marvin":\s*(\d+),\s*"gerald":\s*(\d+),\s*"dell":\s*(\d+)\},\s*SpeedVariation:\s*([\d.]+)\}/g,
  ),
].map((m) => m.slice(1).join(","))
const tsRounds = [
  ...TS.matchAll(
    /\{\s*round:\s*(\d+),\s*interval:\s*([\d.]+),\s*pool:\s*\{\s*scout:\s*(\d+),\s*marvin:\s*(\d+),\s*gerald:\s*(\d+),\s*dell:\s*(\d+)\s*\},\s*speed_variation:\s*([\d.]+)\s*\}/g,
  ),
].map((m) => m.slice(1).join(","))
check("spawn_rounds.length", String(goRounds.length), String(tsRounds.length))
for (let i = 0; i < Math.max(goRounds.length, tsRounds.length); i++) {
  check(`spawn_rounds[${i}]`, goRounds[i] ?? "<missing>", tsRounds[i] ?? "<missing>")
}

// --- pumpkins: fire_rate, health, damage, speed, cost ---
for (const name of ["ferdinand", "chunky", "herbert", "gwynevere", "cramer"]) {
  const go = GO.match(
    new RegExp(
      `"${name}":\\s*\\{FireRate:\\s*([\\d.]+),\\s*Health:\\s*([\\d.]+),\\s*DamagePerShot:\\s*([\\d.]+),\\s*ProjectileSpeed:\\s*([\\d.]+),\\s*Cost:\\s*(\\d+)(?:,\\s*CoinIntervalS:\\s*([\\d.]+),\\s*CoinsPerTick:\\s*(\\d+))?\\}`,
    ),
  )
  const ts = TS.match(
    new RegExp(
      `${name}:\\s*\\{\\s*fire_rate:\\s*([\\d.]+),\\s*health:\\s*([\\d.]+),\\s*damage_per_shot:\\s*([\\d.]+),\\s*projectile_speed:\\s*([\\d.]+),\\s*cost:\\s*(\\d+)(?:,\\s*coin_interval_s:\\s*([\\d.]+),\\s*coins_per_tick:\\s*(\\d+))?`,
    ),
  )
  check(
    `pumpkins.${name}`,
    // Backend omits zero-value CoinIntervalS/CoinsPerTick; fixture spells out 0,0.
    go ? [...go.slice(1, 6), go[6] ?? "0", go[7] ?? "0"].join(",") : "<missing>",
    ts ? ts.slice(1).join(",") : "<missing>",
  )
}

// --- slugs: speed, health, damage, reward, kill_reward, positionally
// (scout, marvin, gerald, dell in both files). ---
const goSlugs = [
  ...GO.matchAll(
    /Speed:\s*([\d.]+),\s*Health:\s*([\d.]+),\s*DamageToPumpkin:\s*([\d.]+),\s*RewardPoints:\s*([\d.]+),\s*KillReward:\s*([\d.]+)/g,
  ),
].map((m) => m.slice(1).join(","))
const tsSlugs = [
  ...TS.matchAll(
    /(?:scout|marvin|gerald|dell):\s*\{\s*speed:\s*([\d.]+),\s*health:\s*([\d.]+),\s*damage_to_pumpkin:\s*([\d.]+),\s*reward_points:\s*([\d.]+),\s*kill_reward:\s*([\d.]+)\s*\}/g,
  ),
].map((m) => m.slice(1).join(","))
check("slugs.length", String(goSlugs.length), String(tsSlugs.length))
for (let i = 0; i < Math.max(goSlugs.length, tsSlugs.length); i++) {
  check(`slugs[${i}]`, goSlugs[i] ?? "<missing>", tsSlugs[i] ?? "<missing>")
}

// --- starting coins ---
const goCoins = (GO.match(/StartingCoins:\s*(\d+)/) || [])[1]
const tsCoins = (TS.match(/starting_coins:\s*(\d+)/) || [])[1]
check("starting_coins", goCoins ?? "<missing>", tsCoins ?? "<missing>")

// --- spawn scaling ---
const goScaling = (GO.match(
  /SpawnScaling:\s*HalloweenSpawnScalingConfig\{\s*Interval:\s*([\d.]+),\s*ScoutPerRound:\s*([\d.]+),\s*MarvinPerRound:\s*([\d.]+),\s*GeraldSqrt:\s*([\d.]+),\s*DellSqrt:\s*([\d.]+),\s*SpeedVariation:\s*([\d.]+)/,
) || []).slice(1).join(",")
const tsScaling = (TS.match(
  /spawn_scaling:\s*\{\s*interval:\s*([\d.]+),\s*scout_per_round:\s*([\d.]+),\s*marvin_per_round:\s*([\d.]+),\s*gerald_sqrt:\s*([\d.]+),\s*dell_sqrt:\s*([\d.]+),\s*speed_variation:\s*([\d.]+)/,
) || []).slice(1).join(",")
check("spawn_scaling", goScaling || "<missing>", tsScaling || "<missing>")

if (failures > 0) {
  console.error(`\n${failures} drifted value(s). Update tools/halloween-balance/config.ts to match the backend.`)
  process.exit(1)
}
console.log("drift check OK: fixture matches backend Config()")
