export interface PromptPlaceholder {
  instruction: string
  fullMatch: string  // entire <span ...>...</span>
  openTag: string    // <span data-variable="{{PROMPT}}" data-prompt="..."> (preserved in output)
}
