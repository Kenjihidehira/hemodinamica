import { z } from 'zod';

const text = z.string().trim().min(1).max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Data inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const statuses = ['Agendada', 'Confirmada', 'Aguardando', 'Em atendimento', 'Concluída', 'Cancelada', 'Não compareceu'] as const;
export type AppointmentStatus = typeof statuses[number];
const profilePhoto = z.string().max(950_000).default('');
const occupation = z.string().trim().max(120).default('');
const patientSchema = z.object({ id: text, name: text, phone: z.string().max(25), birthDate: z.union([date, z.literal('')]), occupation, photoUrl: profilePhoto });
const professionalSchema = z.object({ id: text, name: text, occupation, photoUrl: profilePhoto, specialtyId: text, unitId: text, days: z.array(z.number().int().min(0).max(6)).min(1), start: time, end: time, duration: z.number().int().min(10).max(180), active: z.boolean() }).refine(p => p.start < p.end, 'Fim da jornada deve ser após o início.');
const configSchema = z.object({ name: text, accent: z.enum(['#293a78', '#145b52', '#60427d']), timezone: z.enum(['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco']), stockEnabled: z.boolean(), agendaEnabled: z.boolean(), businessDays: z.array(z.number().int().min(0).max(6)).min(1), opens: time, closes: time, botEnabled: z.boolean(), responsibleIds: z.array(text).min(1) }).refine(c => c.opens < c.closes, 'Fim do expediente deve ser após o início.');
const appointmentSchema = z.object({ id: text, patientId: text, professionalId: text, roomId: text, date, time, duration: z.number().int().min(10).max(180), status: z.enum(statuses), source: z.enum(['Recepção', 'WhatsApp']), reference: text, history: z.array(z.object({ at: z.string(), action: text, reason: z.string().max(500) })) });
const stateSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), config: configSchema, units: z.array(z.object({ id: text, name: text })), specialties: z.array(z.object({ id: text, name: text })), rooms: z.array(z.object({ id: text, name: text, unitId: text })), professionals: z.array(professionalSchema), patients: z.array(patientSchema), appointments: z.array(appointmentSchema), staff: z.array(z.object({ id: text, name: text, phone: z.string().max(25), whatsappOptIn: z.boolean() })), notifications: z.array(z.object({ id: text, appointmentId: text.optional(), recipientId: text, title: text, createdAt: z.string(), read: z.boolean(), whatsapp: z.enum(['Pendente de integração', 'Não autorizado']) })), audit: z.array(z.object({ id: text, at: z.string(), action: text })) });
export type HospitalData = z.infer<typeof stateSchema>;
export type Patient = z.infer<typeof patientSchema>;
export type Professional = z.infer<typeof professionalSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type HospitalConfig = z.infer<typeof configSchema>;
export type Booking = Pick<Appointment, 'patientId' | 'professionalId' | 'roomId' | 'date' | 'time'>;
export const hospitalStorageKey = 'hospital-agenda-demo-v1';
export const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
export const clockTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function localNow(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function plusDays(value: string, days: number) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export const dayOfWeek = (value: string) => new Date(`${value}T12:00:00Z`).getUTCDay();
const occupies = (a: Appointment) => !['Cancelada', 'Não compareceu'].includes(a.status);
const overlap = (start: number, duration: number, a: Appointment) => start < minutes(a.time) + a.duration && start + duration > minutes(a.time);
const cleanKey = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function fail(message: string): never { throw new Error(message); }
function changed(data: HospitalData, action: string): HospitalData { return { ...data, revision: data.revision + 1, audit: [{ id: crypto.randomUUID(), at: new Date().toISOString(), action }, ...data.audit] }; }

export function parseHospitalData(value: unknown): HospitalData {
  const data = stateSchema.parse(value);
  for (const collection of [data.units, data.specialties, data.rooms, data.professionals, data.patients, data.appointments, data.staff, data.notifications]) {
    if (new Set(collection.map(v => v.id)).size !== collection.length) fail('Identificadores duplicados na agenda salva.');
  }
  for (const p of data.professionals) if (!data.units.some(u => u.id === p.unitId) || !data.specialties.some(s => s.id === p.specialtyId)) fail('Profissional sem unidade ou especialidade válida.');
  for (const r of data.rooms) if (!data.units.some(u => u.id === r.unitId)) fail('Sala sem unidade válida.');
  for (const id of data.config.responsibleIds) if (!data.staff.some(s => s.id === id)) fail('Responsável não encontrado.');
  for (const a of data.appointments) {
    const p = data.professionals.find(p => p.id === a.professionalId), r = data.rooms.find(r => r.id === a.roomId);
    if (!p || !r || r.unitId !== p.unitId || !data.patients.some(p => p.id === a.patientId) || minutes(a.time) + a.duration > 1440) fail('Vínculos inválidos na agenda salva.');
    if (occupies(a) && data.appointments.some(b => b.id !== a.id && occupies(b) && b.date === a.date && overlap(minutes(a.time), a.duration, b) && (b.professionalId === a.professionalId || b.patientId === a.patientId || b.roomId === a.roomId))) fail('Conflito na agenda salva. Preserve a base para revisão.');
  }
  return data;
}

export function makeHospitalData(now = new Date()): HospitalData {
  let day = plusDays(localNow('America/Sao_Paulo', now).date, 1);
  while ([0, 6].includes(dayOfWeek(day))) day = plusDays(day, 1);
  return { version: 1, revision: 0, config: { name: 'Jusimed', accent: '#293a78', timezone: 'America/Sao_Paulo', stockEnabled: true, agendaEnabled: true, businessDays: [1, 2, 3, 4, 5], opens: '08:00', closes: '18:00', botEnabled: true, responsibleIds: ['staff-1'] }, units: [{ id: 'unit-1', name: 'Unidade demonstrativa' }], specialties: [{ id: 'spec-1', name: 'Clínica geral' }, { id: 'spec-2', name: 'Ortopedia' }], rooms: [{ id: 'room-1', unitId: 'unit-1', name: 'Consultório 01' }, { id: 'room-2', unitId: 'unit-1', name: 'Consultório 02' }], professionals: [{ id: 'pro-1', name: 'Dra. Ana · fictício', occupation: 'Médica', photoUrl: '', specialtyId: 'spec-1', unitId: 'unit-1', days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00', duration: 30, active: true }, { id: 'pro-2', name: 'Dr. Marcos · fictício', occupation: 'Médico', photoUrl: '', specialtyId: 'spec-2', unitId: 'unit-1', days: [1, 2, 3, 4, 5], start: '13:00', end: '17:00', duration: 30, active: true }], patients: [{ id: 'pat-1', name: 'Paciente demonstração 01', phone: '', birthDate: '', occupation: 'Analista administrativo', photoUrl: '' }, { id: 'pat-2', name: 'Paciente demonstração 02', phone: '', birthDate: '', occupation: 'Profissional autônomo', photoUrl: '' }], appointments: [{ id: 'appointment-1', patientId: 'pat-1', professionalId: 'pro-1', roomId: 'room-1', date: day, time: '09:00', duration: 30, status: 'Agendada', source: 'Recepção', reference: 'DEMO-001', history: [{ at: now.toISOString(), action: 'Agendamento demonstrativo', reason: '' }] }], staff: [{ id: 'staff-1', name: 'Recepção · demonstração', phone: '', whatsappOptIn: false }], notifications: [], audit: [] };
}

export function isOutsideBusinessHours(data: HospitalData, now = new Date()) { const local = localNow(data.config.timezone, now); return !data.config.businessDays.includes(dayOfWeek(local.date)) || local.time < data.config.opens || local.time >= data.config.closes; }

export function bookingProblem(data: HospitalData, input: Booking, exceptId = '', now = new Date()): string {
  if (!data.config.agendaEnabled) return 'Módulo de agenda desativado.';
  if (!date.safeParse(input.date).success || !time.safeParse(input.time).success) return 'Informe uma data e um horário válidos.';
  const current = localNow(data.config.timezone, now);
  if (input.date < current.date || (input.date === current.date && input.time <= current.time)) return 'O horário precisa estar no futuro.';
  const p = data.professionals.find(p => p.id === input.professionalId);
  if (!p?.active) return 'Selecione um profissional ativo.';
  if (!data.patients.some(p => p.id === input.patientId)) return 'Selecione um paciente cadastrado.';
  if (!data.rooms.some(r => r.id === input.roomId && r.unitId === p.unitId)) return 'A sala deve pertencer à unidade do profissional.';
  if (!p.days.includes(dayOfWeek(input.date))) return 'Profissional indisponível nesse dia da semana.';
  const start = minutes(input.time);
  if (start < minutes(p.start) || start + p.duration > minutes(p.end) || (start - minutes(p.start)) % p.duration !== 0) return 'Horário fora da grade de atendimento do profissional.';
  const conflicts = data.appointments.filter(a => a.id !== exceptId && a.date === input.date && occupies(a) && overlap(start, p.duration, a));
  if (conflicts.some(a => a.professionalId === p.id)) return 'O profissional já possui uma consulta nesse intervalo.';
  if (conflicts.some(a => a.patientId === input.patientId)) return 'O paciente já possui uma consulta nesse intervalo.';
  if (conflicts.some(a => a.roomId === input.roomId)) return 'O consultório está ocupado nesse intervalo.';
  return '';
}

export function availableSlots(data: HospitalData, input: Omit<Booking, 'time'>, exceptId = '', now = new Date()) {
  const p = data.professionals.find(p => p.id === input.professionalId);
  if (!p) return [];
  const result: string[] = [];
  for (let n = minutes(p.start); n + p.duration <= minutes(p.end); n += p.duration) { const value = clockTime(n); if (!bookingProblem(data, { ...input, time: value }, exceptId, now)) result.push(value); }
  return result;
}

function notify(data: HospitalData, appointment: Appointment, title: string) {
  return { ...data, notifications: [...data.config.responsibleIds.map(id => ({ id: crypto.randomUUID(), appointmentId: appointment.id, recipientId: id, title, createdAt: new Date().toISOString(), read: false, whatsapp: data.staff.find(s => s.id === id)?.whatsappOptIn ? 'Pendente de integração' as const : 'Não autorizado' as const })), ...data.notifications] };
}

export function bookAppointment(data: HospitalData, input: Booking, source: Appointment['source'] = 'Recepção', now = new Date()): HospitalData {
  const problem = bookingProblem(data, input, '', now); if (problem) fail(problem);
  const id = crypto.randomUUID();
  const appointment: Appointment = { ...input, id, reference: `AG-${id.slice(0, 8).toUpperCase()}`, duration: data.professionals.find(p => p.id === input.professionalId)!.duration, source, status: 'Agendada', history: [{ at: now.toISOString(), action: `Criada pela ${source}`, reason: '' }] };
  return changed(notify({ ...data, appointments: [...data.appointments, appointment] }, appointment, `Nova consulta ${appointment.reference} · ${source}`), `Consulta ${appointment.reference} criada`);
}

export function rescheduleAppointment(data: HospitalData, id: string, input: Booking, reason: string, now = new Date()) {
  const a = data.appointments.find(a => a.id === id);
  if (!a || !['Agendada', 'Confirmada'].includes(a.status)) fail('Somente consultas agendadas ou confirmadas podem ser reagendadas.');
  if (!reason.trim()) fail('Informe o motivo do reagendamento.');
  if (input.patientId !== a.patientId) fail('Não é possível trocar o paciente ao reagendar.');
  const problem = bookingProblem(data, input, id, now); if (problem) fail(problem);
  const next: Appointment = { ...a, ...input, duration: data.professionals.find(p => p.id === input.professionalId)!.duration, status: 'Agendada', history: [...a.history, { at: now.toISOString(), action: 'Reagendada', reason: `${a.date} ${a.time} → ${input.date} ${input.time}. ${reason.trim()}` }] };
  return changed(notify({ ...data, appointments: data.appointments.map(a => a.id === id ? next : a) }, next, `Consulta ${a.reference} reagendada`), `Reagendamento ${a.reference}`);
}

const transitions: Record<AppointmentStatus, AppointmentStatus[]> = { Agendada: ['Confirmada', 'Aguardando', 'Cancelada', 'Não compareceu'], Confirmada: ['Aguardando', 'Cancelada', 'Não compareceu'], Aguardando: ['Em atendimento', 'Cancelada'], 'Em atendimento': ['Concluída'], Concluída: [], Cancelada: [], 'Não compareceu': [] };
export const nextStatuses = (status: AppointmentStatus) => transitions[status];
export function changeAppointmentStatus(data: HospitalData, id: string, status: AppointmentStatus, reason = '', now = new Date()) {
  const a = data.appointments.find(a => a.id === id);
  if (!a || !transitions[a.status].includes(status)) fail('Transição de atendimento não permitida.');
  const current = localNow(data.config.timezone, now);
  if (['Aguardando', 'Em atendimento', 'Concluída'].includes(status) && current.date !== a.date) fail('Essa ação está disponível somente no dia da consulta.');
  if (status === 'Não compareceu' && (a.date > current.date || (a.date === current.date && a.time > current.time))) fail('A consulta ainda não começou.');
  if (status === 'Cancelada' && !reason.trim()) fail('Informe o motivo do cancelamento.');
  const next: Appointment = { ...a, status, history: [...a.history, { at: now.toISOString(), action: status, reason: reason.trim() }] };
  const result = { ...data, appointments: data.appointments.map(a => a.id === id ? next : a) };
  return changed(status === 'Cancelada' ? notify(result, next, `Consulta ${a.reference} cancelada`) : result, `${a.reference}: ${status}`);
}

export function savePatient(data: HospitalData, input: Patient, now = new Date()) {
  const patient = patientSchema.parse(input);
  if (patient.birthDate && patient.birthDate > localNow(data.config.timezone, now).date) fail('Nascimento não pode estar no futuro.');
  return changed({ ...data, patients: data.patients.some(p => p.id === patient.id) ? data.patients.map(p => p.id === patient.id ? patient : p) : [...data.patients, patient] }, 'Cadastro administrativo de paciente atualizado');
}
export function saveProfessional(data: HospitalData, input: Professional) {
  const p = professionalSchema.parse(input);
  if (!data.units.some(u => u.id === p.unitId) || !data.specialties.some(s => s.id === p.specialtyId)) fail('Selecione unidade e especialidade cadastradas.');
  const previous = data.professionals.find(v => v.id === p.id);
  if (previous && data.appointments.some(a => a.professionalId === p.id && ['Agendada', 'Confirmada', 'Aguardando', 'Em atendimento'].includes(a.status)) && ['unitId', 'specialtyId', 'days', 'start', 'end', 'duration', 'active'].some(k => JSON.stringify(previous[k as keyof Professional]) !== JSON.stringify(p[k as keyof Professional]))) fail('Reagende ou encerre as consultas abertas antes de alterar a grade desse profissional.');
  return changed({ ...data, professionals: previous ? data.professionals.map(v => v.id === p.id ? p : v) : [...data.professionals, p] }, 'Cadastro de profissional atualizado');
}
export function saveHospitalConfig(data: HospitalData, input: HospitalConfig) {
  const config = configSchema.parse(input);
  if (config.responsibleIds.some(id => !data.staff.some(s => s.id === id))) fail('Selecione responsáveis cadastrados.');
  if (config.timezone !== data.config.timezone && data.appointments.some(a => !['Cancelada', 'Concluída', 'Não compareceu'].includes(a.status))) fail('Encerre as consultas abertas antes de alterar o fuso horário.');
  return changed({ ...data, config }, 'Configurações do hospital atualizadas');
}
export function addHospitalResource(data: HospitalData, kind: 'units' | 'specialties' | 'rooms', name: string, unitId = '') {
  text.parse(name);
  if (data[kind].some(v => cleanKey(v.name) === cleanKey(name) && (kind !== 'rooms' || ('unitId' in v && v.unitId === unitId)))) fail('Já existe um cadastro com esse nome.');
  if (kind === 'rooms' && !data.units.some(u => u.id === unitId)) fail('Selecione a unidade da sala.');
  const item = { id: crypto.randomUUID(), name: name.trim() };
  return changed(kind === 'rooms' ? { ...data, rooms: [...data.rooms, { ...item, unitId }] } : { ...data, [kind]: [...data[kind], item] }, 'Estrutura do hospital atualizada');
}
export function saveResponsible(data: HospitalData, input: HospitalData['staff'][number]) {
  const staff = stateSchema.shape.staff.element.parse(input);
  if (staff.whatsappOptIn && !/^\+[1-9]\d{9,14}$/.test(staff.phone)) fail('Use telefone internacional, por exemplo +5544999999999.');
  return changed({ ...data, staff: data.staff.some(s => s.id === staff.id) ? data.staff.map(s => s.id === staff.id ? staff : s) : [...data.staff, staff] }, 'Responsável atualizado');
}
export function readNotification(data: HospitalData, id: string) { return changed({ ...data, notifications: data.notifications.map(n => n.id === id ? { ...n, read: true } : n) }, 'Aviso marcado como lido'); }

export type SlotOffer = Booking & { expiresAt: string };
export function offerBotSlot(data: HospitalData, booking: Booking, now = new Date()): SlotOffer {
  if (!data.config.botEnabled || !isOutsideBusinessHours(data, now)) fail('Bot automático disponível somente fora do expediente configurado.');
  const problem = bookingProblem(data, booking, '', now); if (problem) fail(problem);
  return { ...booking, expiresAt: new Date(now.getTime() + 10 * 60000).toISOString() };
}
export function confirmBotSlot(data: HospitalData, offer: SlotOffer, confirmed: boolean, now = new Date()) {
  if (!confirmed) fail('A confirmação explícita do paciente é necessária.');
  if (!data.config.botEnabled || !data.config.agendaEnabled) fail('Agendamento automático desativado.');
  if (!Number.isFinite(Date.parse(offer.expiresAt)) || Date.parse(offer.expiresAt) <= now.getTime()) fail('Oferta expirada. Consulte os horários novamente.');
  // A oferta não reserva o horário: revalidar disponibilidade na confirmação é obrigatório.
  return bookAppointment(data, offer, 'WhatsApp', now);
}
