import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmIdentity } from '../src/hemo/safety.ts';
import { makeHemoData, parseHemoData, findCase, savePrep, startProcedure, finishProcedure, scheduleCase, scheduleProblem, startEmergency, freeStarts } from '../src/hemo/domain.ts';
import { addVital, removeVital, vitalFlags, saveSedation, handoffDraft, saveHandoff, needsHandoff, addRoomBlock, blockProblem, blockConflicts, endRoomBlock } from '../src/hemo/care.ts';
import { roomUsage, periodEndingToday } from '../src/hemo/operations.ts';
import { makeDemoData, withHemoCatalog } from '../src/data.ts';

const now = new Date('2026-11-23T13:00:00Z'); // 10h em São Paulo.
const later = new Date('2026-11-23T13:30:00Z'); // 10h30.
const catalog = withHemoCatalog(makeDemoData()).products;
const base = () => makeHemoData(now);
const allPrep = { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: true, venousAccess: true };
const allTimeout = { identity: true, procedure: true, materials: true, team: true };
const inRoom = () => startProcedure(confirmIdentity(savePrep(base(), 'case-1', allPrep, allTimeout, '', now), 'case-1', { code: 'PAC-HP-2' }, now), 'case-1', now); // entrada 10:00
const vital = patch => ({ at: '2026-11-23T10:05', sbp: 128, dbp: 76, hr: 72, spo2: 97, rr: 16, rhythm: 'Sinusal', ...patch });
const intra = { roomIn: '', start: '2026-11-23T10:05', balloonAt: '', end: '2026-11-23T10:25', access: 'Radial direita', contrastMl: 80, fluoroMin: 6, kermaMgy: 420, complications: '', events: [], pressures: { aoSystolic: null, aoDiastolic: null, lvedp: null } };

test('dados salvos antes destas funções continuam válidos', () => {
  const old = JSON.parse(JSON.stringify(base()));
  delete old.roomBlocks;
  for (const c of old.cases) { delete c.vitals; delete c.sedation; delete c.handoff; }
  const parsed = parseHemoData(old);
  assert.deepEqual(parsed.roomBlocks, []);
  assert.deepEqual(findCase(parsed, 'case-4').vitals, []);
  assert.equal(findCase(parsed, 'case-4').handoff.at, '');
});

test('sinais vitais: validação, etapa, destaque fora da faixa e remoção', () => {
  const data = inRoom();
  assert.throws(() => addVital(data, 'case-1', vital({ sbp: null, dbp: null, hr: null, spo2: null, rr: null }), later), /pelo menos uma/);
  assert.throws(() => addVital(data, 'case-1', vital({ dbp: null }), later), /juntas/);
  assert.throws(() => addVital(data, 'case-1', vital({ sbp: 80, dbp: 90 }), later), /diastólica deve ser menor/);
  assert.throws(() => addVital(data, 'case-1', vital({ spo2: 120 }), later), /Saturação entre 50 e 100/);
  assert.throws(() => addVital(data, 'case-1', vital({ at: '2026-11-23T09:30' }), later), /antes da entrada/);
  assert.throws(() => addVital(data, 'case-1', vital({ at: '2026-11-23T11:00' }), later), /futuro/);
  assert.throws(() => addVital(base(), 'case-1', vital(), later), /etapa atual/);
  const ok = addVital(data, 'case-1', vital({ spo2: 88, hr: 132 }), later);
  const v = findCase(ok, 'case-1').vitals[0];
  assert.equal(v.phase, 'Sala');
  assert.deepEqual(vitalFlags(v), ['Frequência cardíaca alta (132 bpm)', 'Saturação baixa (88%)']);
  assert.match(ok.audit[0].detail, /^Sala · 10:05 · PA 128\/76 · FC 132 · SpO₂ 88% · FR 16 · sinusal$/);
  assert.equal(findCase(removeVital(ok, 'case-1', v.id, later), 'case-1').vitals.length, 0);
  // Só frequência cardíaca também vale.
  assert.equal(findCase(addVital(data, 'case-1', vital({ sbp: null, dbp: null, spo2: null, rr: null, rhythm: '' }), later), 'case-1').vitals[0].hr, 72);
});

test('sedação: nível obrigatório e responsável quando há sedação', () => {
  const data = inRoom();
  assert.throws(() => saveSedation(data, 'case-1', { level: '', responsible: '', notes: '' }, later), /nível/);
  assert.throws(() => saveSedation(data, 'case-1', { level: 'Sedação moderada', responsible: ' ', notes: '' }, later), /quem conduziu/);
  const ok = findCase(saveSedation(data, 'case-1', { level: 'Sem sedação', responsible: 'ignorado', notes: '' }, later), 'case-1');
  assert.deepEqual(ok.sedation, { level: 'Sem sedação', responsible: '', notes: '' });
});

test('passagem de plantão: resumo com o que foi registrado e registro de quem recebeu', () => {
  let data = addVital(inRoom(), 'case-1', vital({ spo2: 90 }), later);
  data = saveSedation(data, 'case-1', { level: 'Sedação moderada', responsible: 'Dra. Ana (anestesia)', notes: '' }, later);
  data = finishProcedure(data, 'case-1', { ...intra, events: ['Reação ao contraste'], complications: 'Urticária leve' }, later);
  const c = findCase(data, 'case-1');
  const text = handoffDraft(data, catalog, c, 'Internação', later);
  assert.match(text, /^PASSAGEM DE PLANTÃO · HEMODINÂMICA → INTERNAÇÃO/);
  assert.match(text, /Maria das Graças Lima, 58 anos, feminino\. Cateterismo cardíaco diagnóstico em 23\/11 às 10:05 com Dra\. Helena Prado\./);
  assert.match(text, /Alergias: nenhuma registrada\./);
  assert.match(text, /Sedação: Sedação moderada \(Dra\. Ana \(anestesia\)\)\./);
  assert.match(text, /Intercorrências: Reação ao contraste; Urticária leve\./);
  assert.match(text, /• Pulseira radial: liberar às 12:25 conforme o protocolo\./);
  assert.match(text, /• Recebeu sedação moderada: observar nível de consciência/);
  assert.match(text, /• Sinais vitais fora da faixa de referência: 10:05 Saturação baixa \(90%\)\./);
  assert.doesNotMatch(text, /\n\n\n/);
  assert.doesNotMatch(text, /undefined|null/);
  assert.throws(() => saveHandoff(data, 'case-1', { text, receivedBy: 'Jo', unit: 'Internação' }, later), /quem recebeu/);
  assert.throws(() => saveHandoff(data, 'case-1', { text, receivedBy: 'Enf. Paula', unit: '' }, later), /destino/);
  const saved = findCase(saveHandoff(data, 'case-1', { text, receivedBy: ' Enf. Paula ', unit: 'Internação' }, later), 'case-1');
  assert.deepEqual([saved.handoff.unit, saved.handoff.receivedBy, saved.handoff.at], ['Internação', 'Enf. Paula', later.toISOString()]);
  assert.equal(needsHandoff('UTI'), true); assert.equal(needsHandoff('Alta no mesmo dia'), false);
});

test('bloqueio de sala: some da agenda e da urgência, mostra eletivos a remarcar', () => {
  const block = { roomId: 'sala-1', start: '2026-11-24T07:00', end: '2026-11-24T18:00', reason: 'Manutenção corretiva', notes: 'Tubo de raios X' };
  const data = base();
  assert.deepEqual(blockConflicts(data, block).map(c => c.id), ['case-1']); // Maria, amanhã 09:00 na sala 1.
  const blocked = addRoomBlock(data, block, now);
  assert.match(blocked.audit[0].detail, /Sala 1 · Angiógrafo A · Manutenção corretiva · .* · 1 eletivo\(s\) a remarcar/);
  assert.match(scheduleProblem(blocked, 'case-3', { roomId: 'sala-1', doctorId: 'doc-1', start: '2026-11-24T13:00' }, now), /Sala bloqueada \(manutenção corretiva\) de 24\/11 07:00 a 18:00/);
  assert.equal(scheduleProblem(blocked, 'case-3', { roomId: 'sala-2', doctorId: 'doc-1', start: '2026-11-24T13:00' }, now), '');
  assert.ok(freeStarts(blocked, 'case-3', 'sala-1', 'doc-1', '2026-11-24', now).every(t => t >= '2026-11-24T18:00'));
  assert.throws(() => scheduleCase(blocked, 'case-3', { roomId: 'sala-1', doctorId: 'doc-2', start: '2026-11-24T08:00' }, now), /bloqueada/);
  // Bloqueio em andamento impede a urgência naquela sala.
  const now2 = addRoomBlock(data, { ...block, start: '2026-11-23T09:00', end: '2026-11-23T12:00' }, now);
  assert.throws(() => startEmergency(now2, { patientId: 'hp-3', typeId: 'iam', roomId: 'sala-1', doctorId: 'doc-1', indication: 'IAM', requestedBy: 'PS', doorAt: '2026-11-23T09:50' }, now), /Sala bloqueada agora/);
  assert.doesNotThrow(() => startEmergency(now2, { patientId: 'hp-3', typeId: 'iam', roomId: 'sala-2', doctorId: 'doc-1', indication: 'IAM', requestedBy: 'PS', doorAt: '2026-11-23T09:50' }, now));
});

test('bloqueio: regras de criação e encerramento', () => {
  const data = base();
  const b = { roomId: 'sala-2', start: '2026-11-23T08:00', end: '2026-11-23T12:00', reason: 'Manutenção preventiva', notes: '' };
  assert.match(blockProblem(data, { ...b, end: '2026-11-23T07:00' }, now), /depois do início/);
  assert.match(blockProblem(data, { ...b, end: '2026-11-23T09:00' }, now), /já terminou/);
  assert.match(blockProblem(data, { ...b, reason: 'Outro' }, now), /Descreva/);
  assert.match(blockProblem(data, { ...b, end: '2027-01-30T08:00' }, now), /31 dias/);
  const one = addRoomBlock(data, b, now);
  assert.match(blockProblem(one, { ...b, start: '2026-11-23T11:00', end: '2026-11-23T14:00' }, now), /Já existe um bloqueio/);
  // Encerrar um bloqueio em andamento corta o fim para agora; o tempo parado continua contado.
  const ended = endRoomBlock(one, one.roomBlocks[0].id, now);
  assert.equal(ended.roomBlocks[0].end, '2026-11-23T10:00');
  assert.equal(ended.audit[0].action, 'Sala liberada');
  assert.equal(roomUsage(ended, periodEndingToday(7, now))[1].blockedMin, 120);
  // Bloqueio futuro cancelado sai da agenda.
  const future = addRoomBlock(data, { ...b, start: '2026-11-25T08:00', end: '2026-11-25T10:00' }, now);
  assert.deepEqual(endRoomBlock(future, future.roomBlocks[0].id, now).roomBlocks, []);
});

test('ocupação desconta o tempo bloqueado do disponível', () => {
  const data = addRoomBlock(base(), { roomId: 'sala-2', start: '2026-11-22T07:00', end: '2026-11-23T19:00', reason: 'Manutenção corretiva', notes: '' }, now);
  const sala2 = roomUsage(data, periodEndingToday(7, now))[1];
  // Dois dias inteiros da janela (2 × 12 h) parados saem das 7 × 12 h disponíveis da semana.
  assert.equal(sala2.blockedMin, 1440);
  assert.equal(sala2.availableMin, 5040 - 1440);
});
