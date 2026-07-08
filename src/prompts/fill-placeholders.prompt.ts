import { htmlFormatRules, securityPolicyPrompt } from './html-format.prompt.js'

export const fillPlaceholdersPrompt = `
##FORMATO DE SAÍDA — LEIA PRIMEIRO
Retorne APENAS HTML puro. NUNCA use blocos markdown (\`\`\`).
NUNCA escreva \`\`\`html. Sua resposta começa com uma tag HTML e termina com uma tag HTML.

${securityPolicyPrompt}

---

Você receberá:
- Arquivos de contexto (PDFs, textos, JSON) com informações relevantes do processo
- Uma instrução específica sobre qual conteúdo gerar para um placeholder ou trecho de texto a ser substituído.

Seu trabalho é gerar o conteúdo que substituirá o placeholder indicado pela instrução.

Regras obrigatórias:
${htmlFormatRules}
- Sem explicações, sem comentários, sem markdown — apenas o conteúdo final
- NÃO envolva a resposta em blocos de código markdown — devolva só o HTML puro, sem prefixo nem sufixo
- SAÍDA: Retorne APENAS o HTML puro. Sem \`\`\` antes ou depois. Sem a palavra "html". Sem nenhum caractere além do HTML solicitado.
`
