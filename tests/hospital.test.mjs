import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHospitalData, parseHospitalData, bookAppointment, bookingProblem, availableSlots, changeAppointmentStatus, rescheduleAppointment, savePatient, saveProfessional, saveHospitalConfig, addHospitalResource, saveResponsible, readNotification, consultationTypes, fitInProblem, fitInSlots, bookFitIn, requestFitIn, approveFitIn, rejectFitIn, occupancyCriteria } from '../src/hospital/domain.ts';

const now = new Date('2026-11-23T23:00:00Z'); // Segunda, 20h em São Paulo.
const base = () => makeHospitalData(now);
const booking = (extra = {}) => ({ patientId: 'pat-2', professionalId: 'pro-1', roomId: 'room-1', date: '2026-11-24', time: '10:00', ...extra });

test('agenda: grava consulta, histórico e aviso para cada responsável, sem envio externo', () => {
  let data = saveResponsible(base(), { id: 'staff-2', name: 'Gestão', phone: '+5544999999999', whatsappOptIn: true });
  data = saveHospitalConfig(data, { ...data.config, responsibleIds: ['staff-1', 'staff-2'] });
  const next = bookAppointment(data, booking(), 'Recepção', now);
  assert.equal(next.appointments.length, 2);
  assert.equal(data.appointments.length, 1);
  assert.equal(next.notifications.length, 2);
  assert.deepEqual(new Set(next.notifications.map(n => n.whatsapp)), new Set(['Pendente de integração', 'Não autorizado']));
  assert.equal(parseHospitalData(next).appointments.length, 2);
  assert.equal(readNotification(next, next.notifications[0].id).notifications[0].read, true);
});
test('agenda: bloqueia profissional, sala e paciente em conflito, mas aceita horários adjacentes', () => {
  let data = bookAppointment(base(), booking(), 'Recepção', now);
  assert.throws(() => bookAppointment(data, booking({ patientId: 'pat-1', roomId: 'room-2' }), 'Recepção', now), /profissional/);
  data = saveProfessional(data, { ...data.professionals[0], id: 'pro-3', name: 'Outra pessoa' });
  assert.match(bookingProblem(data, booking({ professionalId: 'pro-3', patientId: 'pat-1' }), '', now), /consultório/);
  assert.match(bookingProblem(data, booking({ professionalId: 'pro-3', roomId: 'room-2' }), '', now), /paciente/);
  assert.equal(bookingProblem(data, booking({ time: '10:30' }), '', now), '');
});
test('agenda: sobreposição parcial com duração diferente também é recusada', () => {
  let data = bookAppointment(base(), booking(), 'Recepção', now);
  data = saveProfessional(data, { ...data.professionals[0], id: 'pro-3', name: 'Outro', duration: 20 });
  assert.match(bookingProblem(data, booking({ professionalId: 'pro-3', patientId: 'pat-1', time: '10:20' }), '', now), /consultório/);
});
test('agenda: grade exclui consulta ocupada, dia sem jornada, passado e horário fora da grade', () => {
  const data = base();
  const slots = availableSlots(data, booking(), '', now);
  assert.ok(!slots.includes('09:00')); assert.ok(slots.includes('09:30'));
  assert.equal(availableSlots(data, booking({ date: '2026-11-28' }), '', now).length, 0);
  assert.match(bookingProblem(data, booking({ date: '2026-11-22' }), '', now), /futuro/);
  assert.match(bookingProblem(data, booking({ time: '10:15' }), '', now), /grade/);
  assert.match(bookingProblem(data, booking({ date: '2026-02-30' }), '', now), /válidos/);
});
test('agenda: cancelar exige motivo, libera horário e impede transição posterior', () => {
  const data = bookAppointment(base(), booking(), 'Recepção', now), id = data.appointments.at(-1).id;
  assert.throws(() => changeAppointmentStatus(data, id, 'Cancelada', '', now), /motivo/);
  const cancelled = changeAppointmentStatus(data, id, 'Cancelada', 'Solicitação do paciente', now);
  assert.ok(availableSlots(cancelled, booking(), '', now).includes('10:00'));
  assert.throws(() => changeAppointmentStatus(cancelled, id, 'Confirmada', '', now), /Transição/);
});
test('agenda: atendimento deve seguir chegada, início e conclusão no dia correto', () => {
  let data = bookAppointment(base(), booking(), 'Recepção', now); const id = data.appointments.at(-1).id;
  assert.throws(() => changeAppointmentStatus(data, id, 'Concluída', '', now), /Transição/);
  assert.throws(() => changeAppointmentStatus(data, id, 'Aguardando', '', now), /dia/);
  assert.throws(() => changeAppointmentStatus(data, id, 'Não compareceu', '', now), /não começou/);
  const day = new Date('2026-11-24T13:00:00Z');
  data = changeAppointmentStatus(data, id, 'Aguardando', '', day);
  data = changeAppointmentStatus(data, id, 'Em atendimento', '', day);
  data = changeAppointmentStatus(data, id, 'Concluída', '', day);
  assert.equal(data.appointments.at(-1).status, 'Concluída');
  assert.equal(data.appointments.at(-1).history.length, 4);
});
test('agenda: reagendamento conserva paciente e referência e não modifica base em falha', () => {
  const data = bookAppointment(base(), booking(), 'Recepção', now); const a = data.appointments.at(-1);
  const next = rescheduleAppointment(data, a.id, booking({ time: '11:00' }), 'Preferência', now);
  assert.equal(next.appointments.at(-1).reference, a.reference);
  assert.ok(availableSlots(next, booking(), '', now).includes('10:00'));
  assert.throws(() => rescheduleAppointment(data, a.id, booking({ time: '09:00' }), 'Teste', now), /profissional/);
  assert.equal(data.appointments.at(-1).time, '10:00');
  assert.throws(() => rescheduleAppointment(data, a.id, booking({ patientId: 'pat-1' }), 'Teste', now), /paciente/);
});
test('hospital: configuração valida responsáveis, unidade, fuso e consentimento de avisos', () => {
  const data = base();
  assert.throws(() => saveHospitalConfig(data, { ...data.config, responsibleIds: [] }));
  assert.throws(() => saveHospitalConfig(data, { ...data.config, responsibleIds: ['missing'] }), /responsáveis/);
  assert.throws(() => saveHospitalConfig(data, { ...data.config, timezone: 'America/Manaus' }), /fuso/);
  assert.throws(() => addHospitalResource(data, 'rooms', 'Sala', 'missing'), /unidade/);
  assert.throws(() => addHospitalResource(data, 'units', 'UNIDADE DEMONSTRATIVA'), /existe/);
  assert.throws(() => saveResponsible(data, { id: 's', name: 'Recepção', phone: '123', whatsappOptIn: true }), /internacional/);
  assert.throws(() => savePatient(data, { id: 'p', name: 'Teste', phone: '', birthDate: '2027-01-01' }, now), /futuro/);
});
test('hospital: não muda grade de profissional com consultas abertas', () => {
  const data = base();
  assert.throws(() => saveProfessional(data, { ...data.professionals[0], duration: 45 }), /consultas abertas/);
  assert.equal(saveProfessional(data, { ...data.professionals[0], name: 'Novo nome' }).professionals[0].name, 'Novo nome');
});
test('hospital: base salva inválida não é aceita ou convertida silenciosamente em dados fictícios', () => {
  const data = base();
  assert.throws(() => parseHospitalData({ ...data, appointments: [{ ...data.appointments[0], patientId: 'missing' }] }), /Vínculos/);
  assert.throws(() => parseHospitalData({ ...data, appointments: [{ ...data.appointments[0], date: '2026-02-30' }] }));
  assert.throws(() => parseHospitalData({ ...data, appointments: [...data.appointments, { ...data.appointments[0], id: 'another' }] }), /Conflito/);
});

/* ── Critérios de ocupação: tipos de consulta e encaixes ── */
const concluded = (extra = {}) => ({ id: 'past-1', patientId: 'pat-2', professionalId: 'pro-1', roomId: 'room-1', date: '2026-11-10', time: '09:00', duration: 30, status: 'Concluída', source: 'Recepção', reference: 'TESTE-PASSADO', typeId: 'primeira', fitIn: false, history: [], ...extra });

test('tipos: a consulta grava o tipo e ocupa a duração dele', () => {
  const data = base();
  const next = bookAppointment(data, booking({ typeId: 'primeira' }), 'Recepção', now);
  assert.equal(next.appointments.at(-1).typeId, 'primeira');
  const post = bookAppointment(data, booking({ professionalId: 'pro-2', time: '14:00', typeId: 'pos-operatorio' }), 'Recepção', now).appointments.at(-1);
  assert.equal(post.duration, 40);
  // 14:00–14:40 bloqueia também o horário das 14:30 na grade de 30 em 30 minutos.
  const after = bookAppointment(data, booking({ professionalId: 'pro-2', time: '14:00', typeId: 'pos-operatorio' }), 'Recepção', now);
  assert.match(bookingProblem(after, booking({ professionalId: 'pro-2', patientId: 'pat-1', roomId: 'room-2', time: '14:30', typeId: 'primeira' }), '', now), /profissional/);
  assert.equal(availableSlots(data, booking({ professionalId: 'pro-2', typeId: 'pos-operatorio' }), '', now).at(-1), '16:00');
  assert.match(bookingProblem(data, booking({ typeId: 'nao-existe' }), '', now), /não é atendido/);
});
test('tipos: limite diário por tipo conta só consultas ativas e normais', () => {
  let data = base(); // já tem 1 primeira consulta às 09:00 no dia 24
  for (const [i, t] of ['10:00', '10:30', '11:00'].entries()) data = bookAppointment(data, booking({ patientId: i % 2 ? 'pat-1' : 'pat-2', time: t, typeId: 'primeira' }), 'Recepção', now);
  assert.match(bookingProblem(data, booking({ time: '11:30', typeId: 'primeira' }), '', now), /Limite diário/);
  const cancelled = changeAppointmentStatus(data, data.appointments.at(-1).id, 'Cancelada', 'Teste', now);
  assert.equal(bookingProblem(cancelled, booking({ time: '11:30', typeId: 'primeira' }), '', now), '');
});
test('tipos: retorno exige consulta concluída com o mesmo profissional dentro do prazo', () => {
  const data = base();
  assert.match(bookingProblem(data, booking({ typeId: 'retorno' }), '', now), /30 dias/);
  const recent = parseHospitalData({ ...data, appointments: [...data.appointments, concluded()] });
  assert.equal(bookingProblem(recent, booking({ typeId: 'retorno' }), '', now), '');
  const old = parseHospitalData({ ...data, appointments: [...data.appointments, concluded({ date: '2026-10-01' })] });
  assert.match(bookingProblem(old, booking({ typeId: 'retorno' }), '', now), /30 dias/);
});
test('encaixe: só recepção, só intervalo livre, respeita tipos aceitos e limite diário', () => {
  let data = base();
  const fit = (extra = {}) => booking({ professionalId: 'pro-2', time: '13:15', typeId: 'primeira', ...extra });
  assert.throws(() => bookFitIn(data, fit(), '', now), /motivo/);
  assert.match(fitInProblem(data, booking({ time: '10:15', typeId: 'primeira' }), now), /não é aceita como encaixe/);
  assert.match(fitInProblem(data, booking({ time: '09:15', typeId: 'retorno' }), now), /30 dias|profissional/);
  data = bookFitIn(data, fit(), 'Paciente com exame urgente', now);
  const a = data.appointments.at(-1);
  assert.equal(a.fitIn, true); assert.match(a.reference, /^EN-/);
  // Sem sobreposição: o encaixe 13:15–13:45 bloqueia 13:00 e 13:30 na grade normal.
  const grid = availableSlots(data, booking({ professionalId: 'pro-2', typeId: 'primeira' }), '', now);
  assert.ok(!grid.includes('13:00') && !grid.includes('13:30') && grid.includes('14:00'));
  assert.match(fitInProblem(data, fit({ patientId: 'pat-1', time: '15:15' }), now), /Limite diário de encaixes/);
  assert.equal(parseHospitalData(data).appointments.at(-1).fitIn, true);
});
test('encaixe: horários sugeridos ficam fora da grade normal e não sobrepõem', () => {
  const data = base();
  const slots = fitInSlots(data, booking({ professionalId: 'pro-2', typeId: 'primeira' }), now);
  assert.ok(slots.includes('13:05') && !slots.includes('13:00') && !slots.includes('13:30'));
  assert.deepEqual(fitInSlots(data, booking({ typeId: 'primeira' }), now), []); // pro-1 aceita só retorno
});
test('pedido de encaixe: fica pendente sem reservar horário, avisa responsáveis e a recepção decide', () => {
  const data = base();
  const req = { patientId: 'pat-2', professionalId: 'pro-2', typeId: 'primeira', date: '2026-11-24', note: 'Sem horários na semana' };
  const pending = requestFitIn(data, req, 'Recepção', now);
  assert.equal(pending.fitInRequests[0].status, 'Pendente');
  assert.equal(pending.appointments.length, data.appointments.length);
  assert.equal(pending.notifications.length, 1);
  assert.throws(() => requestFitIn(pending, req, 'Recepção', now), /pendente/);
  assert.throws(() => requestFitIn(data, { ...req, professionalId: 'pro-1' }, 'Recepção', now), /não é aceita como encaixe/);
  const id = pending.fitInRequests[0].id;
  assert.throws(() => rejectFitIn(pending, id, '', now), /motivo/);
  const approved = approveFitIn(pending, id, { time: '13:15', roomId: 'room-2' }, 'Aprovado pela recepção', now);
  assert.equal(approved.fitInRequests[0].status, 'Aprovado');
  assert.equal(approved.appointments.find(a => a.id === approved.fitInRequests[0].appointmentId).fitIn, true);
  assert.throws(() => approveFitIn(approved, id, { time: '14:15', roomId: 'room-2' }, '', now), /resolvido/);
  assert.equal(rejectFitIn(pending, id, 'Agenda cheia', now).fitInRequests[0].status, 'Recusado');
});
test('critérios de ocupação: resumo de vagas por tipo e de encaixes do dia', () => {
  const c = occupancyCriteria(base(), 'pro-1', '2026-11-24', now);
  const primeira = c.types.find(t => t.id === 'primeira');
  assert.equal(c.worksThatDay, true);
  assert.equal(primeira.booked, 1); assert.equal(primeira.remaining, 3); assert.ok(primeira.freeSlots > 0);
  assert.equal(c.types.find(t => t.id === 'retorno').acceptsFitIn, true);
  assert.deepEqual({ remaining: c.fitIn.remaining, overlapAllowed: c.fitIn.overlapAllowed }, { remaining: 2, overlapAllowed: false });
  assert.equal(occupancyCriteria(base(), 'pro-2', '2026-11-24', now).types.find(t => t.id === 'pos-operatorio').freeSlots, 7);
  assert.equal(occupancyCriteria(base(), 'pro-1', '2026-11-28', now).worksThatDay, false);
});
test('compatibilidade: agenda salva antes dos tipos e encaixes continua abrindo', () => {
  const old = structuredClone(base());
  delete old.fitInRequests;
  for (const p of old.professionals) { delete p.consultationTypes; delete p.fitIn; }
  for (const a of old.appointments) { delete a.typeId; delete a.fitIn; }
  const data = parseHospitalData(old);
  assert.deepEqual(consultationTypes(data.professionals[0]).map(t => t.name), ['Consulta']);
  assert.equal(data.professionals[0].fitIn.enabled, false);
  assert.equal(bookingProblem(data, booking(), '', now), '');
  assert.match(fitInProblem(data, booking({ time: '10:15' }), now), /não aceita encaixes/);
});
test('profissional: tipo com consulta aberta não pode sumir nem mudar de duração', () => {
  const data = base(), pro = data.professionals[0];
  assert.throws(() => saveProfessional(data, { ...pro, consultationTypes: pro.consultationTypes.filter(t => t.id !== 'primeira') }), /consultas abertas/);
  assert.throws(() => saveProfessional(data, { ...pro, consultationTypes: pro.consultationTypes.map(t => t.id === 'primeira' ? { ...t, duration: 40 } : t) }), /consultas abertas/);
  assert.equal(saveProfessional(data, { ...pro, consultationTypes: pro.consultationTypes.map(t => t.id === 'primeira' ? { ...t, dailyLimit: 6 } : t) }).professionals[0].consultationTypes[0].dailyLimit, 6);
  assert.throws(() => saveProfessional(data, { ...pro, fitIn: { ...pro.fitIn, typeIds: ['inexistente'] } }), /não existe/);
});
