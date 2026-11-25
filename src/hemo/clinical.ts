import { type DemoData, type Product } from '../data.ts';
import {
  ageAt, commit, daysUntil, findCase, hemoMaterials, implantsOf, localStamp, medRoutes, medUnits, minutesOf, newId, patientOf, pendingReplenishment,
  requireStage, stamp, typeOf, type HemoCase, type HemoData, type Medication, type Stage,
} from './domain.ts';

/**
 * Funções clínicas e de qualidade da hemodinâmica: autoria, urgência por etapas, sobreaviso,
 * medicamentos e TCA na sala, pulseira radial, alta, consentimento, imagens e pedido de reposição.
 * Nenhuma regra aqui sugere dose ou conduta: o sistema registra, calcula tempos e lembra.
 */

// ---------- Autoria ----------
/** Marca com o usuário logado as entradas do histórico criadas nesta gravação. */
export function stampAudit(before: HemoData, after: HemoData, by: string): HemoData {
  if (!by) return after;
  const known = new Set(before.audit.map(a => a.id));
  return { ...after, audit: after.audit.map(a => known.has(a.id) || a.by ? a : { ...a, by }) };
}

// ---------- Urgência por etapas e sobreaviso ----------
/** ECG em até 10 minutos da chegada: meta clássica do atendimento ao infarto. */
export const DOOR_TO_ECG_TARGET_MIN = 10;
export type UrgencyTimes = { ecgAt: string; teamCalledAt: string; teamArrivedAt: string };
const STEP_LABELS = ['Chegada → ECG', 'ECG → acionamento da equipe', 'Acionamento → equipe na sala', 'Equipe na sala → punção', 'Punção → abertura da artéria'] as const;
/** Cada etapa do porta-balão em minutos (null quando falta um dos horários). */
export function urgencyTimeline(c: HemoCase) {
  const points = [c.doorAt, c.urgency.ecgAt, c.urgency.teamCalledAt, c.urgency.teamArrivedAt, c.intra.start, c.intra.balloonAt];
  return STEP_LABELS.map((label, i) => {
    const from = points[i], to = points[i + 1];
    return { label, from, to, minutes: from && to ? minutesOf(to) - minutesOf(from) : null, target: i === 0 ? DOOR_TO_ECG_TARGET_MIN : null };
  });
}
export function saveUrgencyTimes(data: HemoData, caseId: string, times: UrgencyTimes, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  if (c.priority !== 'Urgência' || !c.doorAt) throw new Error('Só urgências têm linha do tempo do porta-balão.');
  const at = localStamp(now);
  const sequence: [string, string][] = [['chegada', c.doorAt], ['ECG', times.ecgAt], ['acionamento da equipe', times.teamCalledAt], ['chegada da equipe', times.teamArrivedAt], ['punção', c.intra.start]];
  let last: [string, string] = sequence[0];
  for (const [label, value] of sequence.slice(1)) {
    if (!value) continue;
    if (!stamp.safeParse(value).success) throw new Error(`Horário inválido: ${label}.`);
    if (value > at) throw new Error(`O horário de ${label} não pode ser no futuro.`);
    if (value < last[1]) throw new Error(`O horário de ${label} não pode ser antes de ${last[0]}.`);
    last = [label, value];
  }
  return commit(data, caseId, x => ({ ...x, urgency: { ...times } }), 'Linha do tempo da urgência', [times.ecgAt && `ECG ${times.ecgAt.slice(11)}`, times.teamCalledAt && `acionamento ${times.teamCalledAt.slice(11)}`, times.teamArrivedAt && `equipe ${times.teamArrivedAt.slice(11)}`].filter(Boolean).join(' · ') || 'horários limpos', now);
}
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2); };
/** Mediana de cada etapa entre as urgências registradas: mostra onde o porta-balão perde tempo. */
export function timelineMedians(data: HemoData) {
  const urgent = data.cases.filter(c => c.priority === 'Urgência' && c.stage !== 'Cancelado');
  return STEP_LABELS.map((label, i) => { const values = urgent.map(c => urgencyTimeline(c)[i].minutes).filter((m): m is number => m !== null); return { label, median: median(values), cases: values.length, target: i === 0 ? DOOR_TO_ECG_TARGET_MIN : null }; });
}
export const onCallFor = (data: HemoData, date: string) => data.onCall.find(o => o.date === date)?.doctorId ?? '';
/** Define (ou limpa, com doctorId vazio) o hemodinamicista de sobreaviso de um dia. */
export function setOnCall(data: HemoData, date: string, doctorId: string, now = new Date()): HemoData {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Informe o dia.');
  const doctor = data.doctors.find(d => d.id === doctorId);
  if (doctorId && !doctor) throw new Error('Selecione o hemodinamicista.');
  const onCall = [...data.onCall.filter(o => o.date !== date), ...(doctorId ? [{ date, doctorId }] : [])].sort((a, b) => a.date.localeCompare(b.date));
  return { ...data, onCall, revision: data.revision + 1, audit: [{ id: newId(), at: now.toISOString(), caseId: '', action: 'Escala de sobreaviso', detail: `${date.split('-').reverse().join('/')} · ${doctor?.name ?? 'sem sobreaviso'}`, by: '' }, ...data.audit] };
}

// ---------- Medicamentos e TCA na sala ----------
/** Sugestões para digitar mais rápido; a dose é sempre a que o médico informa. */
export const commonDrugs = ['Heparina não fracionada', 'Nitroglicerina', 'Verapamil', 'Adenosina', 'Midazolam', 'Fentanil', 'Lidocaína', 'Atropina', 'Noradrenalina', 'Tirofibana', 'AAS', 'Clopidogrel', 'Ticagrelor', 'Prasugrel'];
export type MedicationInput = Omit<Medication, 'id'>;
function withinRoom(c: HemoCase, at: string, now: Date, what: string) {
  if (!stamp.safeParse(at).success) throw new Error(`Informe o horário ${what}.`);
  if (c.intra.roomIn && at < c.intra.roomIn) throw new Error(`O horário ${what} não pode ser antes da entrada na sala.`);
  if (at > localStamp(now)) throw new Error(`O horário ${what} não pode ser no futuro.`);
}
export function addMedication(data: HemoData, caseId: string, input: MedicationInput, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  withinRoom(c, input.at, now, 'do medicamento');
  if (!input.drug.trim()) throw new Error('Informe o medicamento.');
  if (!Number.isFinite(input.dose) || input.dose <= 0) throw new Error('Informe a dose.');
  if (!medUnits.includes(input.unit) || !medRoutes.includes(input.route)) throw new Error('Informe unidade e via.');
  const med: Medication = { id: newId(), at: input.at, drug: input.drug.trim(), dose: input.dose, unit: input.unit, route: input.route };
  return commit(data, caseId, x => ({ ...x, meds: [...x.meds, med].sort((a, b) => a.at.localeCompare(b.at)) }), 'Medicamento na sala', `${med.at.slice(11)} · ${med.drug} ${med.dose.toLocaleString('pt-BR')} ${med.unit} · ${med.route}`, now);
}
export function removeMedication(data: HemoData, caseId: string, medId: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  const med = c.meds.find(m => m.id === medId);
  if (!med) throw new Error('Registro de medicamento não encontrado.');
  return commit(data, caseId, x => ({ ...x, meds: x.meds.filter(m => m.id !== medId) }), 'Medicamento removido', `${med.drug} ${med.dose.toLocaleString('pt-BR')} ${med.unit} (registrado às ${med.at.slice(11)})`, now);
}
export function addActReading(data: HemoData, caseId: string, at: string, seconds: number, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  withinRoom(c, at, now, 'do TCA');
  if (!Number.isInteger(seconds) || seconds < 50 || seconds > 999) throw new Error('TCA entre 50 e 999 segundos.');
  return commit(data, caseId, x => ({ ...x, act: { ...x.act, readings: [...x.act.readings, { id: newId(), at, seconds }].sort((a, b) => a.at.localeCompare(b.at)) } }), 'TCA medido', `${at.slice(11)} · ${seconds} s${c.act.target ? ` (alvo ${c.act.target} s)` : ''}`, now);
}
/** Alvo de TCA definido pelo médico para este procedimento (0 = sem alvo). */
export function setActTarget(data: HemoData, caseId: string, target: number, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala');
  if (!Number.isInteger(target) || target < 0 || target > 999) throw new Error('Alvo de TCA entre 0 e 999 segundos.');
  return commit(data, caseId, x => ({ ...x, act: { ...x.act, target } }), 'Alvo de TCA', target ? `${target} s` : 'sem alvo', now);
}
/** Última medida e se ficou abaixo do alvo definido pelo médico. */
export function actStatus(c: HemoCase) {
  const last = c.act.readings.at(-1) ?? null;
  return { last, belowTarget: !!(last && c.act.target && last.seconds < c.act.target) };
}

// ---------- Pulseira de compressão radial ----------
export function setBand(data: HemoData, caseId: string, placedAt: string, releaseMin: number, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Recuperação');
  if (!c.intra.access.startsWith('Radial')) throw new Error('Pulseira de compressão é para acesso radial.');
  if (!stamp.safeParse(placedAt).success || placedAt > localStamp(now)) throw new Error('Informe quando a pulseira foi colocada.');
  if (c.intra.start && placedAt < c.intra.start) throw new Error('A pulseira não pode ser colocada antes do início do procedimento.');
  if (!Number.isInteger(releaseMin) || releaseMin < 15 || releaseMin > 480) throw new Error('Tempo até liberar entre 15 e 480 minutos, conforme o protocolo.');
  return commit(data, caseId, x => ({ ...x, band: { placedAt, releaseMin, removedAt: '' } }), 'Pulseira radial', `colocada ${placedAt.slice(11)} · liberar em ${releaseMin} min`, now);
}
export function removeBand(data: HemoData, caseId: string, at: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Recuperação');
  if (!c.band.placedAt || c.band.removedAt) throw new Error('Não há pulseira colocada.');
  if (!stamp.safeParse(at).success || at < c.band.placedAt || at > localStamp(now)) throw new Error('A retirada deve ser entre a colocação e agora.');
  return commit(data, caseId, x => ({ ...x, band: { ...x.band, removedAt: at } }), 'Pulseira radial retirada', `${at.slice(11)} · ${minutesOf(at) - minutesOf(c.band.placedAt)} min de compressão`, now);
}
/** Quanto falta para liberar a pulseira (negativo = passou do horário). */
export function bandStatus(c: HemoCase, now = new Date()) {
  if (!c.band.placedAt || c.band.removedAt || !c.band.releaseMin) return null;
  const releaseAt = new Date((minutesOf(c.band.placedAt) + c.band.releaseMin) * 60_000).toISOString().slice(0, 16);
  const left = minutesOf(releaseAt) - minutesOf(localStamp(now));
  return { releaseAt, minutesLeft: left, overdue: left < 0 };
}

// ---------- Alta ----------
const limb = (access: string) => access.startsWith('Femoral') ? { part: 'perna', end: 'pé' } : { part: 'braço', end: 'mão' };
/**
 * Modelo de orientação de alta. Linguagem para o paciente, sem doses e sem prazos clínicos:
 * os prazos e a prescrição vêm do protocolo do hospital e da receita médica.
 */
export function dischargeDraft(data: HemoData, catalog: Product[], c: HemoCase) {
  const p = patientOf(data, c), t = typeOf(data, c), { part, end } = limb(c.intra.access);
  const stents = implantsOf(catalog, c).filter(x => /stent/i.test(x.product.name));
  const date = c.intra.start ? c.intra.start.slice(0, 10).split('-').reverse().join('/') : '';
  return [
    'ORIENTAÇÕES DE ALTA · HEMODINÂMICA',
    `Paciente: ${p.name}`,
    `Procedimento: ${t.name}${date ? ` em ${date}` : ''}${c.intra.access ? ` · acesso pelo ${part} (${c.intra.access.toLocaleLowerCase('pt-BR')})` : ''}`,
    '',
    'Cuidados com o local da punção',
    '• Mantenha o curativo limpo e seco pelo tempo que a equipe orientou.',
    `• Evite força e peso com o ${part} da punção pelo tempo que a equipe orientou.`,
    '',
    'Procure a emergência imediatamente se tiver',
    '• sangramento ou inchaço que aumenta no local da punção (aperte o local e peça ajuda);',
    '• dor no peito, falta de ar, desmaio ou batedeira forte;',
    `• ${end} fria, pálida, dormente ou com dor.`,
    ...(stents.length ? ['', `Você recebeu ${stents.length === 1 ? 'um stent' : `${stents.length} stents`} no coração.`, '• Não pare nenhum remédio que "afina o sangue" (antiagregante) sem falar com o seu cardiologista, nem para dentista ou outra cirurgia.', '• Mostre este papel em qualquer consulta ou atendimento.'] : []),
    ...(c.renal.recheckDue ? ['', `Exame de sangue (creatinina) em ${c.renal.recheckDue.split('-').reverse().join('/')}, conforme o pedido médico.`] : []),
  ].join('\n');
}
export type DischargeInput = { text: string; medications: string; returnDate: string };
/** Salva a orientação de alta; delivered = entregue e explicada ao paciente agora. Paciente com stent exige a prescrição registrada. */
export function saveDischarge(data: HemoData, catalog: Product[], caseId: string, input: DischargeInput, delivered: boolean, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Recuperação', 'Laudo', 'Faturamento', 'Encerrado');
  if (input.text.trim().length < 40) throw new Error('Escreva a orientação de alta (use o modelo como ponto de partida).');
  if (input.returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.returnDate)) throw new Error('Data de retorno inválida.');
  const stent = implantsOf(catalog, c).some(x => /stent/i.test(x.product.name));
  if (stent && !input.medications.trim()) throw new Error('Paciente com stent: registre os medicamentos prescritos na alta, incluindo os antiagregantes, conforme a receita.');
  return commit(data, caseId, x => ({ ...x, discharge: { text: input.text.trim(), medications: input.medications.trim(), returnDate: input.returnDate, deliveredAt: delivered ? now.toISOString() : x.discharge.deliveredAt, by: x.discharge.by } }), delivered ? 'Orientação de alta entregue' : 'Orientação de alta salva', input.returnDate ? `retorno ${input.returnDate.split('-').reverse().join('/')}` : 'sem data de retorno', now);
}

// ---------- Consentimento ----------
export const consentRelations = ['Paciente', 'Responsável legal'] as const;
/** Declaração genérica: o conteúdo de riscos e alternativas é o do termo do hospital, explicado pelo médico. */
export function consentText(data: HemoData, c: HemoCase) {
  const p = patientOf(data, c), t = typeOf(data, c);
  return `Declaro que recebi explicação sobre o procedimento ${t.name}, indicado por: ${c.indication} Fui informado(a) sobre os benefícios, os riscos e as alternativas, conforme o termo do hospital, e tive minhas dúvidas respondidas. Autorizo a realização do procedimento em ${p.name}${ageAt(p.birthDate) < 18 ? ' (menor de idade)' : ''}.`;
}
export function signConsent(data: HemoData, caseId: string, input: { signer: string; relation: typeof consentRelations[number]; signature: string }, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Autorização', 'Agendamento', 'Preparo');
  if (input.signer.trim().length < 3) throw new Error('Informe o nome de quem assina.');
  if (!consentRelations.includes(input.relation)) throw new Error('Informe se assina o paciente ou o responsável.');
  if (!input.signature.startsWith('data:image/png;base64,') || input.signature.length < 2_000) throw new Error('Peça para a pessoa assinar no quadro.');
  if (input.signature.length > 400_000) throw new Error('Assinatura muito grande. Limpe e assine de novo.');
  return commit(data, caseId, x => ({ ...x, consent: { signedAt: now.toISOString(), signer: input.signer.trim(), relation: input.relation, signature: input.signature }, prep: { ...x.prep, consent: true } }), 'Termo de consentimento assinado', `${input.signer.trim()} (${input.relation.toLocaleLowerCase('pt-BR')})`, now);
}

// ---------- Imagens (PACS) ----------
export function saveImaging(data: HemoData, caseId: string, accession: string, url: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala', 'Recuperação', 'Laudo', 'Faturamento', 'Encerrado');
  const link = url.trim();
  if (link) { let ok = false; try { ok = ['https:', 'http:'].includes(new URL(link).protocol); } catch { ok = false; } if (!ok) throw new Error('Link inválido: use o endereço completo (https://…) do visualizador de imagens.'); }
  if (accession.trim().length > 64) throw new Error('Número de acesso muito longo.');
  return commit(data, caseId, x => ({ ...x, imaging: { accession: accession.trim(), url: link } }), 'Exame de imagem vinculado', [accession.trim() && `acesso ${accession.trim()}`, link && 'com link'].filter(Boolean).join(' · ') || 'vínculo removido', now);
}

// ---------- Pedido de reposição ao fornecedor (sugestão; nada é enviado) ----------
export function replenishmentOrders(data: HemoData, stock: DemoData) {
  const bySupplier = new Map<string, Map<string, { product: Product; usedInPatients: number; belowMinimum: number }>>();
  const line = (product: Product) => {
    const supplier = product.supplier?.trim() || 'Fornecedor não informado';
    const lines = bySupplier.get(supplier) ?? new Map(); bySupplier.set(supplier, lines);
    const current = lines.get(product.id) ?? { product, usedInPatients: 0, belowMinimum: 0 }; lines.set(product.id, current);
    return current;
  };
  for (const x of pendingReplenishment(data, stock.products)) line(x.product).usedInPatients += x.used.quantity;
  for (const { product, available } of hemoMaterials(stock)) if (product.consigned && available < product.minimum) line(product).belowMinimum = product.minimum - available;
  return [...bySupplier].map(([supplier, lines]) => {
    const items = [...lines.values()].map(l => ({ ...l, quantity: Math.max(l.usedInPatients, l.belowMinimum) })).filter(l => l.quantity > 0);
    const text = [`Pedido de reposição · Hemodinâmica`, `Fornecedor: ${supplier}`, ...items.map(l => `• ${l.quantity} × ${l.product.name}${l.product.code ? ` (${l.product.code})` : ''}${l.usedInPatients ? ` · ${l.usedInPatients} usado(s) em paciente` : ''}${l.belowMinimum ? ` · ${l.belowMinimum} para voltar ao mínimo` : ''}`)].join('\n');
    return { supplier, items, text };
  }).filter(o => o.items.length);
}

// ---------- Indicadores clínicos novos ----------
export function clinicalIndicators(data: HemoData) {
  const rechecked = data.cases.filter(c => c.renal.recheckCreatinine !== null);
  return {
    timeline: timelineMedians(data),
    renal: { programmed: data.cases.filter(c => c.renal.recheckDue && c.stage !== 'Cancelado').length, done: rechecked.length, aki: rechecked.filter(c => c.renal.aki).length },
    consentSigned: data.cases.filter(c => c.consent.signedAt).length,
    dischargeDelivered: data.cases.filter(c => c.discharge.deliveredAt).length,
  };
}

/** Etapas em que a ficha mostra a creatinina de controle. */
export const renalStages: Stage[] = ['Recuperação', 'Laudo', 'Faturamento', 'Encerrado'];
export const recheckOverdue = (c: HemoCase, now = new Date()) => !!c.renal.recheckDue && c.renal.recheckCreatinine === null && daysUntil(c.renal.recheckDue, now) < -1;
