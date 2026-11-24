// Run with `make test-ota`.
import { test } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildOtaBundle } from "./ota-manifest.mjs"

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ota-manifest-"))
}

test("buildOtaBundle writes a manifest and content-addressed blobs", (t) => {
  const root = tmpdir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dist = path.join(root, "dist")
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true })
  fs.writeFileSync(path.join(dist, "index.html"), "<html></html>")
  fs.writeFileSync(path.join(dist, "assets", "a.js"), "same")
  fs.writeFileSync(path.join(dist, "assets", "b.js"), "same")
  fs.writeFileSync(path.join(dist, "index.html.gz"), "x")
  fs.writeFileSync(path.join(dist, "venmic-x64.node"), "x")

  const out = path.join(root, "out")
  const m = buildOtaBundle({
    distDir: dist,
    platform: "electron",
    version: "1.9.0",
    backendUrl: "https://orb.example.com",
    outDir: out,
    shellApi: 2,
  })

  assert.deepEqual(
    m.files.map((f) => f.path),
    ["assets/a.js", "assets/b.js", "index.html"],
    "skips .gz and .node, uses / separators",
  )
  assert.equal(m.shell_api, 2)
  const sha = crypto.createHash("sha256").update("same").digest("hex")
  assert.equal(m.files[0].sha256, sha)
  assert.equal(fs.readFileSync(path.join(out, "ota", "electron", "files", sha), "utf8"), "same")
  // Identical files share one blob.
  assert.equal(fs.readdirSync(path.join(out, "ota", "electron", "files")).length, 2)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "ota-electron.json"), "utf8")), m)
})

test("buildOtaBundle refuses a dist without index.html", (t) => {
  const root = tmpdir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(() =>
    buildOtaBundle({ distDir: root, platform: "android", version: "1.0.0", backendUrl: "", outDir: root, shellApi: 1 }),
  )
})
