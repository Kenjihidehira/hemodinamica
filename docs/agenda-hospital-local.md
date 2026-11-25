# Agenda e configurações hospitalares — versão local

## Escopo implementado

Este protótipo mantém uma agenda local no navegador, separada dos dados do estoque. Os registros são fictícios e ficam no `localStorage` com a chave `hospital-agenda-demo-v1`.

Esta versão contém **somente o sistema** (agenda, perfis, configurações e estoque). A integração com um bot de atendimento ficou fora deste protótipo.

A agenda permite:

- cadastrar pacientes para finalidade administrativa, sem prontuário clínico;
- cadastrar profissionais, especialidades, unidades, salas, dias e grade de atendimento;
- consultar horários livres e impedir conflitos de profissional, paciente e sala;
- agendar e reagendar mantendo histórico e referência;
- confirmar, registrar chegada, iniciar e concluir atendimento;
- cancelar com motivo ou registrar ausência;
- gerar notificações internas para os responsáveis configurados;
- personalizar o nome, a cor, o fuso, o expediente e os módulos visíveis.

## Critérios de ocupação dos profissionais

Os critérios de ocupação são **tipos de consulta** e **encaixes**, configurados por profissional.

**Tipos de consulta** (ex.: Primeira consulta, Retorno, Pós-operatório):

- **Duração própria.** A consulta ocupa a duração do tipo; o campo "duração" do profissional passa a ser o passo da grade.
- **Limite por dia** (opcional). Conta só consultas ativas e normais; cancelamentos e faltas liberam a vaga, e encaixes não entram nessa conta.
- **Prazo de retorno** (opcional). Exige consulta concluída com o mesmo profissional nos últimos N dias.

**Encaixes:**

- O profissional aceita ou não encaixes, com limite diário e lista de tipos aceitos (vazia = todos).
- O encaixe **nunca fica sobreposto** a outra consulta. Ele só entra em intervalo realmente livre, fora dos horários da grade normal, e depois de marcado bloqueia esses horários.
- **Só a recepção marca encaixe**, sempre com motivo.
- Um **pedido de encaixe** (lista de espera) não reserva horário: avisa os responsáveis e aguarda a recepção aprovar (escolhendo horário e sala) ou recusar (com motivo).

A função `occupancyCriteria` resume, por profissional e dia, as vagas por tipo e os encaixes restantes.

Agendas salvas antes dessas regras continuam abrindo: um profissional sem tipos cadastrados atende uma "Consulta" com a duração da grade, e encaixes ficam desativados.

## Limites desta etapa

- Não há bot de atendimento, conexão com WhatsApp Business ou modelo de IA.
- Nenhuma mensagem externa é enviada. O status `Pendente de integração` nos avisos aos responsáveis é apenas o estado planejado para um envio futuro.
- Não há banco central, autenticação ou compartilhamento entre dispositivos.
- Dados de abas diferentes usam controle de revisão para evitar sobrescrita silenciosa, mas `localStorage` continua inadequado para produção multiusuário.
- A agenda não contém prontuário, convênios, autorizações, faturamento, internação ou dados clínicos.

## Verificação

Os testes automatizados cobrem:

- conflitos e sobreposições, jornada do profissional, passado, transições do atendimento, cancelamento, reagendamento, responsáveis e validação da base salva;
- tipos de consulta (duração, limite diário, prazo de retorno);
- encaixes (intervalo livre, tipos aceitos, limite diário, pedidos e aprovação);
- o resumo de ocupação e a abertura de agendas salvas antes dessas regras.
