import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHospitalData, parseHospitalData, bookAppointment, bookingProblem, availableSlots, changeAppointmentStatus, rescheduleAppointment, savePatient, saveProfessional, saveHospitalConfig, addHospitalResource, saveResponsible, readNotification, offerBotSlot, confirmBotSlot, isOutsideBusinessHours } from '../src/hospital/domain.ts';

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
test('WhatsApp local: somente fora do expediente, exige confirmação e respeita expiração', () => {
  const data = base(), business = new Date('2026-11-23T15:00:00Z');
  assert.equal(isOutsideBusinessHours(data, now), true); assert.equal(isOutsideBusinessHours(data, business), false);
  assert.throws(() => offerBotSlot(data, booking(), business), /expediente/);
  const offer = offerBotSlot(data, booking(), now);
  assert.throws(() => confirmBotSlot(data, offer, false, now), /explícita/);
  assert.throws(() => confirmBotSlot(data, offer, true, new Date(now.getTime() + 11 * 60000)), /expirada/);
  const result = confirmBotSlot(data, offer, true, now);
  assert.equal(result.appointments.at(-1).source, 'WhatsApp');
  assert.equal(result.notifications.length, 1);
});
test('WhatsApp local: revalida oferta quando recepção ocupa horário e impede confirmação duplicada', () => {
  const data = base(), offer = offerBotSlot(data, booking(), now);
  const occupied = bookAppointment(data, booking(), 'Recepção', now);
  assert.throws(() => confirmBotSlot(occupied, offer, true, now), /profissional/);
  const booked = confirmBotSlot(data, offer, true, now);
  assert.throws(() => confirmBotSlot(booked, offer, true, now), /profissional/);
  assert.throws(() => confirmBotSlot({ ...data, config: { ...data.config, botEnabled: false } }, offer, true, now), /desativado/);
});
test('hospital: base salva inválida não é aceita ou convertida silenciosamente em dados fictícios', () => {
  const data = base();
  assert.throws(() => parseHospitalData({ ...data, appointments: [{ ...data.appointments[0], patientId: 'missing' }] }), /Vínculos/);
  assert.throws(() => parseHospitalData({ ...data, appointments: [{ ...data.appointments[0], date: '2026-02-30' }] }));
  assert.throws(() => parseHospitalData({ ...data, appointments: [...data.appointments, { ...data.appointments[0], id: 'another' }] }), /Conflito/);
});
