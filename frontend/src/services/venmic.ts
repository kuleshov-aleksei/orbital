import type { VenmicNode } from "@/types"
import { debugLog } from "@/utils/debug"

export interface AudioSource {
  name: string
  value: VenmicNode
}

export async function hasVenmic(): Promise<boolean> {
  if (!window.electronAPI?.venmicHasVenmic) {
    debugLog("[VenmicService] venmicHasVenmic not available")
    return false
  }
  debugLog("[VenmicService] Calling venmicHasVenmic")
  const result = await window.electronAPI.venmicHasVenmic()
  debugLog("[VenmicService] venmicHasVenmic result:", result)
  return result
}

export async function hasPipeWire(): Promise<boolean> {
  if (!window.electronAPI?.venmicHasPipeWire) {
    debugLog("[VenmicService] venmicHasPipeWire not available")
    return false
  }
  debugLog("[VenmicService] Calling venmicHasPipeWire")
  const result = await window.electronAPI.venmicHasPipeWire()
  debugLog("[VenmicService] venmicHasPipeWire result:", result)
  return result
}

export async function listAudioSources(): Promise<VenmicNode[]> {
  if (!window.electronAPI?.venmicListSources) {
    debugLog("[VenmicService] venmicListSources not available")
    return []
  }
  debugLog("[VenmicService] Calling venmicListSources")
  const result = await window.electronAPI.venmicListSources()
  debugLog("[VenmicService] venmicListSources result:", result)
  return result
}

export async function startAudioCapture(include: VenmicNode[]): Promise<boolean> {
  if (!window.electronAPI?.venmicStart) {
    debugLog("[VenmicService] venmicStart not available")
    return false
  }
  debugLog("[VenmicService] Calling venmicStart with:", include)
  const plainInclude = JSON.parse(JSON.stringify(include))
  debugLog("[VenmicService] Plain include:", plainInclude)
  const result = await window.electronAPI.venmicStart(plainInclude)
  debugLog("[VenmicService] venmicStart result:", result)
  return result
}

export async function stopAudioCapture(): Promise<boolean> {
  if (!window.electronAPI?.venmicStop) {
    debugLog("[VenmicService] venmicStop not available")
    return false
  }
  debugLog("[VenmicService] Calling venmicStop")
  const result = await window.electronAPI.venmicStop()
  debugLog("[VenmicService] venmicStop result:", result)
  return result
}

export async function getVirtualMicDeviceId(): Promise<string | null> {
  debugLog("[VenmicService] Enumerating devices to find virtual mic")
  const devices = await navigator.mediaDevices.enumerateDevices()
  debugLog(
    "[VenmicService] All devices:",
    devices.map((d) => ({ label: d.label, kind: d.kind })),
  )
  const audioDevice = devices.find(({ label }) => label === "vencord-screen-share")
  debugLog("[VenmicService] Found virtual mic:", audioDevice?.deviceId)
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

export async function listAudioSourcesDeduplicated(): Promise<AudioSource[]> {
  const nodes = await listAudioSources()

  const seen = new Set<string>()
  const unique: AudioSource[] = []

  for (const node of nodes) {
    const pid = node["application.process.id"] as string
    if (pid && !seen.has(pid)) {
      seen.add(pid)
      unique.push({
        name: formatAudioSourceName(node),
        value: node,
      })
    }
  }

  return unique
}
