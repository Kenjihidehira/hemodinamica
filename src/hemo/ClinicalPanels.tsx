import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ClipboardCopy, Droplets, Eraser, ExternalLink, FileSignature, Image as ImageIcon, PenLine, Pill, Printer, Timer, Trash2, Truck } from 'lucide-react';
import { localStamp, medRoutes, medUnits, patientOf, recordRenalRecheck, renalProfile, type HemoCase, type HemoData, type Medication } from './domain';
import {
  actStatus, addActReading, addMedication, bandStatus, clinicalIndicators, commonDrugs, consentRelations, consentText, dischargeDraft, onCallFor, removeBand, removeMedication,
  replenishmentOrders, saveDischarge, saveImaging, saveUrgencyTimes, setActTarget, setBand, setOnCall, signConsent, urgencyTimeline, type UrgencyTimes,
} from './clinical';
import { dateTime, shortDate, useNow, when, type Props, type Update } from './ui';
import { type DemoData } from '../data';

const copy = (text: string, done: (ok: boolean) => void) => { void navigator.clipboard?.writeText(text).then(() => done(true)).catch(() => done(false)); };
/** Abre uma janela só com o texto e chama a impressão (orientação de alta, pedido ao fornecedor). */
function printText(title: string, text: string) {
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return;
  const doc = w.document;
  doc.title = title;
  const pre = doc.createElement('pre');
  pre.textContent = text;
  pre.style.cssText = 'font: 15px/1.6 Arial, sans-serif; white-space: pre-wrap; margin: 32px;';
  doc.body.appendChild(pre);
  w.focus(); w.print();
}

// ---------------- Função renal ----------------
export function RenalLine({ data, c }: { data: HemoData; c: HemoCase }) {
  const p = patientOf(data, c), r = renalProfile(data, c);
  return <span>{p.creatinine === null ? 'sem creatinina' : `${p.creatinine.toLocaleString('pt-BR')} mg/dL`}{r.egfr !== null && <> · TFG <strong className={r.risk === 'alto' ? 'hemo-risk-high' : r.risk === 'atenção' ? 'hemo-risk-warn' : ''}>{r.egfr}</strong></>} · {p.weightKg ? `${p.weightKg} kg` : '—'}</span>;
}

export function RenalRecheckStep({ update, c }: { update: Update; c: HemoCase }) {
  const [value, setValue] = useState('');
  const now = useNow(60_000);
  if (!c.renal.recheckDue) return null;
  if (c.renal.recheckCreatinine !== null) return <div className={`hemo-step hemo-step-compact ${c.renal.aki ? 'hemo-step-warn' : ''}`}><span><Droplets size={15}/> Creatinina de controle: <strong>{c.renal.recheckCreatinine.toLocaleString('pt-BR')} mg/dL</strong> em {dateTime(c.renal.recheckAt)}{c.renal.aki ? ' · possível lesão renal aguda pelo contraste: avise o médico responsável' : ' · sem alta relevante'}</span></div>;
  const late = c.renal.recheckDue < localStamp(now).slice(0, 10);
  return <div className={`hemo-step ${late ? 'hemo-step-warn' : ''}`}><h3><Droplets size={16}/> Creatinina de controle · {shortDate(c.renal.recheckDue)}</h3>
    <p className="field-hint">Programada porque a função renal já indicava risco ou porque o contraste passou do limite sugerido{c.renal.contrastLimitMl !== null ? ` (${c.renal.contrastLimitMl} mL)` : ''}. Colher entre 48 e 72 h após o procedimento.</p>
    <div className="hemo-inline-form"><label>Creatinina (mg/dL)<input type="number" min={0.1} max={20} step="0.1" value={value} onChange={e => setValue(e.target.value)}/></label><button className="button secondary" disabled={!value} onClick={() => { if (update(d => recordRenalRecheck(d, c.id, Number(value)))) setValue(''); }}>Registrar resultado</button></div>
  </div>;
}

// ---------------- Urgência por etapas ----------------
export function UrgencyTimeline({ update, c }: { update: Update; c: HemoCase }) {
  const [times, setTimes] = useState<UrgencyTimes>(c.urgency);
  if (c.priority !== 'Urgência' || !c.doorAt) return null;
  const steps = urgencyTimeline({ ...c, urgency: times });
  const dirty = JSON.stringify(times) !== JSON.stringify(c.urgency);
  const field = (key: keyof UrgencyTimes, label: string) => <label>{label}<input type="datetime-local" value={times[key]} onChange={e => setTimes({ ...times, [key]: e.target.value })}/></label>;
  return <details className="hemo-signed hemo-timeline" open={['Preparo', 'Sala'].includes(c.stage)}><summary><Timer size={15}/> Porta-balão por etapas</summary>
    <div className="hospital-form-grid hemo-grid-3">{field('ecgAt', 'ECG feito')}{field('teamCalledAt', 'Equipe acionada')}{field('teamArrivedAt', 'Equipe na sala')}</div>
    <div className="head-actions"><button className="button secondary" disabled={!dirty} onClick={() => update(d => saveUrgencyTimes(d, c.id, times))}>Salvar horários</button><span className="field-hint">Punção = início do procedimento; abertura = registro da sala.</span></div>
    <table className="hemo-table"><thead><tr><th>Etapa</th><th>De</th><th>Até</th><th>Minutos</th></tr></thead><tbody>{steps.map(s => <tr key={s.label}><td>{s.label}{s.target ? <small className="hemo-code">meta {s.target} min</small> : null}</td><td>{when(s.from)}</td><td>{when(s.to)}</td><td className={s.target && s.minutes !== null && s.minutes > s.target ? 'is-low' : ''}>{s.minutes ?? '—'}</td></tr>)}</tbody></table>
  </details>;
}

// ---------------- Medicamentos e TCA na sala ----------------
export function MedsPanel({ update, c }: { update: Update; c: HemoCase }) {
  const blank = () => ({ at: localStamp(), drug: '', dose: '', unit: 'mg' as Medication['unit'], route: 'Intravenosa' as Medication['route'] });
  const [med, setMed] = useState(blank);
  const [target, setTarget] = useState(c.act.target ? String(c.act.target) : ''), [actAt, setActAt] = useState(localStamp()), [seconds, setSeconds] = useState('');
  const act = actStatus(c);
  return <div className="hemo-meds">
    <h4><Pill size={15}/> Medicamentos na sala</h4>
    <p className="field-hint">Registre o que foi administrado, com dose e horário. O sistema não sugere doses; a lista só ajuda a digitar.</p>
    <div className="hemo-med-form">
      <label>Horário<input type="datetime-local" value={med.at} onChange={e => setMed({ ...med, at: e.target.value })}/></label>
      <label className="grow">Medicamento<input list="hemo-drugs" value={med.drug} onChange={e => setMed({ ...med, drug: e.target.value })} placeholder="Ex.: Heparina não fracionada"/></label>
      <datalist id="hemo-drugs">{commonDrugs.map(d => <option key={d} value={d}/>)}</datalist>
      <label>Dose<input type="number" min={0} step="any" value={med.dose} onChange={e => setMed({ ...med, dose: e.target.value })}/></label>
      <label>Unidade<select value={med.unit} onChange={e => setMed({ ...med, unit: e.target.value as Medication['unit'] })}>{medUnits.map(u => <option key={u}>{u}</option>)}</select></label>
      <label>Via<select value={med.route} onChange={e => setMed({ ...med, route: e.target.value as Medication['route'] })}>{medRoutes.map(r => <option key={r}>{r}</option>)}</select></label>
      <button className="button secondary" disabled={!med.drug.trim() || !med.dose} onClick={() => { if (update(d => addMedication(d, c.id, { at: med.at, drug: med.drug, dose: Number(med.dose), unit: med.unit, route: med.route }))) setMed(blank()); }}>Registrar</button>
    </div>
    {c.meds.length > 0 && <ul className="hemo-used">{c.meds.map(m => <li key={m.id}><span>{m.at.slice(11)} · {m.drug} <strong>{m.dose.toLocaleString('pt-BR')} {m.unit}</strong><small>{m.route}</small></span><button className="icon-button" aria-label={`Remover ${m.drug} das ${m.at.slice(11)}`} onClick={() => update(d => removeMedication(d, c.id, m.id))}><Trash2 size={15}/></button></li>)}</ul>}
    <h4><Timer size={15}/> Tempo de coagulação ativado (TCA)</h4>
    <div className="hemo-act">
      <div className="hemo-inline-form"><label>Alvo definido pelo médico (s)<input type="number" min={0} max={999} value={target} onChange={e => setTarget(e.target.value)} placeholder="opcional"/></label><button className="button secondary" disabled={(target || '0') === String(c.act.target)} onClick={() => update(d => setActTarget(d, c.id, Number(target || 0)))}>Salvar alvo</button></div>
      <div className="hemo-inline-form"><label>Horário<input type="datetime-local" value={actAt} onChange={e => setActAt(e.target.value)}/></label><label>TCA (s)<input type="number" min={50} max={999} value={seconds} onChange={e => setSeconds(e.target.value)}/></label><button className="button secondary" disabled={!seconds} onClick={() => { if (update(d => addActReading(d, c.id, actAt, Number(seconds)))) { setSeconds(''); setActAt(localStamp()); } }}>Registrar TCA</button></div>
    </div>
    {c.act.readings.length > 0 && <p className={`hemo-act-readings ${act.belowTarget ? 'is-low' : ''}`}>{act.belowTarget && <AlertTriangle size={14}/>}{c.act.readings.map(r => `${r.at.slice(11)} · ${r.seconds} s`).join('  ·  ')}{act.belowTarget ? ` — última medida abaixo do alvo de ${c.act.target} s` : ''}</p>}
  </div>;
}

// ---------------- Pulseira radial ----------------
export function BandPanel({ update, c }: { update: Update; c: HemoCase }) {
  const now = useNow(30_000);
  const [placedAt, setPlacedAt] = useState(c.band.placedAt || c.intra.end || localStamp()), [releaseMin, setReleaseMin] = useState(String(c.band.releaseMin || 120)), [removedAt, setRemovedAt] = useState('');
  const [editing, setEditing] = useState(!c.band.placedAt);
  if (!c.intra.access.startsWith('Radial')) return null;
  const status = bandStatus(c, now);
  if (c.band.removedAt) return <div className="hemo-step hemo-step-compact"><span><Timer size={15}/> Pulseira radial colocada às {c.band.placedAt.slice(11)} e retirada às {c.band.removedAt.slice(11)}.</span></div>;
  return <div className={`hemo-band ${status?.overdue ? 'is-late' : ''}`}>
    <div className="hemo-band-head"><Timer size={18}/>{status ? <div><strong>{status.overdue ? `Liberar a pulseira: passou ${-status.minutesLeft} min do horário` : `Liberar a pulseira às ${status.releaseAt.slice(11)}`}</strong><small>{status.overdue ? 'Avalie e libere conforme o protocolo do serviço.' : `faltam ${status.minutesLeft} min · colocada às ${c.band.placedAt.slice(11)} · ${c.band.releaseMin} min`}</small></div> : <div><strong>Pulseira de compressão radial</strong><small>Registre a colocação para o cronômetro avisar a hora de liberar.</small></div>}</div>
    {editing ? <div className="hemo-inline-form"><label>Colocada<input type="datetime-local" value={placedAt} onChange={e => setPlacedAt(e.target.value)}/></label><label>Liberar após (min)<input type="number" min={15} max={480} value={releaseMin} onChange={e => setReleaseMin(e.target.value)}/></label><button className="button secondary" onClick={() => { if (update(d => setBand(d, c.id, placedAt, Number(releaseMin)))) setEditing(false); }}>Salvar</button></div>
      : <div className="hemo-inline-form"><label>Retirada às<input type="datetime-local" value={removedAt || localStamp(now)} onChange={e => setRemovedAt(e.target.value)}/></label><button className="button primary" onClick={() => update(d => removeBand(d, c.id, removedAt || localStamp()))}><Check size={15}/> Registrar retirada</button><button className="text-link" onClick={() => setEditing(true)}>Ajustar tempo</button></div>}
    <small className="field-hint">Tempo de referência do serviço: ajuste conforme o protocolo e o procedimento.</small>
  </div>;
}

// ---------------- Alta ----------------
export function DischargePanel({ data, update, stock, c }: { data: HemoData; update: Update; stock: DemoData; c: HemoCase }) {
  const [text, setText] = useState(c.discharge.text || dischargeDraft(data, stock.products, c));
  const [medications, setMedications] = useState(c.discharge.medications), [returnDate, setReturnDate] = useState(c.discharge.returnDate);
  const [copied, setCopied] = useState(false);
  const full = `${text}${medications.trim() ? `\n\nMedicamentos da alta (conforme receita)\n${medications.trim()}` : ''}${returnDate ? `\n\nRetorno: ${shortDate(returnDate)}` : ''}`;
  const save = (delivered: boolean) => update(d => saveDischarge(d, stock.products, c.id, { text, medications, returnDate }, delivered));
  return <details className="hemo-signed hemo-discharge" open={c.stage === 'Recuperação' && !c.discharge.deliveredAt}><summary><FileSignature size={15}/> Orientação de alta{c.discharge.deliveredAt ? ` · entregue em ${dateTime(c.discharge.deliveredAt)}` : ' · não entregue'}</summary>
    <p className="field-hint">Modelo para o paciente levar para casa. Revise com o protocolo do hospital: prazos de cuidado e prescrição são definidos pela equipe.</p>
    <label>Texto da orientação<textarea rows={12} value={text} onChange={e => setText(e.target.value)}/></label>
    <div className="hospital-form-grid"><label>Medicamentos da alta (conforme receita)<textarea rows={3} value={medications} onChange={e => setMedications(e.target.value)} placeholder="Copie da receita: nome, dose e horários"/></label><label>Retorno<input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}/></label></div>
    <div className="head-actions"><button className="button secondary" onClick={() => save(false)}>Salvar</button><button className="button secondary" onClick={() => printText('Orientações de alta', full)}><Printer size={15}/> Imprimir</button><button className="button secondary" onClick={() => copy(full, setCopied)}><ClipboardCopy size={15}/> {copied ? 'Copiado' : 'Copiar'}</button><button className="button primary" onClick={() => save(true)}><Check size={15}/> Entregue e explicada ao paciente</button></div>
  </details>;
}

// ---------------- Consentimento ----------------
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef(false), drawn = useRef(false);
  useEffect(() => {
    const el = canvas.current!, ratio = window.devicePixelRatio || 1;
    el.width = el.offsetWidth * ratio; el.height = el.offsetHeight * ratio;
    const ctx = el.getContext('2d')!; ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#17242b';
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return <div className="hemo-signature">
    <canvas ref={canvas} aria-label="Quadro de assinatura: assine com o dedo, a caneta ou o mouse" role="img"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const ctx = e.currentTarget.getContext('2d')!; const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); }}
      onPointerMove={e => { if (!drawing.current) return; const ctx = e.currentTarget.getContext('2d')!; const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke(); drawn.current = true; }}
      onPointerUp={e => { drawing.current = false; if (drawn.current) onChange(e.currentTarget.toDataURL('image/png')); }}
      onPointerLeave={() => { drawing.current = false; }}/>
    <button type="button" className="text-link" onClick={() => { const el = canvas.current!; el.getContext('2d')!.clearRect(0, 0, el.width, el.height); drawn.current = false; onChange(''); }}><Eraser size={14}/> Limpar</button>
  </div>;
}
export function ConsentPanel({ data, update, c }: { data: HemoData; update: Update; c: HemoCase }) {
  const p = patientOf(data, c);
  const [signer, setSigner] = useState(p.name), [relation, setRelation] = useState<typeof consentRelations[number]>('Paciente'), [signature, setSignature] = useState('');
  if (c.consent.signedAt) return <div className="hemo-step hemo-step-compact hemo-consent-done"><span><FileSignature size={15}/> Termo assinado por <strong>{c.consent.signer}</strong> ({c.consent.relation.toLocaleLowerCase('pt-BR')}) em {dateTime(c.consent.signedAt)}</span>{c.consent.signature && <img src={c.consent.signature} alt={`Assinatura de ${c.consent.signer}`}/>}</div>;
  return <details className="hemo-signed hemo-consent"><summary><PenLine size={15}/> Assinar termo de consentimento na tela</summary>
    <p className="hemo-consent-text">{consentText(data, c)}</p>
    <div className="hospital-form-grid"><label>Quem assina<input value={signer} onChange={e => setSigner(e.target.value)}/></label><label>Assina como<select value={relation} onChange={e => { const r = e.target.value as typeof relation; setRelation(r); if (r === 'Paciente') setSigner(p.name); else if (signer === p.name) setSigner(''); }}>{consentRelations.map(r => <option key={r}>{r}</option>)}</select></label></div>
    <SignaturePad onChange={setSignature}/>
    <div className="head-actions"><button className="button primary" disabled={!signature || signer.trim().length < 3} onClick={() => update(d => signConsent(d, c.id, { signer, relation, signature }))}><FileSignature size={15}/> Registrar assinatura</button></div>
    <small className="field-hint">Assinatura eletrônica simples, guardada junto do caso e sem certificado digital. A validade jurídica deve ser confirmada com o jurídico do hospital; o termo completo de riscos é o do hospital.</small>
  </details>;
}

// ---------------- Imagens (PACS) ----------------
export function ImagingPanel({ update, c, editable }: { update: Update; c: HemoCase; editable: boolean }) {
  const [accession, setAccession] = useState(c.imaging.accession), [url, setUrl] = useState(c.imaging.url);
  const dirty = accession !== c.imaging.accession || url !== c.imaging.url;
  const link = c.imaging.url && <a className="text-link" href={c.imaging.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Abrir imagens</a>;
  if (!editable) return c.imaging.accession || c.imaging.url ? <p className="hemo-imaging-line"><ImageIcon size={14}/> Exame de imagem{c.imaging.accession ? ` · acesso ${c.imaging.accession}` : ''} {link}</p> : null;
  return <div className="hemo-imaging"><h4><ImageIcon size={15}/> Imagens da angiografia</h4>
    <div className="hemo-inline-form"><label>Nº de acesso<input value={accession} onChange={e => setAccession(e.target.value)} placeholder="Do sistema de imagens"/></label><label className="grow">Link do visualizador<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"/></label><button className="button secondary" disabled={!dirty} onClick={() => update(d => saveImaging(d, c.id, accession, url))}>Vincular</button>{link}</div>
    <small className="field-hint">Por enquanto o vínculo é manual. Com a integração ao PACS, o exame aparece sozinho.</small>
  </div>;
}

// ---------------- Sobreaviso ----------------
export function OnCallPanel({ data, update }: { data: HemoData; update: Update }) {
  const today = localStamp().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  const weekday = (date: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)).replace('.', '');
  return <section className="panel"><div className="panel-head"><div><h2>Sobreaviso da hemodinâmica</h2><p>Hemodinamicista acionado nas urgências de cada dia. A urgência já abre com o médico de sobreaviso.</p></div></div>
    <div className="hemo-oncall">{days.map(date => <label key={date} className={date === today ? 'is-today' : ''}><span>{weekday(date)} · {shortDate(date).slice(0, 5)}{date === today ? ' · hoje' : ''}</span><select value={onCallFor(data, date)} onChange={e => update(d => setOnCall(d, date, e.target.value))}><option value="">Sem sobreaviso</option>{data.doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>)}</div>
  </section>;
}

// ---------------- Pedido de reposição ----------------
export function ReplenishmentOrders({ data, stock }: { data: HemoData; stock: DemoData }) {
  const orders = replenishmentOrders(data, stock), [copied, setCopied] = useState('');
  return <section className="panel"><div className="panel-head"><div><h2>Pedido de reposição sugerido</h2><p>Por fornecedor: consignados usados em pacientes e ainda não repostos, e consignados abaixo do mínimo. Nada é enviado; copie ou imprima para mandar ao fornecedor.</p></div><span className="count-label">{orders.length} fornecedor(es)</span></div>
    {orders.length === 0 ? <p className="empty-state">Nenhuma reposição a pedir.</p> : <div className="hemo-orders">{orders.map(o => <article key={o.supplier} className="hemo-order"><header><Truck size={16}/><strong>{o.supplier}</strong></header>
      <ul>{o.items.map(l => <li key={l.product.id}><strong>{l.quantity} ×</strong> {l.product.name}<small>{[l.usedInPatients && `${l.usedInPatients} usado(s) em paciente`, l.belowMinimum && `${l.belowMinimum} para voltar ao mínimo`].filter(Boolean).join(' · ')}</small></li>)}</ul>
      <div className="head-actions"><button className="button secondary" onClick={() => copy(o.text, ok => setCopied(ok ? o.supplier : ''))}><ClipboardCopy size={15}/> {copied === o.supplier ? 'Copiado' : 'Copiar pedido'}</button><button className="button secondary" onClick={() => printText(`Pedido · ${o.supplier}`, o.text)}><Printer size={15}/> Imprimir</button></div>
    </article>)}</div>}
  </section>;
}

// ---------------- Indicadores clínicos ----------------
export function ClinicalIndicators({ data }: { data: HemoData }) {
  const ind = clinicalIndicators(data);
  return <>
    <section className="panel"><div className="panel-head"><div><h2>Porta-balão por etapas</h2><p>Mediana de cada etapa nas urgências registradas: mostra onde o tempo se perde.</p></div></div>
      <table className="hemo-table"><thead><tr><th>Etapa</th><th>Mediana</th><th>Urgências com o dado</th></tr></thead><tbody>{ind.timeline.map(s => <tr key={s.label}><td>{s.label}{s.target ? <small className="hemo-code">meta {s.target} min</small> : null}</td><td className={s.target && s.median !== null && s.median > s.target ? 'is-low' : ''}>{s.median === null ? '—' : `${s.median} min`}</td><td>{s.cases}</td></tr>)}</tbody></table>
    </section>
    <div className="hemo-kpis">
      <div><span>Creatinina de controle</span><strong>{ind.renal.done}/{ind.renal.programmed}</strong><small>feitas / programadas após contraste</small></div>
      <div><span>Lesão renal pelo contraste</span><strong className={ind.renal.aki ? 'is-bad' : ''}>{ind.renal.aki}</strong><small>critério KDIGO na creatinina de controle</small></div>
      <div><span>Termos assinados na tela</span><strong>{ind.consentSigned}</strong><small>com assinatura guardada no caso</small></div>
      <div><span>Orientação de alta entregue</span><strong>{ind.dischargeDelivered}</strong><small>registrada como explicada ao paciente</small></div>
    </div>
  </>;
}

/** Pendências de creatinina para a aba Acompanhamento. */
export function RenalRecheckList(ctx: Props & { pending: { c: HemoCase; days: number }[] }) {
  const { data, update, pending } = ctx;
  if (!pending.length) return null;
  return <section className="panel"><div className="panel-head"><div><h2>Creatinina após contraste</h2><p>Controle entre 48 e 72 h nos pacientes com risco renal ou contraste acima do limite sugerido.</p></div><span className="count-label">{pending.filter(x => x.days < 0).length} atrasada(s)</span></div>
    <div className="hemo-followups">{pending.map(({ c, days }) => <div key={c.id} className="hemo-followup"><header><strong>{patientOf(data, c).name}</strong><span className={`appointment-status ${days < 0 ? 'status-cancelled' : days === 0 ? 'status-waiting' : 'status-scheduled'}`}>{days < 0 ? `atrasada ${-days} dia(s)` : days === 0 ? 'hoje' : `em ${days} dia(s)`}</span></header><small>contraste {c.intra.contrastMl} mL{c.renal.contrastLimitMl !== null ? ` · limite sugerido ${c.renal.contrastLimitMl} mL` : ''}{c.renal.baselineEgfr !== null ? ` · TFG ${c.renal.baselineEgfr}` : ''}</small><RenalRecheckStep update={update} c={c}/></div>)}</div>
  </section>;
}
