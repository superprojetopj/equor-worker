/** Escapes a value for safe interpolation into a double-quoted XML attribute. */
export function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
}

/** Escapes XML special characters in element text / marker content. */
export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
