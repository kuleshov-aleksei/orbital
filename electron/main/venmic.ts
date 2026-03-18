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
  console.log("[Venmic] Listed sources:", JSON.stringify(result, null, 2));
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

  console.log("[Venmic] Starting audio capture with include:", JSON.stringify(include, null, 2));

  const data: LinkData = {
    include,
    exclude: [{ "media.class": "Stream/Input/Audio" }],
    ignore_devices: true,
    only_speakers: true,
  };

  const result = patchBayInstance.link(data);
  console.log("[Venmic] Link result:", result);
  return result;
}

export function stopAudioCapture(): boolean {
  return patchBayInstance?.unlink() ?? false;
}
