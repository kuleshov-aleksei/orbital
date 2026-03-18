import type { VenmicNode } from "@/types"

export interface AudioSource {
  name: string
  value: VenmicNode
}

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

export async function listAudioSources(): Promise<VenmicNode[]> {
  if (!window.electronAPI?.venmicListSources) {
    console.log("[VenmicService] venmicListSources not available")
    return []
  }
  console.log("[VenmicService] Calling venmicListSources")
  const result = await window.electronAPI.venmicListSources()
  console.log("[VenmicService] venmicListSources result:", result)
  return result
}

export async function startAudioCapture(include: VenmicNode[]): Promise<boolean> {
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

export async function getVirtualMicDeviceId(): Promise<string | null> {
  console.log("[VenmicService] Enumerating devices to find virtual mic")
  const devices = await navigator.mediaDevices.enumerateDevices()
  console.log("[VenmicService] All devices:", devices.map(d => ({ label: d.label, kind: d.kind })))
  const audioDevice = devices.find(({ label }) => label === "vencord-screen-share")
  console.log("[VenmicService] Found virtual mic:", audioDevice?.deviceId)
  return audioDevice?.deviceId ?? null
}

export function formatAudioSourceName(node: VenmicNode): string {
  const appName = node["application.name"] as string
  const pid = node["application.process.id"] as string
  const nodeName = node["node.name"] as string

  if (appName) {
    return pid ? `${appName} (${pid})` : appName
  }

  return nodeName || "Unknown"
}
