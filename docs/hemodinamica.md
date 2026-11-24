# Hemodinâmica

Área do sistema hospitalar (menu **Hemodinâmica**, endereço `#/hemodinamica`) que acompanha cada procedimento do pedido ao faturamento. Dados fictícios, guardados só no navegador (`hemodinamica-demo-v1`).

## Fluxo do procedimento

| Etapa | O que o sistema exige para avançar |
|---|---|
| Autorização | Só para convênio. Número da guia para aprovar; motivo para negar (negado cancela). |
| Agendamento | Sala, hemodinamicista e horário. Só aparecem horários sem conflito: a sala fica presa durante o procedimento **e** o preparo dela depois; médico e paciente não podem ter dois procedimentos ao mesmo tempo. |
| Preparo | Jejum, exames revisados, alergia a contraste avaliada, conduta com anticoagulantes, consentimento, acesso venoso e os 4 itens do time-out. |
| Sala | Materiais usados saem do lote escolhido e ficam ligados ao paciente (lote vencido não aparece; não sai mais que o saldo; dá para devolver). Via de acesso, início e fim, contraste (obrigatório quando o procedimento usa), fluoroscopia, dose e intercorrências. |
| Recuperação | Hemostasia, sinais estáveis confirmados e destino. |
| Laudo | Achados por vaso, descrição e conclusão. Só o hemodinamicista do procedimento assina; depois de assinado não muda. |
| Faturamento | Fecha a conta e prepara a nota de serviço e uma nota de reposição por fornecedor de consignado. **Notas simuladas: nada é emitido.** |

Cancelamento com motivo é possível até o preparo. Cada ação fica no histórico do caso.

Alertas automáticos (sem IA): alergia a contraste, creatinina ≥ 1,5 mg/dL ou ausente com contraste, anticoagulante, metformina e dose de radiação (abaixo).

## OPME e autorização

- Na etapa Autorização, o pedido de OPME lista os materiais especiais previstos (produtos consignados ou implantáveis) com a justificativa clínica. Sem justificativa, o pedido não é salvo.
- Ao registrar a resposta do convênio, informa-se quanto foi autorizado de cada item (autorização parcial fica registrada).
- Se na sala for usado mais OPME do que o autorizado, a sala, o faturamento e a aba **Convênios e glosas** avisam do risco de glosa.

## Urgência e porta-balão

- O botão **Urgência** abre o caso direto na sala escolhida, com a hora de chegada ao hospital. Não espera autorização nem horário livre.
- Eletivos que estavam marcados naquela sala aparecem para remarcar.
- Na urgência, só o time-out é obrigatório para entrar em sala; o preparo eletivo é opcional.
- Na sala registra-se a abertura da artéria. Porta-balão = chegada → abertura, com meta de 90 min. Enquanto a artéria não abre, a ficha mostra o tempo decorrido.
- Urgência de convênio fica "a regularizar": a guia é registrada depois, o OPME usado passa a ser o autorizado e só então a conta fecha.

## Implantes e dose

- O produto pode ser marcado como **Implantável**, com registro ANVISA (Estoque → Cadastro). Os stents de demonstração já vêm assim, com registros fictícios.
- Implante sai uma unidade por vez, com o número de série da etiqueta. A série não pode repetir.
- A série vai para a saída do Estoque, o laudo, a conta e a prévia da guia.
- **Materiais → Rastrear lote ou série** mostra em quais pacientes um lote ou implante foi usado (para recall).
- Dose: alerta quando o kerma do procedimento ou o acumulado do paciente chega a 5.000 mGy. É uma referência do serviço, ajustável em `SKIN_DOSE_FOLLOWUP_MGY`.

## Faturamento de convênio e glosas

- **Prévia da guia SP/SADT (TISS):** mostra os campos com os dados do caso. O que o hospital ainda não definiu (registro ANS, códigos TUSS) aparece como "a definir", nunca inventado. O XML e o envio ao portal são parte da integração.
- **Glosas:** ao fechar a conta de convênio, ela é marcada como enviada (simulado). As glosas são registradas com item e motivo e seguem Aberta → Em recurso → Revertida ou Aceita. O recurso pode partir de um rascunho do copilot, que usa laudo, OPME e autorização, sem o nome do paciente.

## Acompanhamento de 30 dias

- Ao concluir o procedimento, o contato fica previsto para 30 dias depois.
- A aba **Acompanhamento** lista os contatos pendentes e os atrasados.
- Resultados possíveis: sem eventos, evento adverso, reinternação, óbito ou sem contato. Um evento exige descrição.

## Orientação ao paciente

No preparo eletivo há um texto pronto para enviar ao paciente: data, hora, sala, chegada 60 min antes, documentos, alergias e os remédios que precisam ser confirmados com a equipe. A orientação não diz para suspender nenhum remédio. O envio automático depende de uma integração de mensagens; por enquanto, o texto é copiado.

## Indicadores

São calculados só com o que foi registrado:

- porta-balão (mediana e % dentro da meta);
- procedimentos concluídos e intercorrências;
- percentual de acesso radial e contraste médio;
- eventos em 30 dias;
- glosas por situação;
- fluoroscopia e kerma por hemodinamicista;
- pacientes com dose alta.

A dose pessoal da equipe depende do dosímetro individual, que não está integrado.

## Materiais: um só estoque

Os materiais da hemodinâmica são produtos do **Estoque do hospital**, na especialidade "Hemodinâmica", com lotes no local "Hemodinâmica · Armário de materiais". Aparecem em Estoque, Alertas, Dashboard, Inventário e Leitura de código como qualquer outro produto.

- **Uso em paciente:** registrar um material na sala gera uma **saída** no Estoque, com o motivo "Uso em paciente · paciente · procedimento · caso". O caso guarda a posição (produto + lote + local), e isso permite a rastreabilidade nos dois sentidos.
- **Saldo usado:** só o disponível, pelas regras do Estoque. Reserva, bloqueio, quarentena e lote vencido não podem ir para o paciente.
- **Devolução:** "Devolver" (material registrado por engano) gera uma **entrada** na mesma posição.
- **Reposição de consignado:** gera uma **entrada** do lote novo no mesmo local e baixa a pendência.
- **Consignado:** é marcado no cadastro do produto (Estoque → Cadastro → "Consignado").
- **Gravação conjunta:** caso e estoque são gravados juntos. Se o caso não puder ser salvo, por exemplo porque outra aba mudou os dados, o estoque também não muda.

O catálogo da hemodinâmica é acrescentado ao estoque salvo no navegador uma única vez e só com o que falta. Produtos, saldos e movimentações existentes não são alterados.

## Copilot do médico (IA)

- Resumo pré-procedimento com alertas e o que confirmar antes da sala.
- Rascunho do laudo a partir do registro da sala, materiais e achados; o médico revisa, edita e assina.
- Perguntas livres sobre o caso.
- Rascunho do recurso de glosa (aba Convênios e glosas, ou na ficha do caso encerrado).

Como funciona:

- O navegador chama `/api/copilot`, servida pelo próprio Vite (`server/copilot.ts`), que chama a API da Anthropic (modelo `claude-opus-5-5` por padrão).
- A chave fica só no servidor. Ela não tem prefixo `VITE_`, então nunca vai para o navegador.
- O caso é enviado **sem nome nem contato do paciente**: idade, sexo, peso, exames, alergias, comorbidades, medicamentos e o registro clínico. Se o laudo assinado citar o nome, cada parte do nome é trocada por "[paciente]" antes do envio.

Para ligar:

1. Copie `.env.example` para `.env.local` (o arquivo não vai para o git).
2. Preencha `ANTHROPIC_API_KEY=` com a chave da sua conta Anthropic.
3. Reinicie o `pnpm dev`. Na ficha do procedimento o copilot passa a mostrar "IA ativa".

Sem chave, o resto do sistema funciona normalmente e o copilot mostra como configurar.

A rota só existe em `pnpm dev` e `pnpm preview`. Uma publicação estática (só a pasta `dist`) não tem o copilot. Em produção, a rota vai para o backend, com login, registro de uso e o acordo de tratamento de dados (LGPD) para dados reais de pacientes.

## Integrações

eGestor, SPDATA e Apollo aparecem como **não conectadas**. Cada uma depende de documentação da API, credenciais de homologação e da definição de quais dados cada lado envia e recebe. O papel de cada sistema no hospital ainda precisa ser confirmado com o cliente.
