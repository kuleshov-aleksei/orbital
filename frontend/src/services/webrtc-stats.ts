import { BandwidthStats } from '../types'

export interface ConnectionStats {
  packetsLost: number
  packetsReceived: number
  packetsSent: number
  bytesReceived: number
  bytesSent: number
  jitter: number
  roundTripTime: number
  bandwidth: BandwidthStats
  audioLevel: number
  connectionState: string
  timestamp: Date
}

export interface StatsHistory {
  peerId: string
  stats: ConnectionStats[]
  maxHistorySize: number
}

export class WebRTCStatsCollector {
  private statsHistory: Map<string, StatsHistory> = new Map()
  private outgoingIceCandidates: Map<string, Array<RTCIceCandidate>> = new Map();
  private collectionIntervals: Map<string, number> = new Map()
  private readonly COLLECTION_INTERVAL = 1000 // 1 second
  private readonly MAX_HISTORY_SIZE = 300 // 5 minutes at 1 second intervals

  async collectStats(peerConnection: RTCPeerConnection): Promise<ConnectionStats> {
    try {
      const stats = await peerConnection.getStats()
      
      let packetsLost = 0
      let packetsReceived = 0
      let packetsSent = 0
      let bytesReceived = 0
      let bytesSent = 0
      let jitter = 0
      let roundTripTime = 0
      let uploadBandwidth = 0
      const downloadBandwidth = 0
      let audioLevel = 0
      const connectionState = peerConnection.connectionState

      stats.forEach(report => {
        switch (report.type) {
          case 'inbound-rtp':
            if (report.mediaType === 'audio') {
              packetsLost = report.packetsLost || 0
              packetsReceived = report.packetsReceived || 0
              bytesReceived = report.bytesReceived || 0
              jitter = report.jitter || 0
              audioLevel = (report.audioLevel || 0) * 127 // Convert to 0-127 range
            }
            break
            
          case 'outbound-rtp':
            if (report.mediaType === 'audio') {
              packetsSent = report.packetsSent || 0
              bytesSent = report.bytesSent || 0
              // Calculate bandwidth from bitrate if available
              if (report.bitrate) {
                uploadBandwidth = report.bitrate / 1000 // Convert to kbps
              }
            }
            break
            
          case 'remote-inbound-rtp':
            if (report.mediaType === 'audio') {
              roundTripTime = report.roundTripTime || 0
            }
            break
            
          case 'transport':
            // Additional transport stats can be collected here
            break
        }
      })

      return {
        packetsLost,
        packetsReceived,
        packetsSent,
        bytesReceived,
        bytesSent,
        jitter,
        roundTripTime,
        bandwidth: {
          upload: uploadBandwidth,
          download: downloadBandwidth
        },
        audioLevel,
        connectionState,
        timestamp: new Date()
      }
    } catch (error) {
      console.error('Error collecting WebRTC stats:', error)
      return {
        packetsLost: 0,
        packetsReceived: 0,
        packetsSent: 0,
        bytesReceived: 0,
        bytesSent: 0,
        jitter: 0,
        roundTripTime: 0,
        bandwidth: { upload: 0, download: 0 },
        audioLevel: 0,
        connectionState: peerConnection.connectionState,
        timestamp: new Date()
      }
    }
  }

  startCollection(peerId: string, peerConnection: RTCPeerConnection): void {
    // Stop existing collection if running
    this.stopCollection(peerId)

    // Initialize history if not exists
    if (!this.statsHistory.has(peerId)) {
      this.statsHistory.set(peerId, {
        peerId,
        stats: [],
        maxHistorySize: this.MAX_HISTORY_SIZE
      })
    }

    // Start periodic collection
    const interval = setInterval(async () => {
      try {
        const stats = await this.collectStats(peerConnection)
        const history = this.statsHistory.get(peerId)
        
        if (history) {
          history.stats.push(stats)
          
          // Trim history if it exceeds max size
          if (history.stats.length > history.maxHistorySize) {
            history.stats.shift()
          }
        }
      } catch (error) {
        console.error(`Error collecting stats for peer ${peerId}:`, error)
      }
    }, this.COLLECTION_INTERVAL)

    this.collectionIntervals.set(peerId, interval)
  }

  stopCollection(peerId: string): void {
    const interval = this.collectionIntervals.get(peerId)
    if (interval) {
      clearInterval(interval)
      this.collectionIntervals.delete(peerId)
    }
  }

  getLatestStats(peerId: string): ConnectionStats | null {
    const history = this.statsHistory.get(peerId)
    return history && history.stats.length > 0 
      ? history.stats[history.stats.length - 1] 
      : null
  }

  getStatsHistory(peerId: string): ConnectionStats[] {
    const history = this.statsHistory.get(peerId)
    return history ? [...history.stats] : []
  }

  getAggregatedStats(peerId: string, timeWindowSeconds: number = 60): ConnectionStats | null {
    const history = this.statsHistory.get(peerId)
    if (!history || history.stats.length === 0) {
      return null
    }

    const now = new Date()
    const timeWindowMs = timeWindowSeconds * 1000
    const recentStats = history.stats.filter(
      stat => now.getTime() - stat.timestamp.getTime() <= timeWindowMs
    )

    if (recentStats.length === 0) {
      return null
    }

    // Calculate averages
    const avgStats: ConnectionStats = {
      packetsLost: Math.max(...recentStats.map(s => s.packetsLost)), // Use max for packet loss
      jitter: recentStats.reduce((sum, s) => sum + s.jitter, 0) / recentStats.length,
      roundTripTime: recentStats.reduce((sum, s) => sum + s.roundTripTime, 0) / recentStats.length,
      bandwidth: {
        upload: recentStats.reduce((sum, s) => sum + s.bandwidth.upload, 0) / recentStats.length,
        download: recentStats.reduce((sum, s) => sum + s.bandwidth.download, 0) / recentStats.length
      },
      audioLevel: recentStats.reduce((sum, s) => sum + s.audioLevel, 0) / recentStats.length,
      connectionState: recentStats[recentStats.length - 1].connectionState, // Use latest state
      timestamp: new Date()
    }

    return avgStats
  }

  getAllPeerStats(): Map<string, ConnectionStats> {
    const allStats = new Map<string, ConnectionStats>()
    
    this.statsHistory.forEach((history, peerId) => {
      const latest = this.getLatestStats(peerId)
      if (latest) {
        allStats.set(peerId, latest)
      }
    })

    return allStats
  }

  getAllOutgoingIceCandidates(): Map<string, Array<RTCIceCandidate>> {
    return this.outgoingIceCandidates
  }

  saveOutgoingIceCandidate(peerId: string, iceCandidateData: RTCIceCandidate) {
    let candidates = this.outgoingIceCandidates.get(peerId);
    if (candidates === undefined) {
      candidates = new Array<RTCIceCandidate>();
      this.outgoingIceCandidates.set(peerId, candidates);
    }

    candidates.push(iceCandidateData);
  }

  clearHistory(peerId: string): void {
    const history = this.statsHistory.get(peerId)
    if (history) {
      history.stats = []
    }
  }

  clearAllHistory(): void {
    this.statsHistory.forEach(history => {
      history.stats = []
    })
  }

  getCollectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>()
    this.collectionIntervals.forEach((_, peerId) => {
      status.set(peerId, true)
    })
    return status
  }

  // Utility method to check connection quality
  getConnectionQuality(peerId: string): {
    quality: 'excellent' | 'good' | 'fair' | 'poor'
    score: number
    issues: string[]
  } {
    const stats = this.getLatestStats(peerId)
    if (!stats) {
      return { quality: 'poor', score: 0, issues: ['No connection established'] }
    }

    // Check if connection is actually established
    if (stats.connectionState !== 'connected') {
      return { 
        quality: 'poor', 
        score: 0, 
        issues: [`Connection not established (state: ${stats.connectionState})`] 
      }
    }

    const issues: string[] = []
    let score = 100

    // Packet loss assessment
    if (stats.packetsLost > 10) {
      issues.push('High packet loss')
      score -= 30
    } else if (stats.packetsLost > 5) {
      issues.push('Moderate packet loss')
      score -= 15
    }

    // Jitter assessment
    if (stats.jitter > 100) {
      issues.push('High jitter')
      score -= 25
    } else if (stats.jitter > 50) {
      issues.push('Moderate jitter')
      score -= 10
    }

    // RTT assessment
    if (stats.roundTripTime > 300) {
      issues.push('High latency')
      score -= 20
    } else if (stats.roundTripTime > 150) {
      issues.push('Moderate latency')
      score -= 10
    }

    // Connection state assessment
    if (stats.connectionState !== 'connected') {
      issues.push('Connection not stable')
      score -= 40
    }

    let quality: 'excellent' | 'good' | 'fair' | 'poor'
    if (score >= 85) quality = 'excellent'
    else if (score >= 70) quality = 'good'
    else if (score >= 50) quality = 'fair'
    else quality = 'poor'

    return { quality, score, issues }
  }

  // Cleanup method to stop all collections
  cleanup(): void {
    this.collectionIntervals.forEach((interval) => {
      clearInterval(interval)
    })
    this.collectionIntervals.clear()
    this.statsHistory.clear()
  }
}

// Singleton instance
export const webRTCStatsCollector = new WebRTCStatsCollector()