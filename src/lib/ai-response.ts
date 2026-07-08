export function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:\w+)?\n?([\s\S]*?)```\s*$/s, '$1').trim()
}

export function parsePromptResults(text: string): Map<string, string> {
  const results = new Map<string, string>()
  const blockRegex = /<prompt_result\s+id="([^"]+)"\s*>([\s\S]*?)<\/prompt_result>/g

  // Empty blocks are kept: a conditional prompt can legitimately resolve to
  // empty content ("caso não exista, retorne vazio"). Only an ABSENT block
  // means the model failed to answer that prompt.
  for (const match of stripMarkdownFences(text).matchAll(blockRegex)) {
    results.set(match[1], match[2].trim())
  }

  return results
}
