import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHemoData, parseHemoData, findCase, savePrep, startProcedure, finishProcedure, startEmergency, doorToBalloon, safetyAlerts, copilotContext, billingItems,
  egfr, renalProfile, contrastWarning, recordRenalRecheck, pendingRenalRechecks,
} from '../src/hemo/domain.ts';
import {
  stampAudit, urgencyTimeline, saveUrgencyTimes, timelineMedians, onCallFor, setOnCall, addMedication, removeMedication, addActReading, setActTarget, actStatus,
  setBand, removeBand, bandStatus, dischargeDraft, saveDischarge, consentText, signConsent, saveImaging, replenishmentOrders, clinicalIndicators,
} from '../src/hemo/clinical.ts';
import { makeDemoData, withHemoCatalog } from '../src/data.ts';

const now = new Date('2026-11-23T13:00:00Z'); // 10h em São Paulo.
const later = new Date('2026-11-23T13:30:00Z'); // 10h30.
const base = () => makeHemoData(now);
const catalog = () => withHemoCatalog(makeDemoData()).products;
const allPrep = { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: true, venousAccess: true };
const allTimeout = { identity: true, procedure: true, materials: true, team: true };
const intra = { roomIn: '', start: '2026-11-24T09:05', balloonAt: '', end: '2026-11-24T09:45', access: 'Radial direita', contrastMl: 80, fluoroMin: 6, kermaMgy: 420, complications: '' };
const inRoom = () => startProcedure(savePrep(base(), 'case-1', allPrep, allTimeout, '', now), 'case-1', now);
const signature = `data:image/png;base64,${'A'.repeat(3000)}`;

test('autoria: entradas novas do histórico levam o usuário logado; as antigas não mudam', () => {
  const first = stampAudit(base(), savePrep(base(), 'case-1', allPrep, allTimeout, '', now), 'Ana Admin');
  assert.equal(first.audit[0].by, 'Ana Admin');
  const second = stampAudit(first, startProcedure(first, 'case-1', now), 'Dr. Paulo');
  assert.deepEqual(second.audit.slice(0, 2).map(a => a.by), ['Dr. Paulo', 'Ana Admin']);
  assert.equal(stampAudit(first, first, ''), first);
});

test('dados salvos antes destas funções continuam válidos (campos novos têm padrão)', () => {
  const old = JSON.parse(JSON.stringify(base()));
  delete old.onCall;
  for (const c of old.cases) for (const k of ['urgency', 'meds', 'act', 'renal', 'band', 'discharge', 'consent', 'imaging']) delete c[k];
  for (const a of old.audit) delete a.by;
  const parsed = parseHemoData(old);
  assert.deepEqual(parsed.onCall, []);
  assert.deepEqual(findCase(parsed, 'case-4').meds, []);
  assert.equal(findCase(parsed, 'case-4').renal.recheckDue, '');
});

test('TFG estimada pela CKD-EPI 2021', () => {
  assert.equal(egfr(1.0, 60, 'M'), 86);
  assert.equal(egfr(0.6, 50, 'F'), 109);
  assert.equal(egfr(null, 60, 'M'), null);
  const data = base();
  // Antônio: 67 anos, creatinina 1,6 → TFG 47, risco de atenção, limite 47 × 3,7 = 174 mL.
  assert.deepEqual(renalProfile(data, findCase(data, 'case-2'), now), { egfr: 47, risk: 'atenção', contrastLimitMl: 174 });
  const alerts = safetyAlerts(data, findCase(data, 'case-2')).map(a => a.text).join(' | ');
  assert.match(alerts, /TFG estimada 47/); assert.match(alerts, /Limite sugerido de contraste: 174 mL/);
  assert.equal(copilotContext(data, catalog(), findCase(data, 'case-2'), now).funcaoRenal.tfgEstimada, 47);
  assert.match(contrastWarning(data, findCase(data, 'case-2'), 200), /acima do limite sugerido de 174 mL/);
  assert.equal(contrastWarning(data, findCase(data, 'case-2'), 150), '');
});

test('contraste acima do limite programa creatinina de controle; KDIGO marca lesão renal aguda', () => {
  // Maria: TFG 74 → limite 274 mL. Com 80 mL não programa controle.
  let data = finishProcedure(inRoom(), 'case-1', intra, now);
  assert.equal(findCase(data, 'case-1').renal.recheckDue, '');
  assert.throws(() => recordRenalRecheck(data, 'case-1', 1.0, now), /não tem creatinina/);
  data = finishProcedure(inRoom(), 'case-1', { ...intra, contrastMl: 300 }, now);
  const c = findCase(data, 'case-1');
  assert.equal(c.renal.baselineEgfr, 74);
  assert.equal(c.renal.contrastLimitMl, 274);
  assert.equal(c.renal.recheckDue, '2026-11-26');
  assert.deepEqual(pendingRenalRechecks(data, now).map(x => x.c.id), ['case-1']);
  assert.throws(() => recordRenalRecheck(data, 'case-1', 0, now), /mg\/dL/);
  assert.equal(findCase(recordRenalRecheck(data, 'case-1', 1.1, now), 'case-1').renal.aki, false); // +0,2 sobre 0,9
  const aki = recordRenalRecheck(data, 'case-1', 1.2, now); // +0,3
  assert.equal(findCase(aki, 'case-1').renal.aki, true);
  assert.match(aki.audit[0].detail, /lesão renal aguda/);
  assert.deepEqual(pendingRenalRechecks(aki, now), []);
  assert.deepEqual(clinicalIndicators(aki).renal, { programmed: 1, done: 1, aki: 1 });
});

test('urgência por etapas: ECG na abertura, horários em ordem e soma igual ao porta-balão', () => {
  const at = new Date('2026-11-24T11:50:00Z'); // 08:50 em São Paulo.
  const input = { patientId: 'hp-3', typeId: 'iam', roomId: 'sala-1', doctorId: 'doc-2', indication: 'IAM com supra inferior.', requestedBy: 'PS', doorAt: '2026-11-24T08:20' };
  assert.throws(() => startEmergency(base(), { ...input, ecgAt: '2026-11-24T08:10' }, at), /ECG/);
  let data = startEmergency(base(), { ...input, ecgAt: '2026-11-24T08:26' }, at);
  const id = data.cases[0].id;
  assert.equal(findCase(data, id).urgency.ecgAt, '2026-11-24T08:26');
  assert.throws(() => saveUrgencyTimes(data, id, { ecgAt: '2026-11-24T08:26', teamCalledAt: '2026-11-24T08:24', teamArrivedAt: '' }, at), /antes de ECG/);
  assert.throws(() => saveUrgencyTimes(data, id, { ecgAt: '2026-11-24T08:26', teamCalledAt: '2026-11-24T08:30', teamArrivedAt: '2026-11-24T09:00' }, at), /futuro/);
  assert.throws(() => saveUrgencyTimes(data, 'case-1', { ecgAt: '', teamCalledAt: '', teamArrivedAt: '' }, at), /Só urgências/);
  data = saveUrgencyTimes(data, id, { ecgAt: '2026-11-24T08:26', teamCalledAt: '2026-11-24T08:30', teamArrivedAt: '2026-11-24T08:45' }, at);
  data = startProcedure(savePrep(data, id, findCase(data, id).prep, allTimeout, '', at), id, at);
  data = finishProcedure(data, id, { ...intra, start: '2026-11-24T08:55', balloonAt: '2026-11-24T09:20', end: '2026-11-24T09:50', contrastMl: 150 }, at);
  const steps = urgencyTimeline(findCase(data, id));
  assert.deepEqual(steps.map(s => s.minutes), [6, 4, 15, 10, 25]);
  assert.equal(steps.reduce((s, x) => s + x.minutes, 0), doorToBalloon(findCase(data, id)));
  assert.equal(steps[0].target, 10);
  // Demonstração: Carlos (62 min) por etapas.
  assert.deepEqual(timelineMedians(base()).map(s => s.median), [6, 4, 12, 9, 31]);
});

test('sobreaviso: escala por dia, troca e limpa', () => {
  let data = base();
  assert.equal(onCallFor(data, '2026-11-23'), 'doc-1');
  assert.equal(onCallFor(data, '2026-11-24'), 'doc-2');
  data = setOnCall(data, '2026-11-23', 'doc-2', now);
  assert.equal(onCallFor(data, '2026-11-23'), 'doc-2');
  assert.match(data.audit[0].detail, /Dr. Marcos Teles/);
  assert.equal(onCallFor(setOnCall(data, '2026-11-23', '', now), '2026-11-23'), '');
  assert.throws(() => setOnCall(data, '2026-11-23', 'doc-9', now), /hemodinamicista/);
  assert.throws(() => setOnCall(data, '23/11', 'doc-1', now), /dia/);
});

test('medicamentos e TCA na sala: horário dentro da sala, dose obrigatória, vão para a conta', () => {
  let data = inRoom(); // entrada às 10:00
  const heparin = { at: '2026-11-23T10:05', drug: 'Heparina não fracionada', dose: 5000, unit: 'UI', route: 'Intra-arterial' };
  assert.throws(() => addMedication(data, 'case-1', { ...heparin, at: '2026-11-23T09:50' }, later), /antes da entrada/);
  assert.throws(() => addMedication(data, 'case-1', { ...heparin, at: '2026-11-23T11:00' }, later), /futuro/);
  assert.throws(() => addMedication(data, 'case-1', { ...heparin, dose: 0 }, later), /dose/);
  assert.throws(() => addMedication(base(), 'case-1', heparin, later), /etapa/);
  data = addMedication(data, 'case-1', heparin, later);
  const c = findCase(data, 'case-1');
  assert.equal(c.meds.length, 1);
  assert.ok(billingItems(data, catalog(), c).includes('Medicamento: Heparina não fracionada 5.000 UI · intra-arterial'));
  assert.equal(findCase(removeMedication(data, 'case-1', c.meds[0].id, later), 'case-1').meds.length, 0);
  assert.throws(() => addActReading(data, 'case-1', '2026-11-23T10:20', 40, later), /TCA entre/);
  data = addActReading(data, 'case-1', '2026-11-23T10:20', 260, later);
  assert.equal(actStatus(findCase(data, 'case-1')).belowTarget, false);
  data = setActTarget(data, 'case-1', 300, later);
  assert.equal(actStatus(findCase(data, 'case-1')).belowTarget, true);
  assert.equal(copilotContext(data, catalog(), findCase(data, 'case-1'), later).medicamentosNaSala.length, 1);
});

test('pulseira radial: começa ao concluir, cronômetro e retirada', () => {
  let data = finishProcedure(inRoom(), 'case-1', intra, now); // fim 24/11 09:45, radial
  let c = findCase(data, 'case-1');
  assert.deepEqual(c.band, { placedAt: '2026-11-24T09:45', releaseMin: 120, removedAt: '' });
  assert.deepEqual(bandStatus(c, new Date('2026-11-24T13:00:00Z')), { releaseAt: '2026-11-24T11:45', minutesLeft: 105, overdue: false });
  assert.equal(bandStatus(c, new Date('2026-11-24T15:00:00Z')).overdue, true);
  const afterward = new Date('2026-11-24T16:00:00Z'); // 13:00
  assert.throws(() => setBand(data, 'case-1', '2026-11-24T09:45', 10, afterward), /15 e 480/);
  assert.throws(() => setBand(data, 'case-1', '2026-11-24T09:00', 120, afterward), /antes do início/);
  data = setBand(data, 'case-1', '2026-11-24T09:50', 90, afterward);
  assert.throws(() => removeBand(data, 'case-1', '2026-11-24T09:40', afterward), /entre a colocação e agora/);
  data = removeBand(data, 'case-1', '2026-11-24T11:25', afterward);
  c = findCase(data, 'case-1');
  assert.equal(c.band.removedAt, '2026-11-24T11:25');
  assert.equal(bandStatus(c, afterward), null);
  assert.match(data.audit[0].detail, /95 min de compressão/);
  // Acesso femoral não usa pulseira.
  const femoral = finishProcedure(inRoom(), 'case-1', { ...intra, access: 'Femoral direita' }, now);
  assert.equal(findCase(femoral, 'case-1').band.placedAt, '');
  assert.throws(() => setBand(femoral, 'case-1', '2026-11-24T09:50', 120, afterward), /radial/);
});

test('alta: modelo sem doses, aviso do stent e prescrição obrigatória para quem recebeu stent', () => {
  const data = base(), products = catalog(), c = findCase(data, 'case-4'); // Luíza: stent, acesso radial
  const draft = dischargeDraft(data, products, c);
  assert.match(draft, /Luíza Martins Costa/);
  assert.match(draft, /braço da punção/);
  assert.match(draft, /um stent/);
  assert.match(draft, /antiagregante/);
  assert.doesNotMatch(draft, /\d+\s?mg/);
  assert.throws(() => saveDischarge(data, products, 'case-4', { text: draft, medications: '', returnDate: '' }, true, now), /stent/);
  const saved = saveDischarge(data, products, 'case-4', { text: draft, medications: 'Conforme receita entregue.', returnDate: '2026-12-10' }, true, now);
  assert.ok(findCase(saved, 'case-4').discharge.deliveredAt);
  assert.throws(() => saveDischarge(data, products, 'case-1', { text: draft, medications: 'x', returnDate: '' }, false, now), /etapa/);
  assert.throws(() => saveDischarge(data, products, 'case-4', { text: 'curto', medications: 'x', returnDate: '' }, false, now), /orientação/);
  assert.equal(clinicalIndicators(saved).dischargeDelivered, 1);
});

test('consentimento assinado na tela marca o item do preparo', () => {
  const data = base();
  assert.match(consentText(data, findCase(data, 'case-1')), /Cateterismo cardíaco diagnóstico/);
  assert.throws(() => signConsent(data, 'case-1', { signer: 'Maria das Graças Lima', relation: 'Paciente', signature: 'data:image/png;base64,AA' }, now), /assinar no quadro/);
  assert.throws(() => signConsent(data, 'case-1', { signer: 'Ma', relation: 'Paciente', signature }, now), /nome/);
  assert.throws(() => signConsent(data, 'case-4', { signer: 'Luíza', relation: 'Paciente', signature }, now), /etapa/);
  const signed = signConsent(data, 'case-1', { signer: 'Maria das Graças Lima', relation: 'Paciente', signature }, now);
  const c = findCase(signed, 'case-1');
  assert.equal(c.prep.consent, true);
  assert.equal(c.consent.signer, 'Maria das Graças Lima');
});

test('imagens: só link http(s) e a partir da sala', () => {
  const data = base();
  assert.throws(() => saveImaging(data, 'case-1', '123', '', now), /etapa/);
  assert.throws(() => saveImaging(data, 'case-4', '123', 'javascript:alert(1)', now), /Link inválido/);
  assert.throws(() => saveImaging(data, 'case-4', '123', 'pacs/estudo', now), /Link inválido/);
  const saved = saveImaging(data, 'case-4', ' ACC-0001 ', 'https://pacs.exemplo.local/estudo/0001', now);
  assert.deepEqual(findCase(saved, 'case-4').imaging, { accession: 'ACC-0001', url: 'https://pacs.exemplo.local/estudo/0001' });
});

test('pedido de reposição agrupa por fornecedor e nunca pede zero', () => {
  const stock = withHemoCatalog(makeDemoData());
  const orders = replenishmentOrders(base(), stock);
  assert.ok(orders.length > 0);
  for (const o of orders) {
    assert.ok(o.items.every(i => i.quantity > 0 && i.product.consigned));
    assert.match(o.text, new RegExp(`Fornecedor: ${o.supplier}`));
  }
});
