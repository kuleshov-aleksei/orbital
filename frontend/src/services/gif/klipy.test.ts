import { describe, expect, it } from "vitest"
import { createKlipyProvider, mapKlipyItem } from "./klipy"

const base = "https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/14/af"

describe("mapKlipyItem", () => {
  it("prefers the small mp4 rendition and a jpg still", () => {
    const gif = mapKlipyItem({
      id: 8041071659142944,
      title: "  Hello   hi ",
      file: {
        md: {
          mp4: { url: `${base}/MCCBoQlZ.mp4`, width: 498, height: 498, size: 119294 },
          gif: { url: `${base}/8GCrVAB7.gif`, width: 498, height: 498, size: 3721260 },
          jpg: { url: `${base}/UsX8Vqtm.jpg`, width: 498, height: 498, size: 20086 },
        },
        sm: {
          webp: { url: `${base}/SE72470w.webp`, width: 220, height: 220, size: 80118 },
          jpg: { url: `${base}/uvntdY4w.jpg`, width: 220, height: 220, size: 8560 },
        },
      },
    })
    expect(gif).toEqual({
      provider: "klipy",
      id: "8041071659142944",
      url: `${base}/MCCBoQlZ.mp4`,
      preview_url: `${base}/uvntdY4w.jpg`,
      width: 498,
      height: 498,
      title: "Hello hi",
      // The grid animates: a small webp, not the full-size gif.
      picker_url: `${base}/SE72470w.webp`,
    })
  })

  it("falls back to a gif when the item has no video or webp", () => {
    const gif = mapKlipyItem({
      id: "abc",
      file: {
        sm: {
          gif: { url: `${base}/x.gif`, width: 220, height: 220, size: 314884 },
          jpg: { url: `${base}/x.jpg`, width: 220, height: 220, size: 8560 },
        },
      },
    })
    expect(gif?.url).toBe(`${base}/x.gif`)
    expect(gif?.preview_url).toBe(`${base}/x.jpg`)
    expect(gif?.picker_url).toBe(`${base}/x.gif`)
  })

  it("drops items without any media", () => {
    expect(mapKlipyItem({ id: "abc", file: {} })).toBeNull()
    expect(mapKlipyItem({ file: {} })).toBeNull()
  })
})

describe("createKlipyProvider", () => {
  it("exposes the KLIPY wordmark for the attribution footer", () => {
    const provider = createKlipyProvider("test-key")
    expect(provider.searchPlaceholder).toBe("Search KLIPY")
    expect(provider.attributionLogo).toBe("/assets/attribution/klipy-logo.svg")
  })
})
