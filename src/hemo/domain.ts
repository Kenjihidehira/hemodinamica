import { z } from 'zod';
import { availableQuantity, daysToExpiry, HEMO_CATEGORY, HEMO_LOCATION, type DemoData, type Product } from '../data.ts';
import { consumeForPatient, receiveConsignment, returnFromPatient } from '../domain.ts';

/**
 * Hemodinâmica: do pedido médico ao faturamento.
 * Cada procedimento anda por etapas fixas; cada etapa só avança quando o que ela exige está registrado.
 * Datas e horas são locais (fuso do hospital), no formato AAAA-MM-DDTHH:mm.
 * Os materiais vivem no Estoque do hospital (DemoData): cada uso em paciente é uma saída do lote,
 * e as funções que mexem em material devolvem os dois estados, para gravar juntos.
 */
export const hemoStorageKey = 'hemodinamica-demo-v1';
export const HEMO_TIMEZONE = 'America/Sao_Paulo';

export const stages = ['Autorização', 'Agendamento', 'Preparo', 'Sala', 'Recuperação', 'Laudo', 'Faturamento', 'Encerrado', 'Cancelado'] as const;
export type Stage = typeof stages[number];
export const flowStages: Stage[] = ['Autorização', 'Agendamento', 'Preparo', 'Sala', 'Recuperação', 'Laudo', 'Faturamento', 'Encerrado'];
export const accessRoutes = ['Radial direita', 'Radial esquerda', 'Femoral direita', 'Femoral esquerda', 'Braquial'] as const;
export const destinations = ['Alta no mesmo dia', 'Internação', 'UTI'] as const;

const text = z.string().trim();
export const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Informe data e hora válidas.');
const optionalStamp = z.union([stamp, z.literal('')]).default('');

const roomSchema = z.object({ id: z.string(), name: text.min(1) });
const doctorSchema = z.object({ id: z.string(), name: text.min(1), crm: text.default('') });
const patientSchema = z.object({
  id: z.string(), name: text.min(1, 'Informe o nome do paciente.'), birthDate: z.string(), sex: z.enum(['F', 'M']),
  insurance: text.min(1), cardNumber: text.default(''), weightKg: z.number().nonnegative().default(0), creatinine: z.number().nonnegative().nullable().default(null),
  allergies: z.array(text).default([]), conditions: z.array(text).default([]), medications: z.array(text).default([]),
});
/** tussCode: código do procedimento na tabela TUSS do convênio; vazio até o faturamento do hospital definir. */
const procedureTypeSchema = z.object({ id: z.string(), name: text.min(1), duration: z.number().int().min(10), turnover: z.number().int().min(0), contrast: z.boolean(), needsAuthorization: z.boolean(), tussCode: text.default('') });

/** Material usado no paciente: aponta para a posição (produto + lote + local) do Estoque do hospital. serial = etiqueta do implante. */
const usedMaterialSchema = z.object({ id: z.string(), stockId: z.string(), productId: z.string(), lot: z.string(), serial: text.default(''), quantity: z.number().int().min(1), at: z.string(), replenishedAt: z.string().default('') });
const findingSchema = z.object({ id: z.string(), vessel: text.min(1, 'Informe o vaso.'), stenosis: z.number().int().min(0).max(100), treatment: text.default('') });
const invoiceSchema = z.object({ id: z.string(), kind: z.enum(['Serviço', 'Reposição de consignado']), recipient: z.string(), items: z.array(z.string()), createdAt: z.string(), status: z.literal('Simulada') });
/** OPME pedido ao convênio: quantidade solicitada e quantidade que o convênio autorizou. */
const opmeItemSchema = z.object({ id: z.string(), productId: z.string(), requested: z.number().int().min(1, 'Quantidade de OPME deve ser pelo menos 1.'), authorized: z.number().int().min(0).default(0) });
export const glosaStatuses = ['Aberta', 'Em recurso', 'Revertida', 'Aceita'] as const;
const glosaSchema = z.object({ id: z.string(), item: text.min(1, 'Informe o item glosado.'), reason: text.min(1, 'Informe o motivo da glosa.'), at: z.string(), status: z.enum(glosaStatuses), appeal: z.string().default(''), appealFromCopilot: z.boolean().default(false), resolvedAt: z.string().default('') });
export const followUpOutcomes = ['Sem eventos', 'Evento adverso', 'Reinternação', 'Óbito', 'Sem contato'] as const;

export const prepItems = { fasting: 'Jejum confirmado', labs: 'Exames revisados (função renal e coagulação)', allergy: 'Alergia a contraste avaliada', anticoagulant: 'Conduta com anticoagulantes definida', consent: 'Termo de consentimento assinado', venousAccess: 'Acesso venoso puncionado' } as const;
export const timeoutItems = { identity: 'Paciente identificado em voz alta', procedure: 'Procedimento e via de acesso confirmados', materials: 'Materiais e equipamentos conferidos', team: 'Equipe apresentada e ciente' } as const;
const flag = z.boolean().default(false);
const prepSchema = z.object({ fasting: flag, labs: flag, allergy: flag, anticoagulant: flag, consent: flag, venousAccess: flag }).default({ fasting: false, labs: false, allergy: false, anticoagulant: false, consent: false, venousAccess: false });
const timeoutSchema = z.object({ identity: flag, procedure: flag, materials: flag, team: flag }).default({ identity: false, procedure: false, materials: false, team: false });

export const medUnits = ['UI', 'mg', 'mcg', 'mL'] as const;
export const medRoutes = ['Intravenosa', 'Intra-arterial', 'Intracoronária', 'Subcutânea', 'Oral', 'Sublingual'] as const;
/** Medicamento dado na sala: nome, dose e horário. O sistema não sugere doses. */
const medSchema = z.object({ id: z.string(), at: stamp, drug: text.min(1, 'Informe o medicamento.').max(120), dose: z.number().positive('Informe a dose.'), unit: z.enum(medUnits), route: z.enum(medRoutes) });
/** Tempo de coagulação ativado (TCA) na sala. target = alvo definido pelo médico (0 = não definido). */
const actSchema = z.object({ target: z.number().int().min(0).max(999).default(0), readings: z.array(z.object({ id: z.string(), at: stamp, seconds: z.number().int().min(50, 'TCA entre 50 e 999 segundos.').max(999, 'TCA entre 50 e 999 segundos.') })).default([]) });
const emptyRenal = { baselineEgfr: null, contrastLimitMl: null, recheckDue: '', recheckCreatinine: null, recheckAt: '', aki: false };
const emptyDischarge = { text: '', medications: '', returnDate: '', deliveredAt: '', by: '' };
const emptyConsent = { signedAt: '', signer: '', relation: 'Paciente' as const, signature: '' };

const caseSchema = z.object({
  id: z.string(), patientId: z.string(), typeId: z.string(), requestedBy: text.min(1, 'Informe o médico solicitante.'), indication: text.min(1, 'Informe a indicação clínica.'),
  priority: z.enum(['Eletivo', 'Urgência']), createdAt: z.string(), stage: z.enum(stages),
  /** Urgência: hora de chegada do paciente ao hospital (início do porta-balão). */
  doorAt: optionalStamp,
  /** "Regularizar": urgência de convênio feita antes da guia; a guia é obrigatória para fechar a conta. */
  authorization: z.object({ status: z.enum(['Não se aplica', 'Pendente', 'Autorizada', 'Negada', 'Regularizar']), guide: text.default(''), note: text.default('') }),
  opme: z.object({ items: z.array(opmeItemSchema).default([]), justification: text.default('') }).default({ items: [], justification: '' }),
  schedule: z.object({ roomId: z.string(), doctorId: z.string(), start: stamp }).nullable().default(null),
  prep: prepSchema, prepNotes: text.default(''),
  timeout: timeoutSchema,
  intra: z.object({ roomIn: optionalStamp, start: optionalStamp, balloonAt: optionalStamp, end: optionalStamp, access: z.union([z.enum(accessRoutes), z.literal('')]).default(''), contrastMl: z.number().min(0).default(0), fluoroMin: z.number().min(0).default(0), kermaMgy: z.number().min(0).default(0), complications: text.default('') }).default({ roomIn: '', start: '', balloonAt: '', end: '', access: '', contrastMl: 0, fluoroMin: 0, kermaMgy: 0, complications: '' }),
  materials: z.array(usedMaterialSchema).default([]),
  recovery: z.object({ hemostasis: text.default(''), stable: z.boolean().default(false), destination: z.union([z.enum(destinations), z.literal('')]).default(''), notes: text.default('') }).default({ hemostasis: '', stable: false, destination: '', notes: '' }),
  findings: z.array(findingSchema).default([]),
  report: z.object({ text: z.string().default(''), conclusion: z.string().default(''), copilotDraft: z.boolean().default(false), signedAt: z.string().default(''), signedBy: z.string().default('') }).default({ text: '', conclusion: '', copilotDraft: false, signedAt: '', signedBy: '' }),
  invoices: z.array(invoiceSchema).default([]),
  /** Conta enviada ao convênio (simulada) e glosas recebidas. */
  claim: z.object({ sentAt: z.string().default(''), glosas: z.array(glosaSchema).default([]) }).default({ sentAt: '', glosas: [] }),
  /** Contato de 30 dias após o procedimento. */
  followUp: z.object({ due: z.string().default(''), doneAt: z.string().default(''), outcome: z.union([z.enum(followUpOutcomes), z.literal('')]).default(''), notes: text.default('') }).default({ due: '', doneAt: '', outcome: '', notes: '' }),
  cancelReason: text.default(''),
  /** Urgência por etapas: ECG, acionamento da equipe de sobreaviso e chegada dela. Punção = intra.start. */
  urgency: z.object({ ecgAt: optionalStamp, teamCalledAt: optionalStamp, teamArrivedAt: optionalStamp }).default({ ecgAt: '', teamCalledAt: '', teamArrivedAt: '' }),
  meds: z.array(medSchema).default([]),
  act: actSchema.default({ target: 0, readings: [] }),
  /** Função renal no fim do procedimento (TFG estimada, limite de contraste) e creatinina de controle. */
  renal: z.object({ baselineEgfr: z.number().nullable().default(null), contrastLimitMl: z.number().nullable().default(null), recheckDue: z.string().default(''), recheckCreatinine: z.number().nullable().default(null), recheckAt: z.string().default(''), aki: z.boolean().default(false) }).default(emptyRenal),
  /** Pulseira de compressão radial: colocação, tempo até liberar (protocolo do serviço) e retirada. */
  band: z.object({ placedAt: optionalStamp, releaseMin: z.number().int().min(0).max(480).default(0), removedAt: optionalStamp }).default({ placedAt: '', releaseMin: 0, removedAt: '' }),
  discharge: z.object({ text: z.string().default(''), medications: z.string().default(''), returnDate: z.string().default(''), deliveredAt: z.string().default(''), by: z.string().default('') }).default(emptyDischarge),
  /** Termo de consentimento assinado na tela (assinatura eletrônica simples, sem certificado). */
  consent: z.object({ signedAt: z.string().default(''), signer: z.string().default(''), relation: z.enum(['Paciente', 'Responsável legal']).default('Paciente'), signature: z.string().max(400_000).default('') }).default(emptyConsent),
  /** Exame no sistema de imagens (PACS): número de acesso e link para abrir as imagens. */
  imaging: z.object({ accession: text.max(64).default(''), url: z.string().max(500).default('') }).default({ accession: '', url: '' }),
});
/** by = usuário logado que fez a ação (preenchido ao gravar; vazio em registros antigos). */
const auditSchema = z.object({ id: z.string(), at: z.string(), caseId: z.string().default(''), action: z.string(), detail: z.string(), by: z.string().default('') });

export const hemoSchema = z.object({
  schemaVersion: z.literal(2), revision: z.number().int().min(0),
  rooms: z.array(roomSchema), doctors: z.array(doctorSchema), patients: z.array(patientSchema), types: z.array(procedureTypeSchema),
  cases: z.array(caseSchema), audit: z.array(auditSchema).default([]),
  /** Escala de sobreaviso: hemodinamicista de plantão para urgência em cada dia. */
  onCall: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), doctorId: z.string() })).default([]),
});
export type HemoData = z.infer<typeof hemoSchema>;
export type HemoCase = HemoData['cases'][number];
export type HemoPatient = HemoData['patients'][number];
export type Finding = HemoCase['findings'][number];
export type Intra = HemoCase['intra'];
export type Recovery = HemoCase['recovery'];
export type PrepChecks = HemoCase['prep'];
export type TimeoutChecks = HemoCase['timeout'];
export type OpmeItem = HemoCase['opme']['items'][number];
export type Glosa = HemoCase['claim']['glosas'][number];
export type GlosaStatus = typeof glosaStatuses[number];
export type FollowUpOutcome = typeof followUpOutcomes[number];
export type Medication = HemoCase['meds'][number];

/**
 * Versão 1 tinha estoque próprio (materials/lots). Os materiais de demonstração viraram produtos do Estoque
 * com os mesmos números (mat-N → hem-N, lot-N → hs-N); os registros de uso passam a apontar para eles.
 */
function migrate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return value;
  const old = value as { cases?: { materials?: { lotId?: string; materialId?: string }[] }[]; materials?: unknown; lots?: unknown };
  const map = (id = '', from: string, to: string) => id.startsWith(from) ? to + id.slice(from.length) : id;
  const { materials: _materials, lots: _lots, ...rest } = old;
  return { ...rest, schemaVersion: 2, cases: (old.cases ?? []).map(c => ({ ...c, materials: (c.materials ?? []).map(({ lotId, materialId, ...m }) => ({ ...m, stockId: map(lotId, 'lot-', 'hs-'), productId: map(materialId, 'mat-', 'hem-') })) })) };
}
export function parseHemoData(value: unknown): HemoData {
  const data = hemoSchema.parse(migrate(value));
  for (const c of data.cases) if (!data.patients.some(p => p.id === c.patientId) || !data.types.some(t => t.id === c.typeId)) throw new Error('Procedimento com paciente ou tipo inexistente.');
  return data;
}

export const newId = () => crypto.randomUUID();
export const minutesOf = (value: string) => Date.parse(`${value}:00Z`) / 60_000;
export const addMinutes = (value: string, minutes: number) => new Date((minutesOf(value) + minutes) * 60_000).toISOString().slice(0, 16);
/** Hora local do hospital, no mesmo formato das agendas. */
export function localStamp(now = new Date(), timeZone = HEMO_TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function ageAt(birthDate: string, now = new Date()) {
  const [y, m, d] = birthDate.split('-').map(Number), [ty, tm, td] = localStamp(now).slice(0, 10).split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
export const daysUntil = (date: string, now = new Date()) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${localStamp(now).slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export const findCase = (data: HemoData, caseId: string) => { const c = data.cases.find(item => item.id === caseId); if (!c) throw new Error('Procedimento não encontrado.'); return c; };
export const patientOf = (data: HemoData, c: HemoCase) => data.patients.find(p => p.id === c.patientId)!;
export const typeOf = (data: HemoData, c: HemoCase) => data.types.find(t => t.id === c.typeId)!;
/** Produto do Estoque; se tiver sido removido do catálogo, o histórico do caso continua legível. */
export const productOf = (catalog: Product[], id: string): Product => catalog.find(p => p.id === id) ?? { id, name: 'Produto fora do catálogo', code: '', category: '', minimum: 0, supplier: '', consigned: false };
const stockReference = (data: HemoData, c: HemoCase) => `${patientOf(data, c).name} · ${typeOf(data, c).name} · caso ${c.id.slice(0, 8)}`;
export type WithStock = { hemo: HemoData; stock: DemoData };

export function commit(data: HemoData, caseId: string, change: (c: HemoCase) => HemoCase, action: string, detail: string, now: Date, extra: Partial<HemoData> = {}): HemoData {
  return { ...data, ...extra, revision: data.revision + 1, cases: data.cases.map(c => c.id === caseId ? change(c) : c), audit: [{ id: newId(), at: now.toISOString(), caseId, action, detail, by: '' }, ...data.audit] };
}
export function requireStage(c: HemoCase, ...allowed: Stage[]) {
  if (!allowed.includes(c.stage)) throw new Error(`Esta ação não vale na etapa atual (${c.stage}).`);
}
export const insured = (p: HemoPatient) => p.insurance.trim().toLocaleLowerCase('pt-BR') !== 'particular';

// ---------- Função renal e contraste ----------
/**
 * TFG estimada pela equação CKD-EPI 2021 (sem raça), em mL/min/1,73 m².
 * Usa creatinina sérica (mg/dL), idade e sexo já registrados no paciente.
 */
export function egfr(creatinine: number | null, age: number, sex: 'F' | 'M') {
  if (creatinine === null || creatinine <= 0 || !Number.isFinite(age)) return null;
  const k = sex === 'F' ? 0.7 : 0.9, a = sex === 'F' ? -0.241 : -0.302, r = creatinine / k;
  return Math.round(142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** age * (sex === 'F' ? 1.012 : 1));
}
/** Referências do serviço, ajustáveis: TFG abaixo da qual há risco renal com contraste e razão volume/TFG. */
export const EGFR_ATTENTION = 60, EGFR_HIGH_RISK = 30, CONTRAST_EGFR_RATIO = 3.7;
/** Creatinina de controle entre 48 e 72 h após o contraste. */
export const RENAL_RECHECK_DAYS = 2;
export function renalProfile(data: HemoData, c: HemoCase, now = new Date()) {
  const p = patientOf(data, c), t = typeOf(data, c);
  const value = egfr(p.creatinine, ageAt(p.birthDate, now), p.sex);
  const risk = value === null ? null : value < EGFR_HIGH_RISK ? 'alto' as const : value < EGFR_ATTENTION ? 'atenção' as const : 'baixo' as const;
  return { egfr: value, risk, contrastLimitMl: t.contrast && value !== null ? Math.round(value * CONTRAST_EGFR_RATIO) : null };
}
/** Aviso na sala quando o contraste passa do limite sugerido (TFG × razão do serviço). */
export function contrastWarning(data: HemoData, c: HemoCase, contrastMl: number) {
  const { contrastLimitMl } = renalProfile(data, c);
  return contrastLimitMl !== null && contrastMl > contrastLimitMl ? `Contraste de ${contrastMl} mL acima do limite sugerido de ${contrastLimitMl} mL (TFG × ${CONTRAST_EGFR_RATIO.toLocaleString('pt-BR')}). Programe creatinina de controle.` : '';
}
/** Creatinina de controle após o contraste. Lesão renal aguda (critério KDIGO): alta ≥ 0,3 mg/dL ou ≥ 1,5 vez a basal. */
export function recordRenalRecheck(data: HemoData, caseId: string, creatinine: number, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  if (!c.renal.recheckDue) throw new Error('Este procedimento não tem creatinina de controle programada.');
  if (!Number.isFinite(creatinine) || creatinine <= 0 || creatinine > 20) throw new Error('Informe a creatinina em mg/dL.');
  const baseline = patientOf(data, c).creatinine;
  // Em centésimos de mg/dL: 1,2 − 0,9 em ponto flutuante dá 0,2999… e não pode deixar de contar como alta de 0,3.
  const cents = (v: number) => Math.round(v * 100);
  const aki = baseline !== null && (cents(creatinine) - cents(baseline) >= 30 || cents(creatinine) * 2 >= cents(baseline) * 3);
  return commit(data, caseId, x => ({ ...x, renal: { ...x.renal, recheckCreatinine: creatinine, recheckAt: now.toISOString(), aki } }), 'Creatinina de controle', `${creatinine.toLocaleString('pt-BR')} mg/dL${baseline !== null ? ` (basal ${baseline.toLocaleString('pt-BR')})` : ''}${aki ? ' · possível lesão renal aguda pelo contraste' : ''}`, now);
}
export function pendingRenalRechecks(data: HemoData, now = new Date()) {
  return data.cases.filter(c => c.renal.recheckDue && c.renal.recheckCreatinine === null && c.stage !== 'Cancelado').map(c => ({ c, days: daysUntil(c.renal.recheckDue, now) })).sort((a, b) => a.days - b.days);
}

// ---------- 1. Pedido e autorização ----------
export type CaseRequest = { patientId: string; typeId: string; requestedBy: string; indication: string; priority: 'Eletivo' | 'Urgência' };
export function requestCase(data: HemoData, input: CaseRequest, now = new Date()): HemoData {
  const patient = data.patients.find(p => p.id === input.patientId), type = data.types.find(t => t.id === input.typeId);
  if (!patient) throw new Error('Selecione o paciente.');
  if (!type) throw new Error('Selecione o procedimento.');
  if (data.cases.some(c => c.patientId === patient.id && c.typeId === type.id && !['Encerrado', 'Cancelado'].includes(c.stage))) throw new Error('Este paciente já tem esse procedimento em andamento.');
  const needsAuth = type.needsAuthorization && insured(patient);
  const draft = caseSchema.parse({ ...input, id: newId(), createdAt: now.toISOString(), stage: needsAuth ? 'Autorização' : 'Agendamento', authorization: { status: needsAuth ? 'Pendente' : 'Não se aplica' } });
  return { ...data, revision: data.revision + 1, cases: [draft, ...data.cases], audit: [{ id: newId(), at: now.toISOString(), caseId: draft.id, action: 'Pedido registrado', detail: `${type.name} · ${patient.name} · ${input.priority}`, by: '' }, ...data.audit] };
}
/**
 * Decide a autorização. authorized = quantidade de OPME que o convênio liberou por item do pedido
 * (sem informar, vale o que foi pedido). Autorização parcial é comum e fica registrada.
 */
export function decideAuthorization(data: HemoData, caseId: string, approved: boolean, guide: string, note: string, now = new Date(), authorized: Record<string, number> = {}): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Autorização');
  if (approved && !guide.trim()) throw new Error('Informe o número da guia autorizada.');
  if (!approved && !note.trim()) throw new Error('Informe o motivo da negativa.');
  const items = c.opme.items.map(item => {
    const value = approved ? authorized[item.id] ?? item.requested : 0;
    if (!Number.isInteger(value) || value < 0 || value > item.requested) throw new Error('A quantidade autorizada de OPME deve ficar entre 0 e a quantidade pedida.');
    return { ...item, authorized: value };
  });
  const partial = items.some(i => i.authorized < i.requested);
  return commit(data, caseId, x => ({ ...x, stage: approved ? 'Agendamento' : 'Cancelado', opme: { ...x.opme, items }, authorization: { status: approved ? 'Autorizada' : 'Negada', guide: guide.trim(), note: note.trim() }, cancelReason: approved ? '' : `Autorização negada: ${note.trim()}` }), approved ? 'Autorização registrada' : 'Autorização negada', approved ? `Guia ${guide.trim()}${items.length ? ` · OPME ${partial ? 'autorizado parcialmente' : 'autorizado'}` : ''}` : note.trim(), now);
}

// ---------- OPME: órteses, próteses e materiais especiais (no convênio, exigem autorização própria) ----------
export const isOpme = (p: Product) => !!(p.consigned || p.implantable);
export type OpmeRequest = { productId: string; requested: number }[];
/** Pedido de OPME junto da autorização: o que o médico prevê usar e a justificativa clínica. */
export function saveOpme(data: HemoData, catalog: Product[], caseId: string, items: OpmeRequest, justification: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Autorização');
  const merged = new Map<string, number>();
  for (const item of items) {
    const product = catalog.find(p => p.id === item.productId);
    if (!product || !isOpme(product)) throw new Error('Escolha um material OPME do catálogo (consignado ou implantável).');
    if (!Number.isInteger(item.requested) || item.requested < 1) throw new Error('Quantidade de OPME deve ser pelo menos 1.');
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.requested);
  }
  if (merged.size && !justification.trim()) throw new Error('Escreva a justificativa clínica do OPME: sem ela o convênio costuma negar.');
  const next = [...merged].map(([productId, requested]) => ({ id: c.opme.items.find(i => i.productId === productId)?.id ?? newId(), productId, requested, authorized: 0 }));
  return commit(data, caseId, x => ({ ...x, opme: { items: next, justification: justification.trim() } }), 'Pedido de OPME', next.length ? next.map(i => `${i.requested} × ${productOf(catalog, i.productId).name}`).join('; ') : 'Sem OPME', now);
}
/** OPME usado acima do autorizado pelo convênio: é o que mais vira glosa. */
export function opmeGaps(data: HemoData, catalog: Product[], c: HemoCase) {
  if (!insured(patientOf(data, c)) || c.authorization.status !== 'Autorizada') return [];
  const used = new Map<string, number>();
  for (const m of c.materials) if (isOpme(productOf(catalog, m.productId))) used.set(m.productId, (used.get(m.productId) ?? 0) + m.quantity);
  return [...used].map(([productId, quantity]) => ({ product: productOf(catalog, productId), used: quantity, authorized: c.opme.items.filter(i => i.productId === productId).reduce((s, i) => s + i.authorized, 0) })).filter(g => g.used > g.authorized);
}

// ---------- Urgência: entra direto, fura a agenda e mede o porta-balão ----------
export const DOOR_TO_BALLOON_TARGET_MIN = 90;
export type EmergencyInput = { patientId: string; typeId: string; roomId: string; doctorId: string; indication: string; requestedBy: string; doorAt: string; ecgAt?: string };
/** Urgência não espera autorização (convênio fica para regularizar) nem agenda livre: a sala é tomada agora. */
export function startEmergency(data: HemoData, input: EmergencyInput, now = new Date()): HemoData {
  const patient = data.patients.find(p => p.id === input.patientId), type = data.types.find(t => t.id === input.typeId);
  if (!patient) throw new Error('Selecione o paciente.');
  if (!type) throw new Error('Selecione o procedimento.');
  if (!data.rooms.some(r => r.id === input.roomId)) throw new Error('Selecione a sala.');
  if (!data.doctors.some(d => d.id === input.doctorId)) throw new Error('Selecione o hemodinamicista de sobreaviso.');
  if (!stamp.safeParse(input.doorAt).success) throw new Error('Informe a hora de chegada do paciente.');
  const at = localStamp(now);
  if (input.doorAt > at) throw new Error('A chegada não pode ser no futuro.');
  const ecgAt = input.ecgAt?.trim() ?? '';
  if (ecgAt && (!stamp.safeParse(ecgAt).success || ecgAt < input.doorAt || ecgAt > at)) throw new Error('O ECG deve ser entre a chegada e agora.');
  if (data.cases.some(c => c.patientId === patient.id && ['Sala', 'Recuperação'].includes(c.stage))) throw new Error('Este paciente já está em sala ou em recuperação.');
  const regularize = type.needsAuthorization && insured(patient);
  const draft = caseSchema.parse({ id: newId(), patientId: patient.id, typeId: type.id, requestedBy: input.requestedBy || 'Emergência', indication: input.indication, priority: 'Urgência', createdAt: now.toISOString(), stage: 'Preparo', doorAt: input.doorAt, urgency: { ecgAt, teamCalledAt: '', teamArrivedAt: '' }, authorization: { status: regularize ? 'Regularizar' : 'Não se aplica' }, schedule: { roomId: input.roomId, doctorId: input.doctorId, start: at } });
  return { ...data, revision: data.revision + 1, cases: [draft, ...data.cases], audit: [{ id: newId(), at: now.toISOString(), caseId: draft.id, action: 'Urgência aberta', detail: `${type.name} · ${patient.name} · chegada ${input.doorAt.slice(11)}`, by: '' }, ...data.audit] };
}
/** Eletivos que a urgência atropelou na mesma sala: precisam ser remarcados. */
export function displacedBy(data: HemoData, c: HemoCase) {
  if (c.priority !== 'Urgência' || !c.schedule || ['Encerrado', 'Cancelado', 'Faturamento', 'Laudo'].includes(c.stage)) return [];
  const mine = occupancy(data, c, c.schedule.start);
  return data.cases.filter(o => o.id !== c.id && o.priority === 'Eletivo' && o.stage === 'Preparo' && o.schedule?.roomId === c.schedule!.roomId && o.schedule.start < mine.freeAt && occupancy(data, o, o.schedule.start).freeAt > mine.start);
}
/** Minutos entre a chegada e a abertura da artéria; null se não houver os dois horários. */
export const doorToBalloon = (c: HemoCase) => c.doorAt && c.intra.balloonAt ? minutesOf(c.intra.balloonAt) - minutesOf(c.doorAt) : null;
/** Urgência de convênio: registra a guia depois do procedimento; o OPME usado vira o OPME autorizado. */
export function regularizeAuthorization(data: HemoData, catalog: Product[], caseId: string, guide: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  if (c.authorization.status !== 'Regularizar') throw new Error('Este procedimento não tem autorização a regularizar.');
  if (!guide.trim()) throw new Error('Informe o número da guia.');
  const used = new Map<string, number>();
  for (const m of c.materials) if (isOpme(productOf(catalog, m.productId))) used.set(m.productId, (used.get(m.productId) ?? 0) + m.quantity);
  const items = [...used].map(([productId, quantity]) => ({ id: newId(), productId, requested: quantity, authorized: quantity }));
  return commit(data, caseId, x => ({ ...x, authorization: { status: 'Autorizada', guide: guide.trim(), note: 'Regularizada após urgência' }, opme: { items, justification: x.opme.justification || `Urgência: ${x.indication}` } }), 'Autorização regularizada', `Guia ${guide.trim()}`, now);
}

// ---------- 2. Agenda da sala ----------
export type ScheduleInput = { roomId: string; doctorId: string; start: string };
/** Ocupação = duração do procedimento + preparo da sala depois dele. */
export const occupancy = (data: HemoData, c: { typeId: string }, start: string) => { const t = data.types.find(x => x.id === c.typeId)!; return { start, end: addMinutes(start, t.duration), freeAt: addMinutes(start, t.duration + t.turnover) }; };
export function scheduleProblem(data: HemoData, caseId: string, input: ScheduleInput, now = new Date()): string {
  const c = findCase(data, caseId);
  if (!data.rooms.some(r => r.id === input.roomId)) return 'Selecione a sala.';
  if (!data.doctors.some(d => d.id === input.doctorId)) return 'Selecione o hemodinamicista.';
  if (!stamp.safeParse(input.start).success) return 'Informe data e hora válidas.';
  if (input.start < localStamp(now)) return 'Escolha um horário futuro.';
  const mine = occupancy(data, c, input.start);
  for (const other of data.cases) {
    if (other.id === c.id || !other.schedule || ['Encerrado', 'Cancelado', 'Faturamento', 'Laudo'].includes(other.stage)) continue;
    const theirs = occupancy(data, other, other.schedule.start);
    const roomClash = other.schedule.roomId === input.roomId && mine.start < theirs.freeAt && theirs.start < mine.freeAt;
    const doctorClash = other.schedule.doctorId === input.doctorId && mine.start < theirs.end && theirs.start < mine.end;
    const patientClash = other.patientId === c.patientId && mine.start < theirs.end && theirs.start < mine.end;
    const when = theirs.start.slice(11);
    if (roomClash) return `A sala está ocupada às ${when} (procedimento + preparo da sala até ${theirs.freeAt.slice(11)}).`;
    if (doctorClash) return `O hemodinamicista já tem procedimento às ${when}.`;
    if (patientClash) return `O paciente já tem procedimento às ${when}.`;
  }
  return '';
}
export function scheduleCase(data: HemoData, caseId: string, input: ScheduleInput, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Agendamento', 'Preparo');
  const problem = scheduleProblem(data, caseId, input, now);
  if (problem) throw new Error(problem);
  const room = data.rooms.find(r => r.id === input.roomId)!.name, doctor = data.doctors.find(d => d.id === input.doctorId)!.name;
  return commit(data, caseId, x => ({ ...x, stage: 'Preparo', schedule: { ...input } }), c.schedule ? 'Reagendado' : 'Agendado', `${input.start.replace('T', ' ')} · ${room} · ${doctor}`, now);
}
/** Horários livres de 15 em 15 minutos num dia, para sala e médico escolhidos. */
export function freeStarts(data: HemoData, caseId: string, roomId: string, doctorId: string, day: string, now = new Date(), from = '07:00', to = '19:00') {
  const out: string[] = [];
  for (let t = `${day}T${from}`; t <= `${day}T${to}`; t = addMinutes(t, 15)) if (!scheduleProblem(data, caseId, { roomId, doctorId, start: t }, now)) out.push(t);
  return out;
}

// ---------- 3. Preparo e time-out ----------
/** Alertas que vêm direto dos dados do paciente; não dependem do copilot. */
export function safetyAlerts(data: HemoData, c: HemoCase) {
  const p = patientOf(data, c), t = typeOf(data, c), alerts: { level: 'alto' | 'atenção'; text: string }[] = [];
  const has = (list: string[], re: RegExp) => list.some(item => re.test(item.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()));
  if (t.contrast && has(p.allergies, /contraste|iodo/)) alerts.push({ level: 'alto', text: 'Alergia a contraste iodado registrada.' });
  if (t.contrast && p.creatinine === null) alerts.push({ level: 'atenção', text: 'Sem creatinina registrada para um procedimento com contraste.' });
  const renal = renalProfile(data, c);
  if (t.contrast && p.creatinine !== null && renal.egfr !== null && (renal.risk !== 'baixo' || p.creatinine >= 1.5)) alerts.push({ level: renal.risk === 'alto' ? 'alto' : 'atenção', text: `Creatinina ${p.creatinine.toLocaleString('pt-BR')} mg/dL · TFG estimada ${renal.egfr} mL/min/1,73 m²: risco renal com contraste. Limite sugerido de contraste: ${renal.contrastLimitMl} mL; prevenção conforme protocolo do serviço.` });
  if (has(p.medications, /varfarina|apixabana|rivaroxabana|dabigatrana|edoxabana|heparina|enoxaparina/)) alerts.push({ level: 'atenção', text: 'Usa anticoagulante: confirmar conduta antes do procedimento.' });
  if (t.contrast && has(p.medications, /metformina/)) alerts.push({ level: 'atenção', text: 'Usa metformina: confirmar conduta com o contraste.' });
  return alerts;
}
/** O que falta para entrar em sala. Na urgência, o preparo eletivo não bloqueia; o time-out continua obrigatório. */
export function prepMissing(c: HemoCase) {
  const prep = c.priority === 'Urgência' ? [] : (Object.keys(prepItems) as (keyof typeof prepItems)[]).filter(k => !c.prep[k]).map(k => prepItems[k]);
  return [...prep, ...(Object.keys(timeoutItems) as (keyof typeof timeoutItems)[]).filter(k => !c.timeout[k]).map(k => `Time-out: ${timeoutItems[k]}`)];
}
export function savePrep(data: HemoData, caseId: string, prep: PrepChecks, timeout: TimeoutChecks, notes: string, now = new Date()): HemoData {
  requireStage(findCase(data, caseId), 'Preparo');
  return commit(data, caseId, x => ({ ...x, prep: { ...prep }, timeout: { ...timeout }, prepNotes: notes.trim() }), 'Preparo atualizado', `${Object.values(prep).filter(Boolean).length}/${Object.keys(prepItems).length} itens do preparo · ${Object.values(timeout).filter(Boolean).length}/${Object.keys(timeoutItems).length} do time-out`, now);
}
export function startProcedure(data: HemoData, caseId: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Preparo');
  if (!c.schedule) throw new Error('Agende a sala antes de iniciar.');
  const missing = prepMissing(c);
  if (missing.length) throw new Error(`Falta concluir: ${missing.slice(0, 3).join('; ')}${missing.length > 3 ? '…' : ''}`);
  const at = localStamp(now);
  return commit(data, caseId, x => ({ ...x, stage: 'Sala', intra: { ...x.intra, roomIn: at } }), 'Paciente em sala', at.replace('T', ' '), now);
}

// ---------- 4. Sala: materiais com rastreio por paciente ----------
/**
 * Baixa no Estoque do hospital (saída "Uso em paciente") e registro no caso, juntos.
 * Implantável: uma unidade por registro, com o número de série da etiqueta (não pode repetir).
 */
export function consumeMaterial(data: HemoData, stock: DemoData, caseId: string, stockId: string, quantity: number, now = new Date(), serial = ''): WithStock {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  const position = stock.stock.find(s => s.id === stockId);
  if (!position) throw new Error('Lote não encontrado no estoque.');
  const product = productOf(stock.products, position.productId), tag = serial.trim();
  if (product.implantable) {
    if (!tag) throw new Error('Implantável: informe o número de série da etiqueta.');
    if (quantity !== 1) throw new Error('Implantável: registre uma unidade por vez, cada uma com sua série.');
    if (data.cases.some(other => other.materials.some(m => m.productId === product.id && m.serial.toLocaleUpperCase('pt-BR') === tag.toLocaleUpperCase('pt-BR')))) throw new Error(`A série ${tag} já foi registrada em outro uso.`);
  }
  const nextStock = consumeForPatient(stock, stockId, quantity, `${stockReference(data, c)}${tag ? ` · série ${tag}` : ''}`);
  return { stock: nextStock, hemo: commit(data, caseId, x => ({ ...x, materials: [...x.materials, { id: newId(), stockId, productId: position.productId, lot: position.lot, serial: tag, quantity, at: now.toISOString(), replenishedAt: '' }] }), 'Material usado', `${quantity} × ${product.name} · lote ${position.lot}${tag ? ` · série ${tag}` : ''}${product.consigned ? ' · consignado' : ''}`, now) };
}
export function returnMaterial(data: HemoData, stock: DemoData, caseId: string, usedId: string, now = new Date()): WithStock {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  const used = c.materials.find(m => m.id === usedId);
  if (!used) throw new Error('Registro de material não encontrado.');
  if (!stock.stock.some(s => s.id === used.stockId)) throw new Error('A posição de estoque deste lote não existe mais. Registre a entrada pelo Estoque.');
  const nextStock = returnFromPatient(stock, used.stockId, used.quantity, stockReference(data, c));
  return { stock: nextStock, hemo: commit(data, caseId, x => ({ ...x, materials: x.materials.filter(m => m.id !== usedId) }), 'Material devolvido', `${used.quantity} × ${productOf(stock.products, used.productId).name} · lote ${used.lot}`, now) };
}
/** Lotes da hemodinâmica que podem ir para o paciente agora: saldo disponível, sem vencidos; o que vence primeiro vem antes. */
export function usableLots(stock: DemoData) {
  return stock.stock.filter(s => productOf(stock.products, s.productId).category === HEMO_CATEGORY && availableQuantity(s) > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}
export function intraProblem(data: HemoData, c: HemoCase, intra: Intra) {
  if (!intra.access) return 'Informe a via de acesso.';
  if (!intra.start || !intra.end) return 'Informe início e fim do procedimento.';
  if (intra.end <= intra.start) return 'O fim deve ser depois do início.';
  if (c.intra.roomIn && intra.start < c.intra.roomIn) return 'O início não pode ser antes da entrada na sala.';
  if (intra.balloonAt && (intra.balloonAt < intra.start || intra.balloonAt > intra.end)) return 'A abertura da artéria deve ficar entre o início e o fim.';
  if (typeOf(data, c).contrast && intra.contrastMl <= 0) return 'Informe o volume de contraste usado.';
  return '';
}
export const FOLLOW_UP_DAYS = 30;
/** Tempo até liberar a pulseira radial: referência do serviço, ajustável caso a caso conforme protocolo. */
export const BAND_RELEASE_REFERENCE_MIN = 120;
export function finishProcedure(data: HemoData, caseId: string, intra: Intra, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  const problem = intraProblem(data, c, intra);
  if (problem) throw new Error(problem);
  const due = addMinutes(`${intra.end.slice(0, 10)}T00:00`, FOLLOW_UP_DAYS * 24 * 60).slice(0, 10);
  const dtb = doorToBalloon({ ...c, intra });
  // Creatinina de controle quando a TFG já indica risco ou quando o contraste passou do limite sugerido.
  const renal = renalProfile(data, c, now);
  const recheck = typeOf(data, c).contrast && intra.contrastMl > 0 && (renal.risk === 'alto' || renal.risk === 'atenção' || (renal.contrastLimitMl !== null && intra.contrastMl > renal.contrastLimitMl));
  const recheckDue = recheck ? addMinutes(`${intra.end.slice(0, 10)}T00:00`, RENAL_RECHECK_DAYS * 24 * 60).slice(0, 10) : '';
  const band = intra.access.startsWith('Radial') && !c.band.placedAt ? { placedAt: intra.end, releaseMin: BAND_RELEASE_REFERENCE_MIN, removedAt: '' } : c.band;
  return commit(data, caseId, x => ({ ...x, stage: 'Recuperação', intra: { ...intra, roomIn: x.intra.roomIn, complications: intra.complications.trim() }, followUp: { ...x.followUp, due }, renal: { ...x.renal, baselineEgfr: renal.egfr, contrastLimitMl: renal.contrastLimitMl, recheckDue }, band }), 'Procedimento concluído', `${intra.access} · contraste ${intra.contrastMl} mL · fluoroscopia ${intra.fluoroMin} min${dtb !== null ? ` · porta-balão ${dtb} min` : ''}${recheckDue ? ` · creatinina de controle em ${recheckDue.split('-').reverse().join('/')}` : ''}`, now);
}

// ---------- Dose de radiação ----------
/** Nível de kerma de referência a partir do qual se agenda avaliação de pele (configurável pelo serviço). */
export const SKIN_DOSE_FOLLOWUP_MGY = 5000;
/** Dose do procedimento e acumulada do paciente em todos os procedimentos registrados. */
export function doseAlerts(data: HemoData, c: HemoCase) {
  const cumulative = data.cases.filter(o => o.patientId === c.patientId && o.stage !== 'Cancelado').reduce((s, o) => s + o.intra.kermaMgy, 0);
  const out: { level: 'alto' | 'atenção'; text: string }[] = [];
  if (c.intra.kermaMgy >= SKIN_DOSE_FOLLOWUP_MGY) out.push({ level: 'alto', text: `Kerma de ${c.intra.kermaMgy.toLocaleString('pt-BR')} mGy neste procedimento: agendar avaliação de pele (referência do serviço: ${SKIN_DOSE_FOLLOWUP_MGY.toLocaleString('pt-BR')} mGy).` });
  else if (cumulative >= SKIN_DOSE_FOLLOWUP_MGY) out.push({ level: 'atenção', text: `Dose acumulada do paciente: ${cumulative.toLocaleString('pt-BR')} mGy em ${data.cases.filter(o => o.patientId === c.patientId && o.intra.kermaMgy > 0).length} procedimentos. Considerar avaliação de pele.` });
  return { cumulative, alerts: out };
}

// ---------- Acompanhamento de 30 dias ----------
export function recordFollowUp(data: HemoData, caseId: string, outcome: FollowUpOutcome | '', notes: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Laudo', 'Faturamento', 'Encerrado');
  if (!outcome) throw new Error('Informe o resultado do contato.');
  if (outcome !== 'Sem eventos' && outcome !== 'Sem contato' && !notes.trim()) throw new Error('Descreva o evento.');
  return commit(data, caseId, x => ({ ...x, followUp: { ...x.followUp, doneAt: now.toISOString(), outcome, notes: notes.trim() } }), 'Acompanhamento de 30 dias', `${outcome}${notes.trim() ? ` · ${notes.trim()}` : ''}`, now);
}
/** Contatos de 30 dias ainda não feitos, do mais atrasado para o mais distante. */
export function pendingFollowUps(data: HemoData, now = new Date()) {
  return data.cases.filter(c => c.followUp.due && !c.followUp.doneAt && c.stage !== 'Cancelado').map(c => ({ c, days: daysUntil(c.followUp.due, now) })).sort((a, b) => a.days - b.days);
}

// ---------- 5. Recuperação ----------
export function finishRecovery(data: HemoData, caseId: string, recovery: Recovery, now = new Date()): HemoData {
  requireStage(findCase(data, caseId), 'Recuperação');
  if (!recovery.hemostasis.trim()) throw new Error('Informe como foi feita a hemostasia.');
  if (!recovery.stable) throw new Error('Confirme sinais vitais estáveis e sítio de punção sem sangramento.');
  if (!recovery.destination) throw new Error('Informe o destino do paciente.');
  return commit(data, caseId, x => ({ ...x, stage: 'Laudo', recovery: { ...recovery, hemostasis: recovery.hemostasis.trim(), notes: recovery.notes.trim() } }), 'Recuperação concluída', `${recovery.hemostasis.trim()} · ${recovery.destination}`, now);
}

// ---------- 6. Laudo ----------
export type ReportDraft = { findings: Finding[]; text: string; conclusion: string; copilotDraft: boolean };
export function saveReport(data: HemoData, caseId: string, draft: ReportDraft, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Laudo');
  const findings = draft.findings.map(f => findingSchema.parse(f));
  return commit(data, caseId, x => ({ ...x, findings, report: { ...x.report, text: draft.text, conclusion: draft.conclusion, copilotDraft: draft.copilotDraft } }), 'Laudo salvo', draft.copilotDraft ? 'Rascunho do copilot revisado pelo médico' : 'Rascunho manual', now);
}
export function signReport(data: HemoData, caseId: string, doctorId: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Laudo');
  const doctor = data.doctors.find(d => d.id === doctorId);
  if (!doctor) throw new Error('Selecione o médico que assina.');
  if (c.schedule && c.schedule.doctorId !== doctorId) throw new Error('Só o hemodinamicista do procedimento assina o laudo.');
  if (!c.report.text.trim() || !c.report.conclusion.trim()) throw new Error('Salve descrição e conclusão antes de assinar.');
  return commit(data, caseId, x => ({ ...x, stage: 'Faturamento', report: { ...x.report, signedAt: now.toISOString(), signedBy: `${doctor.name}${doctor.crm ? ` · ${doctor.crm}` : ''}` } }), 'Laudo assinado', doctor.name, now);
}

// ---------- 7. Faturamento e notas (simuladas) ----------
export function billingItems(data: HemoData, catalog: Product[], c: HemoCase) {
  return [typeOf(data, c).name, ...c.materials.map(m => `${m.quantity} × ${productOf(catalog, m.productId).name} (lote ${m.lot}${m.serial ? ` · série ${m.serial}` : ''})`), ...c.meds.map(m => `Medicamento: ${m.drug} ${m.dose.toLocaleString('pt-BR')} ${m.unit} · ${m.route.toLocaleLowerCase('pt-BR')}`)];
}
/** Gera a conta e as notas do caso: uma de serviço e uma de reposição por fornecedor de consignado. Nenhuma é emitida de verdade. */
export function closeBilling(data: HemoData, catalog: Product[], caseId: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Faturamento');
  if (c.authorization.status === 'Regularizar') throw new Error('Regularize a guia do convênio antes de fechar a conta.');
  const p = patientOf(data, c), at = now.toISOString();
  const bySupplier = new Map<string, string[]>();
  for (const m of c.materials) {
    const product = productOf(catalog, m.productId), supplier = product.supplier?.trim() || 'Fornecedor não informado';
    if (product.consigned) bySupplier.set(supplier, [...(bySupplier.get(supplier) ?? []), `${m.quantity} × ${product.name} (lote ${m.lot}) · paciente ${p.name}`]);
  }
  const invoices = [{ id: newId(), kind: 'Serviço' as const, recipient: insured(p) ? `${p.insurance}${c.authorization.guide ? ` · guia ${c.authorization.guide}` : ''}` : `${p.name} (particular)`, items: billingItems(data, catalog, c), createdAt: at, status: 'Simulada' as const }, ...[...bySupplier].map(([supplier, items]) => ({ id: newId(), kind: 'Reposição de consignado' as const, recipient: supplier, items, createdAt: at, status: 'Simulada' as const }))];
  return commit(data, caseId, x => ({ ...x, stage: 'Encerrado', invoices, claim: { ...x.claim, sentAt: insured(p) ? at : '' } }), 'Faturamento fechado', `${invoices.length} nota(s) simulada(s)${insured(p) ? ' · conta enviada ao convênio (simulado)' : ''}`, now);
}

/** Prévia dos campos da guia SP/SADT (padrão TISS). Campos que o hospital ainda não definiu vêm marcados, nunca inventados. */
export function tissPreview(data: HemoData, catalog: Product[], c: HemoCase) {
  const p = patientOf(data, c), t = typeOf(data, c), doctor = c.schedule ? data.doctors.find(d => d.id === c.schedule!.doctorId) : undefined;
  const missing = 'a definir';
  return {
    header: [
      ['Registro ANS da operadora', missing], ['Número da guia', c.authorization.guide || 'sem guia'], ['Operadora', p.insurance],
      ['Carteira do beneficiário', p.cardNumber || missing], ['Beneficiário', p.name], ['Solicitante', c.requestedBy],
      ['Executante', doctor ? `${doctor.name}${doctor.crm ? ` · ${doctor.crm}` : ''}` : missing], ['Caráter do atendimento', c.priority === 'Urgência' ? 'Urgência/emergência' : 'Eletivo'],
      ['Indicação clínica', c.indication], ['Data de realização', c.intra.start ? c.intra.start.slice(0, 10).split('-').reverse().join('/') : missing],
    ] as [string, string][],
    procedure: { code: t.tussCode || `código TUSS ${missing}`, name: t.name },
    opme: c.materials.filter(m => isOpme(productOf(catalog, m.productId))).map(m => { const prod = productOf(catalog, m.productId); return { name: prod.name, registry: prod.anvisaRegistry || missing, lot: m.lot, serial: m.serial, quantity: m.quantity, authorized: c.opme.items.filter(i => i.productId === m.productId).reduce((s, i) => s + i.authorized, 0) }; }),
  };
}

// ---------- Glosas do convênio ----------
export function registerGlosa(data: HemoData, caseId: string, item: string, reason: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Encerrado');
  if (!c.claim.sentAt) throw new Error('Só há glosa em conta enviada a convênio.');
  const glosa = glosaSchema.parse({ id: newId(), item, reason, at: now.toISOString(), status: 'Aberta' });
  return commit(data, caseId, x => ({ ...x, claim: { ...x.claim, glosas: [...x.claim.glosas, glosa] } }), 'Glosa registrada', `${glosa.item} · ${glosa.reason}`, now);
}
export function appealGlosa(data: HemoData, caseId: string, glosaId: string, appeal: string, fromCopilot: boolean, now = new Date()): HemoData {
  const c = findCase(data, caseId), g = c.claim.glosas.find(x => x.id === glosaId);
  if (!g) throw new Error('Glosa não encontrada.');
  if (g.status !== 'Aberta') throw new Error('Esta glosa já está em recurso ou encerrada.');
  if (appeal.trim().length < 20) throw new Error('Escreva o recurso (pelo menos uma frase completa).');
  return commit(data, caseId, x => ({ ...x, claim: { ...x.claim, glosas: x.claim.glosas.map(y => y.id === glosaId ? { ...y, status: 'Em recurso' as const, appeal: appeal.trim(), appealFromCopilot: fromCopilot } : y) } }), 'Recurso de glosa enviado (simulado)', `${g.item}${fromCopilot ? ' · partiu de rascunho do copilot' : ''}`, now);
}
export function resolveGlosa(data: HemoData, caseId: string, glosaId: string, result: 'Revertida' | 'Aceita', now = new Date()): HemoData {
  const c = findCase(data, caseId), g = c.claim.glosas.find(x => x.id === glosaId);
  if (!g) throw new Error('Glosa não encontrada.');
  if (g.status === 'Revertida' || g.status === 'Aceita') throw new Error('Esta glosa já foi encerrada.');
  return commit(data, caseId, x => ({ ...x, claim: { ...x.claim, glosas: x.claim.glosas.map(y => y.id === glosaId ? { ...y, status: result, resolvedAt: now.toISOString() } : y) } }), result === 'Revertida' ? 'Glosa revertida' : 'Glosa aceita', g.item, now);
}
export function allGlosas(data: HemoData) {
  return data.cases.flatMap(c => c.claim.glosas.map(g => ({ c, g, patient: patientOf(data, c).name })));
}

export function cancelCase(data: HemoData, caseId: string, reason: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Autorização', 'Agendamento', 'Preparo');
  if (!reason.trim()) throw new Error('Informe o motivo do cancelamento.');
  return commit(data, caseId, x => ({ ...x, stage: 'Cancelado', cancelReason: reason.trim() }), 'Cancelado', reason.trim(), now);
}

// ---------- Materiais: visão da hemodinâmica sobre o Estoque do hospital ----------
/** Mesmas regras do Estoque: disponível exclui reservas, bloqueios, quarentena e vencidos. */
export function hemoMaterials(stock: DemoData) {
  return stock.products.filter(p => p.category === HEMO_CATEGORY).map(p => {
    const positions = stock.stock.filter(s => s.productId === p.id && s.quantity > 0);
    return { product: p, positions, available: positions.reduce((sum, s) => sum + availableQuantity(s), 0) };
  });
}
export function materialAlerts(stock: DemoData) {
  const out: { productId: string; text: string; level: 'alto' | 'atenção' }[] = [];
  for (const { product, positions, available } of hemoMaterials(stock)) {
    if (available < product.minimum) out.push({ productId: product.id, level: available === 0 ? 'alto' : 'atenção', text: `${product.name}: ${available} un. disponíveis (mínimo ${product.minimum}).` });
    for (const s of positions) {
      const days = daysToExpiry(s.expiresAt);
      if (days < 0) out.push({ productId: product.id, level: 'alto', text: `${product.name} · lote ${s.lot} vencido (${s.quantity} un.).` });
      else if (days <= 30) out.push({ productId: product.id, level: 'atenção', text: `${product.name} · lote ${s.lot} vence em ${days} dia(s).` });
    }
  }
  return out;
}
/** Consignados usados em pacientes que ainda não foram repostos pelo fornecedor. */
export function pendingReplenishment(data: HemoData, catalog: Product[]) {
  return data.cases.flatMap(c => c.stage === 'Cancelado' ? [] : c.materials.filter(m => !m.replenishedAt && productOf(catalog, m.productId).consigned).map(m => ({ caseId: c.id, used: m, product: productOf(catalog, m.productId), patient: patientOf(data, c).name })));
}
/** O fornecedor repôs o item usado: entrada no Estoque (mesmo produto, lote novo) e baixa da pendência no caso. */
export function receiveReplenishment(data: HemoData, stock: DemoData, caseId: string, usedId: string, input: { lot: string; expiresAt: string }, now = new Date()): WithStock {
  const c = findCase(data, caseId), used = c.materials.find(m => m.id === usedId);
  if (!used || used.replenishedAt) throw new Error('Reposição já registrada ou inexistente.');
  const location = stock.stock.find(s => s.id === used.stockId)?.location ?? HEMO_LOCATION;
  const received = receiveConsignment(stock, { productId: used.productId, lot: input.lot, expiresAt: input.expiresAt, location, quantity: used.quantity }, stockReference(data, c));
  return { stock: received.data, hemo: commit(data, caseId, x => ({ ...x, materials: x.materials.map(m => m.id === usedId ? { ...m, replenishedAt: now.toISOString() } : m) }), 'Consignado reposto', `${used.quantity} × ${productOf(stock.products, used.productId).name} · novo lote ${input.lot.trim()}`, now) };
}

// ---------- Rastreabilidade: em quem foi usado este lote / esta série? (recall) ----------
export function traceLot(data: HemoData, catalog: Product[], query: string) {
  const q = query.trim().toLocaleUpperCase('pt-BR');
  if (q.length < 3) return [];
  return data.cases.flatMap(c => c.materials.filter(m => m.lot.toLocaleUpperCase('pt-BR').includes(q) || (m.serial && m.serial.toLocaleUpperCase('pt-BR').includes(q))).map(m => ({
    caseId: c.id, used: m, product: productOf(catalog, m.productId), patient: patientOf(data, c).name, procedure: typeOf(data, c).name,
    date: c.intra.start || m.at.slice(0, 16), doctor: c.schedule ? data.doctors.find(d => d.id === c.schedule!.doctorId)?.name ?? '' : '', stage: c.stage,
  })));
}
/** Implantes que ficaram no paciente, para o laudo e o prontuário. */
export const implantsOf = (catalog: Product[], c: HemoCase) => c.materials.filter(m => productOf(catalog, m.productId).implantable).map(m => ({ used: m, product: productOf(catalog, m.productId) }));

// ---------- Orientação de preparo para o paciente (texto para copiar; nenhum envio automático) ----------
/** Antecedência de chegada pedida ao paciente. Valor do serviço, ajustável. */
export const ARRIVAL_MINUTES_BEFORE = 60;
export function prepMessage(data: HemoData, c: HemoCase) {
  if (!c.schedule) return '';
  const p = patientOf(data, c), t = typeOf(data, c), room = data.rooms.find(r => r.id === c.schedule!.roomId)?.name ?? '';
  const arrival = addMinutes(c.schedule.start, -ARRIVAL_MINUTES_BEFORE);
  const watch = p.medications.filter(m => /varfarina|apixabana|rivaroxabana|dabigatrana|edoxabana|metformina|clopidogrel|ticagrelor|prasugrel|insulina/i.test(m));
  return [
    `Olá, ${p.name.split(' ')[0]}. Seu procedimento (${t.name}) está marcado para ${c.schedule.start.slice(8, 10)}/${c.schedule.start.slice(5, 7)} às ${c.schedule.start.slice(11, 16)}, na Hemodinâmica (${room}).`,
    `Chegue às ${arrival.slice(11, 16)}, com documento com foto${insured(p) ? `, carteira do ${p.insurance}` : ''} e seus exames recentes.`,
    'Jejum: siga exatamente o horário que a equipe informou.',
    watch.length ? `Você usa ${watch.join(', ')}: não suspenda nem mantenha por conta própria. Confirme com a equipe o que fazer antes do procedimento.` : 'Traga a lista dos remédios que você usa.',
    p.allergies.length ? `Avise na chegada sobre a sua alergia: ${p.allergies.join(', ')}.` : 'Se tiver alguma alergia, avise na chegada.',
    'Venha com um acompanhante. Dúvidas: fale com a Hemodinâmica.',
  ].join('\n');
}

// ---------- Indicadores (só o que está registrado nos casos) ----------
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2); };
export function hemoIndicators(data: HemoData, catalog: Product[], now = new Date()) {
  const done = data.cases.filter(c => c.intra.end && c.stage !== 'Cancelado');
  const dtb = data.cases.map(c => ({ c, minutes: doorToBalloon(c) })).filter((x): x is { c: HemoCase; minutes: number } => x.minutes !== null);
  const followed = data.cases.filter(c => c.followUp.doneAt);
  const glosas = allGlosas(data).map(x => x.g);
  const byDoctor = data.doctors.map(d => { const mine = done.filter(c => c.schedule?.doctorId === d.id); return { doctor: d, procedures: mine.length, fluoroMin: mine.reduce((s, c) => s + c.intra.fluoroMin, 0), kermaMgy: mine.reduce((s, c) => s + c.intra.kermaMgy, 0) }; });
  return {
    done: done.length,
    complications: done.filter(c => c.intra.complications).length,
    avgContrastMl: done.length ? Math.round(done.reduce((s, c) => s + c.intra.contrastMl, 0) / done.length) : null,
    radialShare: done.length ? Math.round(100 * done.filter(c => c.intra.access.startsWith('Radial')).length / done.length) : null,
    doorToBalloon: { cases: dtb, median: median(dtb.map(x => x.minutes)), withinTarget: dtb.filter(x => x.minutes <= DOOR_TO_BALLOON_TARGET_MIN).length },
    followUp: { done: followed.length, events: followed.filter(c => ['Evento adverso', 'Reinternação', 'Óbito'].includes(c.followUp.outcome)).length, overdue: pendingFollowUps(data, now).filter(x => x.days < 0).length, pending: pendingFollowUps(data, now).length },
    glosas: Object.fromEntries(glosaStatuses.map(s => [s, glosas.filter(g => g.status === s).length])) as Record<GlosaStatus, number>,
    opmeWithoutAuthorization: data.cases.filter(c => opmeGaps(data, catalog, c).length > 0).length,
    byDoctor,
    highDosePatients: data.patients.map(p => ({ patient: p, kermaMgy: data.cases.filter(c => c.patientId === p.id && c.stage !== 'Cancelado').reduce((s, c) => s + c.intra.kermaMgy, 0) })).filter(x => x.kermaMgy >= SKIN_DOSE_FOLLOWUP_MGY),
  };
}

// ---------- Contexto para o copilot (sem nome nem dados de contato do paciente) ----------
/** Texto livre escrito pela equipe pode citar o paciente: troca cada parte do nome por [paciente]. */
function withoutName(value: string, name: string) {
  return name.split(/\s+/).filter(part => part.length > 2).reduce((out, part) => out.replace(new RegExp(`(?<![\\p{L}])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'), '[paciente]'), value);
}
export function copilotContext(data: HemoData, catalog: Product[], c: HemoCase, now = new Date()) {
  const p = patientOf(data, c), t = typeOf(data, c);
  return {
    procedimento: t.name, indicacao: c.indication, prioridade: c.priority, etapa: c.stage,
    portaBalaoMin: doorToBalloon(c),
    opme: { justificativa: c.opme.justification, itens: c.opme.items.map(i => ({ material: productOf(catalog, i.productId).name, pedido: i.requested, autorizado: i.authorized })), autorizacao: c.authorization.status },
    paciente: { idade: ageAt(p.birthDate, now), sexo: p.sex, pesoKg: p.weightKg || null, creatininaMgDl: p.creatinine, alergias: p.allergies, comorbidades: p.conditions, medicamentos: p.medications },
    alertasDoSistema: safetyAlerts(data, c).map(a => a.text),
    preparoPendente: c.stage === 'Preparo' ? prepMissing(c) : [],
    observacoesPreparo: c.prepNotes,
    registroDaSala: c.intra.start ? { via: c.intra.access, inicio: c.intra.start, fim: c.intra.end, contrasteMl: c.intra.contrastMl, fluoroscopiaMin: c.intra.fluoroMin, kermaMgy: c.intra.kermaMgy, intercorrencias: c.intra.complications } : null,
    materiaisUsados: c.materials.map(m => `${m.quantity} × ${productOf(catalog, m.productId).name}${productOf(catalog, m.productId).implantable ? ' (implante)' : ''}`),
    medicamentosNaSala: c.meds.map(m => `${m.at.slice(11)} · ${m.drug} ${m.dose} ${m.unit} · ${m.route}`),
    tca: c.act.readings.length ? { alvoSegundos: c.act.target || null, leituras: c.act.readings.map(r => `${r.at.slice(11)} · ${r.seconds} s`) } : null,
    funcaoRenal: { tfgEstimada: renalProfile(data, c, now).egfr, limiteContrasteSugeridoMl: renalProfile(data, c, now).contrastLimitMl, creatininaControle: c.renal.recheckCreatinine, lesaoRenalAguda: c.renal.aki },
    laudoAssinado: c.report.signedAt ? { descricao: withoutName(c.report.text, p.name), conclusao: withoutName(c.report.conclusion, p.name) } : null,
    recuperacao: c.recovery.destination ? c.recovery : null,
    achados: c.findings.map(f => ({ vaso: f.vessel, estenosePct: f.stenosis, tratamento: f.treatment })),
  };
}

// ---------- Dados de demonstração (fictícios) ----------
export function makeHemoData(now = new Date()): HemoData {
  const today = localStamp(now).slice(0, 10);
  const day = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const base = (id: string, patientId: string, typeId: string, stage: Stage, extra: Record<string, unknown> = {}) => ({ id, patientId, typeId, stage, requestedBy: 'Dr. Paulo Nunes (cardiologia)', priority: 'Eletivo', createdAt: now.toISOString(), authorization: { status: 'Não se aplica' }, ...extra });
  const prepDone = Object.fromEntries(Object.keys(prepItems).map(k => [k, true])), timeoutDone = Object.fromEntries(Object.keys(timeoutItems).map(k => [k, true]));
  return parseHemoData({
    schemaVersion: 2, revision: 0,
    rooms: [{ id: 'sala-1', name: 'Sala 1 · Angiógrafo A' }, { id: 'sala-2', name: 'Sala 2 · Angiógrafo B' }],
    doctors: [{ id: 'doc-1', name: 'Dra. Helena Prado', crm: 'CRM fictício 12345' }, { id: 'doc-2', name: 'Dr. Marcos Teles', crm: 'CRM fictício 67890' }],
    patients: [
      { id: 'hp-1', name: 'Antônio Ferreira', birthDate: '1959-03-14', sex: 'M', insurance: 'Convênio A', cardNumber: 'Carteira fictícia 0001', weightKg: 82, creatinine: 1.6, allergies: ['Contraste iodado (urticária em 2021)'], conditions: ['Diabetes tipo 2', 'Hipertensão'], medications: ['Metformina 850 mg', 'AAS 100 mg', 'Losartana 50 mg'] },
      { id: 'hp-2', name: 'Maria das Graças Lima', birthDate: '1968-07-02', sex: 'F', insurance: 'Particular', weightKg: 64, creatinine: 0.9, allergies: [], conditions: ['Dislipidemia'], medications: ['AAS 100 mg', 'Atorvastatina 40 mg'] },
      { id: 'hp-3', name: 'José Roberto Alves', birthDate: '1954-11-20', sex: 'M', insurance: 'Convênio B', cardNumber: 'Carteira fictícia 0003', weightKg: 77, creatinine: 1.1, allergies: [], conditions: ['Fibrilação atrial', 'Hipertensão'], medications: ['Varfarina 5 mg', 'Metoprolol 50 mg'] },
      { id: 'hp-4', name: 'Luíza Martins Costa', birthDate: '1963-01-09', sex: 'F', insurance: 'Convênio A', cardNumber: 'Carteira fictícia 0004', weightKg: 70, creatinine: 1.0, allergies: [], conditions: ['Angina estável', 'Tabagismo prévio'], medications: ['AAS 100 mg', 'Clopidogrel 75 mg', 'Rosuvastatina 20 mg'] },
      { id: 'hp-5', name: 'Carlos Eduardo Souza', birthDate: '1961-05-27', sex: 'M', insurance: 'Convênio B', cardNumber: 'Carteira fictícia 0005', weightKg: 88, creatinine: 1.2, allergies: [], conditions: ['Hipertensão', 'Tabagismo atual'], medications: ['Anlodipino 5 mg'] },
    ],
    types: [
      { id: 'cate', name: 'Cateterismo cardíaco diagnóstico', duration: 45, turnover: 15, contrast: true, needsAuthorization: true },
      { id: 'atc', name: 'Angioplastia coronária com stent', duration: 90, turnover: 20, contrast: true, needsAuthorization: true },
      { id: 'perif', name: 'Arteriografia de membros inferiores', duration: 60, turnover: 15, contrast: true, needsAuthorization: true },
      { id: 'iam', name: 'Angioplastia primária no infarto agudo', duration: 90, turnover: 20, contrast: true, needsAuthorization: true },
    ],
    cases: [
      base('case-1', 'hp-2', 'cate', 'Preparo', { indication: 'Dor torácica aos esforços com teste ergométrico positivo.', schedule: { roomId: 'sala-1', doctorId: 'doc-1', start: `${day(1)}T09:00` }, prep: { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: false, venousAccess: false } }),
      base('case-2', 'hp-1', 'atc', 'Autorização', {
        indication: 'Lesão grave em artéria descendente anterior vista em cateterismo prévio.', authorization: { status: 'Pendente' },
        opme: { justification: 'Lesão de 90% em descendente anterior proximal no cateterismo prévio, com isquemia documentada. Previsto 1 stent farmacológico 3,0 mm, com balão de pré-dilatação e fio-guia coronário.', items: [{ id: 'opme-1', productId: 'hem-5', requested: 1 }, { id: 'opme-2', productId: 'hem-4', requested: 1 }, { id: 'opme-3', productId: 'hem-3', requested: 1 }] },
      }),
      base('case-3', 'hp-3', 'cate', 'Agendamento', { indication: 'Avaliação coronária pré-operatória de cirurgia valvar.', authorization: { status: 'Autorizada', guide: 'GUIA-000318' } }),
      base('case-4', 'hp-4', 'atc', 'Laudo', {
        indication: 'Angina estável refratária, lesão em descendente anterior proximal.', authorization: { status: 'Autorizada', guide: 'GUIA-000301' },
        opme: { justification: 'Lesão grave em descendente anterior proximal com angina refratária ao tratamento clínico.', items: [{ id: 'opme-4', productId: 'hem-3', requested: 1, authorized: 1 }, { id: 'opme-5', productId: 'hem-4', requested: 1, authorized: 1 }, { id: 'opme-6', productId: 'hem-5', requested: 1, authorized: 1 }] },
        schedule: { roomId: 'sala-2', doctorId: 'doc-2', start: `${day(-1)}T14:00` }, prep: prepDone, timeout: timeoutDone,
        intra: { roomIn: `${day(-1)}T13:55`, start: `${day(-1)}T14:05`, end: `${day(-1)}T15:10`, access: 'Radial direita', contrastMl: 140, fluoroMin: 14, kermaMgy: 980, complications: '' },
        materials: [
          // Posições hs-* e produtos hem-* do Estoque (ver withHemoCatalog em data.ts).
          { id: 'use-1', stockId: 'hs-4', productId: 'hem-3', lot: 'FG14-2610', quantity: 1, at: now.toISOString() },
          { id: 'use-2', stockId: 'hs-5', productId: 'hem-4', lot: 'BP25-2609', quantity: 1, at: now.toISOString() },
          { id: 'use-3', stockId: 'hs-6', productId: 'hem-5', lot: 'SF30-2612', serial: 'SN-FICT-30001', quantity: 1, at: now.toISOString() },
        ],
        followUp: { due: day(29) },
        meds: [{ id: 'med-1', at: `${day(-1)}T14:08`, drug: 'Heparina não fracionada', dose: 7000, unit: 'UI', route: 'Intra-arterial' }, { id: 'med-2', at: `${day(-1)}T14:09`, drug: 'Nitroglicerina', dose: 200, unit: 'mcg', route: 'Intracoronária' }],
        act: { target: 250, readings: [{ id: 'act-1', at: `${day(-1)}T14:25`, seconds: 268 }] },
        band: { placedAt: `${day(-1)}T15:10`, releaseMin: 120, removedAt: `${day(-1)}T17:15` },
        recovery: { hemostasis: 'Pulseira de compressão radial por 2 h', stable: true, destination: 'Internação', notes: 'Observação por 24 h.' },
        findings: [{ id: 'f-1', vessel: 'Descendente anterior proximal', stenosis: 85, treatment: 'Pré-dilatação e implante de stent farmacológico 3,0 × 18 mm' }, { id: 'f-2', vessel: 'Coronária direita média', stenosis: 30, treatment: 'Tratamento clínico' }],
      }),
      // Urgência de madrugada, já faturada, com glosa aberta e contato de 30 dias atrasado.
      base('case-5', 'hp-5', 'iam', 'Encerrado', {
        priority: 'Urgência', requestedBy: 'Pronto-socorro', indication: 'Infarto agudo com supradesnivelamento de ST em parede inferior, dor há 2 h.', doorAt: `${day(-35)}T02:10`,
        urgency: { ecgAt: `${day(-35)}T02:16`, teamCalledAt: `${day(-35)}T02:20`, teamArrivedAt: `${day(-35)}T02:32` },
        authorization: { status: 'Autorizada', guide: 'GUIA-000287', note: 'Regularizada após urgência' },
        opme: { justification: 'Urgência: infarto agudo com supra de ST.', items: [{ id: 'opme-7', productId: 'hem-6', requested: 1, authorized: 1 }, { id: 'opme-8', productId: 'hem-3', requested: 1, authorized: 1 }] },
        schedule: { roomId: 'sala-1', doctorId: 'doc-1', start: `${day(-35)}T02:30` }, prep: { consent: true, venousAccess: true }, timeout: timeoutDone,
        intra: { roomIn: `${day(-35)}T02:34`, start: `${day(-35)}T02:41`, balloonAt: `${day(-35)}T03:12`, end: `${day(-35)}T03:40`, access: 'Radial direita', contrastMl: 160, fluoroMin: 18, kermaMgy: 2100, complications: '' },
        materials: [
          { id: 'use-4', stockId: 'hs-4', productId: 'hem-3', lot: 'FG14-2610', quantity: 1, at: `${day(-35)}T05:50:00.000Z`, replenishedAt: `${day(-33)}T12:00:00.000Z` },
          { id: 'use-5', stockId: 'hs-7', productId: 'hem-6', lot: 'SF35-2701', serial: 'SN-FICT-35001', quantity: 1, at: `${day(-35)}T06:05:00.000Z`, replenishedAt: `${day(-33)}T12:00:00.000Z` },
        ],
        recovery: { hemostasis: 'Pulseira de compressão radial por 2 h', stable: true, destination: 'UTI', notes: '' },
        findings: [{ id: 'f-3', vessel: 'Coronária direita proximal', stenosis: 100, treatment: 'Angioplastia primária com stent farmacológico 3,5 × 23 mm' }],
        report: { text: 'Acesso radial direito. Coronária direita ocluída no terço proximal, recanalizada com fio-guia, implantado stent farmacológico 3,5 × 23 mm com fluxo final TIMI 3. Demais artérias sem lesões significativas.', conclusion: 'Infarto inferior tratado com angioplastia primária da coronária direita, com sucesso.', signedAt: `${day(-35)}T07:00:00.000Z`, signedBy: 'Dra. Helena Prado · CRM fictício 12345' },
        invoices: [
          { id: 'inv-1', kind: 'Serviço', recipient: 'Convênio B · guia GUIA-000287', items: ['Angioplastia primária no infarto agudo', '1 × Fio-guia coronário 0,014" (lote FG14-2610)', '1 × Stent farmacológico 3,5 × 23 mm (lote SF35-2701 · série SN-FICT-35001)'], createdAt: `${day(-30)}T12:00:00.000Z`, status: 'Simulada' },
          { id: 'inv-2', kind: 'Reposição de consignado', recipient: 'Fornecedor Gama', items: ['1 × Stent farmacológico 3,5 × 23 mm (lote SF35-2701) · paciente Carlos Eduardo Souza'], createdAt: `${day(-30)}T12:00:00.000Z`, status: 'Simulada' },
          { id: 'inv-3', kind: 'Reposição de consignado', recipient: 'Fornecedor Beta', items: ['1 × Fio-guia coronário 0,014" (lote FG14-2610) · paciente Carlos Eduardo Souza'], createdAt: `${day(-30)}T12:00:00.000Z`, status: 'Simulada' },
        ],
        claim: { sentAt: `${day(-30)}T12:00:00.000Z`, glosas: [{ id: 'glosa-1', item: '1 × Stent farmacológico 3,5 × 23 mm', reason: 'Etiqueta do implante não anexada à conta', at: `${day(-5)}T12:00:00.000Z`, status: 'Aberta' }] },
        followUp: { due: day(-5) },
      }),
    ],
    audit: [],
    onCall: Array.from({ length: 7 }, (_, i) => ({ date: day(i), doctorId: i % 2 ? 'doc-2' : 'doc-1' })),
  });
}
