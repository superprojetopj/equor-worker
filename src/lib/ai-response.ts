export function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:\w+)?\n?([\s\S]*?)```\s*$/s, '$1').trim()
}
