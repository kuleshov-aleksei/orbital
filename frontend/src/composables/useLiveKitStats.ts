import type { ConnectionStats, TrackStats } from "@/types"
import type { LiveKitState } from "./useLiveKitState"

const PING_INTERVAL = 3000
const STATS_INTERVAL = 2000

export function useLiveKitStats(
  state: LiveKitState,
  onPingUpdate: (ping: number, quality: "sub-wave" | "excellent" | "good" | "fair" | "poor") => void,
) {
  let pingInterval: ReturnType<typeof setInterval> | null = null
  let statsInterval: ReturnType<typeof setInterval> | null = null

  const calculateBitrate = (
    userId: string,
    trackId: string,
    currentBytes: number,
    currentTime: number,
  ): number => {
    const userPreviousStats = state.previousStats.value.get(userId)
    if (!userPreviousStats) {
      state.previousStats.value.set(
        userId,
        new Map([[trackId, { bytesReceived: currentBytes, timestamp: currentTime }]]),
      )
      return 0
    }

    const trackPreviousStats = userPreviousStats.get(trackId)
    if (!trackPreviousStats) {
      userPreviousStats.set(trackId, {
        bytesReceived: currentBytes,
        timestamp: currentTime,
      })
      return 0
    }

    const deltaBytes = currentBytes - trackPreviousStats.bytesReceived
    const deltaTimeMs = currentTime - trackPreviousStats.timestamp

    userPreviousStats.set(trackId, {
      bytesReceived: currentBytes,
      timestamp: currentTime,
    })

    if (deltaTimeMs <= 0 || deltaBytes < 0) {
      return 0
    }

    return (deltaBytes * 8 * 1000) / deltaTimeMs
  }

  const extractVideoStats = (
    stat: RTCInboundRtpStreamStats,
    trackStats: TrackStats,
  ): TrackStats => {
    const videoStats = { ...trackStats }

    if (stat.frameWidth && stat.frameHeight) {
      videoStats.frameWidth = stat.frameWidth
      videoStats.frameHeight = stat.frameHeight
      videoStats.resolution = `${stat.frameWidth}x${stat.frameHeight}`
    }

    if (stat.framesPerSecond) {
      videoStats.fps = stat.framesPerSecond
    }

    if (stat.framesDecoded !== undefined) {
      videoStats.framesDecoded = stat.framesDecoded
    }
    if (stat.framesDropped !== undefined) {
      videoStats.framesDropped = stat.framesDropped
    }
    if (stat.framesReceived !== undefined) {
      videoStats.framesReceived = stat.framesReceived
    }

    if (stat.codecId) {
      videoStats.codec = stat.codecId
    }

    if (stat.pliCount !== undefined) {
      videoStats.pliCount = stat.pliCount
    }
    if (stat.firCount !== undefined) {
      videoStats.firCount = stat.firCount
    }
    if (stat.nackCount !== undefined) {
      videoStats.nackCount = stat.nackCount
    }

    if (stat.qualityLimitationReason) {
      videoStats.qualityLimitationReason = stat.qualityLimitationReason
    }

    if (stat.decoderImplementation) {
      videoStats.decoderImplementation = stat.decoderImplementation
    }

    return videoStats
  }

  const updateStats = async () => {
    const stats = new Map<string, ConnectionStats>()
    const currentUserId = state.getCurrentUserId()
    const currentTime = Date.now()

    if (state.localAudioPublication.value?.track) {
      try {
        const trackStats = await state.localAudioPublication.value.track.getRTCStatsReport()
        if (trackStats) {
          const senderStats = Array.from(trackStats.values()).find(
            (s: { type: string }) => s.type === "outbound-rtp",
          ) as RTCOutboundRtpStreamStats

          if (senderStats && senderStats.kind === "audio") {
            const bitrate = calculateBitrate(
              currentUserId,
              "local-audio",
              senderStats.bytesSent || 0,
              currentTime,
            )

            const existing = stats.get(currentUserId) || {
              ping: state.currentPing.value || 0,
            }
            stats.set(currentUserId, {
              ...existing,
              audio: {
                jitter: 0,
                packetLoss: 0,
                bitrate,
                bytesReceived: senderStats.bytesSent || 0,
                timestamp: currentTime,
              },
              timestamp: new Date(),
            })
          }
        }
      } catch (error) {
        console.warn("Error getting local stats:", error)
      }
    }

    // Local camera video stats (outbound)
    if (state.localCameraPublication.value?.track) {
      try {
        const trackStats = await state.localCameraPublication.value.track.getRTCStatsReport()
        if (trackStats) {
          const senderStats = Array.from(trackStats.values()).find(
            (s: { type: string }) => s.type === "outbound-rtp",
          ) as RTCOutboundRtpStreamStats

          if (senderStats && senderStats.kind === "video") {
            const bitrate = calculateBitrate(
              currentUserId,
              "local-video",
              senderStats.bytesSent || 0,
              currentTime,
            )

            const existing = stats.get(currentUserId) || {
              ping: state.currentPing.value || 0,
            }
            const trackStatsData: TrackStats = {
              jitter: 0,
              packetLoss: 0,
              bitrate,
              bytesReceived: senderStats.bytesSent || 0,
              timestamp: currentTime,
            }

            if (senderStats.frameWidth && senderStats.frameHeight) {
              trackStatsData.frameWidth = senderStats.frameWidth
              trackStatsData.frameHeight = senderStats.frameHeight
              trackStatsData.resolution = `${senderStats.frameWidth}x${senderStats.frameHeight}`
            }

            if (senderStats.framesPerSecond) {
              trackStatsData.fps = senderStats.framesPerSecond
            }

            stats.set(currentUserId, {
              ...existing,
              localVideo: trackStatsData,
              timestamp: new Date(),
            })
          }
        }
      } catch (error) {
        console.warn("Error getting local camera stats:", error)
      }
    }

    for (const [userId, track] of state.remoteAudioTracks.value) {
      try {
        const trackStats = await track.getRTCStatsReport()
        if (trackStats) {
          const receiverStats = Array.from(trackStats.values()).filter(
            (s: { type: string }) => s.type === "inbound-rtp",
          ) as RTCInboundRtpStreamStats[]

          for (const stat of receiverStats) {
            const kind = stat.kind as "audio" | "video"
            const bitrate = calculateBitrate(
              userId,
              `${kind}-${stat.ssrc || track.sid}`,
              stat.bytesReceived || 0,
              currentTime,
            )

            const existing = stats.get(userId) || { ping: 0 }
            const trackStatsData: TrackStats = {
              jitter: (stat.jitter || 0) * 1000,
              packetLoss: stat.packetsLost
                ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                : 0,
              bitrate,
              bytesReceived: stat.bytesReceived || 0,
              timestamp: currentTime,
            }

            if (kind === "audio") {
              stats.set(userId, {
                ...existing,
                audio: trackStatsData,
                timestamp: new Date(),
              })
            } else if (kind === "video") {
              stats.set(userId, {
                ...existing,
                video: trackStatsData,
                timestamp: new Date(),
              })
            }
          }
        }
      } catch (error) {
        console.warn(`Error getting stats for ${userId}:`, error)
      }
    }

    // Remote camera video stats
    for (const [userId, track] of state.remoteCameraTracks.value) {
      try {
        const trackStats = await track.getRTCStatsReport()
        if (trackStats) {
          const receiverStats = Array.from(trackStats.values()).filter(
            (s: { type: string }) => s.type === "inbound-rtp",
          ) as RTCInboundRtpStreamStats[]

          for (const stat of receiverStats) {
            if (stat.kind === "video") {
              const bitrate = calculateBitrate(
                userId,
                `camera-${stat.ssrc || track.sid}`,
                stat.bytesReceived || 0,
                currentTime,
              )

              const existing = stats.get(userId) || { ping: 0 }
              const trackStatsData: TrackStats = {
                jitter: (stat.jitter || 0) * 1000,
                packetLoss: stat.packetsLost
                  ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                  : 0,
                bitrate,
                bytesReceived: stat.bytesReceived || 0,
                timestamp: currentTime,
              }

              const videoStats = extractVideoStats(stat, trackStatsData)

              if (stat.codecId) {
                const codecStats = Array.from(trackStats.values()).find(
                  (s: { type: string; id?: string }) => s.type === "codec" && s.id === stat.codecId,
                ) as { mimeType?: string } | undefined

                if (codecStats?.mimeType) {
                  const codecMatch = codecStats.mimeType.match(/\/(\w+)$/)
                  if (codecMatch) {
                    videoStats.codec = codecMatch[1]
                  }
                }
              }

              stats.set(userId, {
                ...existing,
                video: videoStats,
                timestamp: new Date(),
              })
            }
          }
        }
      } catch (error) {
        console.warn(`Error getting camera stats for ${userId}:`, error)
      }
    }

    for (const [userId, tracks] of state.remoteScreenTracks.value) {
      // Screen share video stats
      if (tracks.video) {
        try {
          const trackStats = await tracks.video.getRTCStatsReport()
          if (trackStats) {
            const receiverStats = Array.from(trackStats.values()).filter(
              (s: { type: string }) => s.type === "inbound-rtp",
            ) as RTCInboundRtpStreamStats[]

            for (const stat of receiverStats) {
              if (stat.kind === "video") {
                const bitrate = calculateBitrate(
                  userId,
                  `screenshare-${stat.ssrc || tracks.video!.sid}`,
                  stat.bytesReceived || 0,
                  currentTime,
                )

                const existing = stats.get(userId) || { ping: 0 }
                const trackStatsData: TrackStats = {
                  jitter: (stat.jitter || 0) * 1000,
                  packetLoss: stat.packetsLost
                    ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                    : 0,
                  bitrate,
                  bytesReceived: stat.bytesReceived || 0,
                  timestamp: currentTime,
                }

                const videoStats = extractVideoStats(stat, trackStatsData)

                if (stat.codecId) {
                  const codecStats = Array.from(trackStats.values()).find(
                    (s: { type: string; id?: string }) =>
                      s.type === "codec" && s.id === stat.codecId,
                  ) as { mimeType?: string } | undefined

                  if (codecStats?.mimeType) {
                    const codecMatch = codecStats.mimeType.match(/\/(\w+)$/)
                    if (codecMatch) {
                      videoStats.codec = codecMatch[1]
                    }
                  }
                }

                stats.set(userId, {
                  ...existing,
                  screenShare: videoStats,
                  timestamp: new Date(),
                })
              }
            }
          }
        } catch (error) {
          console.warn(`Error getting screen share video stats for ${userId}:`, error)
        }
      }

      // Screen share audio stats
      if (tracks.audio) {
        try {
          const trackStats = await tracks.audio.getRTCStatsReport()
          if (trackStats) {
            const receiverStats = Array.from(trackStats.values()).filter(
              (s: { type: string }) => s.type === "inbound-rtp",
            ) as RTCInboundRtpStreamStats[]

            for (const stat of receiverStats) {
              if (stat.kind === "audio") {
                const bitrate = calculateBitrate(
                  userId,
                  `screenshare-audio-${stat.ssrc || tracks.audio!.sid}`,
                  stat.bytesReceived || 0,
                  currentTime,
                )

                const existing = stats.get(userId) || { ping: 0 }
                const trackStatsData: TrackStats = {
                  jitter: (stat.jitter || 0) * 1000,
                  packetLoss: stat.packetsLost
                    ? (stat.packetsLost / (stat.packetsReceived || 1)) * 100
                    : 0,
                  bitrate,
                  bytesReceived: stat.bytesReceived || 0,
                  timestamp: currentTime,
                }

                if (stat.codecId) {
                  const codecStats = Array.from(trackStats.values()).find(
                    (s: { type: string; id?: string }) =>
                      s.type === "codec" && s.id === stat.codecId,
                  ) as { mimeType?: string } | undefined

                  if (codecStats?.mimeType) {
                    const codecMatch = codecStats.mimeType.match(/\/(\w+)$/)
                    if (codecMatch) {
                      trackStatsData.codec = codecMatch[1]
                    }
                  }
                }

                stats.set(userId, {
                  ...existing,
                  screenShareAudio: trackStatsData,
                  timestamp: new Date(),
                })
              }
            }
          }
        } catch (error) {
          console.warn(`Error getting screen share audio stats for ${userId}:`, error)
        }
      }
    }

    state.participantStats.value = stats
  }

  const startStatsPolling = () => {
    if (statsInterval) clearInterval(statsInterval)
    void updateStats()
    statsInterval = setInterval(() => {
      void updateStats()
    }, STATS_INTERVAL)
  }

  const stopStatsPolling = () => {
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }
    state.previousStats.value.clear()
  }

  const startPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
    }

    pingInterval = setInterval(() => {
      state.currentPing.value = state.room.value?.localParticipant.engine.client.rtt ?? 0

      let quality: "sub-wave" | "excellent" | "good" | "fair" | "poor" = "excellent"
      if (state.currentPing.value < 0) {
        quality = "sub-wave"
      } else if (state.currentPing.value < 30) {
        quality = "excellent"
      } else if (state.currentPing.value < 60) {
        quality = "good"
      } else if (state.currentPing.value < 100) {
        quality = "fair"
      } else {
        quality = "poor"
      }

      onPingUpdate(state.currentPing.value, quality)
    }, PING_INTERVAL)
  }

  const stopPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  const getParticipantStats = (userId: string): ConnectionStats => {
    return (
      state.participantStats.value.get(userId) || {
        ping: 0,
      }
    )
  }

  return {
    startPingInterval,
    stopPingInterval,
    startStatsPolling,
    stopStatsPolling,
    getParticipantStats,
  }
}
