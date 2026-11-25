import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { type Finding, type HemoCase, type HemoData, type Intra } from './domain';
import { arteries, calcificationGrades, complicationTypes, coronarySegments, isAngioplasty, physiologyKinds, therapies, timiGrades, type ComplicationType } from './reportCatalog';
import { describeFinding, findingProblem, INTERMEDIATE_STENOSIS, normalizeFinding, reportIndicators, RESIDUAL_TARGET_PCT, SIGNIFICANT_STENOSIS, stentSizeFromName } from './report';
import { type Product } from '../data';

const OTHER = '__outro';
/** Campo numérico opcional: vazio vira null. */
const optional = (value: string) => value.trim() === '' ? null : Number(value.replace(',', '.'));

/** Um achado do laudo: lesão, avaliação funcional, conduta e resultado. */
export function FindingEditor({ f, index, c, catalog, onChange, onRemove }: { f: Finding; index: number; c: HemoCase; catalog: Product[]; onChange: (next: Finding) => void; onRemove: () => void }) {
  const [other, setOther] = useState(!f.segment && !!f.vessel);
  const set = (patch: Partial<Finding>) => onChange({ ...f, ...patch });
  const implants = c.materials.filter(m => catalog.find(p => p.id === m.productId)?.implantable);
  const problem = findingProblem(normalizeFinding(f), c);
  const angioplasty = isAngioplasty(f.therapy);
  const label = f.vessel || `achado ${index + 1}`;
  function chooseImplant(materialId: string) {
    const used = c.materials.find(m => m.id === materialId);
    const size = used ? stentSizeFromName(catalog.find(p => p.id === used.productId)?.name ?? '') : null;
    set({ stent: { materialId, diameterMm: size?.diameterMm ?? f.stent.diameterMm, lengthMm: size?.lengthMm ?? f.stent.lengthMm } });
  }
  return <fieldset className="hemo-finding-card">
    <legend>Achado {index + 1}</legend>
    <button type="button" className="icon-button hemo-finding-remove" aria-label={`Remover ${label}`} onClick={onRemove}><X size={15}/></button>
    <div className="hemo-finding-row">
      <label className="grow">Segmento<select value={other ? OTHER : f.segment} onChange={e => { const v = e.target.value; if (v === OTHER) { setOther(true); set({ segment: '', vessel: '' }); } else { setOther(false); set({ segment: v as Finding['segment'], vessel: v }); } }}>
        <option value="">Selecione</option>
        {arteries.map(a => <optgroup key={a} label={a}>{coronarySegments.filter(s => s.artery === a).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</optgroup>)}
        <option value={OTHER}>Outro vaso (escrever)</option>
      </select></label>
      {other && <label className="grow">Vaso<input value={f.vessel} onChange={e => set({ vessel: e.target.value })} placeholder="Ex.: artéria femoral superficial direita"/></label>}
      <label>Estenose %<input type="number" min={0} max={100} value={f.stenosis} onChange={e => set({ stenosis: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}/></label>
      <label>TIMI inicial<select value={f.timiPre} onChange={e => set({ timiPre: e.target.value as Finding['timiPre'] })}><option value="">—</option>{timiGrades.map(t => <option key={t}>{t}</option>)}</select></label>
    </div>
    <div className="hemo-finding-row">
      <label>Calcificação<select value={f.calcification} onChange={e => set({ calcification: e.target.value as Finding['calcification'] })}><option value="">—</option>{calcificationGrades.map(g => <option key={g}>{g}</option>)}</select></label>
      <label className="hospital-check"><input type="checkbox" checked={f.thrombus} onChange={e => set({ thrombus: e.target.checked })}/>Trombo</label>
      <label className="hospital-check"><input type="checkbox" checked={f.bifurcation} onChange={e => set({ bifurcation: e.target.checked })}/>Bifurcação</label>
      <label>Avaliação funcional<select value={f.physiology.kind} onChange={e => set({ physiology: { kind: e.target.value as Finding['physiology']['kind'], value: e.target.value ? f.physiology.value : null } })}><option value="">Não feita</option>{physiologyKinds.map(k => <option key={k}>{k}</option>)}</select></label>
      {f.physiology.kind && <label>Valor<input type="number" min={0.3} max={1} step={0.01} value={f.physiology.value ?? ''} onChange={e => set({ physiology: { ...f.physiology, value: optional(e.target.value) } })} placeholder="0,80"/></label>}
    </div>
    <div className="hemo-finding-row">
      <label className="grow">Conduta<select value={f.therapy} onChange={e => set({ therapy: e.target.value as Finding['therapy'] })}><option value="">Selecione</option>{therapies.map(t => <option key={t}>{t}</option>)}</select></label>
      {f.therapy === 'Angioplastia com stent' && <>
        <label className="grow">Implante usado<select value={f.stent.materialId} onChange={e => chooseImplant(e.target.value)}><option value="">{implants.length ? 'Selecione' : 'Nenhum implante registrado na sala'}</option>{implants.map(m => <option key={m.id} value={m.id}>{catalog.find(p => p.id === m.productId)?.name} · série {m.serial || 'sem série'}</option>)}</select></label>
        <label>Diâmetro (mm)<input type="number" min={1.5} max={6} step={0.25} value={f.stent.diameterMm || ''} onChange={e => set({ stent: { ...f.stent, diameterMm: optional(e.target.value) ?? 0 } })}/></label>
        <label>Comprimento (mm)<input type="number" min={6} max={60} value={f.stent.lengthMm || ''} onChange={e => set({ stent: { ...f.stent, lengthMm: optional(e.target.value) ?? 0 } })}/></label>
      </>}
      {angioplasty && <>
        <label>Residual %<input type="number" min={0} max={100} value={f.residual ?? ''} onChange={e => { const v = optional(e.target.value); set({ residual: v === null ? null : Math.max(0, Math.min(100, Math.round(v))) }); }}/></label>
        <label>TIMI final<select value={f.timiPost} onChange={e => set({ timiPost: e.target.value as Finding['timiPost'] })}><option value="">—</option>{timiGrades.map(t => <option key={t}>{t}</option>)}</select></label>
      </>}
    </div>
    <label>Observação<input value={f.treatment} onChange={e => set({ treatment: e.target.value })} placeholder="Ex.: pré-dilatação com balão 2,5 × 15 mm"/></label>
    {problem ? <p className="hemo-finding-problem"><AlertTriangle size={14}/>{problem}</p> : f.vessel && <p className="hemo-finding-preview">{describeFinding(normalizeFinding(f), catalog, c)}</p>}
  </fieldset>;
}

/** Intercorrências na sala: lista fechada (para os indicadores) e detalhes em texto. */
export function ComplicationsField({ intra, onChange }: { intra: Intra; onChange: (patch: Partial<Intra>) => void }) {
  const events = intra.events ?? [];
  const toggle = (type: ComplicationType, on: boolean) => onChange({ events: on ? [...events, type] : events.filter(e => e !== type) });
  return <fieldset className="hemo-complications">
    <legend>Intercorrências</legend>
    <label className="hospital-check"><input type="checkbox" checked={events.length === 0 && !intra.complications} onChange={e => { if (e.target.checked) onChange({ events: [], complications: '' }); }}/>Nenhuma</label>
    <div className="hemo-complication-grid">{complicationTypes.map(t => <label key={t} className="hospital-check"><input type="checkbox" checked={events.includes(t)} onChange={e => toggle(t, e.target.checked)}/>{t}</label>)}</div>
    <label>Detalhes{events.includes('Outra') ? ' (obrigatório para "Outra")' : ''}<input value={intra.complications} onChange={e => onChange({ complications: e.target.value })} placeholder="O que aconteceu e como foi conduzido"/></label>
  </fieldset>;
}

/** Pressões medidas na sala. Todas opcionais. */
export function PressuresField({ intra, onChange }: { intra: Intra; onChange: (patch: Partial<Intra>) => void }) {
  const p = intra.pressures ?? { aoSystolic: null, aoDiastolic: null, lvedp: null };
  const set = (k: keyof typeof p, v: string) => onChange({ pressures: { ...p, [k]: optional(v) } });
  return <div className="hospital-form-grid hemo-grid-3">
    <label>Aorta sistólica (mmHg)<input type="number" min={40} max={300} value={p.aoSystolic ?? ''} onChange={e => set('aoSystolic', e.target.value)}/></label>
    <label>Aorta diastólica (mmHg)<input type="number" min={20} max={200} value={p.aoDiastolic ?? ''} onChange={e => set('aoDiastolic', e.target.value)}/></label>
    <label>PD2VE (mmHg)<input type="number" min={0} max={60} value={p.lvedp ?? ''} onChange={e => set('lvedp', e.target.value)}/></label>
  </div>;
}

/** Indicadores que só existem com o laudo estruturado. */
export function StructuredIndicators({ data }: { data: HemoData }) {
  const ind = reportIndicators(data);
  const pct = (part: number, total: number) => total ? `${Math.round(100 * part / total)}%` : '—';
  return <>
    <div className="hemo-kpis">
      <div><span>Resultado angiográfico ótimo</span><strong>{pct(ind.angioplasty.optimal, ind.angioplasty.lesions)}</strong><small>TIMI 3 final e residual abaixo de {RESIDUAL_TARGET_PCT}% · {ind.angioplasty.optimal} de {ind.angioplasty.lesions} lesão(ões) tratada(s){ind.angioplasty.missingResult ? ` · ${ind.angioplasty.missingResult} sem resultado completo` : ''}</small></div>
      <div><span>FFR/iFR em lesões intermediárias</span><strong>{pct(ind.intermediate.withPhysiology, ind.intermediate.total)}</strong><small>estenoses de {INTERMEDIATE_STENOSIS.min} a {INTERMEDIATE_STENOSIS.max}% · {ind.intermediate.withPhysiology} de {ind.intermediate.total}</small></div>
      <div><span>Stents implantados</span><strong>{ind.angioplasty.stents}</strong><small>em {ind.angioplasty.lesions} lesão(ões) com angioplastia</small></div>
      <div><span>Casos com intercorrência</span><strong className={ind.casesWithComplication ? 'is-bad' : ''}>{pct(ind.casesWithComplication, ind.cases)}</strong><small>{ind.casesWithComplication} de {ind.cases} procedimento(s) concluído(s)</small></div>
    </div>
    <section className="panel"><div className="panel-head"><div><h2>Lesões por artéria</h2><p>Só achados com segmento padronizado ({ind.lesions.coded}). Significativa: estenose ≥ {SIGNIFICANT_STENOSIS.Tronco}% no tronco e ≥ {SIGNIFICANT_STENOSIS.other}% nas demais (referência ajustável pelo serviço).{ind.lesions.legacy ? ` ${ind.lesions.legacy} achado(s) de laudos antigos, sem segmento, ficam fora.` : ''}</p></div></div>
      <table className="hemo-table"><thead><tr><th>Artéria</th><th>Lesões significativas</th><th>Tratadas com angioplastia</th></tr></thead><tbody>{ind.byArtery.map(a => <tr key={a.artery}><td>{a.artery}</td><td>{a.significant}</td><td>{a.treated}</td></tr>)}</tbody></table>
    </section>
    <section className="panel"><div className="panel-head"><div><h2>Intercorrências por tipo</h2><p>Marcadas na lista da sala. As definições seguem o protocolo do serviço.</p></div></div>
      {ind.complicationsByType.length === 0 ? <p className="empty-state">Nenhuma intercorrência marcada nos procedimentos concluídos.</p> : <table className="hemo-table"><thead><tr><th>Intercorrência</th><th>Casos</th><th>% dos concluídos</th></tr></thead><tbody>{ind.complicationsByType.map(x => <tr key={x.type}><td>{x.type}</td><td>{x.cases}</td><td>{pct(x.cases, ind.cases)}</td></tr>)}</tbody></table>}
    </section>
  </>;
}
