import { type Product } from '../data.ts';
import {
  addMinutes, ageAt, blockReasons, commit, findCase, implantsOf, localStamp, minutesOf, newId, occupancy, patientOf, renalProfile, requireStage, rhythms,
  sedationLevels, stamp, typeOf, type HemoCase, type HemoData, type RoomBlock, type Vital,
} from './domain.ts';
import { bandStatus } from './clinical.ts';
import { complicationText } from './report.ts';

/**
 * Cuidado ao redor do procedimento: sinais vitais e sedação, passagem de plantão para a unidade
 * de destino e bloqueio de sala para manutenção. O sistema registra e lembra; não sugere conduta.
 */

// ---------- Sinais vitais ----------
export type VitalInput = Omit<Vital, 'id' | 'phase'>;
/** Faixa plausível de cada medida: fora dela é quase certamente erro de digitação. */
const PLAUSIBLE = { sbp: [40, 300], dbp: [20, 200], hr: [20, 250], spo2: [50, 100], rr: [4, 60] } as const;
/**
 * Faixa de referência do serviço para destacar a medida (não é conduta). Ajustável.
 * PAS < 90 ou > 180 mmHg; FC < 50 ou > 120 bpm; SpO₂ < 92%; FR < 10 ou > 24 irpm.
 */
export const VITAL_REFERENCE = { sbp: [90, 180], hr: [50, 120], spo2: [92, 100], rr: [10, 24] } as const;
const label = { sbp: 'PA sistólica', dbp: 'PA diastólica', hr: 'Frequência cardíaca', spo2: 'Saturação', rr: 'Frequência respiratória' } as const;

/** Etapa em que a medida é registrada: na sala durante o procedimento, depois na recuperação. */
const phaseOf = (c: HemoCase) => c.stage === 'Sala' ? 'Sala' as const : 'Recuperação' as const;
export function addVital(data: HemoData, caseId: string, input: VitalInput, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala', 'Recuperação');
  if (!stamp.safeParse(input.at).success) throw new Error('Informe o horário da medida.');
  if (c.intra.roomIn && input.at < c.intra.roomIn) throw new Error('A medida não pode ser antes da entrada na sala.');
  if (input.at > localStamp(now)) throw new Error('A medida não pode ser no futuro.');
  const keys = ['sbp', 'dbp', 'hr', 'spo2', 'rr'] as const;
  if (keys.every(k => input[k] === null)) throw new Error('Informe pelo menos uma medida.');
  for (const k of keys) {
    const v = input[k];
    if (v !== null && (!Number.isFinite(v) || v < PLAUSIBLE[k][0] || v > PLAUSIBLE[k][1])) throw new Error(`${label[k]} entre ${PLAUSIBLE[k][0]} e ${PLAUSIBLE[k][1]}.`);
  }
  if ((input.sbp === null) !== (input.dbp === null)) throw new Error('Informe a pressão sistólica e a diastólica juntas.');
  if (input.sbp !== null && input.dbp !== null && input.dbp >= input.sbp) throw new Error('A pressão diastólica deve ser menor que a sistólica.');
  if (input.rhythm && !rhythms.includes(input.rhythm)) throw new Error('Ritmo inválido.');
  const vital: Vital = { id: newId(), phase: phaseOf(c), ...input };
  return commit(data, caseId, x => ({ ...x, vitals: [...x.vitals, vital].sort((a, b) => a.at.localeCompare(b.at)) }), 'Sinais vitais', `${vital.phase} · ${vitalText(vital)}`, now);
}
export function removeVital(data: HemoData, caseId: string, vitalId: string, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala', 'Recuperação');
  const v = c.vitals.find(x => x.id === vitalId);
  if (!v) throw new Error('Medida não encontrada.');
  return commit(data, caseId, x => ({ ...x, vitals: x.vitals.filter(y => y.id !== vitalId) }), 'Sinais vitais removidos', `${v.at.slice(11)} · ${vitalText(v)}`, now);
}
export function vitalText(v: Vital) {
  return [
    `${v.at.slice(11)}`,
    v.sbp !== null && v.dbp !== null && `PA ${v.sbp}/${v.dbp}`,
    v.hr !== null && `FC ${v.hr}`,
    v.spo2 !== null && `SpO₂ ${v.spo2}%`,
    v.rr !== null && `FR ${v.rr}`,
    v.rhythm && v.rhythm.toLocaleLowerCase('pt-BR'),
  ].filter(Boolean).join(' · ');
}
/** Medidas fora da faixa de referência do serviço, para destacar na tela e na passagem de plantão. */
export function vitalFlags(v: Vital) {
  const out: string[] = [];
  const check = (k: keyof typeof VITAL_REFERENCE, unit: string) => { const value = v[k]; if (value === null) return; const [min, max] = VITAL_REFERENCE[k]; if (value < min) out.push(`${label[k]} baixa (${value}${unit})`); else if (value > max) out.push(`${label[k]} alta (${value}${unit})`); };
  check('sbp', ' mmHg'); check('hr', ' bpm'); check('spo2', '%'); check('rr', ' irpm');
  return out;
}

// ---------- Sedação ----------
export function saveSedation(data: HemoData, caseId: string, input: HemoCase['sedation'], now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Sala', 'Recuperação');
  if (!input.level || !sedationLevels.includes(input.level)) throw new Error('Escolha o nível de sedação.');
  if (input.level !== 'Sem sedação' && !input.responsible.trim()) throw new Error('Informe quem conduziu a sedação.');
  const sedation = { level: input.level, responsible: input.level === 'Sem sedação' ? '' : input.responsible.trim(), notes: input.notes.trim() };
  return commit(data, caseId, x => ({ ...x, sedation }), 'Sedação', `${sedation.level}${sedation.responsible ? ` · ${sedation.responsible}` : ''}`, now);
}

// ---------- Passagem de plantão ----------
/** Separador de seção no texto (as linhas vazias de campos sem dado são descartadas). */
const SEP = '§';
/**
 * Resumo para a equipe que recebe o paciente (formato SBAR: situação, história, avaliação e o que vigiar).
 * Montado só com o que foi registrado; prazos e condutas seguem o protocolo do serviço e a prescrição.
 */
export function handoffDraft(data: HemoData, catalog: Product[], c: HemoCase, destination: string = c.recovery.destination, now = new Date()) {
  const p = patientOf(data, c), t = typeOf(data, c), renal = renalProfile(data, c, now);
  const doctor = c.schedule ? data.doctors.find(d => d.id === c.schedule!.doctorId)?.name : '';
  const implants = implantsOf(catalog, c);
  const lastVital = [...c.vitals].reverse().find(v => v.phase === 'Recuperação') ?? c.vitals.at(-1);
  const flagged = c.vitals.flatMap(v => vitalFlags(v).map(f => `${v.at.slice(11)} ${f}`));
  const band = bandStatus(c, now);
  const comp = complicationText(c.intra);
  const femoral = c.intra.access.startsWith('Femoral');
  const watch = [
    `Sítio de punção (${c.intra.access.toLocaleLowerCase('pt-BR') || 'acesso não registrado'}): sangramento, hematoma, dor e pulso e perfusão do ${femoral ? 'membro inferior' : 'membro superior'}.`,
    band ? `Pulseira radial: liberar às ${band.releaseAt.slice(11)} conforme o protocolo${band.overdue ? ' (horário já passou)' : ''}.` : c.band.placedAt && !c.band.removedAt ? 'Pulseira radial ainda colocada: liberar conforme o protocolo.' : '',
    femoral ? 'Acesso femoral: repouso e cuidados com o membro conforme o protocolo do serviço.' : '',
    'Dor torácica, alteração do ECG, arritmia ou instabilidade: avisar o hemodinamicista.',
    implants.some(i => /stent/i.test(i.product.name)) ? 'Recebeu stent: antiagregação conforme a prescrição; não suspender sem falar com o hemodinamicista.' : '',
    c.renal.recheckDue ? `Creatinina de controle em ${c.renal.recheckDue.split('-').reverse().join('/')}${renal.risk && renal.risk !== 'baixo' ? ` (TFG ${renal.egfr}, risco ${renal.risk})` : ''}.` : '',
    c.sedation.level && !['Sem sedação', 'Sedação mínima (ansiólise)'].includes(c.sedation.level) ? `Recebeu ${c.sedation.level.toLocaleLowerCase('pt-BR')}: observar nível de consciência e respiração até a recuperação completa.` : '',
    flagged.length ? `Sinais vitais fora da faixa de referência: ${flagged.join('; ')}.` : '',
    comp ? `Intercorrência na sala: ${comp}.` : '',
  ].filter(Boolean);
  return [
    `PASSAGEM DE PLANTÃO · HEMODINÂMICA → ${(destination || 'destino a definir').toLocaleUpperCase('pt-BR')}`,
    SEP,
    'SITUAÇÃO',
    `${p.name}, ${ageAt(p.birthDate, now)} anos, ${p.sex === 'F' ? 'feminino' : 'masculino'}. ${t.name}${c.intra.start ? ` em ${c.intra.start.slice(8, 10)}/${c.intra.start.slice(5, 7)} às ${c.intra.start.slice(11)}` : ''}${doctor ? ` com ${doctor}` : ''}.`,
    `Alergias: ${p.allergies.length ? p.allergies.join(', ') : 'nenhuma registrada'}.`,
    SEP,
    'HISTÓRIA',
    `Indicação: ${c.indication}`,
    p.conditions.length ? `Comorbidades: ${p.conditions.join(', ')}.` : '',
    `Função renal: ${p.creatinine === null ? 'sem creatinina registrada' : `creatinina ${p.creatinine.toLocaleString('pt-BR')} mg/dL${renal.egfr !== null ? `, TFG estimada ${renal.egfr}` : ''}`}.`,
    SEP,
    'PROCEDIMENTO',
    `Acesso ${c.intra.access.toLocaleLowerCase('pt-BR') || 'não registrado'} · contraste ${c.intra.contrastMl} mL · fluoroscopia ${c.intra.fluoroMin.toLocaleString('pt-BR')} min.`,
    c.findings.length ? `Achados e conduta: ${c.findings.map(f => `${f.vessel} ${f.stenosis}%${f.therapy ? ` (${f.therapy.toLocaleLowerCase('pt-BR')})` : ''}`).join('; ')}.` : '',
    implants.length ? `Implantes: ${implants.map(i => `${i.product.name}${i.used.serial ? ` (série ${i.used.serial})` : ''}`).join('; ')}.` : '',
    c.meds.length ? `Medicamentos na sala: ${c.meds.map(m => `${m.at.slice(11)} ${m.drug} ${m.dose.toLocaleString('pt-BR')} ${m.unit}`).join('; ')}.` : 'Medicamentos na sala: nenhum registrado.',
    c.act.readings.length ? `Último TCA: ${c.act.readings.at(-1)!.seconds} s às ${c.act.readings.at(-1)!.at.slice(11)}.` : '',
    `Sedação: ${c.sedation.level || 'não registrada'}${c.sedation.responsible ? ` (${c.sedation.responsible})` : ''}.`,
    `Intercorrências: ${comp || 'nenhuma registrada'}.`,
    SEP,
    'AVALIAÇÃO NA SAÍDA',
    `Hemostasia: ${c.recovery.hemostasis || 'não registrada'}.`,
    lastVital ? `Últimos sinais vitais (${lastVital.phase.toLocaleLowerCase('pt-BR')}): ${vitalText(lastVital)}.` : 'Sinais vitais: nenhum registrado.',
    c.recovery.notes ? `Observações: ${c.recovery.notes}` : '',
    SEP,
    'O QUE VIGIAR',
    ...watch.map(w => `• ${w}`),
  ].filter(Boolean).map(line => line === SEP ? '' : line).join('\n');
}
export function saveHandoff(data: HemoData, caseId: string, input: { text: string; receivedBy: string; unit: string }, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Recuperação');
  if (input.text.trim().length < 80) throw new Error('Monte o resumo da passagem de plantão antes de registrar.');
  if (input.receivedBy.trim().length < 3) throw new Error('Informe quem recebeu o paciente na unidade de destino.');
  if (!input.unit) throw new Error('Escolha o destino do paciente antes da passagem de plantão.');
  return commit(data, caseId, x => ({ ...x, handoff: { text: input.text.trim(), unit: input.unit, receivedBy: input.receivedBy.trim(), at: now.toISOString() } }), 'Passagem de plantão', `${input.unit} · recebido por ${input.receivedBy.trim()}`, now);
}
/** Destinos em que a passagem de plantão é esperada antes de liberar o paciente. */
export const needsHandoff = (destination: string) => destination === 'Internação' || destination === 'UTI';

// ---------- Bloqueio de sala ----------
export type BlockInput = { roomId: string; start: string; end: string; reason: RoomBlock['reason']; notes: string };
/** Eletivos ainda marcados que caem no período do bloqueio: precisam ser remarcados. */
export function blockConflicts(data: HemoData, input: Pick<BlockInput, 'roomId' | 'start' | 'end'>) {
  return data.cases.filter(c => c.schedule && c.schedule.roomId === input.roomId && ['Preparo', 'Agendamento'].includes(c.stage) && (() => { const o = occupancy(data, c, c.schedule!.start); return o.start < input.end && input.start < o.freeAt; })());
}
export function blockProblem(data: HemoData, input: BlockInput, now = new Date()) {
  if (!data.rooms.some(r => r.id === input.roomId)) return 'Selecione a sala.';
  if (!stamp.safeParse(input.start).success || !stamp.safeParse(input.end).success) return 'Informe início e fim do bloqueio.';
  if (input.end <= input.start) return 'O fim do bloqueio deve ser depois do início.';
  if (minutesOf(input.end) - minutesOf(input.start) > 31 * 24 * 60) return 'Bloqueio de no máximo 31 dias; para mais tempo, crie outro.';
  if (input.end <= localStamp(now)) return 'O bloqueio já terminou: registre só bloqueios atuais ou futuros.';
  if (!blockReasons.includes(input.reason)) return 'Escolha o motivo do bloqueio.';
  if (input.reason === 'Outro' && !input.notes.trim()) return 'Descreva o motivo do bloqueio.';
  const overlap = data.roomBlocks.find(b => b.roomId === input.roomId && input.start < b.end && b.start < input.end);
  if (overlap) return 'Já existe um bloqueio desta sala nesse período.';
  const inRoom = data.cases.find(c => c.schedule?.roomId === input.roomId && c.stage === 'Sala' && input.start <= localStamp(now));
  if (inRoom) return 'Há paciente em sala agora: o bloqueio pode começar depois do fim do procedimento.';
  return '';
}
export function addRoomBlock(data: HemoData, input: BlockInput, now = new Date()): HemoData {
  const problem = blockProblem(data, input, now);
  if (problem) throw new Error(problem);
  const block: RoomBlock = { id: newId(), roomId: input.roomId, start: input.start, end: input.end, reason: input.reason, notes: input.notes.trim(), createdAt: now.toISOString() };
  const room = data.rooms.find(r => r.id === input.roomId)!.name, affected = blockConflicts(data, input).length;
  return { ...data, revision: data.revision + 1, roomBlocks: [...data.roomBlocks, block].sort((a, b) => a.start.localeCompare(b.start)),
    audit: [{ id: newId(), at: now.toISOString(), caseId: '', action: 'Sala bloqueada', detail: `${room} · ${block.reason} · ${block.start.replace('T', ' ')} a ${block.end.replace('T', ' ')}${affected ? ` · ${affected} eletivo(s) a remarcar` : ''}`, by: '' }, ...data.audit] };
}
/** Encerra o bloqueio: se já começou, termina agora (o tempo parado continua contado); se é futuro, sai da agenda. */
export function endRoomBlock(data: HemoData, blockId: string, now = new Date()): HemoData {
  const b = data.roomBlocks.find(x => x.id === blockId);
  if (!b) throw new Error('Bloqueio não encontrado.');
  const at = localStamp(now), room = data.rooms.find(r => r.id === b.roomId)?.name ?? '';
  if (b.end <= at) throw new Error('Este bloqueio já terminou.');
  const started = b.start <= at;
  const roomBlocks = started ? data.roomBlocks.map(x => x.id === blockId ? { ...x, end: at > x.start ? at : addMinutes(x.start, 1) } : x) : data.roomBlocks.filter(x => x.id !== blockId);
  return { ...data, revision: data.revision + 1, roomBlocks, audit: [{ id: newId(), at: now.toISOString(), caseId: '', action: started ? 'Sala liberada' : 'Bloqueio cancelado', detail: `${room} · ${b.reason}`, by: '' }, ...data.audit] };
}
