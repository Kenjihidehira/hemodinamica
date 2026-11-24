import { z } from 'zod';

const text = z.string().trim().min(1).max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Data inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const statuses = ['Agendada', 'Confirmada', 'Aguardando', 'Em atendimento', 'Concluída', 'Cancelada', 'Não compareceu'] as const;
export type AppointmentStatus = typeof statuses[number];
const profilePhoto = z.string().max(950_000).default('');
const occupation = z.string().trim().max(120).default('');
const source = z.enum(['Recepção', 'WhatsApp']);

/** Tipo de consulta atendido por um profissional. A duração do tipo define quanto tempo a consulta ocupa. */
const consultationTypeSchema = z.object({
  id: text,
  name: text,
  duration: z.number().int().min(10).max(180),
  /** Máximo de consultas deste tipo por dia para o profissional. 0 = sem limite. */
  dailyLimit: z.number().int().min(0).max(50).default(0),
  /** Exige consulta concluída com o mesmo profissional nos últimos N dias (retorno). 0 = não exige. */
  returnWindowDays: z.number().int().min(0).max(365).default(0),
});
/**
 * Regras de encaixe: consulta marcada fora da grade normal, sempre num intervalo livre
 * (nunca sobreposta a outra consulta). A recepção marca direto ou aprova um pedido de encaixe.
 */
const fitInSchema = z.object({
  enabled: z.boolean(),
  maxPerDay: z.number().int().min(0).max(20),
  /** Tipos aceitos como encaixe. Vazio = todos os tipos do profissional. */
  typeIds: z.array(text),
});
const defaultFitIn = { enabled: false, maxPerDay: 0, typeIds: [] as string[] };

const patientSchema = z.object({ id: text, name: text, phone: z.string().max(25), birthDate: z.union([date, z.literal('')]), occupation, photoUrl: profilePhoto });
/** `duration` é o passo da grade do profissional; a duração de cada consulta vem do tipo. */
const professionalSchema = z.object({ id: text, name: text, occupation, photoUrl: profilePhoto, specialtyId: text, unitId: text, days: z.array(z.number().int().min(0).max(6)).min(1), start: time, end: time, duration: z.number().int().min(10).max(180), active: z.boolean(), consultationTypes: z.array(consultationTypeSchema).default([]), fitIn: fitInSchema.default(defaultFitIn) }).refine(p => p.start < p.end, 'Fim da jornada deve ser após o início.');
const configSchema = z.object({ name: text, accent: z.enum(['#293a78', '#145b52', '#60427d']), timezone: z.enum(['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco']), stockEnabled: z.boolean(), agendaEnabled: z.boolean(), businessDays: z.array(z.number().int().min(0).max(6)).min(1), opens: time, closes: time, responsibleIds: z.array(text).min(1) }).refine(c => c.opens < c.closes, 'Fim do expediente deve ser após o início.');
const appointmentSchema = z.object({ id: text, patientId: text, professionalId: text, roomId: text, date, time, duration: z.number().int().min(10).max(180), status: z.enum(statuses), source, reference: text, history: z.array(z.object({ at: z.string(), action: text, reason: z.string().max(500) })), typeId: z.string().max(160).default(''), fitIn: z.boolean().default(false) });
const fitInRequestSchema = z.object({ id: text, patientId: text, professionalId: text, typeId: text, date, preferredTime: z.union([time, z.literal('')]), note: z.string().max(500), source, status: z.enum(['Pendente', 'Aprovado', 'Recusado']), createdAt: z.string(), resolvedAt: z.string().optional(), resolution: z.string().max(500).optional(), appointmentId: z.string().optional() });
const stateSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), config: configSchema, units: z.array(z.object({ id: text, name: text })), specialties: z.array(z.object({ id: text, name: text })), rooms: z.array(z.object({ id: text, name: text, unitId: text })), professionals: z.array(professionalSchema), patients: z.array(patientSchema), appointments: z.array(appointmentSchema), fitInRequests: z.array(fitInRequestSchema).default([]), staff: z.array(z.object({ id: text, name: text, phone: z.string().max(25), whatsappOptIn: z.boolean() })), notifications: z.array(z.object({ id: text, appointmentId: text.optional(), recipientId: text, title: text, createdAt: z.string(), read: z.boolean(), whatsapp: z.enum(['Pendente de integração', 'Não autorizado']) })), audit: z.array(z.object({ id: text, at: z.string(), action: text })) });
export type HospitalData = z.infer<typeof stateSchema>;
export type Patient = z.infer<typeof patientSchema>;
export type Professional = z.infer<typeof professionalSchema>;
/** Formulários podem omitir tipos e encaixe; o esquema preenche os padrões. */
export type ProfessionalInput = z.input<typeof professionalSchema>;
export type ConsultationType = z.infer<typeof consultationTypeSchema>;
export type FitInRules = z.infer<typeof fitInSchema>;
export type FitInRequest = z.infer<typeof fitInRequestSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type HospitalConfig = z.infer<typeof configSchema>;
export type BookingSource = z.infer<typeof source>;
export type Booking = Pick<Appointment, 'patientId' | 'professionalId' | 'roomId' | 'date' | 'time'> & { typeId?: string };
export const hospitalStorageKey = 'hospital-agenda-demo-v1';
export const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DEFAULT_TYPE_ID = 'padrao';
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
const isOpen = (a: Appointment) => ['Agendada', 'Confirmada', 'Aguardando', 'Em atendimento'].includes(a.status);
const overlap = (start: number, duration: number, a: Appointment) => start < minutes(a.time) + a.duration && start + duration > minutes(a.time);
const cleanKey = (value: string) => value.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function fail(message: string): never { throw new Error(message); }
function changed(data: HospitalData, action: string): HospitalData { return { ...data, revision: data.revision + 1, audit: [{ id: crypto.randomUUID(), at: new Date().toISOString(), action }, ...data.audit] }; }

/** Tipos efetivos do profissional. Cadastros antigos, sem tipos, atendem uma "Consulta" com a duração da grade. */
export function consultationTypes(p: Pick<Professional, 'consultationTypes' | 'duration'>): ConsultationType[] {
  return p.consultationTypes.length ? p.consultationTypes : [{ id: DEFAULT_TYPE_ID, name: 'Consulta', duration: p.duration, dailyLimit: 0, returnWindowDays: 0 }];
}
function resolveType(p: Professional, typeId?: string) { const list = consultationTypes(p); return typeId ? list.find(t => t.id === typeId) : list[0]; }
const effectiveTypeId = (a: Appointment, p: Professional) => a.typeId || consultationTypes(p)[0].id;
function fitInAccepts(p: Professional, typeId: string) { return p.fitIn.enabled && (!p.fitIn.typeIds.length || p.fitIn.typeIds.includes(typeId)); }

export function parseHospitalData(value: unknown): HospitalData {
  const data = stateSchema.parse(value);
  for (const collection of [data.units, data.specialties, data.rooms, data.professionals, data.patients, data.appointments, data.staff, data.notifications, data.fitInRequests]) {
    if (new Set(collection.map(v => v.id)).size !== collection.length) fail('Identificadores duplicados na agenda salva.');
  }
  for (const p of data.professionals) {
    if (!data.units.some(u => u.id === p.unitId) || !data.specialties.some(s => s.id === p.specialtyId)) fail('Profissional sem unidade ou especialidade válida.');
    if (new Set(p.consultationTypes.map(t => t.id)).size !== p.consultationTypes.length) fail('Tipos de consulta duplicados no cadastro do profissional.');
    if (p.fitIn.typeIds.some(id => !consultationTypes(p).some(t => t.id === id))) fail('Encaixe aponta para tipo de consulta inexistente.');
  }
  for (const r of data.rooms) if (!data.units.some(u => u.id === r.unitId)) fail('Sala sem unidade válida.');
  for (const id of data.config.responsibleIds) if (!data.staff.some(s => s.id === id)) fail('Responsável não encontrado.');
  for (const a of data.appointments) {
    const p = data.professionals.find(p => p.id === a.professionalId), r = data.rooms.find(r => r.id === a.roomId);
    if (!p || !r || r.unitId !== p.unitId || !data.patients.some(p => p.id === a.patientId) || minutes(a.time) + a.duration > 1440) fail('Vínculos inválidos na agenda salva.');
    if (a.typeId && !consultationTypes(p).some(t => t.id === a.typeId)) fail('Consulta com tipo inexistente na agenda salva.');
    if (occupies(a) && data.appointments.some(b => b.id !== a.id && occupies(b) && b.date === a.date && overlap(minutes(a.time), a.duration, b) && (b.professionalId === a.professionalId || b.patientId === a.patientId || b.roomId === a.roomId))) fail('Conflito na agenda salva. Preserve a base para revisão.');
  }
  for (const req of data.fitInRequests) {
    const p = data.professionals.find(p => p.id === req.professionalId);
    if (!p || !data.patients.some(x => x.id === req.patientId) || !consultationTypes(p).some(t => t.id === req.typeId)) fail('Pedido de encaixe com vínculos inválidos.');
  }
  return data;
}

export function makeHospitalData(now = new Date()): HospitalData {
  let day = plusDays(localNow('America/Sao_Paulo', now).date, 1);
  while ([0, 6].includes(dayOfWeek(day))) day = plusDays(day, 1);
  const clinicTypes: ConsultationType[] = [
    { id: 'primeira', name: 'Primeira consulta', duration: 30, dailyLimit: 4, returnWindowDays: 0 },
    { id: 'retorno', name: 'Retorno', duration: 30, dailyLimit: 0, returnWindowDays: 30 },
  ];
  const orthoTypes: ConsultationType[] = [
    { id: 'primeira', name: 'Primeira consulta', duration: 30, dailyLimit: 0, returnWindowDays: 0 },
    { id: 'pos-operatorio', name: 'Pós-operatório', duration: 40, dailyLimit: 3, returnWindowDays: 0 },
  ];
  return { version: 1, revision: 0, config: { name: 'Jusimed', accent: '#293a78', timezone: 'America/Sao_Paulo', stockEnabled: true, agendaEnabled: true, businessDays: [1, 2, 3, 4, 5], opens: '08:00', closes: '18:00', responsibleIds: ['staff-1'] }, units: [{ id: 'unit-1', name: 'Unidade demonstrativa' }], specialties: [{ id: 'spec-1', name: 'Clínica geral' }, { id: 'spec-2', name: 'Ortopedia' }], rooms: [{ id: 'room-1', unitId: 'unit-1', name: 'Consultório 01' }, { id: 'room-2', unitId: 'unit-1', name: 'Consultório 02' }], professionals: [{ id: 'pro-1', name: 'Dra. Ana · fictício', occupation: 'Médica', photoUrl: '', specialtyId: 'spec-1', unitId: 'unit-1', days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00', duration: 30, active: true, consultationTypes: clinicTypes, fitIn: { enabled: true, maxPerDay: 2, typeIds: ['retorno'] } }, { id: 'pro-2', name: 'Dr. Marcos · fictício', occupation: 'Médico', photoUrl: '', specialtyId: 'spec-2', unitId: 'unit-1', days: [1, 2, 3, 4, 5], start: '13:00', end: '17:00', duration: 30, active: true, consultationTypes: orthoTypes, fitIn: { enabled: true, maxPerDay: 1, typeIds: [] } }], patients: [{ id: 'pat-1', name: 'Paciente demonstração 01', phone: '', birthDate: '', occupation: 'Analista administrativo', photoUrl: '' }, { id: 'pat-2', name: 'Paciente demonstração 02', phone: '', birthDate: '', occupation: 'Profissional autônomo', photoUrl: '' }], appointments: [{ id: 'appointment-1', patientId: 'pat-1', professionalId: 'pro-1', roomId: 'room-1', date: day, time: '09:00', duration: 30, status: 'Agendada', source: 'Recepção', reference: 'DEMO-001', typeId: 'primeira', fitIn: false, history: [{ at: now.toISOString(), action: 'Agendamento demonstrativo', reason: '' }] }], fitInRequests: [], staff: [{ id: 'staff-1', name: 'Recepção · demonstração', phone: '', whatsappOptIn: false }], notifications: [], audit: [] };
}

/** Validações comuns a consulta normal e encaixe: agenda, data, profissional, paciente, sala e dia de atendimento. */
function baseProblem(data: HospitalData, input: Booking, now: Date): string | { p: Professional; type: ConsultationType } {
  if (!data.config.agendaEnabled) return 'Módulo de agenda desativado.';
  if (!date.safeParse(input.date).success || !time.safeParse(input.time).success) return 'Informe uma data e um horário válidos.';
  const current = localNow(data.config.timezone, now);
  if (input.date < current.date || (input.date === current.date && input.time <= current.time)) return 'O horário precisa estar no futuro.';
  const p = data.professionals.find(p => p.id === input.professionalId);
  if (!p?.active) return 'Selecione um profissional ativo.';
  if (!data.patients.some(p => p.id === input.patientId)) return 'Selecione um paciente cadastrado.';
  if (!data.rooms.some(r => r.id === input.roomId && r.unitId === p.unitId)) return 'A sala deve pertencer à unidade do profissional.';
  if (!p.days.includes(dayOfWeek(input.date))) return 'Profissional indisponível nesse dia da semana.';
  const type = resolveType(p, input.typeId);
  if (!type) return 'Esse tipo de consulta não é atendido por esse profissional.';
  return { p, type };
}

/** Retorno exige consulta concluída com o mesmo profissional dentro do prazo do tipo. */
function returnProblem(data: HospitalData, p: Professional, type: ConsultationType, patientId: string, day: string) {
  if (!type.returnWindowDays) return '';
  const since = plusDays(day, -type.returnWindowDays);
  const ok = data.appointments.some(a => a.professionalId === p.id && a.patientId === patientId && a.status === 'Concluída' && a.date >= since && a.date < day);
  return ok ? '' : `${type.name} disponível somente até ${type.returnWindowDays} dias após consulta concluída com o mesmo profissional.`;
}

export function bookingProblem(data: HospitalData, input: Booking, exceptId = '', now = new Date()): string {
  const base = baseProblem(data, input, now);
  if (typeof base === 'string') return base;
  const { p, type } = base;
  const start = minutes(input.time);
  if (start < minutes(p.start) || start + type.duration > minutes(p.end) || (start - minutes(p.start)) % p.duration !== 0) return 'Horário fora da grade de atendimento do profissional.';
  if (type.dailyLimit) {
    const booked = data.appointments.filter(a => a.id !== exceptId && a.professionalId === p.id && a.date === input.date && occupies(a) && !a.fitIn && effectiveTypeId(a, p) === type.id).length;
    if (booked >= type.dailyLimit) return `Limite diário de ${type.name.toLocaleLowerCase('pt-BR')} atingido (${type.dailyLimit}).`;
  }
  const returning = returnProblem(data, p, type, input.patientId, input.date); if (returning) return returning;
  return conflictProblem(data, input, start, type.duration, exceptId);
}

/** Profissional, paciente e consultório não podem ter consultas sobrepostas (encaixes inclusive). */
function conflictProblem(data: HospitalData, input: Booking, start: number, duration: number, exceptId = '') {
  const conflicts = data.appointments.filter(a => a.id !== exceptId && a.date === input.date && occupies(a) && overlap(start, duration, a));
  if (conflicts.some(a => a.professionalId === input.professionalId)) return 'O profissional já possui uma consulta nesse intervalo.';
  if (conflicts.some(a => a.patientId === input.patientId)) return 'O paciente já possui uma consulta nesse intervalo.';
  if (conflicts.some(a => a.roomId === input.roomId)) return 'O consultório está ocupado nesse intervalo.';
  return '';
}

export function availableSlots(data: HospitalData, input: Omit<Booking, 'time'>, exceptId = '', now = new Date()) {
  const p = data.professionals.find(p => p.id === input.professionalId);
  if (!p) return [];
  const type = resolveType(p, input.typeId);
  if (!type) return [];
  const result: string[] = [];
  for (let n = minutes(p.start); n + type.duration <= minutes(p.end); n += p.duration) { const value = clockTime(n); if (!bookingProblem(data, { ...input, time: value }, exceptId, now)) result.push(value); }
  return result;
}

function notify(data: HospitalData, title: string, appointmentId?: string) {
  return { ...data, notifications: [...data.config.responsibleIds.map(id => ({ id: crypto.randomUUID(), appointmentId, recipientId: id, title, createdAt: new Date().toISOString(), read: false, whatsapp: data.staff.find(s => s.id === id)?.whatsappOptIn ? 'Pendente de integração' as const : 'Não autorizado' as const })), ...data.notifications] };
}

export function bookAppointment(data: HospitalData, input: Booking, origin: BookingSource = 'Recepção', now = new Date()): HospitalData {
  const problem = bookingProblem(data, input, '', now); if (problem) fail(problem);
  const p = data.professionals.find(p => p.id === input.professionalId)!, type = resolveType(p, input.typeId)!;
  const id = crypto.randomUUID();
  const appointment: Appointment = { patientId: input.patientId, professionalId: input.professionalId, roomId: input.roomId, date: input.date, time: input.time, id, reference: `AG-${id.slice(0, 8).toUpperCase()}`, duration: type.duration, typeId: type.id, fitIn: false, source: origin, status: 'Agendada', history: [{ at: now.toISOString(), action: `${type.name} criada pela ${origin}`, reason: '' }] };
  return changed(notify({ ...data, appointments: [...data.appointments, appointment] }, `Nova consulta ${appointment.reference} · ${type.name} · ${origin}`, appointment.id), `Consulta ${appointment.reference} criada`);
}

export function rescheduleAppointment(data: HospitalData, id: string, input: Booking, reason: string, now = new Date()) {
  const a = data.appointments.find(a => a.id === id);
  if (!a || !['Agendada', 'Confirmada'].includes(a.status)) fail('Somente consultas agendadas ou confirmadas podem ser reagendadas.');
  if (a.fitIn) fail('Encaixes não são reagendados: cancele e registre um novo encaixe.');
  if (!reason.trim()) fail('Informe o motivo do reagendamento.');
  if (input.patientId !== a.patientId) fail('Não é possível trocar o paciente ao reagendar.');
  const wanted = { ...input, typeId: input.typeId ?? (a.typeId || undefined) };
  const problem = bookingProblem(data, wanted, id, now); if (problem) fail(problem);
  const p = data.professionals.find(p => p.id === wanted.professionalId)!, type = resolveType(p, wanted.typeId)!;
  const next: Appointment = { ...a, patientId: wanted.patientId, professionalId: wanted.professionalId, roomId: wanted.roomId, date: wanted.date, time: wanted.time, typeId: type.id, duration: type.duration, status: 'Agendada', history: [...a.history, { at: now.toISOString(), action: 'Reagendada', reason: `${a.date} ${a.time} → ${wanted.date} ${wanted.time}. ${reason.trim()}` }] };
  return changed(notify({ ...data, appointments: data.appointments.map(a => a.id === id ? next : a) }, `Consulta ${a.reference} reagendada`, next.id), `Reagendamento ${a.reference}`);
}

/* ── Encaixes ─────────────────────────────────────────────────────────────── */

export function fitInProblem(data: HospitalData, input: Booking, now = new Date()): string {
  const base = baseProblem(data, input, now);
  if (typeof base === 'string') return base;
  const { p, type } = base;
  if (!p.fitIn.enabled) return 'Este profissional não aceita encaixes.';
  if (!fitInAccepts(p, type.id)) return `${type.name} não é aceita como encaixe para este profissional.`;
  const start = minutes(input.time);
  if (start < minutes(p.start) || start + type.duration > minutes(p.end)) return 'Encaixe fora da jornada do profissional.';
  const used = data.appointments.filter(a => a.professionalId === p.id && a.date === input.date && occupies(a) && a.fitIn).length;
  if (used >= p.fitIn.maxPerDay) return `Limite diário de encaixes atingido (${p.fitIn.maxPerDay}).`;
  const returning = returnProblem(data, p, type, input.patientId, input.date); if (returning) return returning;
  // Encaixe não precisa seguir o passo da grade, mas só entra em intervalo realmente livre.
  return conflictProblem(data, input, start, type.duration);
}

/** Intervalos livres para encaixe (passo de 5 min), fora dos horários da grade normal. */
export function fitInSlots(data: HospitalData, input: Omit<Booking, 'time'>, now = new Date()) {
  const p = data.professionals.find(p => p.id === input.professionalId);
  const type = p && resolveType(p, input.typeId);
  if (!p || !type) return [];
  const grid = new Set(availableSlots(data, input, '', now));
  const result: string[] = [];
  for (let n = minutes(p.start); n + type.duration <= minutes(p.end); n += 5) { const value = clockTime(n); if (!grid.has(value) && !fitInProblem(data, { ...input, time: value }, now)) result.push(value); }
  return result;
}

/** Encaixe registrado pela recepção, direto ou ao aprovar um pedido (ver requestFitIn). */
export function bookFitIn(data: HospitalData, input: Booking, reason: string, now = new Date()): HospitalData {
  if (!reason.trim()) fail('Informe o motivo do encaixe.');
  const problem = fitInProblem(data, input, now); if (problem) fail(problem);
  const p = data.professionals.find(p => p.id === input.professionalId)!, type = resolveType(p, input.typeId)!;
  const id = crypto.randomUUID();
  const appointment: Appointment = { patientId: input.patientId, professionalId: input.professionalId, roomId: input.roomId, date: input.date, time: input.time, id, reference: `EN-${id.slice(0, 8).toUpperCase()}`, duration: type.duration, typeId: type.id, fitIn: true, source: 'Recepção', status: 'Agendada', history: [{ at: now.toISOString(), action: `Encaixe · ${type.name}`, reason: reason.trim() }] };
  return changed(notify({ ...data, appointments: [...data.appointments, appointment] }, `Encaixe ${appointment.reference} · ${type.name}`, appointment.id), `Encaixe ${appointment.reference} registrado`);
}

export type FitInRequestInput = { patientId: string; professionalId: string; typeId?: string; date: string; preferredTime?: string; note?: string };
/** Pedido de encaixe (lista de espera). Não reserva horário; aguarda aprovação da recepção. */
export function requestFitIn(data: HospitalData, input: FitInRequestInput, origin: BookingSource = 'Recepção', now = new Date()): HospitalData {
  if (!data.config.agendaEnabled) fail('Módulo de agenda desativado.');
  const p = data.professionals.find(p => p.id === input.professionalId);
  if (!p?.active) fail('Selecione um profissional ativo.');
  if (!data.patients.some(x => x.id === input.patientId)) fail('Selecione um paciente cadastrado.');
  if (!date.safeParse(input.date).success || input.date < localNow(data.config.timezone, now).date) fail('Informe uma data válida, a partir de hoje.');
  if (!p.days.includes(dayOfWeek(input.date))) fail('Profissional indisponível nesse dia da semana.');
  const type = resolveType(p, input.typeId);
  if (!type) fail('Esse tipo de consulta não é atendido por esse profissional.');
  if (!fitInAccepts(p, type.id)) fail(p.fitIn.enabled ? `${type.name} não é aceita como encaixe para este profissional.` : 'Este profissional não aceita encaixes.');
  if (input.preferredTime && !time.safeParse(input.preferredTime).success) fail('Horário preferido inválido.');
  if (data.fitInRequests.some(r => r.status === 'Pendente' && r.patientId === input.patientId && r.professionalId === p.id && r.date === input.date)) fail('Já existe um pedido de encaixe pendente para esse paciente, profissional e data.');
  const request: FitInRequest = { id: crypto.randomUUID(), patientId: input.patientId, professionalId: p.id, typeId: type.id, date: input.date, preferredTime: input.preferredTime ?? '', note: (input.note ?? '').trim().slice(0, 500), source: origin, status: 'Pendente', createdAt: now.toISOString() };
  return changed(notify({ ...data, fitInRequests: [request, ...data.fitInRequests] }, `Pedido de encaixe · ${type.name} · ${origin}`), 'Pedido de encaixe registrado');
}

export function approveFitIn(data: HospitalData, requestId: string, slot: Pick<Booking, 'time' | 'roomId'>, reason: string, now = new Date()): HospitalData {
  const req = data.fitInRequests.find(r => r.id === requestId);
  if (!req || req.status !== 'Pendente') fail('Pedido de encaixe já resolvido ou inexistente.');
  const booked = bookFitIn(data, { patientId: req.patientId, professionalId: req.professionalId, typeId: req.typeId, date: req.date, time: slot.time, roomId: slot.roomId }, reason || `Pedido de encaixe aprovado (${req.source})`, now);
  const appointmentId = booked.appointments.at(-1)!.id;
  return { ...booked, fitInRequests: booked.fitInRequests.map(r => r.id === requestId ? { ...r, status: 'Aprovado' as const, resolvedAt: now.toISOString(), resolution: reason.trim(), appointmentId } : r) };
}

export function rejectFitIn(data: HospitalData, requestId: string, reason: string, now = new Date()): HospitalData {
  const req = data.fitInRequests.find(r => r.id === requestId);
  if (!req || req.status !== 'Pendente') fail('Pedido de encaixe já resolvido ou inexistente.');
  if (!reason.trim()) fail('Informe o motivo da recusa.');
  return changed({ ...data, fitInRequests: data.fitInRequests.map(r => r.id === requestId ? { ...r, status: 'Recusado' as const, resolvedAt: now.toISOString(), resolution: reason.trim() } : r) }, 'Pedido de encaixe recusado');
}

/* ── Critérios de ocupação: resumo por profissional e dia ── */

export function occupancyCriteria(data: HospitalData, professionalId: string, day: string, now = new Date()) {
  const p = data.professionals.find(p => p.id === professionalId);
  if (!p) fail('Profissional não encontrado.');
  const worksThatDay = p.active && p.days.includes(dayOfWeek(day));
  const dayAppointments = data.appointments.filter(a => a.professionalId === p.id && a.date === day && occupies(a));
  const fitInsUsed = dayAppointments.filter(a => a.fitIn).length;
  return {
    professional: { id: p.id, name: p.name, specialty: data.specialties.find(s => s.id === p.specialtyId)?.name ?? '', unit: data.units.find(u => u.id === p.unitId)?.name ?? '' },
    date: day,
    worksThatDay,
    hours: { start: p.start, end: p.end, gridStep: p.duration },
    types: consultationTypes(p).map(t => {
      const booked = dayAppointments.filter(a => !a.fitIn && effectiveTypeId(a, p) === t.id).length;
      return { id: t.id, name: t.name, duration: t.duration, dailyLimit: t.dailyLimit, booked, remaining: t.dailyLimit ? Math.max(0, t.dailyLimit - booked) : null, returnWindowDays: t.returnWindowDays, acceptsFitIn: fitInAccepts(p, t.id), freeSlots: worksThatDay ? availableSlots(data, { patientId: data.patients[0]?.id ?? '', professionalId: p.id, roomId: data.rooms.find(r => r.unitId === p.unitId)?.id ?? '', date: day, typeId: t.id }, '', now).length : 0 };
    }),
    fitIn: { enabled: p.fitIn.enabled, maxPerDay: p.fitIn.maxPerDay, used: fitInsUsed, remaining: p.fitIn.enabled ? Math.max(0, p.fitIn.maxPerDay - fitInsUsed) : 0, overlapAllowed: false },
  };
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
  return changed(status === 'Cancelada' ? notify(result, `Consulta ${a.reference} cancelada`, next.id) : result, `${a.reference}: ${status}`);
}

export function savePatient(data: HospitalData, input: Patient, now = new Date()) {
  const patient = patientSchema.parse(input);
  if (patient.birthDate && patient.birthDate > localNow(data.config.timezone, now).date) fail('Nascimento não pode estar no futuro.');
  return changed({ ...data, patients: data.patients.some(p => p.id === patient.id) ? data.patients.map(p => p.id === patient.id ? patient : p) : [...data.patients, patient] }, 'Cadastro administrativo de paciente atualizado');
}
export function saveProfessional(data: HospitalData, input: ProfessionalInput) {
  const p = professionalSchema.parse(input);
  if (!data.units.some(u => u.id === p.unitId) || !data.specialties.some(s => s.id === p.specialtyId)) fail('Selecione unidade e especialidade cadastradas.');
  if (new Set(p.consultationTypes.map(t => t.id)).size !== p.consultationTypes.length) fail('Há tipos de consulta repetidos.');
  if (new Set(p.consultationTypes.map(t => cleanKey(t.name))).size !== p.consultationTypes.length) fail('Há tipos de consulta com o mesmo nome.');
  if (p.fitIn.typeIds.some(id => !consultationTypes(p).some(t => t.id === id))) fail('O encaixe aponta para um tipo de consulta que não existe.');
  const previous = data.professionals.find(v => v.id === p.id);
  const open = previous ? data.appointments.filter(a => a.professionalId === p.id && isOpen(a)) : [];
  if (open.length && ['unitId', 'specialtyId', 'days', 'start', 'end', 'duration', 'active'].some(k => JSON.stringify(previous![k as keyof Professional]) !== JSON.stringify(p[k as keyof Professional]))) fail('Reagende ou encerre as consultas abertas antes de alterar a grade desse profissional.');
  // Tipos podem ganhar limites novos, mas não sumir nem mudar de duração enquanto houver consultas abertas deles.
  for (const a of open) {
    const before = resolveType(previous!, a.typeId || undefined), after = consultationTypes(p).find(t => t.id === (a.typeId || before?.id));
    if (before && (!after || after.duration !== before.duration)) fail(`O tipo "${before.name}" tem consultas abertas: não pode ser removido nem mudar de duração.`);
  }
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
/** Marcar como lido não entra no registro de alterações nem muda a revisão de conflito entre abas. */
export function readNotification(data: HospitalData, id: string) { return { ...data, notifications: data.notifications.map(n => n.id === id ? { ...n, read: true } : n) }; }
