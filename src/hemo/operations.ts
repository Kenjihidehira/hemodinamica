import { type Product } from '../data.ts';
import { cancelCategories, localStamp, minutesOf, newId, productOf, typeOf, type CancelCategory, type HemoCase, type HemoData } from './domain.ts';

/**
 * Gestão da hemodinâmica: uso das salas, intervalo entre procedimentos, atrasos, cancelamentos
 * e custo de materiais por procedimento. Tudo sai do que foi registrado nos casos;
 * os valores financeiros vêm da tabela que o serviço preenche (nada é presumido).
 */

/** Janela de funcionamento eletivo das salas, a mesma usada para oferecer horários na agenda. */
export const ROOM_WINDOW = { from: '07:00', to: '19:00' } as const;
/** Tolerância para considerar que um eletivo entrou em sala no horário. Referência do serviço. */
export const LATE_TOLERANCE_MIN = 15;

const dayOf = (stampValue: string) => stampValue.slice(0, 10);
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2); };
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Período fechado que termina hoje (fuso do hospital). */
export function periodEndingToday(days: number, now = new Date()) {
  const to = localStamp(now).slice(0, 10);
  return { from: addDays(to, -(days - 1)), to, days };
}
type Period = { from: string; to: string; days: number };
const inPeriod = (day: string, p: Period) => day >= p.from && day <= p.to;

/** Procedimentos que passaram pela sala (com entrada e fim registrados). */
const roomCases = (data: HemoData) => data.cases.filter(c => c.stage !== 'Cancelado' && c.schedule && (c.intra.roomIn || c.intra.start) && c.intra.end);
const roomInOf = (c: HemoCase) => c.intra.roomIn || c.intra.start;

/** Minutos de [start, end] dentro da janela de funcionamento do dia (para procedimentos que cruzam a meia-noite, conta dia a dia). */
function minutesInsideWindow(start: string, end: string) {
  let inside = 0;
  for (let day = dayOf(start); day <= dayOf(end); day = addDays(day, 1)) {
    const a = Math.max(minutesOf(start), minutesOf(`${day}T${ROOM_WINDOW.from}`)), b = Math.min(minutesOf(end), minutesOf(`${day}T${ROOM_WINDOW.to}`));
    if (b > a) inside += b - a;
  }
  return inside;
}

/**
 * Uso de cada sala no período: tempo de sala registrado (entrada → fim) dividido pelas horas da janela
 * em que a sala estava liberada (bloqueios de manutenção saem do disponível e aparecem como tempo parado).
 * O que acontece fora da janela (urgências à noite) aparece à parte e não entra no percentual.
 */
export function roomUsage(data: HemoData, period: Period) {
  const windowMin = minutesOf(`2000-01-01T${ROOM_WINDOW.to}`) - minutesOf(`2000-01-01T${ROOM_WINDOW.from}`);
  return data.rooms.map(room => {
    const mine = roomCases(data).filter(c => c.schedule!.roomId === room.id && inPeriod(dayOf(roomInOf(c)), period));
    const total = mine.reduce((s, c) => s + Math.max(0, minutesOf(c.intra.end) - minutesOf(roomInOf(c))), 0);
    const inside = mine.reduce((s, c) => s + minutesInsideWindow(roomInOf(c), c.intra.end), 0);
    // Bloqueios (manutenção etc.): tempo parado dentro da janela, recortado ao período. Sai do tempo disponível.
    const periodStart = `${period.from}T00:00`, periodEnd = `${addDays(period.to, 1)}T00:00`;
    const blockedMin = data.roomBlocks.filter(b => b.roomId === room.id && b.start < periodEnd && periodStart < b.end)
      .reduce((s, b) => s + minutesInsideWindow(b.start > periodStart ? b.start : periodStart, b.end < periodEnd ? b.end : periodEnd), 0);
    const available = windowMin * period.days - blockedMin;
    return { room, procedures: mine.length, availableMin: available, blockedMin, insideMin: inside, outsideMin: total - inside, utilization: available > 0 ? Math.round(1000 * inside / available) / 10 : null };
  });
}

/**
 * Intervalo entre procedimentos na mesma sala e no mesmo dia: fim de um → entrada do seguinte.
 * Comparado com o preparo de sala previsto no tipo do procedimento anterior.
 */
export function turnovers(data: HemoData, period: Period) {
  const out: { roomId: string; before: HemoCase; after: HemoCase; minutes: number; plannedMin: number }[] = [];
  for (const room of data.rooms) {
    const list = roomCases(data).filter(c => c.schedule!.roomId === room.id && inPeriod(dayOf(roomInOf(c)), period)).sort((a, b) => roomInOf(a).localeCompare(roomInOf(b)));
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1], after = list[i];
      if (dayOf(roomInOf(after)) !== dayOf(before.intra.end)) continue;
      out.push({ roomId: room.id, before, after, minutes: minutesOf(roomInOf(after)) - minutesOf(before.intra.end), plannedMin: typeOf(data, before).turnover });
    }
  }
  return { items: out, median: median(out.map(x => x.minutes)), overPlanned: out.filter(x => x.minutes > x.plannedMin).length };
}

/** Atraso dos eletivos: entrada em sala menos o horário agendado. Urgências não entram (não têm horário marcado). */
export function delays(data: HemoData, period: Period) {
  const items = data.cases.filter(c => c.priority === 'Eletivo' && c.schedule && c.intra.roomIn && c.stage !== 'Cancelado' && inPeriod(dayOf(c.intra.roomIn), period))
    .map(c => ({ c, minutes: minutesOf(c.intra.roomIn) - minutesOf(c.schedule!.start) }));
  return { items, median: median(items.map(x => x.minutes)), onTime: items.filter(x => x.minutes <= LATE_TOLERANCE_MIN).length };
}

/** Cancelamentos no período, por motivo. Casos antigos sem data de cancelamento usam a data do pedido. */
export function cancellations(data: HemoData, period: Period) {
  const cancelled = data.cases.filter(c => c.stage === 'Cancelado' && inPeriod(localStamp(new Date(c.cancelledAt || c.createdAt)).slice(0, 10), period));
  const done = roomCases(data).filter(c => inPeriod(dayOf(c.intra.end), period)).length;
  const label = (c: HemoCase): CancelCategory | 'Sem motivo classificado' => c.cancelCategory || 'Sem motivo classificado';
  const byCategory = [...cancelCategories, 'Sem motivo classificado' as const].map(category => ({ category, cases: cancelled.filter(c => label(c) === category) })).filter(x => x.cases.length);
  return { total: cancelled.length, done, rate: cancelled.length + done ? Math.round(1000 * cancelled.length / (cancelled.length + done)) / 10 : null, byCategory };
}

// ---------- Custos ----------
export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/**
 * Lê valor digitado em reais e devolve centavos; '' = sem valor.
 * Aceita "1.234,56", "18.500" (ponto de milhar), "1234.56" e "R$ 80".
 */
export function parseMoney(input: string): number | null {
  const raw = input.replace(/R\$|\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error(`Valor inválido: "${input.trim()}". Use o formato 1.234,56.`);
  return Math.round(Number(normalized) * 100);
}
export const MAX_VALUE_CENTS = 100_000_000; // R$ 1.000.000,00 por item: acima disso é quase certamente erro de digitação.

export type ValuesInput = { materials: Record<string, number | null>; procedures: Record<string, number | null> };
/** Grava a tabela de valores. Itens sem valor (null) saem da tabela. A permissão é conferida por quem chama. */
export function saveValues(data: HemoData, input: ValuesInput, by: string, now = new Date()): HemoData {
  const clean = (record: Record<string, number | null>) => Object.fromEntries(Object.entries(record).filter((e): e is [string, number] => e[1] !== null).map(([k, v]) => {
    if (!Number.isInteger(v) || v < 0 || v > MAX_VALUE_CENTS) throw new Error('Cada valor deve ficar entre R$ 0,00 e R$ 1.000.000,00.');
    return [k, v];
  }));
  const materials = clean(input.materials), procedures = clean(input.procedures);
  for (const id of Object.keys(procedures)) if (!data.types.some(t => t.id === id)) throw new Error('Tipo de procedimento inexistente na tabela de valores.');
  const at = now.toISOString();
  return { ...data, revision: data.revision + 1, values: { materials, procedures, updatedAt: at, updatedBy: by },
    audit: [{ id: newId(), at, caseId: '', action: 'Tabela de valores atualizada', detail: `${Object.keys(materials).length} material(is) com custo · ${Object.keys(procedures).length} procedimento(s) com valor`, by: '' }, ...data.audit] };
}

/**
 * Custo de materiais e margem de um procedimento. A margem só é calculada quando todos os materiais
 * têm custo e o tipo tem valor de referência; senão, diz o que falta. Medicamentos e honorários não entram.
 */
export function caseCost(data: HemoData, catalog: Product[], c: HemoCase) {
  const lines = c.materials.map(m => { const unit = data.values.materials[m.productId]; return { used: m, product: productOf(catalog, m.productId), unitCents: unit ?? null, totalCents: unit === undefined ? null : unit * m.quantity }; });
  const missing = [...new Set(lines.filter(l => l.unitCents === null).map(l => l.product.name))];
  const materialsCents = missing.length ? null : lines.reduce((s, l) => s + (l.totalCents ?? 0), 0);
  const valueCents = data.values.procedures[c.typeId] ?? null;
  return { lines, missing, materialsCents, valueCents, marginCents: materialsCents !== null && valueCents !== null ? valueCents - materialsCents : null };
}

/** Por tipo de procedimento, só os casos concluídos no período. Médias só com casos de custo completo. */
export function costByType(data: HemoData, catalog: Product[], period: Period) {
  const done = roomCases(data).filter(c => inPeriod(dayOf(c.intra.end), period));
  return data.types.map(type => {
    const mine = done.filter(c => c.typeId === type.id).map(c => ({ c, cost: caseCost(data, catalog, c) }));
    const complete = mine.filter(x => x.cost.materialsCents !== null);
    const withMargin = mine.filter(x => x.cost.marginCents !== null);
    const avg = (values: number[]) => values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
    return {
      type, cases: mine.length, incomplete: mine.length - complete.length, valueCents: data.values.procedures[type.id] ?? null,
      avgMaterialsCents: avg(complete.map(x => x.cost.materialsCents!)), avgMarginCents: avg(withMargin.map(x => x.cost.marginCents!)),
      items: mine,
    };
  }).filter(x => x.cases > 0 || x.valueCents !== null);
}
