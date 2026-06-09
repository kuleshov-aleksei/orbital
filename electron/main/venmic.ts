// @ts-nocheck
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import log from "electron-log"
import type { LinkData, Node, PatchBay as PatchBayType } from "@vencord/venmic";

const getModuleUrl = (): string => {
  if (typeof import.meta !== "undefined" && import.meta.url && import.meta.url !== "undefined") {
    return import.meta.url
  }
  const appPath = app.isPackaged ? app.getAppPath() : join(__dirname, "..", "..")
  return `file://${join(appPath, "dist-electron/main/index.js")}`
}

const moduleUrl = getModuleUrl()
const __dirname = dirname(fileURLToPath(moduleUrl))

const APP_ROOT = app.isPackaged ? app.getAppPath() : join(__dirname, "..", "..")
let DIST_DIR: string;

if (app.isPackaged) {
  const unpackedPath = join(app.getAppPath(), "..", "app.asar.unpacked", "dist");
  DIST_DIR = unpackedPath;
} else {
  DIST_DIR = join(APP_ROOT, "dist");
}

let PatchBay: typeof PatchBayType | undefined;
let patchBayInstance: PatchBayType | undefined;
let imported = false;

export function importVenmic(): boolean {
  if (imported) return !!PatchBay;
  imported = true;

  if (process.platform !== "linux") {
    log.info("[Venmic] Skipping venmic import - not Linux")
    return false
  }

  const importPath = join(DIST_DIR, `venmic-${process.arch}.node`);
  log.info(`[Venmic] Attempting to import from: ${importPath}`);

  try {
    const venmic = require(importPath);
    log.info("[Venmic] venmic module:", venmic);
    PatchBay = venmic.PatchBay;
    log.info("[Venmic] PatchBay constructor:", PatchBay);
    return true;
  } catch (e) {
    log.error("[Venmic] Failed to import:", e);
    log.error("[Venmic] Error stack:", (e as Error).stack);
    return false;
  }
}

export function hasVenmic(): boolean {
  return importVenmic();
}

export function hasPipeWire(): boolean {
  importVenmic();
  return PatchBay?.hasPipeWire() ?? false;
}

export function listAudioSources(props?: string[]): Node[] {
  if (!patchBayInstance) {
    if (!importVenmic()) return [];
    try {
      patchBayInstance = new PatchBay();
      log.info("[Venmic] PatchBay instance created");
    } catch (e) {
      log.error("[Venmic] Failed to instantiate PatchBay:", e);
      log.error("[Venmic] Error stack:", (e as Error).stack);
      return [];
    }
  }
  const result = patchBayInstance.list(props) ?? [];
  log.info("[Venmic] Listed", result.length, "sources");
  return result;
}

export function startAudioCapture(include: Node[]): boolean {
  if (!patchBayInstance) {
    if (!importVenmic()) {
      log.error("[Venmic] Cannot start capture - venmic import failed");
      return false;
    }
    try {
      patchBayInstance = new PatchBay();
      log.info("[Venmic] PatchBay instance created for capture");
    } catch (e) {
      log.error("[Venmic] Failed to instantiate PatchBay:", e);
      log.error("[Venmic] Error stack:", (e as Error).stack);
      return false;
    }
  }

  if (!include || include.length === 0) {
    log.error("[Venmic] No sources provided to capture");
    return false;
  }

  const allSources = patchBayInstance.list() ?? [];
  log.info("[Venmic] All sources count:", allSources.length);

  const uniqueAppIds = new Set<string>();
  for (const node of include) {
    const appId = node["application.process.id"] || node["application.name"];
    if (appId) uniqueAppIds.add(appId);
  }
  log.info("[Venmic] Selected apps:", Array.from(uniqueAppIds));

  const appSources: Node[] = [];
  for (const appId of uniqueAppIds) {
    const matching = allSources.filter((node) => {
      const nodeAppId = node["application.process.id"] || node["application.name"];
      return nodeAppId === appId;
    });
    appSources.push(...matching);
  }

  log.info("[Venmic] Total sources to link:", appSources.length);

  if (appSources.length === 0) {
    log.error("[Venmic] No matching sources found for selected apps");
    return false;
  }

  const linkData: LinkData = {
    include: appSources,
    exclude: [{ "media.class": "Stream/Input/Audio" }],
    ignore_devices: true,
    only_speakers: true,
  };

  log.info("[Venmic] Linking with", appSources.length, "sources");
  const result = patchBayInstance.link(linkData);
  log.info("[Venmic] Link result:", result);
  return result;
}

export function stopAudioCapture(): boolean {
  return patchBayInstance?.unlink() ?? false;
}