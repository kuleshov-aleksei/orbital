import { marked } from "marked"
import DOMPurify from "dompurify"

marked.setOptions({
  gfm: true,
  breaks: true,
})

const URL_REGEX = /((https?:\/\/)[^\s<>\])\"']+)/g
const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\((https?:\/\/[^)]*)\)/g

export function renderMarkdown(content: string): string {
  const noLinks = content.replace(MARKDOWN_LINK_REGEX, (_, __, url) => url)
  const withLinks = noLinks.replace(URL_REGEX, (_, url) => `[${url}](${url})`)
  const html = marked.parse(withLinks, { breaks: true }) as string

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
      "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "strong", "sub",
      "sup", "ul", "table", "thead", "tbody", "tr", "th", "td",
    ],
    ALLOWED_ATTR: ["href", "target", "rel"],
    FORCE_BODY: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_DATA_URI: false,
  })
}