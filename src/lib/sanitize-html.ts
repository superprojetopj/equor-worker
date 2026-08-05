import DOMPurify from 'isomorphic-dompurify'

// Strict allowlist mirroring the TinyMCE tags the templates use. The LLM output
// is untrusted: anything outside this list (script/style/iframe/object/embed/
// form, event handlers, javascript: URLs) is stripped before the HTML is
// reported to the backend and persisted.
//
// This list also gates what reaches the PDF renderer, so it has to cover
// everything TinyMCE persists — a tag missing here is silently dropped from the
// signed document. Keep it in sync with the frontend's RICH_TAGS/RICH_ATTRS
// (src/components/ui/shared/helpers/sanitizeHtml.ts).
const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'sub',
  'sup',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  // colgroup/col carry the column widths of TinyMCE tables
  'colgroup',
  'col',
  'img',
  'figure',
  'figcaption',
]

const ALLOWED_ATTR = [
  'class',
  'style',
  'dir',
  'title',
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'width',
  'height',
  'colspan',
  'rowspan',
  'scope',
  // Table/list presentation attributes TinyMCE still emits
  'span',
  'border',
  'cellpadding',
  'cellspacing',
  'align',
  'valign',
  'start',
]

// img src: https: or data: only. a href: https: / http: / relative / fragment.
// javascript: and other schemes are stripped.
const SAFE_IMG_SRC = /^(?:https:|data:image\/)/i
const SAFE_HREF = /^(?:https?:\/\/|#|\/|mailto:)/i

// DOMPurify does not inspect style attribute values. TinyMCE's valid_styles has
// no image property, so url() is never legitimate formatting here — and it
// would fetch a remote resource when the document renders.
const CSS_URL = /url\s*\(/i

let hooksInstalled = false

function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // isomorphic-dompurify runs under jsdom — avoid relying on a global Element.
    const el = node as {
      hasAttribute?: (name: string) => boolean
      getAttribute?: (name: string) => string | null
      removeAttribute?: (name: string) => void
      setAttribute?: (name: string, value: string) => void
    }
    if (typeof el.hasAttribute !== 'function' || typeof el.getAttribute !== 'function') return

    if (el.hasAttribute('href')) {
      const href = el.getAttribute('href') ?? ''
      if (!SAFE_HREF.test(href) || /^javascript:/i.test(href)) {
        el.removeAttribute?.('href')
      }
    }

    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src') ?? ''
      if (!SAFE_IMG_SRC.test(src)) {
        el.removeAttribute?.('src')
      }
    }

    if (el.hasAttribute('style')) {
      const style = el.getAttribute('style') ?? ''
      if (CSS_URL.test(style)) {
        const cleaned = style
          .split(';')
          .filter((decl) => !CSS_URL.test(decl))
          .join(';')
        if (cleaned.trim() === '') {
          el.removeAttribute?.('style')
        } else {
          el.setAttribute?.('style', cleaned)
        }
      }
    }
  })
}

export function sanitizeGeneratedHtml(html: string): string {
  installHooks()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    ALLOW_DATA_ATTR: false,
  })
}
