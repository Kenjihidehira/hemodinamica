import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHemoData, parseHemoData, requestCase, decideAuthorization, scheduleCase, scheduleProblem, freeStarts, safetyAlerts, prepMissing, savePrep, startProcedure,
  consumeMaterial, returnMaterial, finishProcedure, finishRecovery, saveReport, signReport, closeBilling, cancelCase, materialAlerts, hemoMaterials, usableLots,
  pendingReplenishment, receiveReplenishment, copilotContext, findCase,
  saveOpme, opmeGaps, startEmergency, displacedBy, doorToBalloon, regularizeAuthorization, doseAlerts, recordFollowUp, pendingFollowUps,
  registerGlosa, appealGlosa, resolveGlosa, tissPreview, traceLot, implantsOf, prepMessage, hemoIndicators,
} from '../src/hemo/domain.ts';
import { makeDemoData, withHemoCatalog, availableQuantity, HEMO_CATEGORY } from '../src/data.ts';
import { allocate } from '../src/domain.ts';

const now = new Date('2026-11-23T13:00:00Z'); // 10h em São Paulo.
const base = () => makeHemoData(now);
const stockBase = () => withHemoCatalog(makeDemoData());
const pos = (stock, id) => stock.stock.find(s => s.id === id);
const allPrep = { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: true, venousAccess: true };
const allTimeout = { identity: true, procedure: true, materials: true, team: true };
const intra = { roomIn: '', start: '2026-11-24T09:05', end: '2026-11-24T09:45', access: 'Radial direita', contrastMl: 80, fluoroMin: 6, kermaMgy: 420, complications: '' };

/** Leva o caso 1 (agendado amanhã às 09:00, sala 1, doc-1) até a sala. */
function inRoom() {
  const data = savePrep(base(), 'case-1', allPrep, allTimeout, '', now);
  return startProcedure(data, 'case-1', now);
}

test('demo: dados fictícios válidos e regraváveis', () => {
  assert.equal(parseHemoData(JSON.parse(JSON.stringify(base()))).cases.length, 5);
});

test('estoque único: catálogo da hemodinâmica entra uma vez, só acrescenta e não mexe no que existe', () => {
  const original = makeDemoData();
  const merged = withHemoCatalog(original);
  assert.equal(merged.products.length, original.products.length + 7);
  assert.equal(merged.stock.length, original.stock.length + 8);
  assert.deepEqual(merged.stock.slice(0, original.stock.length), original.stock);
  assert.deepEqual(merged.movements, original.movements);
  assert.equal(withHemoCatalog(merged), merged);
  assert.ok(merged.products.filter(p => p.category === HEMO_CATEGORY).every(p => typeof p.consigned === 'boolean'));
});

test('migração: dados da versão com estoque próprio passam a apontar para o Estoque do hospital', () => {
  const v1 = JSON.parse(JSON.stringify(base()));
  v1.schemaVersion = 1; v1.materials = [{ id: 'mat-5' }]; v1.lots = [{ id: 'lot-6' }];
  v1.cases.find(c => c.id === 'case-4').materials = [{ id: 'u', lotId: 'lot-6', materialId: 'mat-5', lot: 'SF30-2612', quantity: 1, at: now.toISOString() }];
  const migrated = parseHemoData(v1);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal('lots' in migrated, false);
  assert.deepEqual(findCase(migrated, 'case-4').materials.map(m => [m.stockId, m.productId]), [['hs-6', 'hem-5']]);
});

test('pedido: convênio aguarda autorização, particular vai direto para agendamento', () => {
  let data = requestCase(base(), { patientId: 'hp-3', typeId: 'perif', requestedBy: 'Dr. Teste', indication: 'Claudicação', priority: 'Eletivo' }, now);
  assert.equal(data.cases[0].stage, 'Autorização');
  data = requestCase(data, { patientId: 'hp-2', typeId: 'atc', requestedBy: 'Dr. Teste', indication: 'Lesão grave', priority: 'Urgência' }, now);
  assert.equal(data.cases[0].stage, 'Agendamento');
  assert.equal(data.cases[0].authorization.status, 'Não se aplica');
  assert.throws(() => requestCase(data, { patientId: 'hp-2', typeId: 'atc', requestedBy: 'X', indication: 'Y', priority: 'Eletivo' }, now), /já tem esse procedimento/);
  assert.throws(() => requestCase(data, { patientId: 'hp-4', typeId: 'cate', requestedBy: 'X', indication: '', priority: 'Eletivo' }, now), /indicação/);
});

test('autorização: exige guia para aprovar e motivo para negar; negada cancela', () => {
  assert.throws(() => decideAuthorization(base(), 'case-2', true, '', '', now), /guia/);
  assert.throws(() => decideAuthorization(base(), 'case-2', false, '', '', now), /motivo/);
  assert.equal(findCase(decideAuthorization(base(), 'case-2', true, 'G-1', '', now), 'case-2').stage, 'Agendamento');
  const denied = findCase(decideAuthorization(base(), 'case-2', false, '', 'Sem cobertura', now), 'case-2');
  assert.equal(denied.stage, 'Cancelado');
  assert.match(denied.cancelReason, /Sem cobertura/);
});

test('agenda da sala: bloqueia sala durante procedimento + preparo, médico e passado', () => {
  const data = base(); // case-1: sala-1, doc-1, amanhã 09:00, cateterismo 45 min + 15 de preparo.
  assert.match(scheduleProblem(data, 'case-3', { roomId: 'sala-1', doctorId: 'doc-2', start: '2026-11-24T09:50' }, now), /sala está ocupada/);
  assert.equal(scheduleProblem(data, 'case-3', { roomId: 'sala-1', doctorId: 'doc-2', start: '2026-11-24T10:00' }, now), '');
  assert.match(scheduleProblem(data, 'case-3', { roomId: 'sala-2', doctorId: 'doc-1', start: '2026-11-24T09:30' }, now), /hemodinamicista/);
  assert.equal(scheduleProblem(data, 'case-3', { roomId: 'sala-2', doctorId: 'doc-1', start: '2026-11-24T09:45' }, now), '');
  assert.match(scheduleProblem(data, 'case-3', { roomId: 'sala-2', doctorId: 'doc-2', start: '2026-11-23T08:00' }, now), /futuro/);
  const slots = freeStarts(data, 'case-3', 'sala-1', 'doc-2', '2026-11-24', now);
  assert.ok(!slots.includes('2026-11-24T09:00') && !slots.includes('2026-11-24T09:45') && slots.includes('2026-11-24T10:00'));
  const next = scheduleCase(data, 'case-3', { roomId: 'sala-2', doctorId: 'doc-2', start: '2026-11-24T10:00' }, now);
  assert.equal(findCase(next, 'case-3').stage, 'Preparo');
});

test('segurança: alertas de contraste, função renal, anticoagulante e metformina', () => {
  const data = base();
  const a1 = safetyAlerts(data, findCase(data, 'case-2')).map(a => a.text).join(' | ');
  assert.match(a1, /Alergia a contraste/); assert.match(a1, /Creatinina 1,6/); assert.match(a1, /metformina/);
  assert.match(safetyAlerts(data, findCase(data, 'case-3')).map(a => a.text).join(' '), /anticoagulante/);
  assert.equal(safetyAlerts(data, findCase(data, 'case-1')).length, 0);
});

test('preparo: só entra em sala com preparo e time-out completos', () => {
  const data = base();
  assert.ok(prepMissing(findCase(data, 'case-1')).some(m => /consentimento/.test(m)));
  assert.throws(() => startProcedure(data, 'case-1', now), /Falta concluir/);
  const room = inRoom();
  assert.equal(findCase(room, 'case-1').stage, 'Sala');
  assert.equal(findCase(room, 'case-1').intra.roomIn, '2026-11-23T10:00');
});

test('materiais: uso em paciente é saída no Estoque do hospital, com movimentação rastreável', () => {
  const stock = stockBase();
  let { hemo, stock: s } = consumeMaterial(inRoom(), stock, 'case-1', 'hs-1', 2, now);
  assert.equal(pos(s, 'hs-1').quantity, 16);
  assert.equal(pos(stock, 'hs-1').quantity, 18); // estado anterior intacto
  const movement = s.movements[0];
  assert.equal(movement.type, 'Saída');
  assert.equal(movement.productId, 'hem-1');
  assert.match(movement.reason, /Uso em paciente · Maria das Graças Lima · Cateterismo/);
  assert.equal(s.audit[0].stockId, 'hs-1');
  const used = findCase(hemo, 'case-1').materials[0];
  assert.deepEqual([used.stockId, used.productId, used.lot, used.quantity], ['hs-1', 'hem-1', 'IR6-2611', 2]);
  ({ hemo, stock: s } = returnMaterial(hemo, s, 'case-1', used.id, now));
  assert.equal(pos(s, 'hs-1').quantity, 18);
  assert.equal(s.movements[0].type, 'Entrada');
  assert.equal(findCase(hemo, 'case-1').materials.length, 0);
});

test('materiais: respeita as regras do Estoque (reserva, bloqueio, quarentena, vencido) e a etapa', () => {
  const stock = allocate(stockBase(), 'hs-1', 10, 4, 2, 'Separado para outra unidade');
  assert.equal(availableQuantity(pos(stock, 'hs-1')), 2);
  assert.throws(() => consumeMaterial(inRoom(), stock, 'case-1', 'hs-1', 3, now), /2 un\. disponíveis/);
  const expired = { ...stock, stock: stock.stock.map(s => s.id === 'hs-3' ? { ...s, expiresAt: '2020-01-01' } : s) };
  assert.throws(() => consumeMaterial(inRoom(), expired, 'case-1', 'hs-3', 1, now), /vencido/);
  assert.ok(!usableLots(expired).some(s => s.id === 'hs-3'));
  assert.ok(usableLots(stockBase()).every(s => s.productId.startsWith('hem-')));
  assert.throws(() => consumeMaterial(base(), stockBase(), 'case-1', 'hs-1', 1, now), /etapa atual/);
});

test('procedimento completo: sala → recuperação → laudo assinado → faturamento com notas simuladas', () => {
  let { hemo: data, stock } = consumeMaterial(inRoom(), stockBase(), 'case-1', 'hs-4', 1, now); // fio-guia consignado (Fornecedor Beta)
  assert.throws(() => finishProcedure(data, 'case-1', { ...intra, access: '' }, now), /via de acesso/);
  assert.throws(() => finishProcedure(data, 'case-1', { ...intra, contrastMl: 0 }, now), /contraste/);
  data = finishProcedure(data, 'case-1', intra, now);
  assert.throws(() => finishRecovery(data, 'case-1', { hemostasis: 'Pulseira', stable: false, destination: 'Alta no mesmo dia', notes: '' }, now), /estáveis/);
  data = finishRecovery(data, 'case-1', { hemostasis: 'Pulseira radial', stable: true, destination: 'Alta no mesmo dia', notes: '' }, now);
  assert.throws(() => signReport(data, 'case-1', 'doc-1', now), /descrição e conclusão/);
  data = saveReport(data, 'case-1', { findings: [{ id: 'x', vessel: 'DA', stenosis: 40, treatment: '' }], text: 'Descrição.', conclusion: 'Lesão moderada.', copilotDraft: true }, now);
  assert.throws(() => signReport(data, 'case-1', 'doc-2', now), /hemodinamicista do procedimento/);
  data = signReport(data, 'case-1', 'doc-1', now);
  const signed = findCase(data, 'case-1');
  assert.equal(signed.stage, 'Faturamento');
  assert.match(signed.report.signedBy, /Helena/);
  assert.throws(() => saveReport(data, 'case-1', { findings: [], text: 'mudança', conclusion: 'x', copilotDraft: false }, now), /etapa atual/);
  data = closeBilling(data, stock.products, 'case-1', now);
  const closed = findCase(data, 'case-1');
  assert.equal(closed.stage, 'Encerrado');
  assert.deepEqual(closed.invoices.map(i => [i.kind, i.recipient, i.status]), [['Serviço', 'Maria das Graças Lima (particular)', 'Simulada'], ['Reposição de consignado', 'Fornecedor Beta', 'Simulada']]);
  assert.equal(parseHemoData(JSON.parse(JSON.stringify(data))).cases.length, 5);
});

test('consignado: pendência de reposição e entrada do lote novo no Estoque do hospital', () => {
  const stock = stockBase();
  const pending = pendingReplenishment(base(), stock.products);
  assert.equal(pending.length, 3); // fio-guia, balão e stent do caso 4
  const stent = pending.find(p => p.product.id === 'hem-5');
  assert.throws(() => receiveReplenishment(base(), stock, stent.caseId, stent.used.id, { lot: '', expiresAt: '2027-12-01' }, now), /lote/);
  assert.throws(() => receiveReplenishment(base(), stock, stent.caseId, stent.used.id, { lot: 'SF30-2612', expiresAt: '2030-01-01' }, now), /outra validade/);
  const { hemo, stock: s } = receiveReplenishment(base(), stock, stent.caseId, stent.used.id, { lot: 'SF30-NOVO', expiresAt: '2027-12-01' }, now);
  const created = s.stock.find(x => x.lot === 'SF30-NOVO');
  assert.deepEqual([created.productId, created.quantity, created.location], ['hem-5', 1, pos(stock, 'hs-6').location]);
  assert.match(s.movements[0].reason, /Reposição de consignado/);
  assert.equal(pendingReplenishment(hemo, s.products).length, 2);
  assert.throws(() => receiveReplenishment(hemo, s, stent.caseId, stent.used.id, { lot: 'SF30-NOVO', expiresAt: '2027-12-01' }, now), /já registrada/);
});

test('alertas e saldo da hemodinâmica seguem o Estoque do hospital', () => {
  const stock = stockBase();
  const texts = materialAlerts(stock).map(a => a.text).join(' | ');
  assert.match(texts, /JL4-2607 vence em 20/);
  assert.match(texts, /Pulseira de compressão radial: 8 un\. disponíveis \(mínimo 10\)/);
  assert.doesNotMatch(texts, /Stent farmacológico 3,0/);
  assert.equal(hemoMaterials(stock).length, 7);
  const blocked = allocate(stock, 'hs-6', 0, 2, 0, 'Embalagem danificada');
  assert.equal(hemoMaterials(blocked).find(m => m.product.id === 'hem-5').available, 1);
  assert.match(materialAlerts(blocked).map(a => a.text).join(' '), /Stent farmacológico 3,0 × 18 mm: 1 un\./);
});

test('cancelamento só antes da sala e com motivo', () => {
  assert.throws(() => cancelCase(base(), 'case-1', '', now), /motivo/);
  assert.equal(findCase(cancelCase(base(), 'case-1', 'Paciente desistiu', now), 'case-1').stage, 'Cancelado');
  assert.throws(() => cancelCase(inRoom(), 'case-1', 'x', now), /etapa atual/);
});

test('copilot: contexto sem nome do paciente, com alertas e registro clínico', () => {
  const data = base();
  const context = copilotContext(data, stockBase().products, findCase(data, 'case-4'), now);
  const json = JSON.stringify(context);
  assert.ok(!json.includes('Luíza') && !json.includes('Costa'));
  assert.equal(context.paciente.idade, 63);
  assert.equal(context.registroDaSala.contrasteMl, 140);
  assert.equal(context.achados.length, 2);
  assert.ok(context.materiaisUsados.some(m => /Stent/.test(m)));
});

test('copilot: nome citado no laudo é trocado antes de sair do sistema', () => {
  const data = base();
  const c = findCase(data, 'case-4');
  const signed = { ...c, report: { ...c.report, text: 'Paciente Luíza Martins tolerou bem; luíza orientada.', conclusion: 'Sucesso.', signedAt: now.toISOString() } };
  const json = JSON.stringify(copilotContext(data, stockBase().products, signed, now));
  assert.ok(!/Luíza|Martins/i.test(json));
  assert.match(json, /\[paciente\] \[paciente\] tolerou bem/);
});

test('OPME: pedido exige material OPME e justificativa; autorização parcial; uso acima do autorizado vira risco de glosa', () => {
  const stock = stockBase();
  let data = base();
  assert.throws(() => saveOpme(data, stock.products, 'case-2', [{ productId: 'hem-1', requested: 1 }], 'x', now), /OPME/);
  assert.throws(() => saveOpme(data, stock.products, 'case-2', [{ productId: 'hem-5', requested: 2 }], '  ', now), /justificativa/);
  data = saveOpme(data, stock.products, 'case-2', [{ productId: 'hem-5', requested: 1 }, { productId: 'hem-5', requested: 1 }], 'Lesão grave em DA.', now);
  const item = findCase(data, 'case-2').opme.items;
  assert.deepEqual(item.map(i => [i.productId, i.requested]), [['hem-5', 2]]);
  assert.throws(() => decideAuthorization(data, 'case-2', true, 'G-1', '', now, { [item[0].id]: 3 }), /entre 0/);
  data = decideAuthorization(data, 'case-2', true, 'G-1', '', now, { [item[0].id]: 1 });
  assert.equal(findCase(data, 'case-2').opme.items[0].authorized, 1);
  assert.match(data.audit[0].detail, /parcialmente/);

  const demo = base();
  assert.deepEqual(opmeGaps(demo, stock.products, findCase(demo, 'case-4')), []);
  const c4 = findCase(demo, 'case-4');
  const over = { ...c4, materials: [...c4.materials, { ...c4.materials[2], id: 'extra', serial: 'SN-X' }] };
  const gaps = opmeGaps(demo, stock.products, over);
  assert.deepEqual(gaps.map(g => [g.product.id, g.used, g.authorized]), [['hem-5', 2, 1]]);
});

test('implante: série obrigatória, uma unidade por vez, sem repetir; rastreio por lote e série', () => {
  const stock = stockBase();
  const data = inRoom();
  assert.throws(() => consumeMaterial(data, stock, 'case-1', 'hs-6', 1, now), /número de série/);
  assert.throws(() => consumeMaterial(data, stock, 'case-1', 'hs-6', 2, now, 'SN-A'), /uma unidade/);
  assert.throws(() => consumeMaterial(data, stock, 'case-1', 'hs-6', 1, now, 'sn-fict-30001'), /já foi registrada/);
  const used = consumeMaterial(data, stock, 'case-1', 'hs-6', 1, now, 'SN-NOVO-1');
  assert.equal(pos(used.stock, 'hs-6').quantity, 2);
  assert.match(used.stock.movements[0].reason, /série SN-NOVO-1/);
  assert.equal(implantsOf(used.stock.products, findCase(used.hemo, 'case-1'))[0].used.serial, 'SN-NOVO-1');
  assert.deepEqual(traceLot(used.hemo, used.stock.products, 'sf30-2612').map(x => x.caseId).sort(), ['case-1', 'case-4']);
  assert.deepEqual(traceLot(used.hemo, used.stock.products, 'SN-FICT-35001').map(x => x.patient), ['Carlos Eduardo Souza']);
  assert.deepEqual(traceLot(used.hemo, used.stock.products, 'SF'), []);
  // Material comum continua sem série.
  assert.equal(findCase(consumeMaterial(data, stock, 'case-1', 'hs-1', 2, now).hemo, 'case-1').materials[0].serial, '');
});

test('urgência: entra sem autorização, toma a sala, time-out obrigatório, porta-balão e guia regularizada antes da conta', () => {
  const stock = stockBase();
  const at = new Date('2026-11-24T11:50:00Z'); // 08:50 em São Paulo, 10 min antes do eletivo da sala 1.
  const input = { patientId: 'hp-3', typeId: 'iam', roomId: 'sala-1', doctorId: 'doc-2', indication: 'IAM com supra inferior.', requestedBy: 'PS', doorAt: '2026-11-24T08:20' };
  assert.throws(() => startEmergency(base(), { ...input, doorAt: '2026-11-24T09:30' }, at), /futuro/);
  let data = startEmergency(base(), input, at);
  const id = data.cases[0].id;
  let c = findCase(data, id);
  assert.equal(c.stage, 'Preparo');
  assert.equal(c.authorization.status, 'Regularizar');
  assert.deepEqual(displacedBy(data, c).map(x => x.id), ['case-1']);
  assert.throws(() => startProcedure(data, id, at), /Time-out/);
  data = savePrep(data, id, c.prep, allTimeout, '', at);
  data = startProcedure(data, id, at);
  const used = consumeMaterial(data, stock, id, 'hs-6', 1, at, 'SN-URG-1');
  data = used.hemo;
  data = finishProcedure(data, id, { ...intra, start: '2026-11-24T08:55', balloonAt: '2026-11-24T09:20', end: '2026-11-24T09:50', contrastMl: 150 }, at);
  c = findCase(data, id);
  assert.equal(doorToBalloon(c), 60);
  assert.equal(c.followUp.due, '2026-12-24');
  data = finishRecovery(data, id, { hemostasis: 'Pulseira', stable: true, destination: 'UTI', notes: '' }, at);
  data = saveReport(data, id, { findings: [], text: 'Descrição.', conclusion: 'Conclusão.', copilotDraft: false }, at);
  data = signReport(data, id, 'doc-2', at);
  assert.throws(() => closeBilling(data, used.stock.products, id, at), /Regularize/);
  data = regularizeAuthorization(data, used.stock.products, id, 'GUIA-URG-1', at);
  c = findCase(data, id);
  assert.deepEqual(c.opme.items.map(i => [i.productId, i.authorized]), [['hem-5', 1]]);
  assert.deepEqual(opmeGaps(data, used.stock.products, c), []);
  data = closeBilling(data, used.stock.products, id, at);
  assert.ok(findCase(data, id).claim.sentAt);
  assert.throws(() => finishProcedure(base(), 'case-1', { ...intra, balloonAt: '2026-11-24T10:30' }, now), /etapa|abertura/);
});

test('glosas: recurso com texto, encerramento e travas', () => {
  let data = base();
  assert.throws(() => registerGlosa(data, 'case-4', 'Stent', 'Motivo', now), /etapa/);
  const g = findCase(data, 'case-5').claim.glosas[0];
  assert.throws(() => appealGlosa(data, 'case-5', g.id, 'curto', false, now), /recurso/);
  data = appealGlosa(data, 'case-5', g.id, 'A etiqueta do implante (série SN-FICT-35001) está no laudo assinado e segue anexa.', true, now);
  assert.equal(findCase(data, 'case-5').claim.glosas[0].status, 'Em recurso');
  assert.throws(() => appealGlosa(data, 'case-5', g.id, 'Outro recurso com texto suficiente aqui.', false, now), /já está/);
  data = resolveGlosa(data, 'case-5', g.id, 'Revertida', now);
  assert.equal(findCase(data, 'case-5').claim.glosas[0].status, 'Revertida');
  assert.throws(() => resolveGlosa(data, 'case-5', g.id, 'Aceita', now), /encerrada/);
  data = registerGlosa(data, 'case-5', 'Taxa de sala', 'Cobrança em duplicidade', now);
  assert.equal(findCase(data, 'case-5').claim.glosas.length, 2);
});

test('acompanhamento de 30 dias, dose, prévia TISS, orientação ao paciente e indicadores', () => {
  const stock = stockBase();
  let data = base();
  assert.deepEqual(pendingFollowUps(data, now).map(x => [x.c.id, x.days]), [['case-5', -5], ['case-4', 29]]);
  assert.throws(() => recordFollowUp(data, 'case-5', 'Evento adverso', '', now), /Descreva/);
  assert.throws(() => recordFollowUp(data, 'case-1', 'Sem eventos', '', now), /etapa/);
  data = recordFollowUp(data, 'case-5', 'Sem eventos', '', now);
  assert.deepEqual(pendingFollowUps(data, now).map(x => x.c.id), ['case-4']);

  const c4 = findCase(base(), 'case-4');
  assert.deepEqual(doseAlerts(base(), c4).alerts, []);
  assert.equal(doseAlerts(base(), { ...c4, intra: { ...c4.intra, kermaMgy: 5200 } }).alerts[0].level, 'alto');

  const tiss = tissPreview(base(), stock.products, c4);
  assert.deepEqual(tiss.header.find(([k]) => k === 'Número da guia'), ['Número da guia', 'GUIA-000301']);
  assert.match(tiss.procedure.code, /a definir/);
  assert.deepEqual(tiss.opme.map(o => [o.name.split(' ')[0], o.registry, o.authorized]), [['Fio-guia', 'a definir', 1], ['Balão', 'a definir', 1], ['Stent', 'Registro fictício 0000000005', 1]]);

  const msg = prepMessage(base(), findCase(base(), 'case-1'));
  assert.match(msg, /24\/11 às 09:00/);
  assert.match(msg, /Chegue às 08:00/);
  assert.ok(!/carteira/.test(msg));
  assert.equal(prepMessage(base(), findCase(base(), 'case-3')), '');
  assert.match(prepMessage(base(), { ...findCase(base(), 'case-3'), schedule: { roomId: 'sala-1', doctorId: 'doc-1', start: '2026-11-25T10:00' } }), /Varfarina 5 mg: não suspenda/);

  const ind = hemoIndicators(base(), stock.products, now);
  assert.equal(ind.done, 2);
  assert.equal(ind.doorToBalloon.median, 62);
  assert.equal(ind.doorToBalloon.withinTarget, 1);
  assert.equal(ind.glosas.Aberta, 1);
  assert.deepEqual([ind.followUp.overdue, ind.followUp.pending], [1, 2]);
  assert.equal(ind.radialShare, 100);
  assert.deepEqual(ind.byDoctor.map(d => [d.doctor.id, d.procedures]), [['doc-1', 1], ['doc-2', 1]]);
  assert.equal(ind.opmeWithoutAuthorization, 0);
});
