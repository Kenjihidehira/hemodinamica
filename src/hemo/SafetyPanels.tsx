import { useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Droplet, Minus, Pill, Plus, Printer, ScanBarcode, ShieldCheck, X } from 'lucide-react';
import CameraReader from '../CameraReader';
import { type DemoData } from '../data';
import { ageAt, patientOf, reconcileDecisions, type HemoCase, type HemoData, type ReconcileItem } from './domain';
import { checkMaterialScan, code39Bars, confirmIdentity, contrastGauge, CONTRAST_NEAR_SHARE, reconcileHint, reconciliationDraft, reconciliationProblem, reconciliationText, saveReconciliation, wristbandCode } from './safety';
import { dateTime, shortDate, type Update } from './ui';

/** Código de barras Code 39 em SVG (pulseira e etiqueta). */
export function Barcode({ value, height = 48 }: { value: string; height?: number }) {
  const { bars, width } = code39Bars(value);
  return <svg className="hemo-barcode" viewBox={`0 0 ${width + 20} ${height}`} role="img" aria-label={`Código de barras ${value}`} preserveAspectRatio="none">
    <rect width={width + 20} height={height} fill="#fff"/>
    {bars.map((b, i) => <rect key={i} x={b.x + 10} y={0} width={b.w} height={height} fill="#000"/>)}
  </svg>;
}

/** Pulseira para imprimir (impressora de etiquetas ou papel): nome, nascimento, prontuário, alergia e código. */
function WristbandPreview({ data, c }: { data: HemoData; c: HemoCase }) {
  const p = patientOf(data, c), code = wristbandCode(p);
  return <div className="hemo-wristband" id={`pulseira-${c.id}`}>
    <div><strong>{p.name.toLocaleUpperCase('pt-BR')}</strong><small>Nasc. {shortDate(p.birthDate)} ({ageAt(p.birthDate)} a) · {p.sex === 'F' ? 'F' : 'M'} · Pront. {p.id.toUpperCase()}</small>{p.allergies.length > 0 && <span className="hemo-wristband-allergy">ALERGIA: {p.allergies.join('; ')}</span>}</div>
    <div className="hemo-wristband-code"><Barcode value={code} height={40}/><code>{code}</code></div>
  </div>;
}

/**
 * Identificação no time-out: leitura da pulseira (bipador em modo teclado, câmera ou digitação).
 * Pulseira de outro paciente para tudo; sem leitura possível, conferência manual com justificativa.
 */
export function IdentityPanel({ data, update, c }: { data: HemoData; update: Update; c: HemoCase }) {
  const [code, setCode] = useState(''), [manual, setManual] = useState(false), [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function check(value: string) {
    setError('');
    try { confirmIdentity(data, c.id, { code: value }); } catch (e) { setError((e as Error).message); setCode(''); input.current?.focus(); return; }
    update(d => confirmIdentity(d, c.id, { code: value }));
  }
  function printBand() {
    const el = document.getElementById(`pulseira-${c.id}`);
    if (!el) return;
    document.body.classList.add('is-printing-band'); el.classList.add('is-printing');
    window.print();
    document.body.classList.remove('is-printing-band'); el.classList.remove('is-printing');
  }
  if (c.identity.at) return <div className="hemo-identity is-done"><ShieldCheck size={18}/><span><strong>Paciente identificado</strong> · {c.identity.method.toLocaleLowerCase('pt-BR')} em {dateTime(c.identity.at)}{c.identity.reason ? ` · ${c.identity.reason}` : ''}</span></div>;
  return <div className={`hemo-identity ${error.startsWith('PARE') ? 'is-wrong' : ''}`}>
    <h4><ScanBarcode size={16}/> Identificação pela pulseira</h4>
    <p className="field-hint">Leia a pulseira no time-out. Com bipador, deixe o campo ativo e leia: a confirmação é automática.</p>
    <form className="hemo-inline-form" onSubmit={e => { e.preventDefault(); if (code.trim()) check(code); }}>
      <label className="grow">Código da pulseira<input ref={input} value={code} onChange={e => setCode(e.target.value)} placeholder="PAC-…" autoComplete="off" spellCheck={false}/></label>
      <button className="button primary" disabled={!code.trim()}><Check size={15}/> Conferir</button>
    </form>
    <CameraReader onRead={value => { setCode(value); check(value); }}/>
    {error && <p className={error.startsWith('PARE') ? 'hemo-stop' : 'module-error'} role="alert"><AlertTriangle size={18}/>{error}</p>}
    <details className="hemo-band-print"><summary>Pulseira do paciente (imprimir)</summary><WristbandPreview data={data} c={c}/><button className="button secondary" onClick={printBand}><Printer size={15}/> Imprimir pulseira</button></details>
    {manual ? <div className="hemo-inline-form"><label className="grow">Por que não foi possível ler?<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: pulseira danificada; nome completo e nascimento conferidos com o paciente"/></label><button className="button secondary" onClick={() => { if (update(d => confirmIdentity(d, c.id, { manualReason: reason }))) setManual(false); }}>Registrar conferência manual</button><button className="text-link" onClick={() => setManual(false)}>Voltar</button></div>
      : <button className="text-link" onClick={() => setManual(true)}>Não foi possível ler a pulseira</button>}
  </div>;
}

/** Bipar material na sala: confere validade, bloqueio, saldo e autorização antes de registrar. */
export function MaterialScan({ data, stock, c, onPick }: { data: HemoData; stock: DemoData; c: HemoCase; onPick: (stockId: string) => void }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ReturnType<typeof checkMaterialScan> | null>(null);
  function check(value: string) {
    const r = checkMaterialScan(data, stock, c.id, value);
    setResult(r); setCode('');
    if (r.ok && r.position) onPick(r.position.id);
  }
  return <div className="hemo-scan">
    <form className="hemo-inline-form" onSubmit={e => { e.preventDefault(); if (code.trim()) check(code); }}>
      <label className="grow"><span><ScanBarcode size={14}/> Bipar material (lote ou código do produto)</span><input value={code} onChange={e => setCode(e.target.value)} placeholder="Leia a etiqueta da embalagem" autoComplete="off" spellCheck={false}/></label>
      <button className="button secondary" disabled={!code.trim()}>Conferir</button>
    </form>
    {result && <div className={`hemo-scan-result ${result.ok ? (result.issues.length ? 'is-warn' : 'is-ok') : 'is-bad'}`} role="status">
      <strong>{result.ok ? (result.issues.length ? <><AlertTriangle size={15}/> Pode usar, com atenção</> : <><CheckCircle2 size={15}/> Liberado para uso</>) : <><X size={15}/> Não use este material</>}</strong>
      {result.product && result.position && <span>{result.product.name} · lote {result.position.lot} · vence {shortDate(result.position.expiresAt)}{result.ok ? ' · selecionado abaixo' : ''}</span>}
      {result.issues.length > 0 && <ul>{result.issues.map(i => <li key={i.text} className={i.level === 'bloqueia' ? 'is-high' : ''}>{i.text}</li>)}</ul>}
    </div>}
  </div>;
}

/** Contador de contraste ao vivo: botões grandes para a sala e barra contra o limite sugerido pela função renal. */
/** onBump soma ao valor atual (não ao da última renderização): toques rápidos seguidos não se perdem. */
export function ContrastCounter({ data, c, ml, onBump }: { data: HemoData; c: HemoCase; ml: number; onBump: (deltaMl: number) => void }) {
  const g = contrastGauge(data, c, ml);
  const bump = onBump;
  return <div className={`hemo-contrast-counter is-${g.level.replace(' ', '-')}`}>
    <div className="hemo-contrast-top">
      <span className="hemo-contrast-label"><Droplet size={15}/> Contraste</span>
      <strong className="hemo-contrast-value" aria-live="polite">{ml} <small>mL</small></strong>
      {g.limit !== null && <span className="hemo-contrast-limit">{g.level === 'acima' ? `${-g.left!} mL acima` : `restam ${g.left} mL`} · limite sugerido {g.limit} mL</span>}
    </div>
    {g.limit !== null && <div className="hemo-contrast-bar" role="meter" aria-valuemin={0} aria-valuemax={g.limit} aria-valuenow={ml} aria-label="Contraste usado em relação ao limite sugerido"><span style={{ width: `${Math.min(100, g.share! * 100)}%` }}/><i style={{ left: `${CONTRAST_NEAR_SHARE * 100}%` }}/></div>}
    <div className="hemo-contrast-buttons">
      <button type="button" className="button secondary" onClick={() => bump(-10)} aria-label="Menos 10 mL"><Minus size={14}/>10</button>
      {[10, 20, 50].map(n => <button key={n} type="button" className="button secondary" onClick={() => bump(n)}><Plus size={14}/>{n}</button>)}
    </div>
    {g.level === 'sem limite' && <small className="field-hint">Sem creatinina registrada: não há limite calculado.</small>}
  </div>;
}

/** Reconciliação na alta: cada medicamento de uso contínuo recebe uma decisão; o texto vai para o paciente. */
export function ReconciliationPanel({ data, update, stock, c }: { data: HemoData; update: Update; stock: DemoData; c: HemoCase }) {
  const [items, setItems] = useState<ReconcileItem[]>(() => reconciliationDraft(data, c));
  const [open, setOpen] = useState(!c.reconciliation.doneAt);
  const problem = reconciliationProblem(items);
  const set = (i: number, patch: Partial<ReconcileItem>) => setItems(items.map((x, n) => n === i ? { ...x, ...patch } : x));
  if (!open) return <details className="hemo-reconcile"><summary><Pill size={15}/> Reconciliação de medicamentos · feita em {dateTime(c.reconciliation.doneAt)}</summary><pre>{reconciliationText(c)}</pre><button className="text-link" onClick={() => setOpen(true)}>Revisar</button></details>;
  return <div className="hemo-reconcile is-open">
    <h4><Pill size={15}/> Reconciliação de medicamentos na alta</h4>
    <p className="field-hint">Para cada remédio que o paciente já usava, registre a decisão médica. O sistema só aponta o que costuma pedir atenção; dose e data de retomada vêm da prescrição.</p>
    <div className="hemo-reconcile-list">{items.map((item, i) => { const hint = reconcileHint(item.drug, c, stock.products); return <div key={item.id} className="hemo-reconcile-item">
      <div className="hemo-reconcile-row">
        <label className="grow">Medicamento<input value={item.drug} onChange={e => set(i, { drug: e.target.value })}/></label>
        <label>Decisão<select value={item.decision} onChange={e => set(i, { decision: e.target.value as ReconcileItem['decision'] })}><option value="">Decidir</option>{reconcileDecisions.map(d => <option key={d}>{d}</option>)}</select></label>
        {item.decision === 'Suspender' && <label>Retomar em<input type="date" value={item.resumeOn} onChange={e => set(i, { resumeOn: e.target.value })}/></label>}
        <button className="icon-button" aria-label={`Remover ${item.drug || 'medicamento'}`} onClick={() => setItems(items.filter((_, n) => n !== i))}><X size={15}/></button>
      </div>
      {item.decision && item.decision !== 'Manter' && <label>{item.decision === 'Suspender' ? 'Condição para retomar (se não houver data)' : 'Nova orientação, conforme a receita'}<input value={item.note} onChange={e => set(i, { note: e.target.value })}/></label>}
      {hint && <small className="hemo-reconcile-hint"><AlertTriangle size={12}/> {hint}</small>}
    </div>; })}</div>
    <button className="text-link" onClick={() => setItems([...items, { id: crypto.randomUUID(), drug: '', decision: 'Nova prescrição', resumeOn: '', note: '' }])}><Plus size={14}/> Adicionar medicamento</button>
    <div className="head-actions"><button className="button primary" disabled={!!problem} title={problem} onClick={() => { if (update(d => saveReconciliation(d, c.id, items))) setOpen(false); }}><Check size={15}/> Salvar reconciliação</button>{problem && <span className="field-hint">{problem}</span>}</div>
  </div>;
}
