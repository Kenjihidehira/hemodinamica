import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHemoData, findCase, savePrep, startProcedure, prepMissing, finishProcedure, parseHemoData } from '../src/hemo/domain.ts';
import { makeDemoData, withHemoCatalog } from '../src/data.ts';
import { checkMaterialScan, code39Bars, confirmIdentity, contrastGauge, reconcileHint, reconciliationDraft, reconciliationProblem, reconciliationText, saveReconciliation, wristbandCode } from '../src/hemo/safety.ts';
import { dischargeDraft } from '../src/hemo/clinical.ts';

const now = new Date('2026-11-23T13:00:00Z'); // 10h em São Paulo.
const base = () => makeHemoData(now);
const stockBase = () => withHemoCatalog(makeDemoData());
const allPrep = { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: true, venousAccess: true };
const allTimeout = { identity: true, procedure: true, materials: true, team: true };

test('pulseira: código por paciente e entrada em sala só depois da identificação', () => {
  const data = savePrep(base(), 'case-1', allPrep, allTimeout, '', now);
  assert.equal(wristbandCode({ id: 'hp-2' }), 'PAC-HP-2');
  assert.ok(prepMissing(findCase(data, 'case-1')).some(m => /pulseira/.test(m)));
  assert.throws(() => startProcedure(data, 'case-1', now), /pulseira/);
  const ok = confirmIdentity(data, 'case-1', { code: ' pac-hp-2 ' }, now);
  const c = findCase(ok, 'case-1');
  assert.equal(c.identity.method, 'Pulseira lida');
  assert.equal(c.timeout.identity, true);
  assert.equal(findCase(startProcedure(ok, 'case-1', now), 'case-1').stage, 'Sala');
  assert.equal(ok.audit[0].action, 'Paciente identificado');
});

test('pulseira: de outro paciente para tudo; código estranho e manual sem motivo são recusados', () => {
  const data = savePrep(base(), 'case-1', allPrep, allTimeout, '', now);
  assert.throws(() => confirmIdentity(data, 'case-1', { code: 'PAC-HP-3' }, now), /PARE: esta pulseira é de outro paciente \(José Roberto Alves\)/);
  assert.throws(() => confirmIdentity(data, 'case-1', { code: 'XYZ-1' }, now), /não reconhecido/);
  assert.throws(() => confirmIdentity(data, 'case-1', { manualReason: 'rasgada' }, now), /explique/);
  const manual = confirmIdentity(data, 'case-1', { manualReason: 'Pulseira rasgada; nome e nascimento conferidos com a paciente.' }, now);
  assert.equal(findCase(manual, 'case-1').identity.method, 'Conferência manual');
  assert.match(manual.audit[0].action, /sem leitura/);
  assert.throws(() => confirmIdentity(base(), 'case-4', { code: 'PAC-HP-4' }, now), /etapa atual/);
});

test('pulseira: Code 39 tem início/fim e recusa caractere sem código', () => {
  const { bars, width } = code39Bars('PAC-HP-2');
  assert.equal(bars.length, 10 * 5); // 8 caracteres + 2 asteriscos, 5 barras cada.
  assert.ok(width > 100);
  assert.throws(() => code39Bars('pac'), /Caractere/);
});

test('material bipado: lote bom, vencido, bloqueado, desconhecido e OPME além do autorizado', () => {
  const data = base(), stock = stockBase();
  const good = checkMaterialScan(data, stock, 'case-1', 'NAO-EXISTE-999');
  const lot = stock.stock.find(s => s.productId === 'hem-1');
  const byLot = checkMaterialScan(data, stock, 'case-1', lot.lot);
  assert.equal(byLot.ok, true); assert.equal(byLot.position.id, lot.id);
  const byCode = checkMaterialScan(data, stock, 'case-1', 'hem-ir6-001');
  assert.equal(byCode.product.id, 'hem-1');
  assert.equal(good.ok, false);
  assert.match(good.issues[0].text, /não encontrado/);
  const expired = { ...stock, stock: stock.stock.map(s => s.id === lot.id ? { ...s, expiresAt: '2020-01-01' } : s) };
  const exp = checkMaterialScan(data, expired, 'case-1', lot.lot);
  assert.equal(exp.ok, false); assert.match(exp.issues.map(i => i.text).join(' '), /vencido/);
  const blocked = { ...stock, stock: stock.stock.map(s => s.id === lot.id ? { ...s, blocked: s.quantity } : s) };
  assert.match(checkMaterialScan(data, blocked, 'case-1', lot.lot).issues.map(i => i.text).join(' '), /bloqueado/);
  // Caso 4: convênio autorizou 1 stent e 1 já foi usado.
  const stent = checkMaterialScan(data, stock, 'case-4', stock.stock.find(s => s.productId === 'hem-5').lot);
  assert.equal(stent.ok, true);
  assert.match(stent.issues.map(i => i.text).join(' '), /já foi usado/);
  assert.match(stent.issues.map(i => i.text).join(' '), /número de série/);
});

test('contraste: faixa ok, perto (80%) e acima do limite pela função renal', () => {
  const data = base(), c = findCase(data, 'case-2'); // creatinina 1,6 → limite 174 mL
  assert.equal(contrastGauge(data, c, 100).level, 'ok');
  assert.equal(contrastGauge(data, c, 150).level, 'perto');
  const over = contrastGauge(data, c, 200);
  assert.equal(over.level, 'acima'); assert.equal(over.left, over.limit - 200);
  const noCreat = parseHemoData({ ...data, patients: data.patients.map(p => p.id === 'hp-1' ? { ...p, creatinine: null } : p) });
  assert.equal(contrastGauge(noCreat, findCase(noCreat, 'case-2'), 50).level, 'sem limite');
});

test('reconciliação: parte dos remédios do paciente, exige decisão e vai para a orientação de alta', () => {
  const stock = stockBase();
  let data = savePrep(base(), 'case-1', allPrep, allTimeout, '', now);
  data = startProcedure(confirmIdentity(data, 'case-1', { code: 'PAC-HP-2' }, now), 'case-1', now);
  data = finishProcedure(data, 'case-1', { roomIn: '', start: '2026-11-23T10:05', end: '2026-11-23T10:40', access: 'Radial direita', contrastMl: 80, fluoroMin: 6, kermaMgy: 400, complications: '' }, now);
  const c = findCase(data, 'case-1');
  const draft = reconciliationDraft(data, c);
  assert.deepEqual(draft.map(i => i.drug), ['AAS 100 mg', 'Atorvastatina 40 mg']);
  assert.match(reconciliationProblem(draft), /Decida/);
  assert.match(reconcileHint('Metformina 850 mg', c, stock.products), /contraste/);
  const items = [{ ...draft[0], decision: 'Manter' }, { ...draft[1], decision: 'Suspender' }];
  assert.throws(() => saveReconciliation(data, 'case-1', items, now), /quando retomar/);
  data = saveReconciliation(data, 'case-1', [items[0], { ...items[1], resumeOn: '2026-11-26' }], now);
  const done = findCase(data, 'case-1');
  assert.ok(done.reconciliation.doneAt);
  assert.match(reconciliationText(done), /Atorvastatina 40 mg: NÃO tomar até 26\/11\/2026/);
  assert.match(dischargeDraft(data, stock.products, done), /SEUS REMÉDIOS/);
  assert.throws(() => saveReconciliation(base(), 'case-1', items, now), /etapa atual/);
});
