// Run with `make test-ota` (node --test; Node strips the types itself).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  compareVersions,
  createLock,
  decide,
  isSafeBundlePath,
  normalizeState,
  parseManifest,
  resolveStartupState,
  staleBundleNames,
  type OtaContext,
  type OtaManifest,
} from "./otaPlan.ts"

const sha = "a".repeat(64)

function manifest(over: Partial<OtaManifest> = {}): OtaManifest {
  return {
    version: "1.9.0",
    shell_api: 2,
    backend_url: "https://orb.example.com",
    files: [{ path: "index.html", sha256: sha, size: 10 }],
    ...over,
  }
}

const ctx: OtaContext = {
  shellApi: 2,
  currentVersion: "1.8.0",
  builtinVersion: "1.8.0",
  backendUrl: "https://orb.example.com",
  bad: [],
}

test("compareVersions ignores suffixes and rejects dev builds", () => {
  assert.equal(compareVersions("1.9.0", "1.8.12"), 1)
  assert.equal(compareVersions("1.9.0-abc", "1.9.0"), 0)
  assert.equal(compareVersions("1.2.3", "1.10.0"), -1)
  assert.equal(compareVersions("dev-unknown", "1.0.0"), null)
})

test("isSafeBundlePath rejects escapes", () => {
  assert.ok(isSafeBundlePath("assets/index-abc.js"))
  for (const p of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "a\\b", "./a"]) {
    assert.equal(isSafeBundlePath(p), false, p)
  }
})

test("parseManifest validates untrusted input", () => {
  assert.ok(parseManifest(manifest()))
  assert.equal(parseManifest({ ...manifest(), version: "latest" }), null)
  assert.equal(parseManifest({ ...manifest(), files: [] }), null)
  assert.equal(parseManifest(manifest({ files: [{ path: "a.js", sha256: sha, size: 1 }] })), null, "needs index.html")
  assert.equal(
    parseManifest(manifest({ files: [{ path: "../index.html", sha256: sha, size: 1 }] })),
    null,
  )
  assert.equal(
    parseManifest(manifest({ files: [{ path: "index.html", sha256: "zz", size: 1 }] })),
    null,
  )
  const dup = [
    { path: "index.html", sha256: sha, size: 1 },
    { path: "index.html", sha256: sha, size: 1 },
  ]
  assert.equal(parseManifest(manifest({ files: dup })), null)
})

test("decide: stage a newer bundle for the same shell", () => {
  assert.deepEqual(decide(manifest(), ctx), { action: "stage" })
})

test("decide: newer shell needs the native update", () => {
  assert.deepEqual(decide(manifest({ shell_api: 3 }), ctx), { action: "native" })
})

test("decide: nothing to do", () => {
  assert.equal(decide(manifest({ version: "1.8.0" }), ctx).action, "none")
  assert.equal(decide(manifest({ shell_api: 1 }), ctx).action, "none")
  assert.equal(decide(manifest({ backend_url: "https://other" }), ctx).action, "none")
  assert.equal(decide(manifest(), { ...ctx, bad: ["1.9.0"] }).action, "none")
  assert.equal(decide(manifest(), { ...ctx, builtinVersion: "dev-unknown" }).action, "none")
  // Already running 1.9.0 from an earlier OTA.
  assert.equal(decide(manifest(), { ...ctx, currentVersion: "1.9.0" }).action, "none")
  // An old release with an older shell must not trigger a native update.
  assert.equal(decide(manifest({ version: "1.7.0", shell_api: 3 }), ctx).action, "none")
})

test("resolveStartupState promotes pending and drops stale bundles", () => {
  const all = () => true
  assert.deepEqual(resolveStartupState({ active: null, pending: "1.9.0", bad: [] }, "1.8.0", all), {
    active: "1.9.0",
    pending: null,
    bad: [],
  })
  // A native update to 1.9.0 makes the 1.9.0 bundle redundant.
  assert.equal(resolveStartupState({ active: "1.9.0", pending: null, bad: [] }, "1.9.0", all).active, null)
  // Bad or missing pending keeps the current active bundle.
  assert.equal(
    resolveStartupState({ active: "1.9.0", pending: "1.9.1", bad: ["1.9.1"] }, "1.8.0", all).active,
    "1.9.0",
  )
  assert.equal(
    resolveStartupState({ active: "1.9.0", pending: "1.9.1", bad: [] }, "1.8.0", (v) => v === "1.9.0").active,
    "1.9.0",
  )
  assert.equal(resolveStartupState({ active: "1.9.0", pending: null, bad: [] }, "1.8.0", () => false).active, null)
})

test("normalizeState tolerates garbage", () => {
  assert.deepEqual(normalizeState(null), { active: null, pending: null, bad: [] })
  assert.deepEqual(normalizeState({ active: "../x", pending: 3, bad: ["1.0.0", 4] }), {
    active: null,
    pending: null,
    bad: ["1.0.0"],
  })
})

test("staleBundleNames keeps active, pending and the bundle being staged", () => {
  const entries = ["1.8.0", "1.9.0", "1.9.0.tmp", "1.9.1.tmp", "not-a-version"]
  // 1.9.0 is mid-stage: neither it nor its .tmp may be deleted (the cleanup used
  // to remove them, which made staging fail with ENOENT).
  assert.deepEqual(staleBundleNames(entries, { active: "1.8.0", pending: null }, "1.9.0"), [
    "1.9.1.tmp",
    "not-a-version",
  ])
  // Nothing in flight: a .tmp left by a killed run is stale and goes away.
  assert.deepEqual(staleBundleNames(entries, { active: null, pending: null }, null), [
    "1.8.0",
    "1.9.0",
    "1.9.0.tmp",
    "1.9.1.tmp",
    "not-a-version",
  ])
  // A pending bundle is kept until it becomes active.
  assert.deepEqual(staleBundleNames(["1.8.0", "1.9.0"], { active: "1.8.0", pending: "1.9.0" }, null), [])
  assert.deepEqual(staleBundleNames([], { active: "1.8.0", pending: null }, null), [])
})

test("createLock serializes tasks and survives a rejection", async () => {
  const withLock = createLock()
  const order: string[] = []
  let running = 0
  let maxRunning = 0
  const task = (name: string) =>
    withLock(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(name)
      running--
    })
  const failing = withLock(async () => {
    throw new Error("boom")
  })
  const results = await Promise.allSettled([task("a"), failing, task("b"), task("c")])
  assert.equal(results[1].status, "rejected")
  assert.equal(maxRunning, 1, "tasks must not overlap")
  assert.deepEqual(order, ["a", "b", "c"], "a rejection must not stall the queue")
})
