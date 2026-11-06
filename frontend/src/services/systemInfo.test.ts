import { describe, expect, it, vi } from "vitest"
import { collectSystemInfo } from "./systemInfo"

const USER_AGENTS: Array<{ expected: string; version: string; ua: string }> = [
  {
    expected: "Edge",
    version: "120.0.0.0",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  },
  {
    expected: "Opera",
    version: "105.0.0.0",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0",
  },
  {
    expected: "Chrome",
    version: "121.0.0.0",
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  },
  {
    expected: "Firefox",
    version: "122.0",
    ua: "Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",
  },
  {
    expected: "Safari",
    version: "17.2",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  },
]

function stubNavigator(userAgent: string): void {
  vi.stubGlobal("navigator", {
    userAgent,
    language: "en-US",
    platform: "Linux x86_64",
  })
}

describe("collectSystemInfo", () => {
  it.each(USER_AGENTS)("detects $expected $version", async ({ expected, version, ua }) => {
    stubNavigator(ua)

    const info = await collectSystemInfo()

    expect(info.browser).toEqual({ name: expected, version })
  })

  it("captures viewport, screen, and language for log reports", async () => {
    stubNavigator(USER_AGENTS[2].ua)

    const info = await collectSystemInfo()

    expect(info.viewport).toEqual({ width: 1280, height: 800, dpr: 1 })
    expect(info.screen).toEqual({ width: 1920, height: 1080, color_depth: 24 })
    expect(info.language).toBe("en-US")
    expect(info.is_electron).toBe(false)
  })
})
