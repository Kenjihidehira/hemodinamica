import { type DemoData, type Product } from '../data.ts';
import {
  addMinutes, allGlosas, doorToBalloon, DOOR_TO_BALLOON_TARGET_MIN, glosaStatuses, hemoMaterials, localStamp, productOf, type HemoCase, type HemoData,
} from './domain.ts';
import { cancellations, costByType, roomUsage } from './operations.ts';

/**
 * Gestão: relatório mensal, qualidade por hemodinamicista e previsão de compra de materiais.
 * Tudo vem do que foi registrado nos casos; médias com poucos casos vêm marcadas.
 */

const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2); };
const avg = (values: number[]) => values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
const pct = (part: number, total: number) => total ? Math.round(1000 * part / total) / 10 : null;
const done = (data: HemoData) => data.cases.filter(c => c.stage !== 'Cancelado' && c.intra.end);
const hadComplication = (c: HemoCase) => !!(c.intra.events.length || c.intra.complications);

// ---------- Relatório mensal ----------
/** Mês no formato AAAA-MM → período fechado (primeiro ao último dia). */
export function monthPeriod(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Escolha o mês.');
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, days };
}
export const currentMonth = (now = new Date()) => localStamp(now).slice(0, 7);

export function monthlyReport(data: HemoData, catalog: Product[], month: string) {
  const period = monthPeriod(month);
  const inMonth = done(data).filter(c => c.intra.end.slice(0, 10) >= period.from && c.intra.end.slice(0, 10) <= period.to);
  const urgent = inMonth.filter(c => c.priority === 'Urgência');
  const dtb = urgent.map(doorToBalloon).filter((m): m is number => m !== null);
  const glosas = allGlosas(data).filter(x => x.c.claim.sentAt && localStamp(new Date(x.c.claim.sentAt)).slice(0, 7) === month).map(x => x.g);
  const costs = costByType(data, catalog, period);
  const eventCounts = new Map<string, number>();
  for (const c of inMonth) for (const e of c.intra.events) eventCounts.set(e, (eventCounts.get(e) ?? 0) + 1);
  return {
    month, period,
    volume: { total: inMonth.length, urgent: urgent.length, elective: inMonth.length - urgent.length, byType: data.types.map(t => ({ type: t, cases: inMonth.filter(c => c.typeId === t.id).length })).filter(x => x.cases) },
    rooms: roomUsage(data, period),
    doorToBalloon: { cases: dtb.length, median: median(dtb), withinTarget: dtb.filter(m => m <= DOOR_TO_BALLOON_TARGET_MIN).length },
    complications: { cases: inMonth.filter(hadComplication).length, rate: pct(inMonth.filter(hadComplication).length, inMonth.length), byEvent: [...eventCounts].map(([event, cases]) => ({ event, cases })).sort((a, b) => b.cases - a.cases) },
    radialShare: pct(inMonth.filter(c => c.intra.access.startsWith('Radial')).length, inMonth.length),
    avgContrastMl: avg(inMonth.map(c => c.intra.contrastMl)),
    glosas: Object.fromEntries(glosaStatuses.map(s => [s, glosas.filter(g => g.status === s).length])) as Record<typeof glosaStatuses[number], number>,
    cancellations: cancellations(data, period),
    costs,
    costComplete: costs.every(x => x.incomplete === 0 && x.valueCents !== null),
  };
}

// ---------- Qualidade por hemodinamicista ----------
/** Abaixo disso, a taxa do médico aparece marcada: poucos casos variam muito por acaso. */
export const QUALITY_MIN_CASES = 10;
function qualityOf(cases: HemoCase[]) {
  const dtb = cases.map(doorToBalloon).filter((m): m is number => m !== null);
  return {
    cases: cases.length,
    complicationRate: pct(cases.filter(hadComplication).length, cases.length),
    radialShare: pct(cases.filter(c => c.intra.access.startsWith('Radial')).length, cases.length),
    avgContrastMl: avg(cases.map(c => c.intra.contrastMl)),
    avgFluoroMin: cases.length ? Math.round(10 * cases.reduce((s, c) => s + c.intra.fluoroMin, 0) / cases.length) / 10 : null,
    avgKermaMgy: avg(cases.map(c => c.intra.kermaMgy)),
    dtbMedian: median(dtb), dtbCases: dtb.length,
  };
}
/** Indicadores por médico ao lado da média do serviço. A visão é restrita por permissão (quem chama confere). */
export function doctorQuality(data: HemoData) {
  const all = done(data);
  return {
    service: qualityOf(all),
    doctors: data.doctors.map(d => ({ doctor: d, ...qualityOf(all.filter(c => c.schedule?.doctorId === d.id)) })).filter(x => x.cases > 0),
  };
}

// ---------- Previsão de compra ----------
export const FORECAST_DAYS = 14;
/**
 * Necessidade de material nos próximos dias: para cada caso agendado no período, o OPME pedido na autorização
 * (quando houver) e, para o resto, a média de uso por caso do mesmo tipo de procedimento no histórico.
 * Sugestão de compra = necessidade + mínimo − disponível (só se positiva). É estimativa: confirme com a agenda.
 */
export function stockForecast(data: HemoData, stock: DemoData, days = FORECAST_DAYS, now = new Date()) {
  const from = localStamp(now), to = addMinutes(`${from.slice(0, 10)}T00:00`, days * 24 * 60);
  const upcoming = data.cases.filter(c => c.schedule && c.schedule.start >= from && c.schedule.start < to && ['Agendamento', 'Preparo'].includes(c.stage));
  const history = done(data);
  /** Média de uso por caso, por tipo e produto. */
  const usePerCase = (typeId: string) => {
    const mine = history.filter(c => c.typeId === typeId), totals = new Map<string, number>();
    for (const c of mine) for (const m of c.materials) totals.set(m.productId, (totals.get(m.productId) ?? 0) + m.quantity);
    return { cases: mine.length, perCase: new Map([...totals].map(([id, q]) => [id, q / mine.length])) };
  };
  const need = new Map<string, number>();
  const add = (id: string, q: number) => need.set(id, (need.get(id) ?? 0) + q);
  const typesWithoutHistory = new Set<string>();
  for (const c of upcoming) {
    const opme = new Set(c.opme.items.map(i => i.productId));
    for (const i of c.opme.items) add(i.productId, i.requested);
    const h = usePerCase(c.typeId);
    if (!h.cases) typesWithoutHistory.add(c.typeId);
    for (const [id, q] of h.perCase) if (!opme.has(id)) add(id, q);
  }
  const rows = hemoMaterials(stock).map(({ product, available }) => {
    const expected = Math.ceil(need.get(product.id) ?? 0);
    return { product, expected, available, minimum: product.minimum, suggest: Math.max(0, expected + product.minimum - available) };
  }).filter(r => r.expected > 0 || r.suggest > 0).sort((a, b) => b.suggest - a.suggest || b.expected - a.expected);
  return { days, upcoming: upcoming.length, rows, typesWithoutHistory: [...typesWithoutHistory].map(id => data.types.find(t => t.id === id)?.name ?? id), unscheduled: data.cases.filter(c => ['Autorização', 'Agendamento'].includes(c.stage) && !c.schedule).length };
}
export function forecastText(forecast: ReturnType<typeof stockForecast>, catalog: Product[]) {
  return [`Sugestão de compra · Hemodinâmica · próximos ${forecast.days} dias`, ...forecast.rows.filter(r => r.suggest > 0).map(r => `• ${r.suggest} × ${productOf(catalog, r.product.id).name}${r.product.code ? ` (${r.product.code})` : ''} · previsto ${r.expected}, disponível ${r.available}, mínimo ${r.minimum}`)].join('\n');
}
