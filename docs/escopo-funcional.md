# Escopo funcional do protótipo

## Usuários e tarefas

| Perfil proposto | Tarefa principal | Situação no protótipo |
| --- | --- | --- |
| Operador de estoque | Consultar e registrar movimentações | Simulado, sem login |
| Gestor | Ver alertas, saldo e histórico | Simulado |
| Qualidade | Conferir rastreabilidade e critérios de bloqueio | Apenas demonstrativo; regras reais pendentes |

## Dados demonstrados

- Produto: nome, código interno único, categoria, mínimo global, fabricante e fornecedor.
- Posição de estoque: produto, lote, localização, validade, quantidade física, reservado, bloqueado e quarentena. Disponível é calculado.
- Movimentação: tipo, produto, lote, quantidade, origem/destino, data e responsável fictício.
- Contagem: posição, revisão do saldo, esperado, contado, motivo, situação e data de revisão simulada.
- Transferência: quantidade em trânsito, origem, destino, validade e confirmação de recebimento.
- Registro local das alterações de cadastro, situações, transferências e contagens.
- Pedido: referência única, hospital, procedimento/finalidade, data necessária, unidade, responsável informado e itens solicitados. Reserva vincula pedido, item, posição e quantidade conferida.
- Dashboard: contexto da base, saldo e distribuição atuais, exposição a vencimento, saídas registradas, tendência de seis meses, cobertura dos registros e prioridades demonstrativas. As fórmulas e limites estão em [analytics.md](analytics.md).

O código lido **não é presumido como portador de lote ou validade**. No exemplo, ele encontra um produto ou lote cadastrado; a estrutura real das etiquetas precisa ser examinada.

## Regras implementadas

1. Entrada soma ao saldo da posição selecionada. Cadastro inicial pode ter saldo zero.
2. Reservado + bloqueado + quarentena nunca pode exceder o físico. Mudanças exigem motivo.
3. Disponível = físico menos essas três situações; para vencidos, disponível é sempre zero. Saída e transferência só utilizam disponível.
4. Transferência retira da origem e mantém saldo em trânsito. Recebimento confirmado uma única vez credita o destino em quarentena. A liberação é uma alteração separada e justificada.
5. Produto + lote deve ter validade consistente; produto + lote + local não pode ser duplicado.
6. Excel/CSV passa por prévia e validação completa. Uma linha inválida impede todo o lote de importação; posições existentes não são somadas novamente.
7. Contagem física não altera saldo até a revisão simulada. Divergência exige justificativa. Há somente uma contagem pendente por posição.
8. Se saldo ou situações mudam após a contagem, sua aplicação é bloqueada. Também não se aplica contagem menor que o total comprometido.
9. Validade em até 30 dias e disponível global abaixo do mínimo alimentam alertas. Bloqueio e quarentena aparecem na operação.
10. Os dados são gravados em `localStorage`. A migração da versão anterior preserva saldos e acrescenta as novas estruturas. Há aviso caso a gravação falhe.
11. Reserva de pedido compromete apenas disponível da unidade e lotes válidos hoje e na data necessária. A seleção por validade pode produzir reserva parcial e não usa reservas internas existentes.
12. O total reservado inclui reservas internas e de pedidos. Alteração manual não pode reduzi-lo abaixo das reservas vinculadas.
13. Conferência exige código interno, lote correto e quantidade dentro da reserva. Complementar uma reserva já conferida exige nova conferência daquele lote.
14. Expedição exige todos os itens reservados e conferidos; revalida lotes, baixa físico e reservas e registra saídas por lote. Pedido expedido não pode ser expedido ou cancelado novamente.
15. Cancelamento de pedido aberto exige motivo e libera somente suas reservas. Nenhum pedido é apagado.

Essas regras servem para demonstração e **não substituem** procedimentos aprovados pela empresa. Pedidos identificam hospital e finalidade sem dados de pacientes. Não há consignação, controle de consumo hospitalar, entrega comprovada, devolução formal, recall, número de série, múltiplas unidades de medida, controle por perfil, aprovação por outro usuário ou trilha de auditoria imutável. A quarentena é uma situação controlada manualmente, sem gestão documental de qualidade. Veja o [guia operacional](operacao-v2.md) e o [fluxo de pedidos](pedidos-expedicao.md).

## Critérios para uma primeira versão operacional

- Fontes de dados e identificadores de produto/lote definidos.
- Regras de entrada, saída, transferência, devolução e ajuste documentadas.
- Permissões por papel e unidade aprovadas.
- Validação no servidor de saldo, validade, bloqueio e isolamento dos dados.
- Histórico auditável com autoria, data, motivo e rastreabilidade de correções.
- Plano de importação, reconciliação e recuperação de dados testado.
- Testes com etiquetas, câmeras e bipadores reais no ambiente de trabalho.
