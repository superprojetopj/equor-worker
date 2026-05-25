import { fillPlaceholdersPrompt } from './fill-placeholders.prompt.js'
import { systemPrompt } from './system.prompt.js'

export const aiGenerateSystemInstruction = [systemPrompt, fillPlaceholdersPrompt].join('\n\n---\n\n')
