# Roteiro de descoberta e validação na Jusimed

O objetivo é entender o processo existente antes de propor substituição ou integração. Nenhuma resposta abaixo foi presumida.

## Perguntas para estoque e operação

1. Qual evento inicia uma entrada, uma saída, uma transferência e uma devolução?
2. O que o bipador lê: código do produto, lote, número de série, validade ou outra estrutura?
3. A planilha contém apenas saldos ou também histórico de cada movimentação?
4. Quem pode alterar saldos? Como são corrigidos erros e contadas divergências?
5. Há estoque em hospitais, consignação, reservas para cirurgia ou kits?
6. Quais são os locais físicos e como são identificados?
7. Quais relatórios a gestão e a qualidade precisam hoje e não conseguem gerar?
8. Qual é a conectividade real no depósito e nos pontos de uso?

## Evidências a solicitar

- Uma exportação ou cópia **sem dados pessoais e comerciais sensíveis** da estrutura da planilha.
- Fotos de etiquetas de teste ou amostras sem informação sensível.
- Exemplos de relatórios atuais e campos exigidos.
- Uma demonstração presencial de uma entrada, uma saída e uma contagem.
- Modelo de celular e leitor usado pela equipe.

## Critério de decisão após a descoberta

| Achado | Direção provável |
| --- | --- |
| A planilha exporta dados consistentes e o fluxo operacional funciona | Integrar ou importar dados e priorizar análise/alertas |
| Há saldos, mas não histórico confiável | Começar a registrar movimentações; não inventar histórico retroativo |
| O leitor fornece apenas código de produto | Exigir confirmação de lote, validade e quantidade no formulário |
| Conexão instável | Projetar sincronização e resolução de conflito antes de permitir escrita offline |

Fechar o piloto com critérios mensuráveis, responsáveis, duração, dispositivo de teste e procedimento de reconciliação com o estoque oficial.
