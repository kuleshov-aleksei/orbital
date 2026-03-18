import type { LinkData, Node, PatchBay as PatchBayType } from "@vencord/venmic";

let PatchBay: typeof PatchBayType | undefined;
let patchBayInstance: PatchBayType | undefined;
let imported = false;

export function importVenmic(): boolean {
  if (imported) return !!PatchBay;
  imported = true;

  try {
    console.log("[Venmic] Attempting to import...");
    const venmic = require("@vencord/venmic");
    console.log("[Venmic] venmic module:", venmic);
    PatchBay = venmic.PatchBay;
    console.log("[Venmic] PatchBay constructor:", PatchBay);
    return true;
  } catch (e) {
    console.error("[Venmic] Failed to import:", e);
    console.error("[Venmic] Error stack:", (e as Error).stack);
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
      console.log("[Venmic] PatchBay instance created");
    } catch (e) {
      console.error("[Venmic] Failed to instantiate PatchBay:", e);
      console.error("[Venmic] Error stack:", (e as Error).stack);
      return [];
    }
  }
  const result = patchBayInstance.list(props) ?? [];
  console.log("[Venmic] Listed", result.length, "sources");
  return result;
}

export function startAudioCapture(include: Node[]): boolean {
  if (!patchBayInstance) {
    if (!importVenmic()) {
      console.error("[Venmic] Cannot start capture - venmic import failed");
      return false;
    }
    try {
      patchBayInstance = new PatchBay();
      console.log("[Venmic] PatchBay instance created for capture");
    } catch (e) {
      console.error("[Venmic] Failed to instantiate PatchBay:", e);
      console.error("[Venmic] Error stack:", (e as Error).stack);
      return false;
    }
  }

  if (!include || include.length === 0) {
    console.error("[Venmic] No sources provided to capture");
    return false;
  }

  const selectedAppId = include[0]["application.process.id"] || include[0]["application.name"];
  console.log("[Venmic] Selected app ID:", selectedAppId);

  const allSources = patchBayInstance.list() ?? [];
  console.log("[Venmic] All sources count:", allSources.length);

  const appSources = allSources.filter((node) => {
    const nodeAppId = node["application.process.id"] || node["application.name"];
    return nodeAppId === selectedAppId;
  });

  console.log("[Venmic] Found", appSources.length, "sources for app:", selectedAppId);

  if (appSources.length === 0) {
    console.error("[Venmic] No matching sources found for app");
    return false;
  }

  const linkData: LinkData = {
    include: appSources,
    exclude: [{ "media.class": "Stream/Input/Audio" }],
    ignore_devices: true,
    only_speakers: true,
  };

  console.log("[Venmic] Linking with", appSources.length, "sources");
  const result = patchBayInstance.link(linkData);
  console.log("[Venmic] Link result:", result);
  return result;
}

export function stopAudioCapture(): boolean {
  return patchBayInstance?.unlink() ?? false;
}
