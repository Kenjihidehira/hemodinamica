import { useState } from 'react';
import { Activity, AlertTriangle, ArrowRightLeft, ClipboardCopy, Moon, Printer, Trash2, Wrench } from 'lucide-react';
import { blockReasons, blockSpan, localStamp, rhythms, sedationLevels, type HemoCase, type HemoData, type RoomBlock, type Vital } from './domain';
import { addRoomBlock, addVital, blockConflicts, blockProblem, endRoomBlock, handoffDraft, removeVital, saveHandoff, saveSedation, VITAL_REFERENCE, vitalFlags, type BlockInput } from './care';
import { dateTime, when, type Update } from './ui';
import { patientOf } from './domain';
import { type DemoData } from '../data';

const optional = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'));

/** Sinais vitais com horário: na sala e na recuperação. Medidas fora da faixa de referência ficam destacadas. */
export function VitalsPanel({ update, c }: { update: Update; c: HemoCase }) {
  const blank = () => ({ at: localStamp(), sbp: '', dbp: '', hr: '', spo2: '', rr: '', rhythm: '' as Vital['rhythm'] });
  const [v, setV] = useState(blank);
  const empty = !v.sbp && !v.dbp && !v.hr && !v.spo2 && !v.rr;
  const field = (k: 'sbp' | 'dbp' | 'hr' | 'spo2' | 'rr', label: string, min: number, max: number) => <label>{label}<input type="number" inputMode="numeric" min={min} max={max} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })}/></label>;
  function save() {
    if (update(d => addVital(d, c.id, { at: v.at, sbp: optional(v.sbp), dbp: optional(v.dbp), hr: optional(v.hr), spo2: optional(v.spo2), rr: optional(v.rr), rhythm: v.rhythm }))) setV(blank());
  }
  return <div className="hemo-vitals">
    <h4><Activity size={15}/> Sinais vitais</h4>
    <p className="field-hint">Registre a cada medida. Fora da faixa de referência do serviço (PAS {VITAL_REFERENCE.sbp[0]}–{VITAL_REFERENCE.sbp[1]}, FC {VITAL_REFERENCE.hr[0]}–{VITAL_REFERENCE.hr[1]}, SpO₂ ≥ {VITAL_REFERENCE.spo2[0]}%, FR {VITAL_REFERENCE.rr[0]}–{VITAL_REFERENCE.rr[1]}) a medida fica destacada; a conduta é da equipe.</p>
    <div className="hemo-vital-form">
      <label className="hemo-vital-time">Horário<input type="datetime-local" value={v.at} onChange={e => setV({ ...v, at: e.target.value })}/></label>
      {field('sbp', 'PAS', 40, 300)}{field('dbp', 'PAD', 20, 200)}{field('hr', 'FC', 20, 250)}{field('spo2', 'SpO₂ %', 50, 100)}{field('rr', 'FR', 4, 60)}
      <label className="hemo-vital-rhythm">Ritmo<select value={v.rhythm} onChange={e => setV({ ...v, rhythm: e.target.value as Vital['rhythm'] })}><option value="">—</option>{rhythms.map(r => <option key={r}>{r}</option>)}</select></label>
      <button className="button secondary" disabled={empty} onClick={save}>Registrar</button>
    </div>
    {c.vitals.length > 0 && <table className="hemo-table hemo-vital-table"><thead><tr><th>Horário</th><th>Etapa</th><th>PA</th><th>FC</th><th>SpO₂</th><th>FR</th><th>Ritmo</th><th aria-label="Ações"/></tr></thead>
      <tbody>{c.vitals.map(x => { const flags = vitalFlags(x); return <tr key={x.id} className={flags.length ? 'is-flagged' : ''} title={flags.join('; ')}>
        <td>{x.at.slice(11)}</td><td>{x.phase}</td>
        <td>{x.sbp !== null ? `${x.sbp}/${x.dbp}` : '—'}</td><td>{x.hr ?? '—'}</td><td>{x.spo2 !== null ? `${x.spo2}%` : '—'}</td><td>{x.rr ?? '—'}</td><td>{x.rhythm || '—'}</td>
        <td>{['Sala', 'Recuperação'].includes(c.stage) && <button className="icon-button" aria-label={`Remover medida das ${x.at.slice(11)}`} onClick={() => update(d => removeVital(d, c.id, x.id))}><Trash2 size={14}/></button>}</td>
      </tr>; })}</tbody></table>}
    {c.vitals.some(x => vitalFlags(x).length) && <ul className="hemo-alerts">{c.vitals.flatMap(x => vitalFlags(x).map(f => <li key={x.id + f} className="is-warn"><AlertTriangle size={14}/>{x.at.slice(11)} · {f}</li>))}</ul>}
  </div>;
}

/** Nível de sedação e quem conduziu. Os sedativos ficam em Medicamentos na sala. */
export function SedationPanel({ update, c }: { update: Update; c: HemoCase }) {
  const [s, setS] = useState(c.sedation);
  const dirty = JSON.stringify(s) !== JSON.stringify(c.sedation);
  return <div className="hemo-sedation">
    <h4><Moon size={15}/> Sedação</h4>
    <div className="hemo-inline-form">
      <label>Nível<select value={s.level} onChange={e => setS({ ...s, level: e.target.value as HemoCase['sedation']['level'] })}><option value="">Selecione</option>{sedationLevels.map(l => <option key={l}>{l}</option>)}</select></label>
      {s.level && s.level !== 'Sem sedação' && <label className="grow">Conduzida por<input value={s.responsible} onChange={e => setS({ ...s, responsible: e.target.value })} placeholder="Ex.: Dr. anestesista de plantão"/></label>}
      <label className="grow">Observação<input value={s.notes} onChange={e => setS({ ...s, notes: e.target.value })} placeholder="Opcional"/></label>
      <button className="button secondary" disabled={!dirty || !s.level} onClick={() => update(d => saveSedation(d, c.id, s))}>Salvar sedação</button>
    </div>
    <small className="field-hint">Os sedativos e as doses ficam em Medicamentos na sala.</small>
  </div>;
}

/** Resumo para a equipe da unidade de destino, montado com o que foi registrado e editável antes de registrar. */
export function HandoffPanel({ data, update, stock, c, destination }: { data: HemoData; update: Update; stock: DemoData; c: HemoCase; destination: string }) {
  const [text, setText] = useState(c.handoff.text || handoffDraft(data, stock.products, c, destination));
  const [receivedBy, setReceivedBy] = useState(c.handoff.receivedBy), [copied, setCopied] = useState(false);
  if (c.handoff.at) return <details className="hemo-signed hemo-handoff"><summary><ArrowRightLeft size={15}/> Passagem de plantão · {c.handoff.unit} · recebido por {c.handoff.receivedBy} em {dateTime(c.handoff.at)}</summary><p className="hemo-report-text">{c.handoff.text}</p></details>;
  return <details className="hemo-signed hemo-handoff" open={!!destination && destination !== 'Alta no mesmo dia'}><summary><ArrowRightLeft size={15}/> Passagem de plantão{destination ? ` · ${destination}` : ''} · não registrada</summary>
    <p className="field-hint">Resumo no formato situação, história, avaliação e o que vigiar, montado com o que foi registrado. Revise e complete antes de registrar. Prazos e condutas seguem o protocolo e a prescrição.</p>
    <div className="head-actions"><button className="text-link" onClick={() => { if (!text.trim() || window.confirm('Substituir o texto pelo resumo atualizado com os registros mais recentes?')) setText(handoffDraft(data, stock.products, c, destination)); }}>Atualizar com os registros mais recentes</button></div>
    <label>Resumo<textarea rows={16} value={text} onChange={e => setText(e.target.value)}/></label>
    <div className="hemo-inline-form">
      <label className="grow">Recebido por (nome e função)<input value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Ex.: Enf. Paula, UTI coronariana"/></label>
      <button className="button secondary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }}><ClipboardCopy size={15}/> {copied ? 'Copiado' : 'Copiar'}</button>
      <button className="button secondary" onClick={() => { const w = window.open('', '_blank', 'width=720,height=900'); if (!w) return; const pre = w.document.createElement('pre'); pre.textContent = text; pre.style.cssText = 'font: 14px/1.55 Arial, sans-serif; white-space: pre-wrap; margin: 32px;'; w.document.title = 'Passagem de plantão'; w.document.body.appendChild(pre); w.focus(); w.print(); }}><Printer size={15}/> Imprimir</button>
      <button className="button primary" disabled={!destination || receivedBy.trim().length < 3} title={!destination ? 'Escolha o destino do paciente' : receivedBy.trim().length < 3 ? 'Informe quem recebeu' : ''} onClick={() => update(d => saveHandoff(d, c.id, { text, receivedBy, unit: destination }))}><ArrowRightLeft size={15}/> Registrar passagem</button>
    </div>
  </details>;
}

/** Bloqueios de sala: manutenção do angiógrafo, calibração, limpeza terminal. */
export function RoomBlocksPanel({ data, update }: { data: HemoData; update: Update }) {
  const now = localStamp();
  const blank = (): BlockInput => ({ roomId: data.rooms[0]?.id ?? '', start: now, end: '', reason: 'Manutenção preventiva', notes: '' });
  const [form, setForm] = useState<BlockInput>(blank);
  const problem = form.end ? blockProblem(data, form) : 'Informe o fim do bloqueio.';
  const affected = form.end && !problem ? blockConflicts(data, form) : [];
  const current = data.roomBlocks.filter(b => b.end > now), past = data.roomBlocks.filter(b => b.end <= now).slice(-5).reverse();
  const roomName = (b: RoomBlock) => data.rooms.find(r => r.id === b.roomId)?.name ?? 'Sala removida';
  return <section className="panel"><div className="panel-head"><div><h2>Bloqueios de sala</h2><p>Manutenção do angiógrafo, calibração ou limpeza terminal. No período, a sala não aparece para agendamento nem para urgência, e o tempo parado entra em Ocupação e custos.</p></div><span className="count-label"><Wrench size={13}/> {current.length} ativo(s) ou futuro(s)</span></div>
    <div className="hemo-block-form">
      <label>Sala<select value={form.roomId} onChange={e => setForm({ ...form, roomId: e.target.value })}>{data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Início<input type="datetime-local" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}/></label>
      <label>Fim<input type="datetime-local" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}/></label>
      <label>Motivo<select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value as BlockInput['reason'] })}>{blockReasons.map(r => <option key={r}>{r}</option>)}</select></label>
      <label className="grow">Observação{form.reason === 'Outro' ? ' (obrigatória)' : ''}<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Ex.: troca do tubo de raios X, chamado 4471"/></label>
      <button className="button primary" disabled={!!problem} title={problem} onClick={() => { if (update(d => addRoomBlock(d, form))) setForm(blank()); }}><Wrench size={15}/> Bloquear sala</button>
    </div>
    {form.end && problem && <p className="field-hint hemo-block-hint">{problem}</p>}
    {affected.length > 0 && <ul className="hemo-alerts"><li className="is-warn"><AlertTriangle size={15}/>{affected.length} eletivo(s) marcado(s) neste período precisarão ser remarcados: {affected.map(c => `${patientOf(data, c).name} (${when(c.schedule!.start)})`).join(', ')}.</li></ul>}
    {current.length === 0 ? <p className="empty-state">Nenhuma sala bloqueada agora ou no futuro.</p> : <ul className="hemo-blocks">{current.map(b => { const conflicts = blockConflicts(data, b); return <li key={b.id} className={b.start <= now ? 'is-active' : ''}>
      <span><strong>{roomName(b)}</strong> · {b.reason}<small>{blockSpan(b)}{b.start <= now ? ' · em andamento' : ''}{b.notes ? ` · ${b.notes}` : ''}{conflicts.length ? ` · ${conflicts.length} eletivo(s) a remarcar: ${conflicts.map(c => patientOf(data, c).name).join(', ')}` : ''}</small></span>
      <button className="text-link" onClick={() => { if (window.confirm(b.start <= now ? 'Liberar a sala agora? O tempo parado até aqui continua registrado.' : 'Cancelar este bloqueio futuro?')) update(d => endRoomBlock(d, b.id)); }}>{b.start <= now ? 'Liberar sala agora' : 'Cancelar bloqueio'}</button>
    </li>; })}</ul>}
    {past.length > 0 && <details className="hemo-cost-cases"><summary>Bloqueios encerrados recentes</summary><ul className="hemo-blocks">{past.map(b => <li key={b.id}><span><strong>{roomName(b)}</strong> · {b.reason}<small>{blockSpan(b)}{b.notes ? ` · ${b.notes}` : ''}</small></span></li>)}</ul></details>}
  </section>;
}

/** Faixa do bloqueio dentro da agenda do dia de cada sala. */
export function DayBlocks({ data, roomId, day }: { data: HemoData; roomId: string; day: string }) {
  const blocks = data.roomBlocks.filter(b => b.roomId === roomId && b.start < `${day}T23:59` && `${day}T00:00` < b.end);
  return <>{blocks.map(b => <div key={b.id} className="hemo-room-slot hemo-room-blocked"><span className="appointment-time">{b.start.slice(0, 10) < day ? '00:00' : b.start.slice(11)}<small>até {b.end.slice(0, 10) > day ? '24:00' : b.end.slice(11)}</small></span><span className="appointment-person"><strong><Wrench size={13}/> Sala bloqueada</strong><small>{b.reason}{b.notes ? ` · ${b.notes}` : ''}</small></span><span className="appointment-status status-cancelled">Bloqueio</span></div>)}</>;
}

/** Linha da sedação e da passagem de plantão no laudo assinado e nas etapas finais. */
export function CareSummary({ c }: { c: HemoCase }) {
  if (!c.sedation.level && !c.vitals.length) return null;
  return <p><strong>Sedação:</strong> {c.sedation.level || 'não registrada'}{c.sedation.responsible ? ` (${c.sedation.responsible})` : ''} · <strong>Sinais vitais:</strong> {c.vitals.length} medida(s){c.vitals.some(v => vitalFlags(v).length) ? ', com valores fora da faixa de referência' : ''}</p>;
}
