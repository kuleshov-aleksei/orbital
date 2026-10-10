import type { VenmicApp, VenmicSource } from "@/types"

export async function hasVenmic(): Promise<boolean> {
  if (!window.electronAPI?.venmicHasVenmic) {
    console.log("[VenmicService] venmicHasVenmic not available")
    return false
  }
  console.log("[VenmicService] Calling venmicHasVenmic")
  const result = await window.electronAPI.venmicHasVenmic()
  console.log("[VenmicService] venmicHasVenmic result:", result)
  return result
}

export async function hasPipeWire(): Promise<boolean> {
  if (!window.electronAPI?.venmicHasPipeWire) {
    console.log("[VenmicService] venmicHasPipeWire not available")
    return false
  }
  console.log("[VenmicService] Calling venmicHasPipeWire")
  const result = await window.electronAPI.venmicHasPipeWire()
  console.log("[VenmicService] venmicHasPipeWire result:", result)
  return result
}

export async function listApps(includeAll = false): Promise<VenmicApp[]> {
  if (!window.electronAPI?.venmicListApps) {
    console.log("[VenmicService] venmicListApps not available")
    return []
  }
  console.log("[VenmicService] Calling venmicListApps, includeAll:", includeAll)
  const result = await window.electronAPI.venmicListApps(includeAll)
  console.log("[VenmicService] venmicListApps result:", result)
  return result
}

export async function getSavedSources(): Promise<VenmicSource[]> {
  if (!window.electronAPI?.venmicGetSavedSources) {
    console.log("[VenmicService] venmicGetSavedSources not available")
    return []
  }
  console.log("[VenmicService] Calling venmicGetSavedSources")
  const result = await window.electronAPI.venmicGetSavedSources()
  console.log("[VenmicService] venmicGetSavedSources result:", result)
  return result
}

export async function saveSources(sources: VenmicSource[]): Promise<void> {
  if (!window.electronAPI?.venmicSaveSources) {
    console.log("[VenmicService] venmicSaveSources not available")
    return
  }
  console.log("[VenmicService] Calling venmicSaveSources with:", sources)
  await window.electronAPI.venmicSaveSources(sources)
}

export async function startAudioCapture(include: VenmicSource[]): Promise<boolean> {
  if (!window.electronAPI?.venmicStart) {
    console.log("[VenmicService] venmicStart not available")
    return false
  }
  console.log("[VenmicService] Calling venmicStart with:", include)
  const plainInclude = JSON.parse(JSON.stringify(include))
  console.log("[VenmicService] Plain include:", plainInclude)
  const result = await window.electronAPI.venmicStart(plainInclude)
  console.log("[VenmicService] venmicStart result:", result)
  return result
}

export async function stopAudioCapture(): Promise<boolean> {
  if (!window.electronAPI?.venmicStop) {
    console.log("[VenmicService] venmicStop not available")
    return false
  }
  console.log("[VenmicService] Calling venmicStop")
  const result = await window.electronAPI.venmicStop()
  console.log("[VenmicService] venmicStop result:", result)
  return result
}

const VIRTUAL_MIC_LABEL = "vencord-screen-share"

function findVirtualMic(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  return devices.find((d) => d.kind === "audioinput" && d.label === VIRTUAL_MIC_LABEL)
}

export async function getVirtualMicDeviceId(timeoutMs = 8000): Promise<string | null> {
  console.log(`[VenmicService] Waiting for virtual mic (${timeoutMs}ms)`)
  const deadline = Date.now() + timeoutMs
  let audioDevice: MediaDeviceInfo | undefined

  while (!audioDevice && Date.now() < deadline) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioDevice = findVirtualMic(devices)
    if (!audioDevice) {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  if (!audioDevice) {
    const devices = await navigator.mediaDevices.enumerateDevices()
    console.log(
      "[VenmicService] Virtual mic not found within timeout. All devices:",
      devices.map((d) => ({ label: d.label, kind: d.kind })),
    )
    return null
  }

  console.log("[VenmicService] Found virtual mic:", audioDevice.deviceId)
  return audioDevice.deviceId
}
