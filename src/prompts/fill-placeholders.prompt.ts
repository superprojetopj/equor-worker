import { htmlFormatRules, securityPolicyPrompt } from './html-format.prompt.js'

export const fillPlaceholdersPrompt = `
## FORMATO DE SAÍDA — LEIA PRIMEIRO
Retorne APENAS HTML puro. NUNCA use blocos markdown (\`\`\`), NUNCA escreva \`\`\`html, sem explicações, sem comentários, sem prefixo nem sufixo. Sua resposta começa com uma tag HTML e termina com uma tag HTML.

Exceção única: se a instrução for condicional e o resultado for "nada a gerar" (ex.: "caso o benefício não exista, não escreva nada"), retorne resposta VAZIA — nenhum caractere.

${securityPolicyPrompt}

---

Você receberá:
- Arquivos de contexto (PDFs, textos, JSON) com informações relevantes do processo
- Metadados estruturados na tag <metadata>
- Uma instrução específica na tag <instruction>, indicando qual conteúdo gerar para um placeholder ou trecho de texto a ser substituído

Seu trabalho é gerar SOMENTE o conteúdo que substituirá o placeholder indicado pela instrução.

${htmlFormatRules}
`
