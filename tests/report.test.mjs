import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHemoData, parseHemoData, findCase, savePrep, startProcedure, finishProcedure, saveReport, intraProblem, hemoIndicators, copilotContext, typeOf } from '../src/hemo/domain.ts';
import { emptyFinding, normalizeFinding, findingProblem, describeFinding, stentSizeFromName, structuredReportText, reportIndicators, pressureText, complicationText } from '../src/hemo/report.ts';
import { makeDemoData, withHemoCatalog } from '../src/data.ts';

const now = new Date('2026-11-23T13:00:00Z');
const base = () => makeHemoData(now);
const catalog = withHemoCatalog(makeDemoData()).products;
const allPrep = { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: true, venousAccess: true };
const allTimeout = { identity: true, procedure: true, materials: true, team: true };
const intra = { roomIn: '', start: '2026-11-24T09:05', balloonAt: '', end: '2026-11-24T09:45', access: 'Radial direita', contrastMl: 80, fluoroMin: 6, kermaMgy: 420, complications: '', events: [], pressures: { aoSystolic: null, aoDiastolic: null, lvedp: null } };
const inRoom = () => startProcedure(savePrep(base(), 'case-1', allPrep, allTimeout, '', now), 'case-1', now);
const finding = patch => ({ ...emptyFinding('x'), segment: 'Descendente anterior média', vessel: 'Descendente anterior média', stenosis: 80, ...patch });
const noMaterials = { materials: [] };

test('laudos e salas salvos antes do laudo estruturado continuam válidos', () => {
  const old = JSON.parse(JSON.stringify(base()));
  for (const c of old.cases) {
    c.findings = c.findings.map(({ id, vessel, stenosis, treatment }) => ({ id, vessel, stenosis, treatment }));
    delete c.intra.events; delete c.intra.pressures;
  }
  const c = findCase(parseHemoData(old), 'case-4');
  assert.equal(c.findings[0].segment, '');
  assert.equal(c.findings[0].therapy, '');
  assert.deepEqual(c.intra.events, []);
  assert.equal(c.intra.pressures.lvedp, null);
  // Achado antigo (só vaso e estenose) é descrito sem inventar campos.
  assert.equal(describeFinding(c.findings[1], catalog, c), 'Coronária direita média: estenose de 30%.');
  assert.equal(describeFinding(c.findings[0], catalog, c), 'Descendente anterior proximal: estenose de 85%. Pré-dilatação com balão 2,5 × 15 mm.');
});

test('normalização: o vaso segue o segmento e campos de outra conduta são limpos', () => {
  const f = normalizeFinding(finding({ vessel: 'texto antigo', therapy: 'Tratamento clínico', stent: { materialId: 'use-3', diameterMm: 3, lengthMm: 18 }, residual: 0, timiPost: '3', physiology: { kind: '', value: 0.8 } }));
  assert.equal(f.vessel, 'Descendente anterior média');
  assert.deepEqual(f.stent, { materialId: '', diameterMm: 0, lengthMm: 0 });
  assert.equal(f.residual, null); assert.equal(f.timiPost, '');
  assert.deepEqual(f.physiology, { kind: '', value: null });
});

test('coerência de cada achado', () => {
  const problem = patch => findingProblem(normalizeFinding(finding(patch)), noMaterials);
  assert.equal(problem({}), '');
  assert.match(problem({ segment: '', vessel: '' }), /segmento/);
  assert.match(problem({ stenosis: 100, timiPre: '3' }), /Oclusão total/);
  assert.equal(problem({ stenosis: 100, timiPre: '0' }), '');
  assert.match(problem({ physiology: { kind: 'FFR', value: null } }), /FFR entre 0,30 e 1,00/);
  assert.match(problem({ physiology: { kind: 'iFR', value: 1.4 } }), /iFR/);
  assert.equal(problem({ physiology: { kind: 'FFR', value: 0.78 } }), '');
  assert.match(problem({ therapy: 'Angioplastia com stent', stent: { materialId: '', diameterMm: 0, lengthMm: 18 }, timiPost: '3' }), /Diâmetro/);
  assert.match(problem({ therapy: 'Angioplastia com stent', stent: { materialId: '', diameterMm: 3, lengthMm: 2 }, timiPost: '3' }), /Comprimento/);
  assert.match(problem({ therapy: 'Angioplastia com stent', stent: { materialId: 'nao-existe', diameterMm: 3, lengthMm: 18 }, timiPost: '3' }), /implante escolhido/);
  assert.match(problem({ therapy: 'Angioplastia com balão' }), /TIMI final/);
  assert.match(problem({ therapy: 'Angioplastia com balão', timiPost: '3', residual: 90 }), /residual não pode ser maior/);
  assert.equal(problem({ therapy: 'Angioplastia com balão', timiPost: '3', residual: 30 }), '');
});

test('salvar o laudo recusa achado incoerente e aceita o estruturado', () => {
  const data = base();
  const bad = [finding({ id: 'n1', therapy: 'Angioplastia com balão' })];
  assert.throws(() => saveReport(data, 'case-4', { findings: bad, text: 'x', conclusion: 'y', copilotDraft: false }, now), /Achado 1 \(Descendente anterior média\): Informe o fluxo TIMI final/);
  const c = findCase(data, 'case-4');
  const saved = findCase(saveReport(data, 'case-4', { findings: c.findings, text: 'x', conclusion: 'y', copilotDraft: false }, now), 'case-4');
  assert.equal(saved.findings[0].stent.materialId, 'use-3');
});

test('descrição do achado traz stent, série e resultado final', () => {
  const c = findCase(base(), 'case-4');
  assert.equal(describeFinding(c.findings[0], catalog, c), 'Descendente anterior proximal: estenose de 85%, fluxo TIMI 3, calcificação moderada. Angioplastia com stent 3 × 18 mm (Stent farmacológico 3,0 × 18 mm, série SN-FICT-30001). Estenose residual de 0%, fluxo final TIMI 3. Pré-dilatação com balão 2,5 × 15 mm.');
  const occlusion = findCase(base(), 'case-5');
  assert.match(describeFinding(occlusion.findings[0], catalog, occlusion), /^Coronária direita proximal: oclusão total, fluxo TIMI 0, com trombo\. Angioplastia com stent 3,5 × 23 mm/);
  assert.match(describeFinding(finding({ physiology: { kind: 'FFR', value: 0.82 }, therapy: 'Tratamento clínico' }), catalog, noMaterials), /FFR 0,82\. Tratamento clínico\.$/);
});

test('medidas do stent lidas do nome do produto', () => {
  assert.deepEqual(stentSizeFromName('Stent farmacológico 3,0 × 18 mm'), { diameterMm: 3, lengthMm: 18 });
  assert.deepEqual(stentSizeFromName('Stent 2.75x12mm'), { diameterMm: 2.75, lengthMm: 12 });
  assert.equal(stentSizeFromName('Fio-guia coronário 0,014"'), null);
});

test('sala: intercorrências da lista, "Outra" com descrição e pressões plausíveis', () => {
  const data = inRoom(), c = findCase(data, 'case-1');
  assert.match(intraProblem(data, c, { ...intra, events: ['Outra'] }), /Descreva a intercorrência/);
  assert.equal(intraProblem(data, c, { ...intra, events: ['Outra'], complications: 'Vasoespasmo radial' }), '');
  assert.match(intraProblem(data, c, { ...intra, pressures: { aoSystolic: 120, aoDiastolic: 130, lvedp: null } }), /diastólica da aorta deve ser menor/);
  assert.match(intraProblem(data, c, { ...intra, pressures: { aoSystolic: null, aoDiastolic: null, lvedp: 80 } }), /PD2VE|diastólica final do VE/);
  const done = finishProcedure(data, 'case-1', { ...intra, events: ['Dissecção coronária', 'Dissecção coronária'], complications: ' tratada com stent ' }, now);
  const after = findCase(done, 'case-1');
  assert.deepEqual(after.intra.events, ['Dissecção coronária']);
  assert.equal(complicationText(after.intra), 'Dissecção coronária; tratada com stent');
  assert.match(done.audit[0].detail, /intercorrências: Dissecção coronária/);
  assert.equal(hemoIndicators(done, catalog, now).complications, 1);
});

test('texto do laudo montado só com o que foi registrado', () => {
  const data = base(), c = findCase(data, 'case-4');
  const text = structuredReportText(c, c.findings, catalog, typeOf(data, c).name);
  assert.match(text, /^Angioplastia coronária com stent por via radial direita\./);
  assert.match(text, /Hemodinâmica: pressão aórtica 132\/74 mmHg, pressão diastólica final do VE 14 mmHg\./);
  assert.match(text, /- Coronária direita média: estenose de 30%, fluxo TIMI 3, calcificação leve\. Tratamento clínico\./);
  assert.match(text, /Contraste 140 mL, fluoroscopia 14 min, kerma no ar 980 mGy\./);
  assert.match(text, /Sem intercorrências registradas\.$/);
  assert.equal(pressureText({ aoSystolic: null, aoDiastolic: null, lvedp: null }), '');
});

test('indicadores do laudo estruturado', () => {
  const ind = reportIndicators(base());
  assert.equal(ind.cases, 2);
  assert.deepEqual(ind.lesions, { coded: 3, legacy: 0 });
  assert.deepEqual(ind.angioplasty, { lesions: 2, stents: 2, optimal: 2, missingResult: 0 });
  assert.deepEqual(ind.intermediate, { total: 0, withPhysiology: 0 });
  assert.deepEqual(ind.byArtery.find(a => a.artery === 'Descendente anterior'), { artery: 'Descendente anterior', significant: 1, treated: 1 });
  assert.deepEqual(ind.byArtery.find(a => a.artery === 'Coronária direita'), { artery: 'Coronária direita', significant: 1, treated: 1 });
  assert.deepEqual(ind.complicationsByType, []);
  // Lesão intermediária com FFR entra no indicador de avaliação funcional.
  const data = base();
  data.cases = data.cases.map(c => c.id === 'case-4' ? { ...c, findings: [...c.findings, finding({ id: 'f-9', stenosis: 55, physiology: { kind: 'FFR', value: 0.86 }, therapy: 'Tratamento clínico' })] } : c);
  assert.deepEqual(reportIndicators(data).intermediate, { total: 1, withPhysiology: 1 });
});

test('copilot recebe os achados estruturados, sem o nome do paciente', () => {
  const data = base(), c = findCase(data, 'case-4');
  const ctx = copilotContext(data, catalog, c, now);
  assert.equal(ctx.achados[0].timiFinal, '3');
  assert.equal(ctx.achados[0].stentMm, '3 × 18');
  assert.match(ctx.achados[0].resumo, /série SN-FICT-30001/);
  assert.match(ctx.registroDaSala.pressoes, /132\/74/);
  assert.doesNotMatch(JSON.stringify(ctx), /Luíza|Martins/);
});
