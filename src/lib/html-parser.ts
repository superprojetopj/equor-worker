import type { PromptPlaceholder } from '../types/index.js'

function isPromptSpan(attrs: string): boolean {
  return /data-variable=["']\{\{PROMPT\}\}["']/i.test(attrs)
}

function extractDataPrompt(attrs: string): string | null {
  const m = /data-prompt=["']([^"']*)["']/i.exec(attrs)
  return m ? m[1].trim() : null
}

/**
 * Finds all <span> elements that are PROMPT variables, regardless of attribute order.
 * A PROMPT span must have data-variable="{{PROMPT}}" and data-prompt="<instruction>".
 */
export function extractPromptPlaceholders(html: string): PromptPlaceholder[] {
  const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gis
  const placeholders: PromptPlaceholder[] = []
  let match: RegExpExecArray | null

  while ((match = spanRegex.exec(html)) !== null) {
    const attrs = match[1]
    if (!isPromptSpan(attrs)) continue

    const instruction = extractDataPrompt(attrs)
    if (!instruction) continue

    placeholders.push({
      instruction,
      fullMatch: match[0],
      openTag: `<span${attrs}>`,
    })
  }

  return placeholders
}

/**
 * Replaces only the inner content of the span, preserving all attributes.
 * Before: <span data-variable="{{PROMPT}}" data-prompt="...">old content</span>
 * After:  <span data-variable="{{PROMPT}}" data-prompt="...">AI content</span>
 */
export function replacePlaceholder(
  html: string,
  placeholder: PromptPlaceholder,
  content: string
): string {
  return html.replace(placeholder.fullMatch, `${placeholder.openTag}${content}</span>`)
}

/**
 * Replaces all regular variable spans with values from the provided map.
 * Matches: <span data-variable="{{varName}}">...</span>
 * Skips PROMPT variables (handled separately by Claude).
 * Leaves unmatched variables as-is.
 */
export function replaceVariables(html: string, variables: Record<string, unknown>): string {
  const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gis
  return html.replace(spanRegex, (fullMatch, attrs: string) => {
    const varMatch = /data-variable=["']\{\{([^}]+)\}\}["']/i.exec(attrs)
    if (!varMatch) return fullMatch

    const key = varMatch[1]
    if (key === 'PROMPT') return fullMatch

    const value = variables[key]
    if (value === undefined || value === null) return fullMatch

    return `<span${attrs}>${String(value)}</span>`
  })
}
