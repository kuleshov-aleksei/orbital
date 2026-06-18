import { ref, onUnmounted, type Ref } from "vue"
import type {
  Room,
  LocalTrackPublication,
  RemoteAudioTrack,
  RemoteVideoTrack,
  RTCInboundRtpStreamStats,
} from "livekit-client"
import type { PerPairObservation, ClientStatsBatch, ConnectionStats, TrackStats } from "@/types"
import { wsService } from "@/services/websocket"
import { gzipSync } from "fflate"

const PING_INTERVAL = 3000
const STATS_INTERVAL = 2000
const MAX_OBSERVATIONS_PER_USER = 30

export interface StatsCollectorOptions {
  room: Ref<Room | null>
  localAudioPublication: Ref<LocalTrackPublication | null>
  localCameraPublication: Ref<LocalTrackPublication | null>
  remoteAudioTracks: Ref<Map<string, RemoteAudioTrack>>
  remoteCameraTracks: Ref<Map<string, RemoteVideoTrack>>
  remoteScreenTracks: Ref<Map<string, { video?: RemoteVideoTrack; audio?: RemoteAudioTrack }>>
  roomId: string
  getCurrentUserId: () => string
  onPingUpdate: (ping: number, quality: "sub-wave" | "excellent" | "good" | "fair" | "poor") => void
}

export function useStatsCollector(options: StatsCollectorOptions) {
  let pingInterval: ReturnType<typeof setInterval> | null = null
  let statsInterval: ReturnType<typeof setInterval> | null = null
  let reportInterval: ReturnType<typeof setInterval> | null = null
  let remoteRoomId = ""

  const currentPing = ref(0)
  const participantStats = ref<Map<string, ConnectionStats>>(new Map())
  const previousStats = ref<Map<string, Map<string, { bytesReceived: number; timestamp: number }>>>(
    new Map(),
  )
  const observationBuffer = ref<Map<string, PerPairObservation[]>>(new Map())

  const calculateBitrate = (
    userKey: string,
    trackKey: string,
    currentBytes: number,
    currentTime: number,
  ): number => {
    const userPrev = previousStats.value.get(userKey)
    if (!userPrev) {
      previousStats.value.set(
        userKey,
        new Map([[trackKey, { bytesReceived: currentBytes, timestamp: currentTime }]]),
      )
      return 0
    }

    const trackPrev = userPrev.get(trackKey)
    if (!trackPrev) {
      userPrev.set(trackKey, { bytesReceived: currentBytes, timestamp: currentTime })
      return 0
    }

    const deltaBytes = currentBytes - trackPrev.bytesReceived
    const deltaTimeMs = currentTime - trackPrev.timestamp

    userPrev.set(trackKey, { bytesReceived: currentBytes, timestamp: currentTime })

    if (deltaTimeMs <= 0 || deltaBytes < 0) return 0
    return (deltaBytes * 8 * 1000) / deltaTimeMs
  }

  const pushObservation = (observedUserId: string, obs: PerPairObservation) => {
    const arr = observationBuffer.value.get(observedUserId) || []
    arr.push(obs)
    if (arr.length > MAX_OBSERVATIONS_PER_USER) {
      arr.splice(0, arr.length - MAX_OBSERVATIONS_PER_USER)
    }
    observationBuffer.value.set(observedUserId, arr)
  }

  const updateStats = async () => {
    const currentTime = Date.now()
    const stats = new Map<string, ConnectionStats>()

    // Remote audio tracks (mic)
    for (const [userId, track] of options.remoteAudioTracks.value) {
      try {
        const trackStats = await track.getRTCStatsReport()
        if (!trackStats) continue

        const receiverStats = Array.from(trackStats.values()).filter(
          (s) => s.type === "inbound-rtp",
        ) as RTCInboundRtpStreamStats[]

        for (const stat of receiverStats) {
          if (stat.kind !== "audio") continue

          const bitrate = calculateBitrate(
            userId,
            `mic-${stat.ssrc || track.sid}`,
            stat.bytesReceived || 0,
            currentTime,
          )

          const existing = stats.get(userId) || { ping: 0 }

          let codec: string | undefined
          if (stat.codecId) {
            const codecStats = Array.from(trackStats.values()).find(
              (s) => s.type === "codec" && s.id === stat.codecId,
            ) as { mimeType?: string } | undefined
            if (codecStats?.mimeType) {
              const match = codecStats.mimeType.match(/\/(\w+)$/)
              if (match) codec = match[1]
            }
          }

          const obs: PerPairObservation = {
            track_type: "mic",
            jitter: (stat.jitter || 0) * 1000,
            packet_loss: stat.packetsLost
              ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
              : 0,
            bitrate,
            codec,
            timestamp: currentTime,
          }
          pushObservation(userId, obs)

          const trackStatsData: TrackStats = {
            jitter: obs.jitter,
            packetLoss: obs.packet_loss,
            bitrate: obs.bitrate,
            bytesReceived: stat.bytesReceived || 0,
            timestamp: currentTime,
            codec: obs.codec,
          }

          stats.set(userId, {
            ...existing,
            audio: trackStatsData,
            timestamp: new Date(),
          })
        }
      } catch {
        // ignore per-track errors
      }
    }

    // Remote camera video tracks (webcam)
    for (const [userId, track] of options.remoteCameraTracks.value) {
      try {
        const trackStats = await track.getRTCStatsReport()
        if (!trackStats) continue

        const receiverStats = Array.from(trackStats.values()).filter(
          (s) => s.type === "inbound-rtp",
        ) as RTCInboundRtpStreamStats[]

        for (const stat of receiverStats) {
          if (stat.kind !== "video") continue

          const bitrate = calculateBitrate(
            userId,
            `webcam-${stat.ssrc || track.sid}`,
            stat.bytesReceived || 0,
            currentTime,
          )

          const existing = stats.get(userId) || { ping: 0 }

          let codec: string | undefined
          let resolution: string | undefined
          let fps: number | undefined

          if (stat.codecId) {
            const codecStats = Array.from(trackStats.values()).find(
              (s) => s.type === "codec" && s.id === stat.codecId,
            ) as { mimeType?: string } | undefined
            if (codecStats?.mimeType) {
              const match = codecStats.mimeType.match(/\/(\w+)$/)
              if (match) codec = match[1]
            }
          }
          if (stat.frameWidth && stat.frameHeight) {
            resolution = `${stat.frameWidth}x${stat.frameHeight}`
          }
          if (stat.framesPerSecond) {
            fps = stat.framesPerSecond
          }

          const obs: PerPairObservation = {
            track_type: "webcam",
            jitter: (stat.jitter || 0) * 1000,
            packet_loss: stat.packetsLost
              ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
              : 0,
            bitrate,
            codec,
            resolution,
            fps,
            timestamp: currentTime,
          }
          pushObservation(userId, obs)

          const trackStatsData: TrackStats = {
            jitter: obs.jitter,
            packetLoss: obs.packet_loss,
            bitrate: obs.bitrate,
            bytesReceived: stat.bytesReceived || 0,
            timestamp: currentTime,
            codec: obs.codec,
            resolution: obs.resolution,
            fps: obs.fps,
          }

          stats.set(userId, {
            ...existing,
            video: trackStatsData,
            timestamp: new Date(),
          })
        }
      } catch {
        // ignore
      }
    }

    // Remote screen share tracks
    for (const [userId, tracks] of options.remoteScreenTracks.value) {
      // Screen share video
      if (tracks.video) {
        try {
          const trackStats = await tracks.video.getRTCStatsReport()
          if (trackStats) {
            const receiverStats = Array.from(trackStats.values()).filter(
              (s) => s.type === "inbound-rtp",
            ) as RTCInboundRtpStreamStats[]

            for (const stat of receiverStats) {
              if (stat.kind !== "video") continue

              const bitrate = calculateBitrate(
                userId,
                `screenshare-${stat.ssrc || tracks.video!.sid}`,
                stat.bytesReceived || 0,
                currentTime,
              )

              const existing = stats.get(userId) || { ping: 0 }

              let codec: string | undefined
              let resolution: string | undefined
              let fps: number | undefined

              if (stat.codecId) {
                const codecStats = Array.from(trackStats.values()).find(
                  (s) => s.type === "codec" && s.id === stat.codecId,
                ) as { mimeType?: string } | undefined
                if (codecStats?.mimeType) {
                  const match = codecStats.mimeType.match(/\/(\w+)$/)
                  if (match) codec = match[1]
                }
              }
              if (stat.frameWidth && stat.frameHeight) {
                resolution = `${stat.frameWidth}x${stat.frameHeight}`
              }
              if (stat.framesPerSecond) {
                fps = stat.framesPerSecond
              }

              const obs: PerPairObservation = {
                track_type: "screen_share",
                jitter: (stat.jitter || 0) * 1000,
                packet_loss: stat.packetsLost
                  ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                  : 0,
                bitrate,
                codec,
                resolution,
                fps,
                timestamp: currentTime,
              }
              pushObservation(userId, obs)

              const trackStatsData: TrackStats = {
                jitter: obs.jitter,
                packetLoss: obs.packet_loss,
                bitrate: obs.bitrate,
                bytesReceived: stat.bytesReceived || 0,
                timestamp: currentTime,
                codec: obs.codec,
                resolution: obs.resolution,
                fps: obs.fps,
              }

              stats.set(userId, {
                ...existing,
                screenShare: trackStatsData,
                timestamp: new Date(),
              })
            }
          }
        } catch {
          // ignore
        }
      }

      // Screen share audio
      if (tracks.audio) {
        try {
          const trackStats = await tracks.audio.getRTCStatsReport()
          if (trackStats) {
            const receiverStats = Array.from(trackStats.values()).filter(
              (s) => s.type === "inbound-rtp",
            ) as RTCInboundRtpStreamStats[]

            for (const stat of receiverStats) {
              if (stat.kind !== "audio") continue

              const bitrate = calculateBitrate(
                userId,
                `screenshare-audio-${stat.ssrc || tracks.audio!.sid}`,
                stat.bytesReceived || 0,
                currentTime,
              )

              const existing = stats.get(userId) || { ping: 0 }

              let codec: string | undefined
              if (stat.codecId) {
                const codecStats = Array.from(trackStats.values()).find(
                  (s) => s.type === "codec" && s.id === stat.codecId,
                ) as { mimeType?: string } | undefined
                if (codecStats?.mimeType) {
                  const match = codecStats.mimeType.match(/\/(\w+)$/)
                  if (match) codec = match[1]
                }
              }

              const obs: PerPairObservation = {
                track_type: "screen_share_audio",
                jitter: (stat.jitter || 0) * 1000,
                packet_loss: stat.packetsLost
                  ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                  : 0,
                bitrate,
                codec,
                timestamp: currentTime,
              }
              pushObservation(userId, obs)

              const trackStatsData: TrackStats = {
                jitter: obs.jitter,
                packetLoss: obs.packet_loss,
                bitrate: obs.bitrate,
                bytesReceived: stat.bytesReceived || 0,
                timestamp: currentTime,
                codec: obs.codec,
              }

              stats.set(userId, {
                ...existing,
                screenShareAudio: trackStatsData,
                timestamp: new Date(),
              })
            }
          }
        } catch {
          // ignore
        }
      }
    }

    participantStats.value = stats
  }

  const sendBatchReport = () => {
    const currentUserId = options.getCurrentUserId()
    const room = options.room.value
    if (!room || !remoteRoomId || !currentUserId) return

    const buf = observationBuffer.value
    if (buf.size === 0) return

    const batch: ClientStatsBatch = {
      room_id: remoteRoomId,
      reporter_id: currentUserId,
      timestamp: Date.now(),
      rtt: currentPing.value,
      observations: {},
    }

    for (const [observedUserId, observations] of buf.entries()) {
      batch.observations[observedUserId] = observations
    }

    buf.clear()

    try {
      const json = JSON.stringify(batch)
      const encoded = new TextEncoder().encode(json)
      const compressed = gzipSync(encoded, { level: 6 })
      const b64 = btoa(String.fromCharCode(...compressed))
      wsService.sendMessage("client_stats_batch", b64)
    } catch (err) {
      console.error("[Stats] Failed to compress/send batch:", err)
    }
  }

  const startCollecting = () => {
    stopCollecting()
    void updateStats()
    statsInterval = setInterval(() => {
      void updateStats()
    }, STATS_INTERVAL)
  }

  const stopCollecting = () => {
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }
    previousStats.value.clear()
  }

  const startPingInterval = () => {
    if (pingInterval) clearInterval(pingInterval)

    pingInterval = setInterval(() => {
      const rtt = options.room.value?.localParticipant.engine.client.rtt ?? 0
      currentPing.value = rtt

      let quality: "sub-wave" | "excellent" | "good" | "fair" | "poor"
      if (rtt < 0) quality = "sub-wave"
      else if (rtt < 30) quality = "excellent"
      else if (rtt < 60) quality = "good"
      else if (rtt < 100) quality = "fair"
      else quality = "poor"

      options.onPingUpdate(rtt, quality)
    }, PING_INTERVAL)
  }

  const stopPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  const startBatchReporting = (roomId: string, intervalMs: number) => {
    stopBatchReporting()
    remoteRoomId = roomId
    sendBatchReport()
    reportInterval = setInterval(sendBatchReport, intervalMs)
  }

  const stopBatchReporting = () => {
    if (reportInterval) {
      clearInterval(reportInterval)
      reportInterval = null
    }
    remoteRoomId = ""
  }

  const getParticipantStats = (userId: string): ConnectionStats => {
    return participantStats.value.get(userId) || { ping: 0 }
  }

  // Self-register WebSocket handlers for admin control
  const handleEnableStats = (message: { data: { room_id: string; interval_ms?: number } }) => {
    if (message.data.room_id === options.roomId) {
      startBatchReporting(message.data.room_id, message.data.interval_ms || 15000)
    }
  }

  const handleDisableStats = (message: { data: { room_id: string } }) => {
    if (message.data.room_id === options.roomId) {
      stopBatchReporting()
    }
  }

  wsService.on("enable_stats_collection", handleEnableStats)
  wsService.on("disable_stats_collection", handleDisableStats)

  onUnmounted(() => {
    stopCollecting()
    stopPingInterval()
    stopBatchReporting()
  })

  return {
    startCollecting,
    stopCollecting,
    startPingInterval,
    stopPingInterval,
    startBatchReporting,
    stopBatchReporting,
    getParticipantStats,
  }
}
