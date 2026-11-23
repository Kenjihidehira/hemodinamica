# Agenda e configurações hospitalares — versão local

## Escopo implementado

Este protótipo mantém uma agenda local no navegador, separada dos dados do estoque. Os registros são fictícios e ficam no `localStorage` com a chave `hospital-agenda-demo-v1`.

A agenda permite:

- cadastrar pacientes para finalidade administrativa, sem prontuário clínico;
- cadastrar profissionais, especialidades, unidades, salas, dias e duração das consultas;
- consultar horários livres e impedir conflitos de profissional, paciente e sala;
- agendar e reagendar mantendo histórico e referência;
- confirmar, registrar chegada, iniciar e concluir atendimento;
- cancelar com motivo ou registrar ausência;
- gerar notificações internas para os responsáveis configurados;
- personalizar o nome, a cor, o fuso, o expediente e os módulos visíveis;
- simular o fluxo de agendamento fora do expediente pelo WhatsApp.

## Simulação do WhatsApp

O fluxo local representa as etapas que a integração futura deverá executar:

1. identificar paciente, profissional, data e sala;
2. consultar os horários realmente livres;
3. oferecer um horário por até dez minutos;
4. exigir confirmação explícita do paciente;
5. verificar novamente a disponibilidade;
6. registrar a consulta com origem `WhatsApp`;
7. gerar avisos internos para os responsáveis.

A oferta não reserva o horário. Se a recepção utilizar o intervalo antes da confirmação, o agendamento automático é recusado e uma nova consulta de disponibilidade será necessária.

## Limites desta etapa

- Não há conexão com WhatsApp Business ou modelo de IA.
- Nenhuma mensagem externa é enviada.
- Não há banco central, autenticação ou compartilhamento entre dispositivos.
- O aviso `Pendente de integração` é apenas o estado planejado para o envio futuro.
- Dados de abas diferentes usam controle de revisão para evitar sobrescrita silenciosa, mas `localStorage` continua inadequado para produção multiusuário.
- A agenda não contém prontuário, convênios, autorizações, faturamento, internação ou dados clínicos.

## Verificação

Os testes automatizados cobrem conflitos e sobreposições, jornada do profissional, passado, transições do atendimento, cancelamento, reagendamento, responsáveis, validação da base salva, expiração da oferta e revalidação antes da confirmação pelo fluxo simulado.
