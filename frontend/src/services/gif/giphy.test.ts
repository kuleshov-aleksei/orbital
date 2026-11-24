import { describe, expect, it } from "vitest"
import { mapGiphyItem } from "./giphy"

describe("mapGiphyItem", () => {
  it("prefers the downsized mp4 and a still frame", () => {
    const gif = mapGiphyItem({
      id: "3o7aD2saalBwwftBIY",
      title: "Excited",
      images: {
        downsized: {
          url: "https://media.giphy.com/media/x/giphy.gif",
          mp4: "https://media.giphy.com/media/x/giphy.mp4",
          width: "480",
          height: "270",
        },
        fixed_width_small: {
          url: "https://media.giphy.com/media/x/giphy_small.gif",
          webp: "https://media.giphy.com/media/x/giphy_small.webp",
          width: "100",
          height: "56",
        },
        fixed_width_still: { url: "https://media.giphy.com/media/x/giphy_s.gif" },
      },
    })
    expect(gif).toEqual({
      provider: "giphy",
      id: "3o7aD2saalBwwftBIY",
      url: "https://media.giphy.com/media/x/giphy.mp4",
      preview_url: "https://media.giphy.com/media/x/giphy_s.gif",
      width: 480,
      height: 270,
      title: "Excited",
      picker_url: "https://media.giphy.com/media/x/giphy_small.webp",
    })
  })

  it("uses the gif when there is no mp4", () => {
    const gif = mapGiphyItem({
      id: "abc",
      images: {
        original: {
          url: "https://i.giphy.com/x.gif",
          width: "200",
          height: "100",
        },
      },
    })
    expect(gif?.url).toBe("https://i.giphy.com/x.gif")
    // No small rendition: the grid falls back to the still (or the gif).
    expect(gif?.picker_url).toBe("https://i.giphy.com/x.gif")
  })

  it("drops items without an id or media", () => {
    expect(mapGiphyItem({ images: {} })).toBeNull()
    expect(mapGiphyItem({ id: "abc", images: {} })).toBeNull()
  })
})
