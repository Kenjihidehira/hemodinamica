# Dashboard — definições e limites

O Dashboard é a **tela inicial** do protótipo. Foi desenhado para responder onde a gestão precisa agir, usando apenas campos presentes nos dados fictícios. O filtro por unidade afeta indicadores, prioridades, trânsito e contagens relacionados à unidade. As unidades são derivadas do trecho da localização anterior a `·`. A comparação entre unidades permanece consolidada. O filtro de período afeta somente movimentações e volumes de entrada/saída; saldos e pendências são atuais, e a tendência mantém sua janela de seis meses.

| Indicador | Cálculo no protótipo | Decisão apoiada |
| --- | --- | --- |
| Disponível para saída | Físico menos reservado, bloqueado e quarentena; posições vencidas contribuem zero | Identificar quantidade que pode sair pelas regras demonstrativas |
| Saldo físico | Soma das quantidades nas posições, incluindo comprometidos e vencidos, exibida abaixo do disponível | Dimensionar presença física; não inclui trânsito |
| Reservado / bloqueado / quarentena | Soma de cada situação nas posições filtradas | Identificar restrições quantitativas; vencimento pode se sobrepor a essas situações |
| Em trânsito | Quantidades de transferências ainda não recebidas; no filtro de unidade, inclui origem ou destino correspondente | Acompanhar recebimentos pendentes; não somar os totais por unidade pois uma transferência pode aparecer nas duas |
| Contagens divergentes | Contagens pendentes cujo contado difere do esperado | Abrir a conferência; não é uma taxa de acuracidade |
| Exposição a vencimento | Quantidade de unidades em lotes que vencem entre hoje e 30 dias | Priorizar análise pela operação e qualidade |
| Abaixo do mínimo | Produtos cujo disponível global é inferior ao mínimo demonstrativo | Revisar reposição; sem cálculo por unidade, pois não há mínimo local |
| Saídas no período | Soma das saídas registradas no período e unidade filtrados | Acompanhar o volume registrado; não equivale à demanda total |
| Unidades vencidas | Soma do saldo positivo em lotes com validade anterior a hoje | Identificar necessidade de bloqueio e análise pela área responsável |
| Movimentações no período | Contagem de entradas, saídas, transferências, recebimentos e ajustes | Abrir histórico; despacho e recebimento são eventos separados |
| Composição por especialidade | Soma do saldo atual por categoria dos produtos | Entender concentração de unidades |
| Distribuição por unidade | Soma do físico atual nas unidades cadastradas | Comparar presença física, incluindo situações indisponíveis |
| Decisões prioritárias | Lotes vencidos ou até 30 dias do vencimento, depois produtos abaixo do mínimo | Direcionar análise e ações, sem automatizar decisões comerciais ou sanitárias |

**Métricas ainda indisponíveis:** valor financeiro do estoque, capital imobilizado e perdas financeiras (faltam custos); giro e cobertura (faltam série histórica completa e demanda); nível de serviço (pedidos locais já existem, mas faltam critérios aprovados e histórico de atendimento/entrega); taxa de acuracidade (faltam campanha, amostra e fórmula aprovadas, embora contagens e divergências já existam). O painel não estima esses valores.

## Atendimento de pedidos

Indicadores atuais, filtrados pela unidade de origem do pedido, independentes do período de movimentações. Cada indicador abre a lista de pedidos com situação e unidade correspondentes.

| Indicador | Regra |
| --- | --- |
| Pedidos em aberto | Pedidos que não foram expedidos nem cancelados |
| Reserva incompleta | Pedidos abertos com quantidade solicitada ainda não reservada em ao menos um item |
| Prazo em até 3 dias · com pendência | Pedidos abertos com data necessária até hoje + 3 dias, incluindo atrasados, que ainda não estão prontos para expedir |
| Prontos para expedir | Pedido aberto com reserva e conferência completas e lotes ainda válidos |

Expedição de pedido gera saída por lote. Esses volumes entram em Saídas no período; representam saída do estoque, não comprovação de entrega, consumo hospitalar ou faturamento. O total reservado no dashboard inclui as reservas internas e as vinculadas a pedidos, sem somar duas vezes.

O desenho do dashboard segue a estrutura do Patrimônio Ops: contexto da base, KPIs que abrem uma tela de detalhe, atenção da gestão, tendência e cobertura dos registros. As seis métricas e os painéis abaixo foram adaptados para produto e lote. A tendência de seis meses mostra apenas os eventos fictícios registrados; meses vazios não significam ausência real de operação.

A cobertura dos registros verifica **presença** de lote, validade e localização nas posições da amostra. Todos estão preenchidos no conjunto fictício inicial. Isso não valida a veracidade dos campos nem substitui conciliação física.

As movimentações fictícias iniciais são uma amostra parcial e não reconstituem o saldo de abertura. Por isso, entradas menos saídas **não** são apresentadas como reconciliação do saldo atual.

## Validação para uma versão real

1. Aprovar fórmula, janela de tempo e responsável por cada indicador.
2. Definir os mínimos por produto e por local, se aplicável.
3. Identificar custo, demanda, reservas, consignação e histórico completo.
4. Conferir os resultados do painel com relatórios oficiais antes de usá-los em decisões.
