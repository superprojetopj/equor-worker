export const fillPlaceholdersPrompt = `
Você receberá:
- Arquivos de contexto (PDFs, textos, JSONs) com informações relevantes da operação
- Uma instrução específica sobre qual conteúdo gerar para um placeholder

Seu trabalho é gerar o conteúdo que substituirá o placeholder indicado pela instrução.

Regras obrigatórias:
- Para o conteúdo gerado em HTML, siga estritamente o formato TinyMCE:
    - Gere HTML limpo e semântico seguindo rigorosamente estas regras:
        ESTRUTURA PERMITIDA:
        - Parágrafos: <p>
        - Títulos: <h1> a <h6>
        - Listas: <ul>/<ol> com <li>
        - Tabelas: <table> com <thead> e <tbody>
        - Formatação inline: <strong>, <em>, <u>, <s>
        - Quebra de página: <!-- pagebreak -->

        TIPOGRAFIA PADRÃO (aplique em TODOS os elementos de texto):
        - Todo <p> e <li> e <td> e <th>: style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;"
        - Todo <p>: adicione também text-align: justify; line-height: 1.5;
        - Títulos (<h1>–<h6>): mesma fonte, tamanho proporcional, sem alterar a família

        REGRAS DE FORMATAÇÃO:
        1. Todo <p> DEVE ter obrigatoriamente: style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000; text-align: justify; line-height: 1.5;"
        2. NÃO use <br> para separar parágrafos. Use <p> separados.
        3. NÃO use <div> como wrapper de parágrafos.
        4. NÃO use parágrafos numerados manualmente. Use <ol>/<ul>.
        5. Parágrafos de espaçamento: <p>&nbsp;</p>
        6. NÃO adicione estilos além dos definidos nestas regras, salvo exceções abaixo.

        EXCEÇÕES DE ESTILO PERMITIDAS:
        - Alinhamento diferente do padrão: acrescente text-align: center|left|right ao style do <p>
        - Cor de destaque: acrescente color: #hex ao elemento inline (ex: <span style="color: #hex">)
        - Tamanho diferente: acrescente font-size: Xpt somente quando explicitamente necessário

        EXEMPLO CORRETO:
        <h2 style="font-family: Arial, sans-serif; font-size: 14pt; color: #000000;">Título da Seção</h2>
        <p style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000; text-align: justify; line-height: 1.5;">
        Primeiro parágrafo com <strong>texto em negrito</strong> e <em>itálico</em>.
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000; text-align: justify; line-height: 1.5;">
        Segundo parágrafo do documento.
        </p>
        <ul>
        <li style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;">Item de lista</li>
        <li style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;">Outro item</li>
        </ul>
        <table>
        <thead>
            <tr>
            <th style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;">Coluna 1</th>
            <th style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;">Coluna 2</th>
            </tr>
        </thead>
        <tbody>
            <tr>
            <td style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;">Dado 1</td>
            <td style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000;">Dado 2</td>
            </tr>
        </tbody>
        </table>
        BLOCO DE ASSINATURAS (quando solicitado):
        <p style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000; text-align: left; line-height: 1.5;"><strong>EMPRESA ABC LTDA</strong></p>
        <p style="font-family: Arial, sans-serif; font-size: 12pt; color: #000000; text-align: left; line-height: 1.5;">CNPJ 12.345.678/0001-99</p>
        <p style="border-bottom: 1px solid #000000; width: 200px; font-family: Arial, sans-serif; font-size: 12pt; color: #000000; line-height: 1.5;"> </p>
        <p style="font-family: Arial, sans-serif; font-size: 10pt; color: #000000; text-align: left; line-height: 1.5;">Representante Legal</p>

- Use português brasileiro formal, adequado para documentos jurídicos
- Sem explicações, sem comentários, sem markdown — apenas o conteúdo final`
