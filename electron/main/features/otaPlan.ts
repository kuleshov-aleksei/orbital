// Pure OTA decisions (no Electron imports) so they can run under `node --test`.
// See features/ota.ts and docs/notes/MIGRATION_TO_S3.md "OTA frontend".

export interface OtaFile {
  path: string
  sha256: string
  size: number
}

export interface OtaManifest {
  version: string
  /** Shell API the bundle was built for (shell-api.json). */
  shell_api: number
  /** Backend the bundle talks to (baked in at build time); "" = unknown. */
  backend_url?: string
  files: OtaFile[]
}

export interface OtaState {
  /** Bundle served now ("" / null = the one inside the installer). */
  active: string | null
  /** Downloaded and verified, applied on the next launch or on request. */
  pending: string | null
  /** Bundles that failed to boot; never staged again. */
  bad: string[]
}

export type OtaAction =
  | { action: "none"; reason: string }
  /** The newest release needs a newer shell: run the full (native) update. */
  | { action: "native" }
  | { action: "stage" }

export interface OtaContext {
  shellApi: number
  /** Version the renderer would run without OTA changes (active or built-in). */
  currentVersion: string
  /** Installed app version (built-in bundle). */
  builtinVersion: string
  backendUrl: string
  bad: string[]
}

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** -1 / 0 / 1, or null when either side isn't a version (dev builds). */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

const SHA256 = /^[0-9a-f]{64}$/

/** A relative path that can't escape the bundle dir. */
export function isSafeBundlePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..")
}

/** Validates an untrusted manifest; null when anything is off. */
export function parseManifest(raw: unknown): OtaManifest | null {
  if (!raw || typeof raw !== "object") return null
  const m = raw as Record<string, unknown>
  if (typeof m.version !== "string" || !parseVersion(m.version)) return null
  if (typeof m.shell_api !== "number" || !Number.isInteger(m.shell_api)) return null
  if (m.backend_url !== undefined && typeof m.backend_url !== "string") return null
  if (!Array.isArray(m.files) || m.files.length === 0) return null
  const seen = new Set<string>()
  const files: OtaFile[] = []
  for (const f of m.files as unknown[]) {
    if (!f || typeof f !== "object") return null
    const { path, sha256, size } = f as Record<string, unknown>
    if (typeof path !== "string" || !isSafeBundlePath(path) || seen.has(path)) return null
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) return null
    seen.add(path)
    files.push({ path, sha256, size })
  }
  if (!seen.has("index.html")) return null
  return {
    version: m.version,
    shell_api: m.shell_api,
    backend_url: m.backend_url as string | undefined,
    files,
  }
}

/** What to do with the newest published manifest. */
export function decide(m: OtaManifest, ctx: OtaContext): OtaAction {
  // Dev builds ("dev-unknown") never update over the air.
  if (!parseVersion(ctx.builtinVersion)) return { action: "none", reason: "dev build" }
  const newer = compareVersions(m.version, ctx.currentVersion)
  if (newer === null || newer <= 0) return { action: "none", reason: "up to date" }
  if (m.shell_api > ctx.shellApi) return { action: "native" }
  if (m.shell_api < ctx.shellApi) return { action: "none", reason: "shell is newer than the bundle" }
  if (m.backend_url && ctx.backendUrl && m.backend_url !== ctx.backendUrl) {
    return { action: "none", reason: "bundle is built for another backend" }
  }
  if (ctx.bad.includes(m.version)) return { action: "none", reason: "bundle failed to boot before" }
  return { action: "stage" }
}

/**
 * Startup transition: a pending bundle becomes active, and an active bundle
 * that is missing, bad or not newer than the installed app is dropped (a native
 * update ships a newer built-in bundle).
 */
export function resolveStartupState(
  state: OtaState,
  builtinVersion: string,
  exists: (version: string) => boolean,
): OtaState {
  const usable = (v: string | null): v is string =>
    !!v &&
    exists(v) &&
    !state.bad.includes(v) &&
    (compareVersions(v, builtinVersion) ?? 0) > 0
  const next: OtaState = { active: state.active, pending: null, bad: state.bad }
  if (usable(state.pending)) next.active = state.pending
  if (!usable(next.active)) next.active = null
  return next
}

/**
 * Runs tasks one at a time, in call order. Staging and cleanup share one of
 * these: a cleanup that overlaps a stage deletes the `.tmp` directory the stage
 * is still writing into (every file after that point fails with ENOENT).
 */
export function createLock(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

/**
 * Bundle-dir entries that can be deleted: everything except the active and
 * pending bundles and the version being staged right now (with its `.tmp`).
 * Without `inFlight`, a `<version>.tmp` left behind by a killed run is stale and
 * gets removed.
 */
export function staleBundleNames(
  entries: readonly string[],
  state: Pick<OtaState, "active" | "pending">,
  inFlight: string | null,
): string[] {
  const keep = new Set<string>()
  if (state.active) keep.add(state.active)
  if (state.pending) keep.add(state.pending)
  if (inFlight) {
    keep.add(inFlight)
    keep.add(`${inFlight}.tmp`)
  }
  return entries.filter((name) => !keep.has(name))
}

export function normalizeState(raw: unknown): OtaState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && parseVersion(v) ? v : null)
  return {
    active: str(s.active),
    pending: str(s.pending),
    bad: Array.isArray(s.bad) ? s.bad.filter((v): v is string => typeof v === "string").slice(-20) : [],
  }
}
