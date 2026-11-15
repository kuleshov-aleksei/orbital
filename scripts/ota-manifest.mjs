#!/usr/bin/env node
// Builds an over-the-air (OTA) frontend bundle for the desktop or Android shell.
//
//   node scripts/ota-manifest.mjs <distDir> <electron|android> <version> <backendUrl> <outDir>
//
// Writes <outDir>/ota-<platform>.json (the manifest the shell reads) and copies
// every file to <outDir>/ota/<platform>/files/<sha256> (content-addressed blobs,
// so a client only downloads files that changed). The shell API version comes from
// shell-api.json at the repo root. See docs/notes/MIGRATION_TO_S3.md "OTA frontend".
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLATFORMS = ["electron", "android"]

// Not part of the renderer: native addons (loaded by the main process from the
// install dir) and the nginx-only precompressed copies.
const EXCLUDED = [/\.node$/, /\.gz$/, /\.br$/]

function walk(dir, base = dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"))
  }
  return out
}

export function buildOtaBundle({ distDir, platform, version, backendUrl, outDir, shellApi }) {
  if (!PLATFORMS.includes(platform)) throw new Error(`unknown platform ${platform}`)
  if (!fs.existsSync(path.join(distDir, "index.html"))) throw new Error(`${distDir}/index.html missing`)
  if (!Number.isInteger(shellApi) || shellApi < 1) throw new Error(`bad shell api ${shellApi}`)

  const blobDir = path.join(outDir, "ota", platform, "files")
  fs.mkdirSync(blobDir, { recursive: true })

  const files = walk(distDir)
    .filter((p) => !EXCLUDED.some((re) => re.test(p)))
    .sort()
    .map((p) => {
      const data = fs.readFileSync(path.join(distDir, p))
      const sha256 = crypto.createHash("sha256").update(data).digest("hex")
      fs.writeFileSync(path.join(blobDir, sha256), data)
      return { path: p, sha256, size: data.length }
    })

  const manifest = { version, shell_api: shellApi, backend_url: backendUrl, files }
  fs.writeFileSync(path.join(outDir, `ota-${platform}.json`), JSON.stringify(manifest, null, 2) + "\n")
  return manifest
}

function readShellApi(platform) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shell-api.json")
  return JSON.parse(fs.readFileSync(file, "utf8"))[platform]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [distDir, platform, version, backendUrl, outDir] = process.argv.slice(2)
  if (!distDir || !platform || !version || backendUrl === undefined || !outDir) {
    console.error("usage: ota-manifest.mjs <distDir> <electron|android> <version> <backendUrl> <outDir>")
    process.exit(2)
  }
  const manifest = buildOtaBundle({
    distDir,
    platform,
    version,
    backendUrl,
    outDir,
    shellApi: readShellApi(platform),
  })
  const bytes = manifest.files.reduce((n, f) => n + f.size, 0)
  console.log(
    `ota-${platform}.json: v${version}, shell ${manifest.shell_api}, ${manifest.files.length} files, ${(bytes / 1048576).toFixed(1)} MiB`,
  )
}
