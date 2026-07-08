import { htmlFormatRules, securityPolicyPrompt } from './html-format.prompt.js'

export const composeDocumentPrompt = `
## FORMATO DE SAÍDA — LEIA PRIMEIRO

Você vai gerar o conteúdo de VÁRIOS trechos de um mesmo documento em uma única resposta.
Retorne um bloco <prompt_result> para CADA prompt recebido, exatamente neste formato:

<prompt_result id="{PROMPT_exemplo}">
<p style="...">conteúdo HTML do trecho</p>
</prompt_result>

- O atributo id deve ser copiado EXATAMENTE do id do prompt correspondente.
- Gere um bloco para TODOS os prompts recebidos, sem exceção, na mesma ordem.
- NUNCA omita um bloco — a ausência de um bloco é tratada como FALHA de geração e dispara reprocessamento. Quando um prompt condicional resultar em nada (ex.: "caso o benefício não exista, retorne vazio"), retorne o bloco VAZIO: <prompt_result id="{PROMPT_x}"></prompt_result>. Quando os dados existirem mas estiverem incompletos, redija o texto com as variáveis \`{{NOME_DA_VARIAVEL}}\` destacadas conforme as regras do sistema.
- Não escreva NADA fora dos blocos <prompt_result>: sem introduções, explicações, comentários ou blocos markdown (\`\`\`).
- Dentro de cada bloco: apenas HTML puro.

${securityPolicyPrompt}

---

Você receberá:
- Arquivos de contexto (PDFs, textos, JSON) com informações relevantes do processo
- Metadados estruturados na tag <metadata>
- O ESQUELETO do documento na tag <document_skeleton>: versão simplificada em texto do documento completo, com marcadores [[{PROMPT_x}]] indicando o ponto exato onde cada trecho gerado será inserido
- A lista de prompts na tag <prompts>, cada um com seu id, sua instrução e opcionalmente o atributo "tamanho"

## COMO USAR O ESQUELETO

O documento final JÁ EXISTE — as partes fixas estão prontas e NÃO serão alteradas. Seu trabalho é APENAS gerar o conteúdo que substituirá cada marcador [[{PROMPT_x}]].

1. **Dimensione pelo contexto**: leia o texto ao redor de cada marcador. O conteúdo gerado deve caber naturalmente naquele ponto do documento. Se o marcador está dentro de uma cláusula ou entre parágrafos fixos, gere um ou poucos parágrafos — NUNCA uma seção inteira nem um documento completo.
2. **Padrão de tamanho**: na ausência de indicação contrária, gere o MENOR conteúdo que cumpra a instrução — tipicamente um parágrafo. Só ultrapasse isso quando a instrução do prompt pedir explicitamente (ex: "gere a cláusula completa com subcláusulas").
3. **Atributo tamanho**: quando o prompt tiver o atributo "tamanho" (ex: tamanho="um parágrafo"), essa indicação é OBRIGATÓRIA e prevalece sobre qualquer outra inferência.
4. **Não duplique o que é fixo**: títulos, cláusulas e textos que já existem no esqueleto NÃO devem ser repetidos no conteúdo gerado. Ex: se o esqueleto já traz o título "CLÁUSULA PRIMEIRA — DO OBJETO" antes do marcador, gere apenas o corpo da cláusula, sem repetir o título.
5. **Coerência entre trechos**: todos os trechos serão inseridos no mesmo documento. Não repita informações entre eles, não se contradiga, e mantenha gênero, número e terminologia consistentes com o texto fixo do esqueleto.
6. **EXCEÇÃO — documento inteiro**: quando a instrução indicar que o template não possui texto fixo relevante e os prompts constituem o DOCUMENTO INTEIRO, as regras 1 e 2 NÃO se aplicam — gere o conteúdo completo que cada prompt pede (com título, qualificação, cláusulas numeradas e fecho, quando for o caso), mantendo as regras 3, 4 e 5.

## REGRAS DE FORMATAÇÃO DO HTML (aplicam-se ao conteúdo de cada bloco)
${htmlFormatRules}
`
