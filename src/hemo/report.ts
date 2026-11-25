import type { Product } from '../data.ts';
import type { Finding, HemoCase, HemoData, Intra } from './domain.ts';
import { arteries, complicationTypes, coronarySegments, isAngioplasty, type Artery } from './reportCatalog.ts';

/**
 * Laudo estruturado: achados por segmento coronário, fisiologia, conduta, stent e resultado final,
 * além das intercorrências em lista fechada. O sistema valida coerência e monta o texto a partir dos campos;
 * a interpretação e a conduta são do médico.
 * Este arquivo só importa tipos de domain.ts, para não criar dependência circular.
 */

const num = (v: number, digits = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: digits });
export const arteryOf = (segment: string): Artery | null => coronarySegments.find(s => s.name === segment)?.artery ?? null;

export const emptyFinding = (id: string): Finding => ({
  id, vessel: '', stenosis: 0, treatment: '', segment: '', timiPre: '', calcification: '', thrombus: false, bifurcation: false,
  physiology: { kind: '', value: null }, therapy: '', stent: { materialId: '', diameterMm: 0, lengthMm: 0 }, residual: null, timiPost: '',
});

/** Limpa campos que não fazem sentido para a conduta escolhida (stent sem angioplastia, resultado sem tratamento etc.). */
export function normalizeFinding(f: Finding): Finding {
  const angioplasty = isAngioplasty(f.therapy);
  return {
    ...f,
    vessel: f.segment || f.vessel.trim(),
    physiology: f.physiology.kind ? f.physiology : { kind: '', value: null },
    stent: f.therapy === 'Angioplastia com stent' ? f.stent : { materialId: '', diameterMm: 0, lengthMm: 0 },
    residual: angioplasty ? f.residual : null,
    timiPost: angioplasty ? f.timiPost : '',
  };
}

/** Primeiro problema do achado, ou '' quando está coerente. c = caso, para conferir o implante escolhido. */
export function findingProblem(f: Finding, c: Pick<HemoCase, 'materials'>) {
  if (!f.vessel.trim()) return 'Escolha o segmento ou escreva o vaso.';
  if (f.stenosis === 100 && (f.timiPre === '2' || f.timiPre === '3')) return 'Oclusão total (100%) não tem fluxo TIMI 2 ou 3. Confira a estenose ou o fluxo.';
  if (f.physiology.kind) {
    const v = f.physiology.value;
    if (v === null || !Number.isFinite(v) || v < 0.3 || v > 1) return `Informe o valor do ${f.physiology.kind} entre 0,30 e 1,00.`;
  }
  if (f.therapy === 'Angioplastia com stent') {
    if (f.stent.diameterMm < 1.5 || f.stent.diameterMm > 6) return 'Diâmetro do stent entre 1,5 e 6 mm.';
    if (f.stent.lengthMm < 6 || f.stent.lengthMm > 60) return 'Comprimento do stent entre 6 e 60 mm.';
    if (f.stent.materialId && !c.materials.some(m => m.id === f.stent.materialId)) return 'O implante escolhido não está entre os materiais usados neste caso.';
  }
  if (isAngioplasty(f.therapy)) {
    if (!f.timiPost) return 'Informe o fluxo TIMI final.';
    if (f.residual !== null && f.residual > f.stenosis) return 'A estenose residual não pode ser maior que a estenose inicial.';
  }
  return '';
}

/** Lê "3,0 × 18 mm" do nome do stent, para preencher diâmetro e comprimento ao escolher o implante. */
export function stentSizeFromName(name: string) {
  const m = /(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*mm/i.exec(name);
  return m ? { diameterMm: Number(m[1].replace(',', '.')), lengthMm: Number(m[2].replace(',', '.')) } : null;
}

/** Uma frase por achado, no formato usado no laudo. */
export function describeFinding(f: Finding, catalog: Product[], c: Pick<HemoCase, 'materials'>) {
  const lesion = [
    f.stenosis === 100 ? 'oclusão total' : f.stenosis === 0 ? 'sem estenose' : `estenose de ${f.stenosis}%`,
    f.timiPre && `fluxo TIMI ${f.timiPre}`,
    f.calcification && f.calcification !== 'Ausente' && `calcificação ${f.calcification.toLocaleLowerCase('pt-BR')}`,
    f.thrombus && 'com trombo',
    f.bifurcation && 'em bifurcação',
  ].filter(Boolean).join(', ');
  const parts = [`${f.vessel}: ${lesion}.`];
  if (f.physiology.kind && f.physiology.value !== null) parts.push(`${f.physiology.kind} ${num(f.physiology.value, 2)}.`);
  if (f.therapy === 'Angioplastia com stent') {
    const used = c.materials.find(m => m.id === f.stent.materialId);
    const product = used ? catalog.find(p => p.id === used.productId) : undefined;
    parts.push(`Angioplastia com stent ${num(f.stent.diameterMm)} × ${num(f.stent.lengthMm)} mm${product ? ` (${product.name}${used?.serial ? `, série ${used.serial}` : ''})` : ''}.`);
  } else if (f.therapy) parts.push(`${f.therapy}.`);
  const result = isAngioplasty(f.therapy) ? [f.residual !== null && `estenose residual de ${f.residual}%`, f.timiPost && `fluxo final TIMI ${f.timiPost}`].filter(Boolean).join(', ') : '';
  if (result) parts.push(`${result[0].toLocaleUpperCase('pt-BR')}${result.slice(1)}.`);
  if (f.treatment) parts.push(`${f.treatment.replace(/[.\s]+$/, '')}.`);
  return parts.join(' ');
}

export function pressureText(p: Intra['pressures']) {
  return [
    p.aoSystolic !== null && p.aoDiastolic !== null ? `pressão aórtica ${p.aoSystolic}/${p.aoDiastolic} mmHg` : p.aoSystolic !== null ? `pressão aórtica sistólica ${p.aoSystolic} mmHg` : '',
    p.lvedp !== null ? `pressão diastólica final do VE ${p.lvedp} mmHg` : '',
  ].filter(Boolean).join(', ');
}

export function complicationText(intra: Pick<Intra, 'events' | 'complications'>) {
  const listed = intra.events.filter(e => e !== 'Outra');
  const parts = [...listed, intra.complications.trim()].filter(Boolean);
  return parts.length ? parts.join('; ') : '';
}

/**
 * Descrição montada só com o que foi registrado (sem IA). O médico revisa e completa antes de assinar.
 * findings = achados em edição (podem ainda não estar salvos).
 */
export function structuredReportText(c: HemoCase, findings: Finding[], catalog: Product[], procedure: string) {
  const i = c.intra;
  const lines = [`${procedure}${i.access ? ` por via ${i.access.toLocaleLowerCase('pt-BR')}` : ''}.`];
  const pressures = pressureText(i.pressures);
  if (pressures) lines.push(`Hemodinâmica: ${pressures}.`);
  lines.push(findings.length ? `Achados:\n${findings.map(f => `- ${describeFinding(normalizeFinding(f), catalog, c)}`).join('\n')}` : 'Achados: nenhum registrado.');
  lines.push(`Contraste ${i.contrastMl} mL, fluoroscopia ${num(i.fluoroMin)} min, kerma no ar ${i.kermaMgy.toLocaleString('pt-BR')} mGy.`);
  const comp = complicationText(i);
  lines.push(comp ? `Intercorrências: ${comp}.` : 'Sem intercorrências registradas.');
  return lines.join('\n\n');
}

/** Estenose que costuma ser chamada de significativa: ≥ 50% no tronco, ≥ 70% nas demais. Referência ajustável pelo serviço. */
export const SIGNIFICANT_STENOSIS = { Tronco: 50, other: 70 } as const;
/** Faixa de estenose intermediária, em que a avaliação funcional (FFR/iFR) costuma ser indicada. */
export const INTERMEDIATE_STENOSIS = { min: 40, max: 69 } as const;
/** Resultado angiográfico considerado ótimo após angioplastia: TIMI 3 final e residual abaixo deste valor. */
export const RESIDUAL_TARGET_PCT = 20;

const isSignificant = (f: Finding) => { const a = arteryOf(f.segment); return a !== null && f.stenosis >= (a === 'Tronco' ? SIGNIFICANT_STENOSIS.Tronco : SIGNIFICANT_STENOSIS.other); };

/** Indicadores do laudo estruturado, só com o que está registrado. Achados sem segmento (laudos antigos) ficam fora das contas por artéria. */
export function reportIndicators(data: HemoData) {
  const done = data.cases.filter(c => c.intra.end && c.stage !== 'Cancelado');
  const findings = done.flatMap(c => c.findings);
  const coded = findings.filter(f => f.segment);
  const intermediate = coded.filter(f => f.stenosis >= INTERMEDIATE_STENOSIS.min && f.stenosis <= INTERMEDIATE_STENOSIS.max);
  const treated = findings.filter(f => isAngioplasty(f.therapy));
  return {
    cases: done.length,
    complicationsByType: complicationTypes.map(type => ({ type, cases: done.filter(c => c.intra.events.includes(type)).length })).filter(x => x.cases > 0),
    casesWithComplication: done.filter(c => c.intra.events.length > 0 || c.intra.complications).length,
    lesions: { coded: coded.length, legacy: findings.length - coded.length },
    byArtery: arteries.map(artery => ({ artery, significant: coded.filter(f => arteryOf(f.segment) === artery && isSignificant(f)).length, treated: coded.filter(f => arteryOf(f.segment) === artery && isAngioplasty(f.therapy)).length })),
    intermediate: { total: intermediate.length, withPhysiology: intermediate.filter(f => f.physiology.kind && f.physiology.value !== null).length },
    angioplasty: { lesions: treated.length, stents: treated.filter(f => f.therapy === 'Angioplastia com stent').length, optimal: treated.filter(f => f.timiPost === '3' && f.residual !== null && f.residual < RESIDUAL_TARGET_PCT).length, missingResult: treated.filter(f => !f.timiPost || f.residual === null).length },
  };
}
