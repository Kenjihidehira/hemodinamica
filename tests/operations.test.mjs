import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHemoData, parseHemoData, findCase, cancelCase, decideAuthorization } from '../src/hemo/domain.ts';
import { periodEndingToday, roomUsage, turnovers, delays, cancellations, parseMoney, saveValues, caseCost, costByType, brl } from '../src/hemo/operations.ts';
import { can } from '../src/auth/domain.ts';
import { makeDemoData, withHemoCatalog } from '../src/data.ts';

const now = new Date('2026-11-23T13:00:00Z'); // 10h em São Paulo; o caso 4 foi ontem, o 5 há 35 dias.
const base = () => makeHemoData(now);
const catalog = withHemoCatalog(makeDemoData()).products;
const week = periodEndingToday(7, now), quarter = periodEndingToday(90, now);

test('dados salvos antes da gestão continuam válidos (tabela vazia, sem motivo de cancelamento)', () => {
  const old = JSON.parse(JSON.stringify(base()));
  delete old.values;
  for (const c of old.cases) { delete c.cancelCategory; delete c.cancelledAt; }
  const parsed = parseHemoData(old);
  assert.deepEqual(parsed.values.materials, {});
  assert.equal(findCase(parsed, 'case-1').cancelCategory, '');
});

test('período termina hoje no fuso do hospital', () => {
  assert.deepEqual(week, { from: '2026-11-17', to: '2026-11-23', days: 7 });
});

test('uso das salas: só a janela de 7h às 19h entra no percentual; a urgência da madrugada fica à parte', () => {
  const [sala1, sala2] = roomUsage(base(), week);
  assert.equal(sala1.procedures, 0);
  // Caso 4: entrada 13:55, fim 15:10 → 75 min em 7 dias × 12 h.
  assert.deepEqual({ p: sala2.procedures, inside: sala2.insideMin, available: sala2.availableMin, pct: sala2.utilization }, { p: 1, inside: 75, available: 5040, pct: 1.5 });
  const night = roomUsage(base(), quarter)[0];
  assert.deepEqual({ p: night.procedures, inside: night.insideMin, outside: night.outsideMin }, { p: 1, inside: 0, outside: 66 });
});

test('atraso dos eletivos e intervalo entre casos na mesma sala', () => {
  const data = base();
  assert.deepEqual(delays(data, week).items.map(x => x.minutes), [-5]);
  assert.equal(delays(data, week).onTime, 1);
  assert.equal(turnovers(data, week).items.length, 0);
  // Segundo caso na sala 2 no mesmo dia, entrando 30 min depois do fim do caso 4 (preparo previsto da angioplastia: 20 min).
  const c4 = findCase(data, 'case-4'), day = c4.intra.end.slice(0, 10);
  const next = { ...c4, id: 'case-x', schedule: { ...c4.schedule, start: `${day}T15:30` }, intra: { ...c4.intra, roomIn: `${day}T15:40`, start: `${day}T15:45`, end: `${day}T16:30` } };
  const t = turnovers({ ...data, cases: [...data.cases, next] }, week);
  assert.deepEqual(t.items.map(x => [x.minutes, x.plannedMin]), [[30, 20]]);
  assert.equal(t.overPlanned, 1);
  assert.equal(delays({ ...data, cases: [...data.cases, next] }, week).items.find(x => x.c.id === 'case-x').minutes, 10);
});

test('cancelamento exige motivo da lista e entra nos indicadores do período', () => {
  assert.throws(() => cancelCase(base(), 'case-1', 'x', now, 'Qualquer'), /motivo/);
  const data = cancelCase(base(), 'case-1', 'Não veio e não atendeu o telefone', now, 'Paciente não compareceu');
  const c = findCase(data, 'case-1');
  assert.equal(c.cancelCategory, 'Paciente não compareceu');
  assert.equal(c.cancelledAt, now.toISOString());
  assert.match(data.audit[0].detail, /^Paciente não compareceu · Não veio/);
  // Chamada antiga, sem categoria, vira "Outro".
  assert.equal(findCase(cancelCase(base(), 'case-1', 'Paciente desistiu', now), 'case-1').cancelCategory, 'Outro');
  const denied = decideAuthorization(data, 'case-2', false, '', 'Sem cobertura contratual', now);
  const ind = cancellations(denied, week);
  assert.deepEqual(ind.byCategory.map(x => [x.category, x.cases.length]), [['Paciente não compareceu', 1], ['Autorização negada', 1]]);
  assert.equal(ind.done, 1);
  assert.equal(ind.rate, 66.7);
});

test('valores digitados em reais', () => {
  assert.equal(parseMoney('1.234,56'), 123456);
  assert.equal(parseMoney('R$ 80'), 8000);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('18.500'), 1850000);
  assert.equal(parseMoney('1.250.000'), 125000000);
  assert.equal(parseMoney('  '), null);
  assert.throws(() => parseMoney('abc'), /Valor inválido/);
  assert.throws(() => parseMoney('1,234'), /Valor inválido/);
  assert.equal(brl(123456).replace(/\s/g, ' '), 'R$ 1.234,56');
});

test('custo e margem só com a tabela completa; nada é presumido', () => {
  const data = base(), c = findCase(data, 'case-4');
  const empty = caseCost(data, catalog, c);
  assert.equal(empty.materialsCents, null); assert.equal(empty.marginCents, null); assert.equal(empty.valueCents, null);
  assert.equal(empty.missing.length, 3);
  const partial = saveValues(data, { materials: { 'hem-3': 45000 }, procedures: { atc: 1500000 } }, 'Ana Admin', now);
  assert.deepEqual(caseCost(partial, catalog, findCase(partial, 'case-4')).missing, ['Balão de pré-dilatação 2,5 × 15 mm', 'Stent farmacológico 3,0 × 18 mm']);
  const full = saveValues(data, { materials: { 'hem-3': 45000, 'hem-4': 90000, 'hem-5': 600000, 'hem-1': null }, procedures: { atc: 1500000 } }, 'Ana Admin', now);
  assert.deepEqual(Object.keys(full.values.materials).sort(), ['hem-3', 'hem-4', 'hem-5']);
  assert.equal(full.values.updatedBy, 'Ana Admin');
  assert.equal(full.audit[0].action, 'Tabela de valores atualizada');
  const cost = caseCost(full, catalog, findCase(full, 'case-4'));
  assert.deepEqual([cost.materialsCents, cost.valueCents, cost.marginCents], [735000, 1500000, 765000]);
  const byType = costByType(full, catalog, week);
  assert.deepEqual(byType.map(x => [x.type.id, x.cases, x.avgMaterialsCents, x.avgMarginCents]), [['atc', 1, 735000, 765000]]);
  assert.throws(() => saveValues(data, { materials: { 'hem-3': -1 }, procedures: {} }, '', now), /entre R\$ 0,00/);
  assert.throws(() => saveValues(data, { materials: {}, procedures: { nao: 100 } }, '', now), /inexistente/);
});

test('só administrador altera a tabela de valores', () => {
  assert.equal(can({ role: 'admin', active: true }, 'valores.editar'), true);
  assert.equal(can({ role: 'medico', active: true }, 'valores.editar'), false);
  assert.equal(can({ role: 'equipe', active: true }, 'valores.editar'), false);
});
