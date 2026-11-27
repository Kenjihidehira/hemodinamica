import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHemoData } from '../src/hemo/domain.ts';
import { makeDemoData, withHemoCatalog } from '../src/data.ts';
import { doctorQuality, forecastText, monthPeriod, monthlyReport, stockForecast } from '../src/hemo/insights.ts';

const now = new Date('2026-11-23T13:00:00Z');
const base = () => makeHemoData(now);
const stockBase = () => withHemoCatalog(makeDemoData());

test('mês: período fechado, inclusive fevereiro bissexto; mês inválido recusado', () => {
  assert.deepEqual(monthPeriod('2026-11'), { from: '2026-11-01', to: '2026-11-30', days: 30 });
  assert.equal(monthPeriod('2028-02').days, 29);
  assert.throws(() => monthPeriod('2026-13'), /mês/);
});

test('relatório mensal: só o que terminou no mês', () => {
  const data = base(), stock = stockBase();
  const nov = monthlyReport(data, stock.products, '2026-11');
  assert.equal(nov.volume.total, 1); // caso 4 (angioplastia, ontem)
  assert.equal(nov.volume.byType[0].type.id, 'atc');
  assert.equal(nov.radialShare, 100);
  assert.equal(nov.rooms.length, 2);
  assert.equal(nov.costComplete, false); // tabela de valores vazia: nada é estimado
  const oct = monthlyReport(data, stock.products, '2026-10');
  assert.equal(oct.volume.urgent, 1); // urgência de 35 dias atrás
  assert.ok(oct.doorToBalloon.cases >= 1);
});

test('qualidade: por médico ao lado da média do serviço', () => {
  const q = doctorQuality(base());
  assert.equal(q.service.cases, q.doctors.reduce((s, d) => s + d.cases, 0));
  assert.ok(q.doctors.every(d => d.cases > 0));
  assert.equal(q.doctors.find(d => d.doctor.id === 'doc-2').avgContrastMl !== null, true);
});

test('previsão: OPME pedido + histórico do mesmo procedimento; sugestão = previsto + mínimo − disponível', () => {
  const stock = stockBase();
  const data = base();
  data.cases = data.cases.map(c => c.id === 'case-2' ? { ...c, stage: 'Preparo', schedule: { roomId: 'sala-1', doctorId: 'doc-1', start: '2026-11-25T09:00' } } : c);
  const f = stockForecast(data, stock, 14, now);
  assert.equal(f.upcoming, 2); // caso 1 (amanhã) e caso 2
  const stent = f.rows.find(r => r.product.id === 'hem-5');
  assert.equal(stent.expected, 1);
  assert.equal(stent.suggest, Math.max(0, 1 + stent.minimum - stent.available));
  assert.ok(f.typesWithoutHistory.includes('Cateterismo cardíaco diagnóstico'));
  assert.equal(stockForecast(data, stock, 1, now).upcoming, 0); // 1 dia = só hoje
  assert.equal(stockForecast(data, stock, 2, now).upcoming, 1);
  assert.match(forecastText(f, stock.products), /Sugestão de compra/);
});
