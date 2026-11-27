import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Check, ChevronLeft, Columns3, Copy, FileText, List, Plug, Plus, RotateCcw, Search, Siren, Sparkles, X } from 'lucide-react';
import {
  accessRoutes, addMinutes, ageAt, allGlosas, appealGlosa, billingItems, cancelCase, closeBilling, consumeMaterial, copilotContext, decideAuthorization, destinations, displacedBy, doorToBalloon,
  DOOR_TO_BALLOON_TARGET_MIN, doseAlerts, finishProcedure, finishRecovery, flowStages, followUpOutcomes, freeStarts, hemoIndicators, hemoMaterials, implantsOf, intraProblem, isOpme, localStamp,
  materialAlerts, minutesOf, occupancy, opmeGaps, patientOf, pendingFollowUps, pendingRenalRechecks, pendingReplenishment, prepItems, contrastWarning, renalProfile, CONTRAST_EGFR_RATIO, prepMessage, prepMissing, productOf, receiveReplenishment, recordFollowUp,
  registerGlosa, regularizeAuthorization, requestCase, resolveGlosa, returnMaterial, safetyAlerts, saveOpme, saveReport, savePrep, scheduleCase, signReport, SKIN_DOSE_FOLLOWUP_MGY, startEmergency,
  startProcedure, timeoutItems, tissPreview, traceLot, typeOf, usableLots, cancelCategories, blockOverlapping, type CancelCategory,
  type Finding, type FollowUpOutcome, type Glosa, type HemoCase, type HemoData, type Intra, type PrepChecks, type Recovery, type Stage, type TimeoutChecks, type WithStock,
} from './domain';
import { askCopilot, copilotStatus, type Answer, type Briefing } from './copilot';
import { type HemoStore } from './useHemo';
import { onCallFor, renalStages } from './clinical';
import { BandPanel, ClinicalIndicators, ConsentPanel, DischargePanel, ImagingPanel, MedsPanel, OnCallPanel, RenalLine, RenalRecheckList, RenalRecheckStep, ReplenishmentOrders, UrgencyTimeline } from './ClinicalPanels';
import { ComplicationsField, FindingEditor, PressuresField, StructuredIndicators } from './ReportPanels';
import { CaseCostLine, Operations, type Actor } from './OperationsPanel';
import { CareSummary, DayBlocks, HandoffPanel, RoomBlocksPanel, SedationPanel, VitalsPanel } from './CarePanels';
import { needsHandoff } from './care';
import { ContrastCounter, IdentityPanel, MaterialScan, ReconciliationPanel } from './SafetyPanels';
import { DoctorQuality, ForecastPanel, MonthlyReport, MyTasks, PublicBoardButton, TimeAlertsBar } from './TeamPanels';
import { tasksFor } from './team';
import { complicationText, describeFinding, emptyFinding, findingProblem, normalizeFinding, pressureText, structuredReportText } from './report';
import { dateTime, when, type Props, type Update } from './ui';
import { availableQuantity, type DemoData } from '../data';
import '../hospital/hospital.css';
import './hemo.css';
/** Cor fixa por etapa (mesma na lista, no quadro e na ficha), como nos painéis de status de sala. */
const stageKey: Record<Stage, string> = { Autorização: 'auth', Agendamento: 'sched', Preparo: 'prep', Sala: 'room', Recuperação: 'recov', Laudo: 'report', Faturamento: 'bill', Encerrado: 'done', Cancelado: 'cancel' };
function StageBadge({ stage }: { stage: Stage }) { return <span className={`stage-badge stage-${stageKey[stage]}`}>{stage}</span>; }
/** Tempo na etapa atual quando há relógio correndo: em sala desde a entrada, na recuperação desde o fim do procedimento. */
function stageClock(c: HemoCase, now: string) {
  const since = c.stage === 'Sala' ? c.intra.roomIn : c.stage === 'Recuperação' ? c.intra.end : '';
  if (!since) return '';
  const min = Math.max(0, minutesOf(now) - minutesOf(since));
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}

export default function HemoWorkspace({ store, stock, onStockChange, onOpenLot, user, night = false }: { store: HemoStore; stock: DemoData; onStockChange: (next: DemoData) => void; onOpenLot: (stockId: string) => void; user: Actor; night?: boolean }) {
  const [tab, setTab] = useState<'tasks' | 'cases' | 'rooms' | 'materials' | 'claims' | 'followup' | 'indicators' | 'management' | 'invoices' | 'integrations'>('cases');
  /** Abrir um caso vindo de outra aba (tarefas, avisos) ou a urgência pelo botão do plantão noturno. n força remontar a lista. */
  const [focus, setFocus] = useState({ id: '', emergency: false, n: 0 });
  const openCase = (id: string) => { setTab('cases'); setFocus(f => ({ id, emergency: false, n: f.n + 1 })); window.scrollTo({ top: 0 }); };
  const openEmergency = () => { setTab('cases'); setFocus(f => ({ id: '', emergency: true, n: f.n + 1 })); window.scrollTo({ top: 0 }); };
  const { data, update, error } = store;
  if (!data) return <section className="panel module-form"><h2>Hemodinâmica indisponível</h2><p role="alert">{error}</p><button className="button secondary" onClick={() => { if (window.confirm('Apagar os dados salvos da hemodinâmica e voltar à demonstração?')) store.reset(); }}>Restaurar demonstração</button></section>;
  function commitBoth(change: (hemo: HemoData, stock: DemoData) => WithStock) {
    let next = null as DemoData | null;
    const ok = update(current => { const result = change(current, stock); next = result.stock; return result.hemo; });
    if (ok && next) onStockChange(next);
    return ok;
  }
  const ctx: Props = { data, update, stock, commitBoth, onOpenLot };
  const pending = pendingReplenishment(data, stock.products).length, alerts = materialAlerts(stock).length;
  const openGlosas = allGlosas(data).filter(x => x.g.status === 'Aberta').length, overdue = pendingFollowUps(data).filter(x => x.days < 0).length + pendingRenalRechecks(data).filter(x => x.days < 0).length;
  const n = (count: number) => count ? ` (${count})` : '';
  const myTasks = tasksFor(user.role, data).length;
  const tabs = [['tasks', `Minhas tarefas${n(myTasks)}`], ['cases', 'Procedimentos'], ['rooms', 'Salas do dia'], ['materials', `Materiais${n(alerts + pending)}`], ['claims', `Convênios e glosas${n(openGlosas)}`], ['followup', `Acompanhamento${n(overdue)}`], ['indicators', 'Indicadores'], ['management', 'Ocupação e custos'], ['invoices', 'Notas fiscais'], ['integrations', 'Integrações']] as const;
  return <div className="hospital-workspace hemo-workspace module-stack">
    <div className="hospital-local-note"><strong>Demonstração</strong><span>Pacientes fictícios, dados só neste navegador. Notas fiscais e integrações simuladas.</span><button type="button" className="text-link" onClick={() => { if (window.confirm('Restaurar os procedimentos e materiais de demonstração? O que foi feito neste navegador será apagado.')) store.reset(); }}><RotateCcw size={13}/> Restaurar demonstração</button></div>
    {error && <div className="module-error" role="alert">{error}<button type="button" className="message-close" aria-label="Fechar aviso" onClick={store.clearError}><X size={16}/></button></div>}
    <div className="module-tabs hospital-tabs" role="group" aria-label="Hemodinâmica">{tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={e => { setTab(id); store.clearError(); revealTab(e.currentTarget); }}>{label}</button>)}</div>
    <TimeAlertsBar data={data} onOpen={openCase}/>
    {tab === 'tasks' && <MyTasks data={data} role={user.role} onOpen={openCase}/>}
    {tab === 'cases' && <Cases key={focus.n} {...ctx} focusId={focus.id} startEmergency={focus.emergency}/>}
    {tab === 'rooms' && <><div className="hemo-tab-actions"><PublicBoardButton/></div><Rooms data={data}/><RoomBlocksPanel data={data} update={update}/><OnCallPanel data={data} update={update}/></>}
    {tab === 'materials' && <><Materials {...ctx}/><ForecastPanel data={data} stock={stock}/></>}
    {tab === 'claims' && <Claims {...ctx}/>}
    {tab === 'followup' && <FollowUps {...ctx}/>}
    {tab === 'indicators' && <><MonthlyReport data={data} stock={stock}/><DoctorQuality data={data} user={user}/><Indicators {...ctx}/></>}
    {tab === 'management' && <Operations {...ctx} user={user}/>}
    {tab === 'invoices' && <Invoices data={data}/>}
    {tab === 'integrations' && <Integrations/>}
    {night && <button type="button" className="hemo-night-urgent" onClick={openEmergency}><Siren size={20}/> Urgência</button>}
  </div>;
}

// ---------------- Procedimentos ----------------
function Cases({ focusId = '', startEmergency = false, ...ctx }: Props & { focusId?: string; startEmergency?: boolean }) {
  const { data } = ctx;
  const focused = data.cases.find(c => c.id === focusId);
  const [filter, setFilter] = useState<Stage | 'Em andamento' | 'Todos'>(focused && ['Encerrado', 'Cancelado'].includes(focused.stage) ? 'Todos' : 'Em andamento');
  /** Em telas estreitas lista e ficha se alternam (mestre-detalhe); por isso nada abre selecionado. */
  const [selectedId, setSelectedId] = useState(focused ? focused.id : startEmergency || narrowLayout() ? '' : data.cases.find(c => c.stage === 'Laudo')?.id ?? data.cases[0]?.id ?? '');
  const [creating, setCreating] = useState<'' | 'elective' | 'emergency'>(startEmergency ? 'emergency' : '');
  const [query, setQuery] = useState('');
  const active = (c: HemoCase) => !['Encerrado', 'Cancelado'].includes(c.stage);
  const term = query.trim().toLocaleLowerCase('pt-BR');
  const list = data.cases.filter(c => filter === 'Todos' || (filter === 'Em andamento' ? active(c) : c.stage === filter))
    .filter(c => !term || `${patientOf(data, c).name} ${typeOf(data, c).name} ${c.authorization.guide}`.toLocaleLowerCase('pt-BR').includes(term));
  function select(id: string) { setSelectedId(id); setCreating(''); if (narrowLayout()) window.scrollTo({ top: 0 }); }
  function back() { setSelectedId(''); setCreating(''); }
  /** Setas ↑/↓ percorrem a lista e já abrem o caso, como nas listas de pacientes dos prontuários. */
  function listKeys(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.appointment-row')];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus(); next.click();
  }
  const selected = data.cases.find(c => c.id === selectedId);
  const count = (s: Stage) => data.cases.filter(c => c.stage === s).length;
  const [view, setView] = useState<'list' | 'board'>(() => { if (focusId || startEmergency) return 'list'; try { return localStorage.getItem('hemo-cases-view') === 'board' ? 'board' : 'list'; } catch { return 'list'; } });
  const now = useNow();
  function changeView(next: 'list' | 'board') { setView(next); try { localStorage.setItem('hemo-cases-view', next); } catch { /* preferência só desta sessão */ } }
  function open(id: string) { select(id); changeView('list'); }
  const actions = <div className="head-actions"><button className="button hemo-urgent" onClick={() => { setCreating('emergency'); setSelectedId(''); changeView('list'); }}><Siren size={16}/> Urgência</button><button className="button primary" onClick={() => { setCreating('elective'); setSelectedId(''); changeView('list'); }}><Plus size={16}/> Novo pedido</button></div>;
  const detailOpen = !!(selected || creating);
  return <>
    <div className="hemo-cases-bar">
      {view === 'list' ? <div className="hemo-pipeline" role="group" aria-label="Procedimentos por etapa">
        {(['Em andamento', ...flowStages, 'Cancelado', 'Todos'] as const).map(s => { const n = s === 'Todos' ? data.cases.length : s === 'Em andamento' ? data.cases.filter(active).length : count(s); return <button key={s} type="button" aria-pressed={filter === s} onClick={e => { setFilter(s); revealTab(e.currentTarget); if (narrowLayout()) back(); }}><span>{s}</span><strong>{n}</strong></button>; })}
      </div> : <p className="hemo-board-note">Casos em andamento por etapa. Selecione um cartão para abrir a ficha.</p>}
      <div className="hemo-view-toggle" role="group" aria-label="Forma de exibição"><button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}><List size={15}/> Lista</button><button type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}><Columns3 size={15}/> Quadro</button></div>
    </div>
    {view === 'board' ? <CaseBoard data={data} now={now} onOpen={open} actions={actions}/> :
    <div className={`hemo-layout ${detailOpen ? 'with-detail' : ''}`}>
      <section className="panel hemo-list" onKeyDown={listKeys}>
        <div className="panel-head"><div><h2>Procedimentos</h2><p aria-live="polite">{list.length} {list.length === 1 ? 'caso' : 'casos'}</p></div>{actions}</div>
        <label className="hemo-list-search"><Search size={15} aria-hidden="true"/><span className="sr-only">Buscar procedimento</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Paciente, procedimento ou guia"/>{query && <button type="button" className="icon-button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={14}/></button>}</label>
        {list.length === 0 && <p className="empty-state">{term ? 'Nenhum caso encontrado para essa busca.' : 'Nenhum procedimento nesta etapa.'}</p>}
        {list.map(c => { const p = patientOf(data, c), clock = stageClock(c, now); return <button key={c.id} type="button" className={`appointment-row ${c.id === selectedId ? 'is-selected' : ''} ${c.priority === 'Urgência' ? 'is-urgent' : ''}`} aria-current={c.id === selectedId ? 'true' : undefined} onClick={() => select(c.id)}>
          <span className="appointment-time">{c.schedule ? c.schedule.start.slice(11, 16) : '—'}<small>{c.schedule ? when(c.schedule.start).slice(0, 5) : 'sem data'}</small></span>
          <span className="appointment-person"><strong>{p.name}</strong><small>{typeOf(data, c).name}</small>{c.priority === 'Urgência' && <span className="hemo-urgent-tag">urgência</span>}</span>
          <span className="appointment-stage"><StageBadge stage={c.stage}/>{clock && <small className="stage-clock">há {clock}</small>}</span>
        </button>; })}
      </section>
      {detailOpen && <button type="button" className="hemo-back" onClick={back}><ChevronLeft size={17}/> Procedimentos</button>}
      {creating === 'elective' && <NewCase {...ctx} onDone={id => { setCreating(''); if (id) { setSelectedId(id); setFilter('Em andamento'); } }}/>}
      {creating === 'emergency' && <NewEmergency {...ctx} onDone={id => { setCreating(''); if (id) { setSelectedId(id); setFilter('Em andamento'); } }}/>}
      {selected && !creating && <CaseSheet key={selected.id} {...ctx} c={selected}/>}
    </div>}
  </>;
}

/** Mesmo corte do CSS (hemo.css, 1100 px): abaixo dele lista e ficha não cabem lado a lado. */
const narrowLayout = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches;
/** Mantém a aba ou o filtro escolhido visível quando a faixa rola na horizontal (celular). */
function revealTab(el: HTMLElement) { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }

/** Hora local atualizada a cada 30 s, para os relógios de etapa. */
function useNow() {
  const [now, setNow] = useState(localStamp);
  useEffect(() => { const id = window.setInterval(() => setNow(localStamp()), 30000); return () => window.clearInterval(id); }, []);
  return now;
}

/** Quadro de status (estilo painel de sala): uma coluna por etapa ativa, cartões compactos com sala, horário e tempo na etapa. */
function CaseBoard({ data, now, onOpen, actions }: { data: HemoData; now: string; onOpen: (id: string) => void; actions: React.ReactNode }) {
  const columns: Stage[] = flowStages.filter(s => s !== 'Encerrado');
  return <section className="panel hemo-board-panel">
    <div className="panel-head"><div><h2>Quadro de procedimentos</h2><p>{data.cases.filter(c => columns.includes(c.stage)).length} em andamento</p></div>{actions}</div>
    <div className="hemo-board">{columns.map(stage => { const items = data.cases.filter(c => c.stage === stage).sort((a, b) => (a.priority === 'Urgência' ? -1 : 0) - (b.priority === 'Urgência' ? -1 : 0) || (a.schedule?.start ?? '9').localeCompare(b.schedule?.start ?? '9')); return <div key={stage} className={`hemo-board-col stage-${stageKey[stage]} ${items.length ? '' : 'is-empty'}`}>
      <h3><span>{stage}</span><strong>{items.length}</strong></h3>
      {items.length === 0 && <p className="hemo-board-empty">—</p>}
      {items.map(c => { const p = patientOf(data, c), clock = stageClock(c, now), room = c.schedule ? data.rooms.find(r => r.id === c.schedule!.roomId)?.name.split(' · ')[0] : ''; return <button key={c.id} type="button" className={`hemo-card ${c.priority === 'Urgência' ? 'is-urgent' : ''}`} onClick={() => onOpen(c.id)}>
        <span className="hemo-card-top"><span className="mono">{c.schedule ? `${when(c.schedule.start).slice(0, 5)} ${c.schedule.start.slice(11, 16)}` : 'sem data'}</span>{room && <span>{room}</span>}</span>
        <strong>{p.name}</strong>
        <small>{typeOf(data, c).name}</small>
        {(c.priority === 'Urgência' || clock || p.allergies.length > 0) && <span className="hemo-card-flags">{c.priority === 'Urgência' && <span className="hemo-urgent-tag">urgência</span>}{p.allergies.length > 0 && <span className="hemo-card-allergy" title={p.allergies.join('; ')}><AlertTriangle size={11}/> alergia</span>}{clock && <span className="stage-clock">há {clock}</span>}</span>}
      </button>; })}
    </div>; })}</div>
  </section>;
}

function NewCase({ data, update, onDone }: Props & { onDone: (id?: string) => void }) {
  const [form, setForm] = useState({ patientId: data.patients[0]?.id ?? '', typeId: data.types[0]?.id ?? '', requestedBy: '', indication: '', priority: 'Eletivo' as 'Eletivo' | 'Urgência' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let createdId = '';
    if (update(d => { const next = requestCase(d, form); createdId = next.cases[0].id; return next; })) onDone(createdId);
  }
  return <form className="panel module-form hemo-sheet" onSubmit={submit}>
    <div className="panel-head"><div><h2>Novo pedido de procedimento</h2><p>Pedidos de convênio entram aguardando autorização.</p></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => onDone()}><X size={18}/></button></div>
    <div className="hospital-form-grid">
      <label>Paciente<select value={form.patientId} onChange={set('patientId')}>{data.patients.map(p => <option key={p.id} value={p.id}>{p.name} · {p.insurance}</option>)}</select></label>
      <label>Procedimento<select value={form.typeId} onChange={set('typeId')}>{data.types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.duration} min)</option>)}</select></label>
      <label>Médico solicitante<input value={form.requestedBy} onChange={set('requestedBy')} placeholder="Nome e especialidade"/></label>
      <label>Prioridade<select value={form.priority} onChange={set('priority')}><option>Eletivo</option><option>Urgência</option></select></label>
    </div>
    <label>Indicação clínica<textarea rows={3} value={form.indication} onChange={set('indication')}/></label>
    <div className="head-actions"><button className="button primary" type="submit"><Check size={16}/> Registrar pedido</button></div>
  </form>;
}

function NewEmergency({ data, update, onDone }: Props & { onDone: (id?: string) => void }) {
  const onCall = onCallFor(data, localStamp().slice(0, 10));
  const [form, setForm] = useState({ patientId: data.patients[0]?.id ?? '', typeId: data.types.find(t => t.id === 'iam')?.id ?? data.types[0]?.id ?? '', roomId: data.rooms[0]?.id ?? '', doctorId: onCall || data.doctors[0]?.id || '', requestedBy: 'Pronto-socorro', indication: '', doorAt: localStamp(), ecgAt: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let createdId = '';
    if (update(d => { const next = startEmergency(d, form); createdId = next.cases[0].id; return next; })) onDone(createdId);
  }
  return <form className="panel module-form hemo-sheet hemo-emergency" onSubmit={submit}>
    <div className="panel-head"><div><h2>Urgência</h2><p>Entra direto, com a sala tomada agora. O convênio fica para regularizar depois; o time-out continua obrigatório.</p></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => onDone()}><X size={18}/></button></div>
    <div className="hospital-form-grid">
      <label>Paciente<select value={form.patientId} onChange={set('patientId')}>{data.patients.map(p => <option key={p.id} value={p.id}>{p.name} · {p.insurance}</option>)}</select></label>
      <label>Procedimento<select value={form.typeId} onChange={set('typeId')}>{data.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Sala<select value={form.roomId} onChange={set('roomId')}>{data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Hemodinamicista de sobreaviso<select value={form.doctorId} onChange={set('doctorId')}>{data.doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.id === onCall ? ' · escala de hoje' : ''}</option>)}</select></label>
      <label>Chegada no hospital (porta)<input type="datetime-local" value={form.doorAt} onChange={set('doorAt')}/></label>
      <label>ECG feito às (opcional)<input type="datetime-local" value={form.ecgAt} onChange={set('ecgAt')}/></label>
      <label>Origem<input value={form.requestedBy} onChange={set('requestedBy')}/></label>
    </div>
    <label>Indicação clínica<textarea rows={2} value={form.indication} onChange={set('indication')} placeholder="Ex.: infarto com supra de ST em parede inferior, dor há 2 h"/></label>
    <div className="head-actions"><button className="button hemo-urgent" type="submit"><Siren size={16}/> Abrir urgência</button></div>
  </form>;
}

/** Porta-balão: mostra o tempo decorrido enquanto a artéria não abre e o resultado depois. */
function DoorToBalloon({ c }: { c: HemoCase }) {
  if (c.priority !== 'Urgência' || !c.doorAt) return null;
  const dtb = doorToBalloon(c), elapsed = minutesOf(localStamp()) - minutesOf(c.doorAt);
  const live = dtb === null && ['Preparo', 'Sala'].includes(c.stage);
  const value = dtb ?? (live ? elapsed : null);
  const late = value !== null && value > DOOR_TO_BALLOON_TARGET_MIN;
  return <div className={`hemo-dtb ${late ? 'is-late' : ''}`}><Siren size={16}/><span>Chegada {when(c.doorAt)} · {dtb !== null ? <>porta-balão <strong>{dtb} min</strong></> : live ? <>decorrido <strong>{elapsed} min</strong> desde a chegada</> : 'sem horário de abertura da artéria'} · meta até {DOOR_TO_BALLOON_TARGET_MIN} min</span></div>;
}

/** Faixa de identificação do paciente, como nos prontuários eletrônicos: campos rotulados e alergia sempre visível. */
function PatientBanner({ p, c }: { p: ReturnType<typeof patientOf>; c: HemoCase }) {
  const [y, m, d] = p.birthDate.split('-');
  const fields: [string, string, boolean?][] = [
    ['Nasc.', `${d}/${m}/${y} (${ageAt(p.birthDate)} a)`],
    ['Sexo', p.sex === 'F' ? 'Feminino' : 'Masculino'],
    ['Prontuário', p.id.toUpperCase(), true],
    ['Convênio', p.insurance],
    ...(c.authorization.guide ? [['Guia', c.authorization.guide, true] as [string, string, boolean]] : []),
    ...(p.weightKg ? [['Peso', `${p.weightKg} kg`] as [string, string]] : []),
  ];
  return <header className={`hemo-banner ${c.priority === 'Urgência' ? 'is-urgent' : ''}`}>
    <div className="hemo-banner-top">
      <h2>{p.name.toLocaleUpperCase('pt-BR')}</h2>
      {c.priority === 'Urgência' && <span className="hemo-flag is-urgent">Urgência</span>}
      <StageBadge stage={c.stage}/>
    </div>
    <dl>{fields.map(([k, v, mono]) => <div key={k}><dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd></div>)}</dl>
    <p className={`hemo-flag ${p.allergies.length ? 'is-allergy' : 'is-clear'}`}>{p.allergies.length ? <><AlertTriangle size={13}/> Alergia: {p.allergies.join('; ')}</> : 'Sem alergias registradas'}</p>
  </header>;
}

function CaseSheet(props: Props & { c: HemoCase }) {
  const { data, update, stock, c } = props;
  const p = patientOf(data, c), t = typeOf(data, c), alerts = [...safetyAlerts(data, c), ...(c.intra.end ? doseAlerts(data, c).alerts : [])];
  const displaced = displacedBy(data, c);
  const history = data.audit.filter(a => a.caseId === c.id);
  const [cancelling, setCancelling] = useState(false), [reason, setReason] = useState(''), [cancelCategory, setCancelCategory] = useState<CancelCategory | ''>('');
  const doneIndex = flowStages.indexOf(c.stage);
  return <section className="panel hemo-sheet" aria-label={`Procedimento de ${p.name}`}>
    <PatientBanner p={p} c={c}/>
    <p className="hemo-procedure"><strong>{t.name}</strong> · {c.priority}{c.schedule ? ` · ${when(c.schedule.start)} · ${data.rooms.find(r => r.id === c.schedule!.roomId)?.name} · ${data.doctors.find(d => d.id === c.schedule!.doctorId)?.name}` : ''}<br/><small>{c.indication} Solicitado por {c.requestedBy}.</small></p>
    {c.stage !== 'Cancelado' && <ol className="hemo-stepper" aria-label="Etapas do procedimento">{flowStages.map((s, i) => <li key={s} title={s} className={i < doneIndex ? 'is-done' : i === doneIndex ? 'is-current' : ''} aria-current={i === doneIndex ? 'step' : undefined}>{s}</li>)}</ol>}

    <div className="hemo-clinical">
      <div><small>Comorbidades</small><span>{p.conditions.join('; ') || '—'}</span></div>
      <div><small>Medicamentos</small><span>{p.medications.join('; ') || '—'}</span></div>
      <div><small>Creatinina · TFG · peso</small><RenalLine data={data} c={c}/></div>
    </div>
    {alerts.length > 0 && !['Encerrado', 'Cancelado'].includes(c.stage) && <ul className="hemo-alerts">{alerts.map(a => <li key={a.text} className={`is-${a.level === 'alto' ? 'high' : 'warn'}`}><AlertTriangle size={15}/>{a.text}</li>)}</ul>}
    <DoorToBalloon c={c}/>
    {c.stage !== 'Cancelado' && <UrgencyTimeline key={JSON.stringify(c.urgency)} update={update} c={c}/>}
    {displaced.length > 0 && <ul className="hemo-alerts"><li className="is-warn"><AlertTriangle size={15}/><span>A urgência ocupa a sala no horário de: {displaced.map(o => `${patientOf(data, o).name} (${o.schedule!.start.slice(11)})`).join('; ')}. Remarque esses procedimentos.</span></li></ul>}
    {c.authorization.status === 'Regularizar' && <Regularize {...props}/>}

    <div className="hemo-stage">
      {c.stage === 'Autorização' && <AuthorizationStep {...props}/>}
      {(c.stage === 'Agendamento' || (c.stage === 'Preparo' && c.priority !== 'Urgência')) && <ScheduleStep {...props}/>}
      {['Autorização', 'Agendamento'].includes(c.stage) && <ConsentPanel data={data} update={update} c={c}/>}
      {c.stage === 'Preparo' && <PrepStep key={c.consent.signedAt} {...props}/>}
      {c.stage === 'Sala' && <RoomStep {...props}/>}
      {c.stage === 'Recuperação' && <RecoveryStep {...props}/>}
      {renalStages.includes(c.stage) && <RenalRecheckStep update={update} c={c}/>}
      {['Laudo', 'Faturamento', 'Encerrado'].includes(c.stage) && <ReconciliationPanel key={`rec-${c.reconciliation.doneAt}`} data={data} update={update} stock={stock} c={c}/>}
      {['Laudo', 'Faturamento', 'Encerrado'].includes(c.stage) && <DischargePanel key={c.discharge.deliveredAt} data={data} update={update} stock={stock} c={c}/>}
      {c.stage === 'Laudo' && <ReportStep {...props}/>}
      {c.stage === 'Faturamento' && <BillingStep {...props}/>}
      {(c.stage === 'Faturamento' || c.stage === 'Encerrado') && <SignedReport data={data} stock={stock} c={c}/>}
      {(c.stage === 'Faturamento' || c.stage === 'Encerrado') && c.authorization.status !== 'Não se aplica' && <TissPreview {...props}/>}
      {c.stage === 'Encerrado' && <InvoiceList data={data} cases={[c]}/>}
      {c.stage === 'Encerrado' && c.claim.sentAt && <GlosaPanel {...props}/>}
      {['Laudo', 'Faturamento', 'Encerrado'].includes(c.stage) && c.followUp.due && <FollowUpStep {...props}/>}
      {c.stage === 'Cancelado' && <p className="module-error">Cancelado{c.cancelCategory ? ` · ${c.cancelCategory}` : ''}: {c.cancelReason}</p>}
    </div>

    {!['Encerrado', 'Cancelado', 'Faturamento'].includes(c.stage) && <CopilotPanel data={data} stock={stock} c={c}/>}

    {['Autorização', 'Agendamento', 'Preparo'].includes(c.stage) && (cancelling
      ? <div className="hemo-inline-form"><label>Motivo<select value={cancelCategory} onChange={e => setCancelCategory(e.target.value as CancelCategory | '')}><option value="">Selecione</option>{cancelCategories.map(x => <option key={x}>{x}</option>)}</select></label><label className="grow">Detalhe<input value={reason} onChange={e => setReason(e.target.value)} placeholder="O que aconteceu"/></label><button className="button secondary" disabled={!cancelCategory || !reason.trim()} title={!cancelCategory ? 'Escolha o motivo' : !reason.trim() ? 'Descreva o que aconteceu' : ''} onClick={() => { if (cancelCategory && update(d => cancelCase(d, c.id, reason, new Date(), cancelCategory))) setCancelling(false); }}>Confirmar cancelamento</button><button className="text-link" onClick={() => setCancelling(false)}>Voltar</button></div>
      : <button className="text-link hemo-cancel" onClick={() => setCancelling(true)}>Cancelar procedimento</button>)}

    <details className="hemo-history"><summary>Histórico ({history.length})</summary><ol className="appointment-history">{history.map(h => <li key={h.id}><small>{dateTime(h.at)} · {h.action}{h.by ? <> · <strong>{h.by}</strong></> : ''}</small><p>{h.detail}</p></li>)}</ol></details>
  </section>;
}

function AuthorizationStep({ update, stock, c }: Props & { c: HemoCase }) {
  const [guide, setGuide] = useState(''), [note, setNote] = useState('');
  const [authorized, setAuthorized] = useState<Record<string, string>>({});
  const opmeProducts = stock.products.filter(isOpme);
  const [items, setItems] = useState(c.opme.items.map(i => ({ productId: i.productId, requested: String(i.requested) })));
  const [justification, setJustification] = useState(c.opme.justification);
  const savedItems = JSON.stringify(c.opme.items.map(i => ({ productId: i.productId, requested: String(i.requested) })));
  const dirty = JSON.stringify(items) !== savedItems || justification !== c.opme.justification;
  const decide = (approved: boolean) => update(d => decideAuthorization(d, c.id, approved, guide, note, new Date(), Object.fromEntries(Object.entries(authorized).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))));
  return <div className="hemo-step"><h3>Autorização do convênio</h3>
    <h4>Pedido de OPME</h4>
    <p className="field-hint">Materiais especiais que o médico prevê usar (consignados e implantáveis). O convênio autoriza cada item à parte: usar mais do que o autorizado é a causa mais comum de glosa.</p>
    {items.map((item, i) => <div key={i} className="hemo-inline-form"><label className="grow">Material<select value={item.productId} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, productId: e.target.value } : x))}>{opmeProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.implantable ? ' · implante' : ''}</option>)}</select></label><label>Qtd.<input type="number" min={1} value={item.requested} onChange={e => setItems(items.map((x, n) => n === i ? { ...x, requested: e.target.value } : x))}/></label><button className="icon-button" aria-label="Remover item de OPME" onClick={() => setItems(items.filter((_, n) => n !== i))}><X size={15}/></button></div>)}
    <button className="text-link hemo-start" disabled={!opmeProducts.length} onClick={() => setItems([...items, { productId: opmeProducts[0]?.id ?? '', requested: '1' }])}><Plus size={14}/> Adicionar material OPME</button>
    <label>Justificativa clínica do OPME<textarea rows={2} value={justification} onChange={e => setJustification(e.target.value)} placeholder="Ex.: lesão de 90% em DA proximal com isquemia documentada"/></label>
    <div className="head-actions"><button className="button secondary" disabled={!dirty} onClick={() => update(d => saveOpme(d, stock.products, c.id, items.map(x => ({ productId: x.productId, requested: Number(x.requested) })), justification))}>Salvar pedido de OPME</button></div>
    <h4>Resposta do convênio</h4>
    <div className="hospital-form-grid"><label>Número da guia<input value={guide} onChange={e => setGuide(e.target.value)} placeholder="Ex.: GUIA-000400"/></label><label>Observação<input value={note} onChange={e => setNote(e.target.value)} placeholder="Obrigatória se negada"/></label></div>
    {c.opme.items.length > 0 && <table className="hemo-table"><thead><tr><th>OPME pedido</th><th>Pedido</th><th>Autorizado</th></tr></thead><tbody>{c.opme.items.map(i => <tr key={i.id}><td>{productOf(stock.products, i.productId).name}</td><td>{i.requested}</td><td><input type="number" min={0} max={i.requested} aria-label={`Autorizado de ${productOf(stock.products, i.productId).name}`} value={authorized[i.id] ?? String(i.requested)} onChange={e => setAuthorized({ ...authorized, [i.id]: e.target.value })}/></td></tr>)}</tbody></table>}
    <div className="head-actions"><button className="button primary" disabled={dirty} title={dirty ? 'Salve o pedido de OPME primeiro' : ''} onClick={() => decide(true)}><Check size={16}/> Autorizado</button><button className="button secondary" onClick={() => decide(false)}>Negado</button></div>
    <p className="field-hint">O envio pelo portal do convênio (padrão TISS) entra com as integrações.</p>
  </div>;
}

function Regularize({ update, stock, c }: Props & { c: HemoCase }) {
  const [guide, setGuide] = useState('');
  return <div className="hemo-step hemo-step-warn"><strong>Autorização a regularizar</strong><p className="field-hint">Urgência de convênio feita antes da guia. Registre a guia quando o convênio liberar; o OPME usado passa a ser o OPME autorizado. Sem isso, a conta não fecha.</p>
    <div className="hemo-inline-form"><label className="grow">Número da guia<input value={guide} onChange={e => setGuide(e.target.value)}/></label><button className="button secondary" onClick={() => update(d => regularizeAuthorization(d, stock.products, c.id, guide))}>Registrar guia</button></div>
  </div>;
}

function ScheduleStep({ data, update, c }: Props & { c: HemoCase }) {
  const tomorrow = addMinutes(`${localStamp().slice(0, 10)}T00:00`, 24 * 60).slice(0, 10);
  const [roomId, setRoomId] = useState(c.schedule?.roomId ?? data.rooms[0].id), [doctorId, setDoctorId] = useState(c.schedule?.doctorId ?? data.doctors[0].id);
  const [day, setDay] = useState(c.schedule?.start.slice(0, 10) ?? tomorrow), [start, setStart] = useState('');
  const [open, setOpen] = useState(c.stage === 'Agendamento');
  const slots = useMemo(() => open ? freeStarts(data, c.id, roomId, doctorId, day) : [], [data, c.id, roomId, doctorId, day, open]);
  if (!open) return <div className="hemo-step hemo-step-compact"><span>Agendado para <strong>{when(c.schedule!.start)}</strong> até {occupancy(data, c, c.schedule!.start).end.slice(11)} (sala livre às {occupancy(data, c, c.schedule!.start).freeAt.slice(11)}).</span><button className="text-link" onClick={() => setOpen(true)}>Reagendar</button></div>;
  return <div className="hemo-step"><h3>{c.schedule ? 'Reagendar sala' : 'Agendar sala'}</h3><p className="field-hint">Cada horário reserva {typeOf(data, c).duration} min de procedimento e {typeOf(data, c).turnover} min de preparo da sala. Só aparecem horários sem conflito de sala, médico ou paciente.</p>
    <div className="hospital-form-grid hemo-grid-3"><label>Sala<select value={roomId} onChange={e => { setRoomId(e.target.value); setStart(''); }}>{data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Hemodinamicista<select value={doctorId} onChange={e => { setDoctorId(e.target.value); setStart(''); }}>{data.doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Dia<input type="date" value={day} onChange={e => { setDay(e.target.value); setStart(''); }}/></label></div>
    <fieldset className="slot-fieldset"><legend>Horários livres</legend>{slots.length ? <div className="slot-grid">{slots.map(s => <button key={s} type="button" className={s === start ? 'is-selected' : ''} aria-pressed={s === start} onClick={() => setStart(s)}>{s.slice(11)}</button>)}</div> : <p className="field-hint">Nenhum horário livre neste dia para essa combinação.</p>}</fieldset>
    <div className="head-actions"><button className="button primary" disabled={!start} onClick={() => { if (update(d => scheduleCase(d, c.id, { roomId, doctorId, start }))) setOpen(false); }}><Check size={16}/> Confirmar {start ? start.slice(11) : 'horário'}</button>{c.schedule && <button className="text-link" onClick={() => setOpen(false)}>Manter horário atual</button>}</div>
  </div>;
}

function PrepMessage({ data, c }: { data: HemoData; c: HemoCase }) {
  const text = prepMessage(data, c), [copied, setCopied] = useState(false);
  if (!text) return null;
  return <details className="hemo-message"><summary>Orientação de preparo para o paciente</summary>
    <p className="field-hint">Texto para enviar ao paciente (WhatsApp, SMS ou e-mail). O envio automático depende de uma integração de mensagens.</p>
    <pre>{text}</pre>
    <button className="button secondary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false)); }}><Copy size={15}/> {copied ? 'Copiado' : 'Copiar texto'}</button>
  </details>;
}

function PrepStep({ data, update, c }: Props & { c: HemoCase }) {
  const [prep, setPrep] = useState<PrepChecks>(c.prep), [timeout, setTimeoutChecks] = useState<TimeoutChecks>(c.timeout), [notes, setNotes] = useState(c.prepNotes);
  const missing = prepMissing({ ...c, prep, timeout });
  const dirty = JSON.stringify([prep, timeout, notes]) !== JSON.stringify([c.prep, c.timeout, c.prepNotes]);
  const urgent = c.priority === 'Urgência';
  return <div className="hemo-step"><h3>{urgent ? 'Time-out da urgência' : 'Preparo e time-out'}</h3>
    {!urgent && <PrepMessage data={data} c={c}/>}
    <ConsentPanel data={data} update={update} c={c}/>
    <IdentityPanel data={data} update={update} c={c}/>
    {urgent && <p className="field-hint">Na urgência o preparo eletivo não bloqueia a entrada em sala; marque o que foi possível. O time-out é obrigatório.</p>}
    <div className="hemo-checks"><fieldset><legend>Preparo do paciente{urgent ? ' (opcional)' : ''}</legend>{(Object.keys(prepItems) as (keyof PrepChecks)[]).map(k => <label key={k} className="hospital-check"><input type="checkbox" checked={prep[k]} onChange={e => setPrep({ ...prep, [k]: e.target.checked })}/>{prepItems[k]}</label>)}</fieldset>
      <fieldset><legend>Time-out na sala (cirurgia segura)</legend>{(Object.keys(timeoutItems) as (keyof TimeoutChecks)[]).map(k => <label key={k} className="hospital-check"><input type="checkbox" checked={timeout[k]} onChange={e => setTimeoutChecks({ ...timeout, [k]: e.target.checked })}/>{timeoutItems[k]}</label>)}</fieldset></div>
    <label>Observações do preparo<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: metformina suspensa conforme protocolo"/></label>
    <div className="head-actions"><button className="button secondary" disabled={!dirty} onClick={() => update(d => savePrep(d, c.id, prep, timeout, notes))}>Salvar preparo</button><button className="button primary" disabled={missing.length > 0 || dirty} title={dirty ? 'Salve o preparo primeiro' : missing.join('; ')} onClick={() => update(d => startProcedure(d, c.id))}>Paciente em sala</button></div>
    {missing.length > 0 && <p className="field-hint">Para entrar em sala falta: {missing.join('; ')}.</p>}
  </div>;
}

function RoomStep({ data, update, stock, commitBoth, c }: Props & { c: HemoCase }) {
  const usable = usableLots(stock);
  const [chosen, setLotId] = useState(usable[0]?.id ?? ''), [qty, setQty] = useState('1'), [serial, setSerial] = useState('');
  const lotId = usable.some(s => s.id === chosen) ? chosen : usable[0]?.id ?? '';
  const [intra, setIntra] = useState<Intra>({ ...c.intra, start: c.intra.start || c.intra.roomIn });
  const set = <K extends keyof Intra>(k: K, v: Intra[K]) => setIntra({ ...intra, [k]: v });
  const patch = (p: Partial<Intra>) => setIntra({ ...intra, ...p });
  const problem = intraProblem(data, c, intra);
  const product = (id: string) => productOf(stock.products, id);
  const chosenProduct = product(usable.find(s => s.id === lotId)?.productId ?? '');
  const gaps = opmeGaps(data, stock.products, c);
  const renal = renalProfile(data, c), contrast = contrastWarning(data, c, intra.contrastMl);
  return <div className="hemo-step"><h3>Em sala · entrada {when(c.intra.roomIn)}</h3>
    <h4>Materiais usados no paciente</h4>
    <p className="field-hint">Sai do Estoque do hospital como "uso em paciente" e fica ligado a este caso. Só aparecem lotes com saldo disponível (sem reserva, bloqueio, quarentena ou vencimento); o que vence primeiro vem no topo.</p>
    <MaterialScan data={data} stock={stock} c={c} onPick={setLotId}/>
    <div className="hemo-inline-form"><label className="grow">Material e lote<select value={lotId} onChange={e => setLotId(e.target.value)}>{usable.map(s => { const m = product(s.productId); return <option key={s.id} value={s.id}>{m.name} · lote {s.lot} · {availableQuantity(s)} un. · vence {s.expiresAt.split('-').reverse().join('/')}{m.consigned ? ' · consignado' : ''}</option>; })}</select></label>{chosenProduct.implantable ? <label>Nº de série (etiqueta)<input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Da etiqueta do implante"/></label> : <label>Qtd.<input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)}/></label>}<button className="button secondary" disabled={!lotId} onClick={() => { if (commitBoth((h, s) => consumeMaterial(h, s, c.id, lotId, chosenProduct.implantable ? 1 : Number(qty), new Date(), serial))) setSerial(''); }}><Plus size={15}/> Registrar</button></div>
    {chosenProduct.implantable && <p className="field-hint">Implante: uma unidade por registro, com a série da etiqueta. Ela vai para o laudo, para a conta do convênio e para o rastreio em caso de recall.</p>}
    {usable.length === 0 && <p className="field-hint">Nenhum lote da hemodinâmica com saldo disponível no Estoque.</p>}
    {gaps.length > 0 && <ul className="hemo-alerts">{gaps.map(g => <li key={g.product.id} className="is-high"><AlertTriangle size={15}/>{g.product.name}: usado {g.used}, autorizado {g.authorized}. Risco de glosa: peça complemento de autorização ao convênio.</li>)}</ul>}
    {c.materials.length > 0 ? <ul className="hemo-used">{c.materials.map(m => <li key={m.id}><span>{m.quantity} × {product(m.productId).name}<small>lote {m.lot}{m.serial ? ` · série ${m.serial}` : ''}{product(m.productId).consigned ? ' · consignado' : ''}</small></span><button className="text-link" onClick={() => commitBoth((h, s) => returnMaterial(h, s, c.id, m.id))}>Devolver</button></li>)}</ul> : <p className="field-hint">Nenhum material registrado ainda.</p>}
    <h4>Registro do procedimento</h4>
    {typeOf(data, c).contrast && <ContrastCounter data={data} c={c} ml={intra.contrastMl} onBump={delta => setIntra(prev => ({ ...prev, contrastMl: Math.max(0, prev.contrastMl + delta) }))}/>}
    <div className="hospital-form-grid hemo-grid-3">
      <label>Via de acesso<select value={intra.access} onChange={e => set('access', e.target.value as Intra['access'])}><option value="">Selecione</option>{accessRoutes.map(a => <option key={a}>{a}</option>)}</select></label>
      <label>Início<input type="datetime-local" value={intra.start} onChange={e => set('start', e.target.value)}/></label>
      {c.priority === 'Urgência' && <label>Abertura da artéria (balão)<input type="datetime-local" value={intra.balloonAt} onChange={e => set('balloonAt', e.target.value)}/></label>}
      <label>Fim<input type="datetime-local" value={intra.end} onChange={e => set('end', e.target.value)}/></label>
      <label>Contraste (mL)<input type="number" min={0} value={intra.contrastMl} onChange={e => set('contrastMl', Number(e.target.value))}/></label>
      <label>Fluoroscopia (min)<input type="number" min={0} step="0.1" value={intra.fluoroMin} onChange={e => set('fluoroMin', Number(e.target.value))}/></label>
      <label>Kerma no ar (mGy)<input type="number" min={0} value={intra.kermaMgy} onChange={e => set('kermaMgy', Number(e.target.value))}/></label>
    </div>
    {renal.contrastLimitMl !== null && <p className={contrast ? 'hemo-contrast is-over' : 'hemo-contrast'}>{contrast ? <><AlertTriangle size={14}/>{contrast}</> : <>Limite sugerido de contraste: <strong>{renal.contrastLimitMl} mL</strong> (TFG {renal.egfr} × {CONTRAST_EGFR_RATIO.toLocaleString('pt-BR')}). Referência do serviço; a decisão é do médico.</>}</p>}
    <h4>Pressões (opcional)</h4>
    <PressuresField intra={intra} onChange={patch}/>
    <ComplicationsField intra={intra} onChange={patch}/>
    <MedsPanel update={update} c={c}/>
    <SedationPanel key={JSON.stringify(c.sedation)} update={update} c={c}/>
    <VitalsPanel update={update} c={c}/>
    <ImagingPanel key={c.imaging.url + c.imaging.accession} update={update} c={c} editable/>
    <div className="head-actions"><button className="button primary" disabled={!!problem} title={problem} onClick={() => update(d => finishProcedure(d, c.id, intra))}><Check size={16}/> Concluir procedimento</button>{problem && <span className="field-hint">{problem}</span>}</div>
  </div>;
}

function RecoveryStep({ data, update, stock, c }: Props & { c: HemoCase }) {
  const [r, setR] = useState<Recovery>(c.recovery);
  function release() {
    const pending = [c.band.placedAt && !c.band.removedAt && 'a pulseira radial ainda não foi retirada', r.destination === 'Alta no mesmo dia' && !c.discharge.deliveredAt && 'a orientação de alta não foi entregue', r.destination === 'Alta no mesmo dia' && !c.reconciliation.doneAt && 'a reconciliação de medicamentos não foi feita', needsHandoff(r.destination) && !c.handoff.at && `a passagem de plantão para ${r.destination === 'UTI' ? 'a UTI' : 'a internação'} não foi registrada`].filter(Boolean);
    if (pending.length && !window.confirm(`Atenção: ${pending.join(' e ')}. Liberar mesmo assim?`)) return;
    update(d => finishRecovery(d, c.id, r));
  }
  return <div className="hemo-step"><h3>Recuperação</h3>
    <BandPanel key={c.band.placedAt + c.band.releaseMin} update={update} c={c}/>
    <div className="hospital-form-grid"><label>Hemostasia<input value={r.hemostasis} onChange={e => setR({ ...r, hemostasis: e.target.value })} placeholder="Ex.: pulseira de compressão radial por 2 h"/></label><label>Destino<select value={r.destination} onChange={e => setR({ ...r, destination: e.target.value as Recovery['destination'] })}><option value="">Selecione</option>{destinations.map(d => <option key={d}>{d}</option>)}</select></label></div>
    <label className="hospital-check"><input type="checkbox" checked={r.stable} onChange={e => setR({ ...r, stable: e.target.checked })}/>Sinais vitais estáveis e sítio de punção sem sangramento</label>
    <label>Observações<input value={r.notes} onChange={e => setR({ ...r, notes: e.target.value })}/></label>
    <SedationPanel key={JSON.stringify(c.sedation)} update={update} c={c}/>
    <VitalsPanel update={update} c={c}/>
    <HandoffPanel key={`${c.handoff.at}|${r.destination}`} data={data} update={update} stock={stock} c={{ ...c, recovery: { ...c.recovery, ...r } }} destination={r.destination}/>
    <ReconciliationPanel key={`rec-${c.reconciliation.doneAt}`} data={data} update={update} stock={stock} c={c}/>
    <DischargePanel key={c.discharge.deliveredAt} data={data} update={update} stock={stock} c={c}/>
    <div className="head-actions"><button className="button primary" onClick={release}><Check size={16}/> Liberar para laudo</button></div>
  </div>;
}

function ReportStep({ data, update, stock, c }: Props & { c: HemoCase }) {
  const [findings, setFindings] = useState<Finding[]>(c.findings), [text, setText] = useState(c.report.text), [conclusion, setConclusion] = useState(c.report.conclusion);
  const [fromCopilot, setFromCopilot] = useState(c.report.copilotDraft), [review, setReview] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [copilotError, setCopilotError] = useState('');
  const [signer, setSigner] = useState(c.schedule?.doctorId ?? data.doctors[0].id);
  const dirty = JSON.stringify([findings, text, conclusion]) !== JSON.stringify([c.findings, c.report.text, c.report.conclusion]);
  const problems = findings.map(f => findingProblem(normalizeFinding(f), c));
  const firstProblem = problems.findIndex(Boolean);
  async function draft() {
    setBusy(true); setCopilotError('');
    try {
      const result = await askCopilot('laudo', copilotContext(data, stock.products, { ...c, findings }));
      setText(result.descricao); setConclusion(result.conclusao); setReview(result.pontosParaRevisar); setFromCopilot(true);
    } catch (e) { setCopilotError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="hemo-step"><h3>Laudo</h3>
    <h4>Achados por segmento</h4>
    <p className="field-hint">Um achado por lesão. Para vasos fora da árvore coronária (ex.: arteriografia periférica), use "Outro vaso".</p>
    <div className="hemo-findings">{findings.map((f, i) => <FindingEditor key={f.id} f={f} index={i} c={c} catalog={stock.products} onChange={next => setFindings(findings.map((x, n) => n === i ? next : x))} onRemove={() => setFindings(findings.filter((_, n) => n !== i))}/>)}
      <button className="text-link" onClick={() => setFindings([...findings, emptyFinding(crypto.randomUUID())])}><Plus size={14}/> Adicionar achado</button></div>
    <div className="hemo-copilot-inline">
      <button className="button secondary" disabled={firstProblem >= 0} title={firstProblem >= 0 ? `Corrija o achado ${firstProblem + 1}` : ''} onClick={() => { if (text.trim() && !window.confirm('Substituir a descrição atual pelo texto montado a partir dos achados?')) return; setText(structuredReportText(c, findings, stock.products, typeOf(data, c).name)); setFromCopilot(false); setReview([]); }}><FileText size={16}/> Montar descrição a partir dos achados</button>
      <button className="button secondary" disabled={busy} onClick={draft}><Sparkles size={16}/> {busy ? 'Redigindo…' : 'Rascunho do laudo com o copilot'}</button>
      <span className="field-hint">A montagem usa só o que foi registrado, sem IA. O copilot redige em texto corrido. Nos dois casos, você revisa antes de assinar.</span></div>
    {copilotError && <p className="module-error" role="alert">{copilotError}</p>}
    {review.length > 0 && <div className="hemo-review"><strong>O copilot pede para conferir</strong><ul>{review.map(r => <li key={r}>{r}</li>)}</ul></div>}
    <label>Descrição do procedimento{fromCopilot && <span className="hemo-ai-tag"><Bot size={12}/> rascunho do copilot · revisar</span>}<textarea rows={9} value={text} onChange={e => setText(e.target.value)}/></label>
    <label>Conclusão<textarea rows={3} value={conclusion} onChange={e => setConclusion(e.target.value)}/></label>
    <ImagingPanel key={c.imaging.url + c.imaging.accession} update={update} c={c} editable/>
    <div className="head-actions">
      <button className="button secondary" disabled={(!dirty && fromCopilot === c.report.copilotDraft) || firstProblem >= 0} title={firstProblem >= 0 ? `Corrija o achado ${firstProblem + 1}: ${problems[firstProblem]}` : ''} onClick={() => update(d => saveReport(d, c.id, { findings, text, conclusion, copilotDraft: fromCopilot }))}>Salvar laudo</button>
      <label className="hemo-signer">Assina<select value={signer} onChange={e => setSigner(e.target.value)}>{data.doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <button className="button primary" disabled={dirty} title={dirty ? 'Salve o laudo antes de assinar' : ''} onClick={() => { if (window.confirm('Assinar o laudo? Depois de assinado ele não pode ser editado.')) update(d => signReport(d, c.id, signer)); }}><FileText size={16}/> Assinar laudo</button>
    </div>
  </div>;
}

function SignedReport({ data, stock, c }: { data: HemoData; stock: DemoData; c: HemoCase }) {
  const implants = implantsOf(stock.products, c);
  return <details className="hemo-signed" open={c.stage === 'Faturamento'}><summary>Laudo assinado · {c.report.signedBy} · {dateTime(c.report.signedAt)}{c.report.copilotDraft ? ' · partiu de rascunho do copilot' : ''}</summary>
    {c.findings.length > 0 && <><strong>Achados</strong><ul>{c.findings.map(f => <li key={f.id}>{describeFinding(f, stock.products, c)}</li>)}</ul></>}
    {pressureText(c.intra.pressures) && <p><strong>Hemodinâmica:</strong> {pressureText(c.intra.pressures)}.</p>}
    <p><strong>Intercorrências:</strong> {complicationText(c.intra) || 'nenhuma registrada'}.</p>
    <CareSummary c={c}/>
    {c.handoff.at && <p><strong>Passagem de plantão:</strong> {c.handoff.unit}, recebido por {c.handoff.receivedBy} em {dateTime(c.handoff.at)}.</p>}
    <p className="hemo-report-text">{c.report.text}</p><p><strong>Conclusão:</strong> {c.report.conclusion}</p>
    {implants.length > 0 && <><strong>Implantes</strong><ul>{implants.map(({ used, product }) => <li key={used.id}>{product.name} · {product.anvisaRegistry || 'registro ANVISA não cadastrado'} · lote {used.lot} · série {used.serial || 'não registrada'}</li>)}</ul></>}
    {c.meds.length > 0 && <><strong>Medicamentos na sala</strong><ul>{c.meds.map(m => <li key={m.id}>{m.at.slice(11)} · {m.drug} {m.dose.toLocaleString('pt-BR')} {m.unit} · {m.route.toLocaleLowerCase('pt-BR')}</li>)}</ul></>}
    {c.act.readings.length > 0 && <p><strong>TCA:</strong> {c.act.readings.map(r => `${r.at.slice(11)} · ${r.seconds} s`).join('; ')}{c.act.target ? ` (alvo ${c.act.target} s)` : ''}</p>}
    <ImagingPanel update={() => false} c={c} editable={false}/>
    {c.consent.signedAt && <p><strong>Consentimento:</strong> assinado por {c.consent.signer} ({c.consent.relation.toLocaleLowerCase('pt-BR')}) em {dateTime(c.consent.signedAt)}.</p>}
    <small>{typeOf(data, c).name} · {c.intra.access} · contraste {c.intra.contrastMl} mL · fluoroscopia {c.intra.fluoroMin} min · {c.intra.kermaMgy} mGy{doorToBalloon(c) !== null ? ` · porta-balão ${doorToBalloon(c)} min` : ''}</small>
  </details>;
}

function BillingStep({ data, update, stock, c }: Props & { c: HemoCase }) {
  const consigned = c.materials.filter(m => productOf(stock.products, m.productId).consigned);
  const gaps = opmeGaps(data, stock.products, c);
  return <div className="hemo-step"><h3>Faturamento</h3>
    <p className="field-hint">Conta do procedimento com os materiais rastreados. Ao fechar, o sistema prepara a nota de serviço e uma nota de reposição por fornecedor de consignado. Nesta demonstração as notas são simuladas: nada é emitido nem enviado.</p>
    <ul className="hemo-used">{billingItems(data, stock.products, c).map(i => <li key={i}><span>{i}</span></li>)}</ul>
    <CaseCostLine data={data} stock={stock} c={c}/>
    {consigned.length > 0 && <p className="field-hint">{consigned.length} item(ns) consignado(s): a reposição aparece em Materiais.</p>}
    {gaps.length > 0 && <ul className="hemo-alerts">{gaps.map(g => <li key={g.product.id} className="is-high"><AlertTriangle size={15}/>{g.product.name}: usado {g.used}, autorizado {g.authorized}. Sem complemento de autorização, este item tende a ser glosado.</li>)}</ul>}
    <div className="head-actions"><button className="button primary" disabled={c.authorization.status === 'Regularizar'} title={c.authorization.status === 'Regularizar' ? 'Regularize a guia do convênio primeiro' : ''} onClick={() => update(d => closeBilling(d, stock.products, c.id))}><Check size={16}/> Fechar conta e gerar notas</button></div>
  </div>;
}

function TissPreview({ data, stock, c }: Props & { c: HemoCase }) {
  const g = tissPreview(data, stock.products, c);
  return <details className="hemo-signed hemo-tiss"><summary>Prévia da guia SP/SADT (padrão TISS) · não enviada</summary>
    <dl>{g.header.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v === 'a definir' ? 'is-missing' : ''}>{v}</dd></div>)}</dl>
    <p><strong>Procedimento:</strong> {g.procedure.code} · {g.procedure.name}</p>
    {g.opme.length > 0 && <table className="hemo-table"><thead><tr><th>OPME</th><th>Registro ANVISA</th><th>Lote / série</th><th>Usado</th><th>Autorizado</th></tr></thead><tbody>{g.opme.map((o, i) => <tr key={i}><td>{o.name}</td><td className={o.registry === 'a definir' ? 'is-missing' : ''}>{o.registry}</td><td>{o.lot}{o.serial ? ` / ${o.serial}` : ''}</td><td>{o.quantity}</td><td className={o.authorized < o.quantity ? 'is-low' : ''}>{o.authorized}</td></tr>)}</tbody></table>}
    <small>Campos "a definir" dependem do cadastro do hospital (registro ANS, códigos TUSS). O XML TISS e o envio ao portal do convênio entram com a integração.</small>
  </details>;
}

function GlosaPanel({ data, update, stock, c }: Props & { c: HemoCase }) {
  const [item, setItem] = useState(''), [reason, setReason] = useState(''), [adding, setAdding] = useState(false);
  return <div className="hemo-step"><h3>Glosas do convênio</h3>
    <p className="field-hint">Conta enviada ao convênio em {dateTime(c.claim.sentAt)} (simulado). Registre aqui o que o convênio recusou e acompanhe o recurso.</p>
    {c.claim.glosas.length === 0 && <p className="field-hint">Nenhuma glosa registrada.</p>}
    {c.claim.glosas.map(g => <GlosaItem key={g.id} data={data} update={update} stock={stock} c={c} g={g}/>)}
    {adding ? <div className="hemo-inline-form"><label className="grow">Item glosado<input value={item} onChange={e => setItem(e.target.value)} placeholder="Ex.: 1 × Stent farmacológico 3,0 × 18 mm"/></label><label className="grow">Motivo informado pelo convênio<input value={reason} onChange={e => setReason(e.target.value)}/></label><button className="button secondary" onClick={() => { if (update(d => registerGlosa(d, c.id, item, reason))) { setAdding(false); setItem(''); setReason(''); } }}>Registrar glosa</button><button className="text-link" onClick={() => setAdding(false)}>Cancelar</button></div>
      : <button className="text-link hemo-start" onClick={() => setAdding(true)}><Plus size={14}/> Registrar glosa</button>}
  </div>;
}

const glosaTone: Record<Glosa['status'], string> = { Aberta: 'status-cancelled', 'Em recurso': 'status-waiting', Revertida: 'status-done', Aceita: 'status-scheduled' };
function GlosaItem({ data, update, stock, c, g }: { data: HemoData; update: Update; stock: DemoData; c: HemoCase; g: Glosa }) {
  const [appeal, setAppeal] = useState(g.appeal), [fromCopilot, setFromCopilot] = useState(false), [docs, setDocs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function draft() {
    setBusy(true); setError('');
    try {
      const result = await askCopilot('recurso', { ...copilotContext(data, stock.products, c), glosa: { item: g.item, motivo: g.reason } });
      setAppeal(result.texto); setDocs(result.documentosParaAnexar); setFromCopilot(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <article className="hemo-glosa">
    <header><strong>{g.item}</strong><span className={`appointment-status ${glosaTone[g.status]}`}>{g.status}</span></header>
    <small>Motivo: {g.reason} · registrada em {dateTime(g.at)}</small>
    {g.status === 'Aberta' && <>
      <div className="hemo-copilot-inline"><button className="button secondary" disabled={busy} onClick={draft}><Sparkles size={15}/> {busy ? 'Redigindo…' : 'Rascunho do recurso com o copilot'}</button><span className="field-hint">Usa laudo, registro da sala, OPME e autorização, sem nome do paciente.</span></div>
      {error && <p className="module-error" role="alert">{error}</p>}
      <label>Recurso{fromCopilot && <span className="hemo-ai-tag"><Bot size={12}/> rascunho do copilot · revisar</span>}<textarea rows={4} value={appeal} onChange={e => setAppeal(e.target.value)}/></label>
      {docs.length > 0 && <div className="hemo-review"><strong>Anexar</strong><ul>{docs.map(d => <li key={d}>{d}</li>)}</ul></div>}
      <div className="head-actions"><button className="button primary" onClick={() => update(d => appealGlosa(d, c.id, g.id, appeal, fromCopilot))}>Enviar recurso</button><button className="text-link" onClick={() => { if (window.confirm('Aceitar a glosa? O valor não será cobrado do convênio.')) update(d => resolveGlosa(d, c.id, g.id, 'Aceita')); }}>Aceitar glosa</button></div>
    </>}
    {g.status === 'Em recurso' && <><p className="hemo-report-text">{g.appeal}</p><div className="head-actions"><button className="button secondary" onClick={() => update(d => resolveGlosa(d, c.id, g.id, 'Revertida'))}>Convênio reverteu</button><button className="text-link" onClick={() => update(d => resolveGlosa(d, c.id, g.id, 'Aceita'))}>Convênio manteve</button></div></>}
    {(g.status === 'Revertida' || g.status === 'Aceita') && g.appeal && <p className="hemo-report-text">{g.appeal}</p>}
  </article>;
}

function FollowUpStep({ update, c }: Props & { c: HemoCase }) {
  const [outcome, setOutcome] = useState<FollowUpOutcome | ''>(''), [notes, setNotes] = useState('');
  const due = c.followUp.due.split('-').reverse().join('/');
  if (c.followUp.doneAt) return <div className="hemo-step hemo-step-compact"><span>Contato de 30 dias: <strong>{c.followUp.outcome}</strong>{c.followUp.notes ? ` · ${c.followUp.notes}` : ''} · {dateTime(c.followUp.doneAt)}</span></div>;
  return <div className="hemo-step"><h3>Contato de 30 dias · previsto para {due}</h3>
    <div className="hemo-inline-form"><label>Resultado<select value={outcome} onChange={e => setOutcome(e.target.value as FollowUpOutcome)}><option value="">Selecione</option>{followUpOutcomes.map(o => <option key={o}>{o}</option>)}</select></label><label className="grow">Observação<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Obrigatória se houve evento"/></label><button className="button secondary" onClick={() => update(d => recordFollowUp(d, c.id, outcome, notes))}>Registrar contato</button></div>
  </div>;
}

// ---------------- Copilot ----------------
function CopilotPanel({ data, stock, c }: { data: HemoData; stock: DemoData; c: HemoCase }) {
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null | undefined>(undefined);
  const [brief, setBrief] = useState<Briefing | null>(null), [answer, setAnswer] = useState<Answer | null>(null), [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'' | 'briefing' | 'pergunta'>(''), [error, setError] = useState('');
  useEffect(() => { let live = true; copilotStatus().then(s => { if (live) setStatus(s); }); return () => { live = false; }; }, []);
  async function run(task: 'briefing' | 'pergunta') {
    setBusy(task); setError('');
    try {
      const context = copilotContext(data, stock.products, c);
      if (task === 'briefing') setBrief(await askCopilot('briefing', context));
      else setAnswer(await askCopilot('pergunta', context, question));
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <section className="hemo-copilot" aria-label="Copilot do médico">
    <div className="hemo-copilot-head"><span><Bot size={18}/> <strong>Copilot do médico</strong></span><small>{status === undefined ? 'verificando…' : status === null ? 'servidor indisponível' : status.configured ? `IA ativa · ${status.model}` : 'sem chave configurada'}</small></div>
    <p className="field-hint">Recebe só dados clínicos do caso, sem nome nem contato do paciente. As respostas são sugestões para o médico revisar.</p>
    {status && !status.configured && <p className="hemo-setup">Para ligar o copilot, crie o arquivo <code>.env.local</code> na pasta do projeto com <code>ANTHROPIC_API_KEY=sua-chave</code> e reinicie o <code>pnpm dev</code>.</p>}
    <div className="head-actions"><button className="button secondary" disabled={!!busy || !status?.configured} onClick={() => run('briefing')}><Sparkles size={16}/> {busy === 'briefing' ? 'Analisando…' : 'Resumo pré-procedimento'}</button></div>
    {brief && <div className="hemo-brief"><p>{brief.resumo}</p>{brief.alertas.length > 0 && <ul className="hemo-alerts">{brief.alertas.map(a => <li key={a.titulo} className={a.nivel === 'alto' ? 'is-high' : a.nivel === 'atenção' ? 'is-warn' : 'is-info'}><AlertTriangle size={15}/><span><strong>{a.titulo}.</strong> {a.detalhe}</span></li>)}</ul>}{brief.perguntasEmAberto.length > 0 && <><strong>Confirmar antes da sala</strong><ul>{brief.perguntasEmAberto.map(q => <li key={q}>{q}</li>)}</ul></>}</div>}
    <form className="hemo-inline-form" onSubmit={e => { e.preventDefault(); if (question.trim()) run('pergunta'); }}><label className="grow">Pergunte sobre este caso<input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ex.: Algum cuidado extra com a via radial neste paciente?"/></label><button className="button secondary" disabled={!!busy || !question.trim() || !status?.configured}>{busy === 'pergunta' ? 'Pensando…' : 'Perguntar'}</button></form>
    {answer && <div className="hemo-brief"><p>{answer.resposta}</p>{answer.pontosParaRevisar.length > 0 && <ul>{answer.pontosParaRevisar.map(r => <li key={r}>{r}</li>)}</ul>}</div>}
    {error && <p className="module-error" role="alert">{error}</p>}
  </section>;
}

// ---------------- Salas do dia ----------------
function Rooms({ data }: { data: HemoData }) {
  const [day, setDay] = useState(localStamp().slice(0, 10));
  const scheduled = data.cases.filter(c => c.schedule && c.schedule.start.startsWith(day) && c.stage !== 'Cancelado').sort((a, b) => a.schedule!.start.localeCompare(b.schedule!.start));
  return <section className="panel"><div className="panel-head toolbar"><div><h2>Ocupação das salas</h2><p>Procedimento + preparo da sala. Um horário só é oferecido se sala, médico e paciente estiverem livres.</p></div><label className="hemo-day">Dia<input type="date" value={day} onChange={e => setDay(e.target.value)}/></label></div>
    <div className="hemo-rooms">{data.rooms.map(r => { const items = scheduled.filter(c => c.schedule!.roomId === r.id); return <div key={r.id} className="hemo-room"><h3>{r.name}</h3><DayBlocks data={data} roomId={r.id} day={day}/>{items.length === 0 && !data.roomBlocks.some(b => b.roomId === r.id && b.start < `${day}T23:59` && `${day}T00:00` < b.end) && <p className="field-hint">Sala livre neste dia.</p>}{items.map(c => { const o = occupancy(data, c, c.schedule!.start); const clash = ['Agendamento', 'Preparo'].includes(c.stage) ? blockOverlapping(data, r.id, o.start, o.freeAt) : undefined; return <div key={c.id} className={`hemo-room-slot${clash ? ' is-conflict' : ''}`}><span className="appointment-time">{o.start.slice(11)}<small>até {o.end.slice(11)} · livre {o.freeAt.slice(11)}</small></span><span className="appointment-person"><strong>{patientOf(data, c).name}</strong><small>{typeOf(data, c).name} · {data.doctors.find(d => d.id === c.schedule!.doctorId)?.name}</small>{clash && <small className="hemo-conflict">Sala bloqueada ({clash.reason.toLocaleLowerCase('pt-BR')}): remarcar</small>}</span><StageBadge stage={c.stage}/></div>; })}</div>; })}</div>
  </section>;
}

// ---------------- Materiais ----------------
function Materials({ data, stock, commitBoth, onOpenLot }: Props) {
  const alerts = materialAlerts(stock), pending = pendingReplenishment(data, stock.products);
  const [receiving, setReceiving] = useState(''), [lot, setLot] = useState(''), [expiresAt, setExpiresAt] = useState('');
  const [query, setQuery] = useState(''), traced = traceLot(data, stock.products, query);
  return <div className="module-stack">
    <section className="panel"><div className="panel-head"><div><h2>Rastrear lote ou série</h2><p>Em caso de recall ou alerta da ANVISA: em quais pacientes este lote ou implante foi usado.</p></div></div>
      <div className="hemo-trace"><label className="hemo-search"><Search size={15}/><input aria-label="Lote ou série" value={query} onChange={e => setQuery(e.target.value)} placeholder="Digite o lote ou o número de série (mín. 3 caracteres)"/></label></div>
      {query.trim().length >= 3 && (traced.length === 0 ? <p className="empty-state">Nenhum uso em paciente com esse lote ou série.</p> : <table className="hemo-table"><thead><tr><th>Paciente</th><th>Procedimento</th><th>Data</th><th>Material</th><th>Lote / série</th><th>Médico</th></tr></thead><tbody>{traced.map(x => <tr key={x.used.id}><td><strong>{x.patient}</strong></td><td>{x.procedure}<small className="hemo-code">{x.stage}</small></td><td>{when(x.date)}</td><td>{x.used.quantity} × {x.product.name}</td><td>{x.used.lot}{x.used.serial ? ` / ${x.used.serial}` : ''}</td><td>{x.doctor || '—'}</td></tr>)}</tbody></table>)}
    </section>
    <ReplenishmentOrders data={data} stock={stock}/>
    {alerts.length > 0 && <section className="panel"><div className="panel-head"><div><h2>Alertas de materiais</h2><p>Saldo abaixo do mínimo e validade em até 30 dias.</p></div></div><ul className="hemo-alerts">{alerts.map(a => <li key={a.text} className={a.level === 'alto' ? 'is-high' : 'is-warn'}><AlertTriangle size={15}/>{a.text}</li>)}</ul></section>}
    <section className="panel"><div className="panel-head"><div><h2>Reposição de consignados</h2><p>Itens do fornecedor usados em pacientes e ainda não repostos. Ao receber, informe o lote novo: ele entra no Estoque do hospital, no mesmo local.</p></div><span className="count-label">{pending.length} pendente(s)</span></div>
      {pending.length === 0 ? <p className="empty-state">Nenhuma reposição pendente.</p> : <table className="hemo-table"><thead><tr><th>Fornecedor</th><th>Material</th><th>Lote usado</th><th>Paciente</th><th/></tr></thead><tbody>{pending.map(x => <tr key={x.used.id}><td>{x.product.supplier || '—'}</td><td>{x.used.quantity} × {x.product.name}</td><td>{x.used.lot}</td><td>{x.patient}</td><td>{receiving === x.used.id ? <div className="hemo-inline-form"><input aria-label="Lote recebido" placeholder="Lote recebido" value={lot} onChange={e => setLot(e.target.value)}/><input aria-label="Validade" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}/><button className="button primary" onClick={() => { if (commitBoth((h, s) => receiveReplenishment(h, s, x.caseId, x.used.id, { lot, expiresAt }))) { setReceiving(''); setLot(''); setExpiresAt(''); } }}>Confirmar</button><button className="text-link" onClick={() => setReceiving('')}>Cancelar</button></div> : <button className="text-link" onClick={() => setReceiving(x.used.id)}>Registrar reposição</button>}</td></tr>)}</tbody></table>}
    </section>
    <section className="panel"><div className="panel-head"><div><h2>Materiais da hemodinâmica no Estoque</h2><p>Produtos da especialidade Hemodinâmica. Disponível segue as regras do Estoque: sem reservas, bloqueios, quarentena e vencidos. Selecione um lote para abrir a ficha no Estoque.</p></div></div>
      <table className="hemo-table"><thead><tr><th>Material</th><th>Fornecedor</th><th>Disponível</th><th>Mínimo</th><th>Lotes</th></tr></thead><tbody>{hemoMaterials(stock).map(({ product: m, positions, available }) => <tr key={m.id}><td><strong>{m.name}</strong>{m.consigned && <span className="hemo-tag">consignado</span>}<small className="hemo-code">{m.code}</small></td><td>{m.supplier || '—'}</td><td className={available < m.minimum ? 'is-low' : ''}>{available}</td><td>{m.minimum}</td><td>{positions.length ? <div className="hemo-lots">{positions.map(s => <button key={s.id} type="button" className="text-link" onClick={() => onOpenLot(s.id)}>{s.lot} ({s.quantity}, vence {s.expiresAt.split('-').reverse().join('/')})</button>)}</div> : '—'}</td></tr>)}</tbody></table>
    </section>
  </div>;
}

// ---------------- Convênios e glosas ----------------
function Claims(ctx: Props) {
  const { data, stock } = ctx;
  const glosas = allGlosas(data);
  const atRisk = data.cases.filter(c => c.stage !== 'Cancelado').map(c => ({ c, gaps: opmeGaps(data, stock.products, c) })).filter(x => x.gaps.length);
  const regularize = data.cases.filter(c => c.authorization.status === 'Regularizar');
  const waiting = data.cases.filter(c => c.stage === 'Autorização');
  const withClaim = data.cases.filter(c => c.claim.sentAt);
  return <div className="module-stack">
    <div className="hemo-kpis">
      <div><span>Aguardando autorização</span><strong>{waiting.length}</strong></div>
      <div><span>Urgências a regularizar</span><strong>{regularize.length}</strong></div>
      <div><span>OPME acima do autorizado</span><strong className={atRisk.length ? 'is-bad' : ''}>{atRisk.length}</strong></div>
      <div><span>Glosas abertas</span><strong className={glosas.some(x => x.g.status === 'Aberta') ? 'is-bad' : ''}>{glosas.filter(x => x.g.status === 'Aberta').length}</strong></div>
      <div><span>Em recurso</span><strong>{glosas.filter(x => x.g.status === 'Em recurso').length}</strong></div>
    </div>
    {(atRisk.length > 0 || regularize.length > 0) && <section className="panel"><div className="panel-head"><div><h2>Antes de faturar</h2><p>O que ainda pode virar glosa e dá para resolver agora.</p></div></div>
      <ul className="hemo-alerts">{regularize.map(c => <li key={c.id} className="is-warn"><AlertTriangle size={15}/>{patientOf(data, c).name} · {typeOf(data, c).name}: urgência sem guia. Registre a guia na ficha do procedimento.</li>)}{atRisk.flatMap(({ c, gaps }) => gaps.map(g => <li key={c.id + g.product.id} className="is-high"><AlertTriangle size={15}/>{patientOf(data, c).name} · {g.product.name}: usado {g.used}, autorizado {g.authorized}.</li>))}</ul>
    </section>}
    <section className="panel"><div className="panel-head"><div><h2>Glosas</h2><p>Contas enviadas a convênio ({withClaim.length}) e o que foi recusado. O recurso pode partir de um rascunho do copilot.</p></div></div>
      {withClaim.length === 0 && <p className="empty-state">Nenhuma conta enviada a convênio ainda.</p>}
      <div className="hemo-claims">{withClaim.map(c => <div key={c.id} className="hemo-claim"><header><strong>{patientOf(data, c).name}</strong><small>{typeOf(data, c).name} · {patientOf(data, c).insurance} · guia {c.authorization.guide || '—'}</small></header>
        {c.claim.glosas.length === 0 ? <p className="field-hint">Sem glosa.</p> : c.claim.glosas.map(g => <GlosaItem key={g.id} data={data} update={ctx.update} stock={stock} c={c} g={g}/>)}</div>)}</div>
    </section>
  </div>;
}

// ---------------- Acompanhamento de 30 dias ----------------
function FollowUps(ctx: Props) {
  const { data } = ctx;
  const pending = pendingFollowUps(data), done = data.cases.filter(c => c.followUp.doneAt);
  return <div className="module-stack">
    <RenalRecheckList {...ctx} pending={pendingRenalRechecks(data)}/>
    <section className="panel"><div className="panel-head"><div><h2>Contatos de 30 dias</h2><p>Ligação ao paciente 30 dias após o procedimento: complicações, reinternação e óbito entram nos indicadores.</p></div><span className="count-label">{pending.filter(x => x.days < 0).length} atrasado(s)</span></div>
      {pending.length === 0 ? <p className="empty-state">Nenhum contato pendente.</p> : <div className="hemo-followups">{pending.map(({ c, days }) => <div key={c.id} className="hemo-followup"><header><strong>{patientOf(data, c).name}</strong><span className={`appointment-status ${days < 0 ? 'status-cancelled' : days <= 3 ? 'status-waiting' : 'status-scheduled'}`}>{days < 0 ? `atrasado ${-days} dia(s)` : days === 0 ? 'hoje' : `em ${days} dia(s)`}</span></header><small>{typeOf(data, c).name} · {when(c.intra.end)}{c.priority === 'Urgência' ? ' · urgência' : ''}</small><FollowUpStep {...ctx} c={c}/></div>)}</div>}
    </section>
    {done.length > 0 && <section className="panel"><div className="panel-head"><div><h2>Contatos feitos</h2></div></div><table className="hemo-table"><thead><tr><th>Paciente</th><th>Procedimento</th><th>Resultado</th><th>Observação</th></tr></thead><tbody>{done.map(c => <tr key={c.id}><td>{patientOf(data, c).name}</td><td>{typeOf(data, c).name}</td><td>{c.followUp.outcome}</td><td>{c.followUp.notes || '—'}</td></tr>)}</tbody></table></section>}
  </div>;
}

// ---------------- Indicadores ----------------
function Indicators({ data, stock }: Props) {
  const ind = hemoIndicators(data, stock.products);
  const pct = (part: number, total: number) => total ? `${Math.round(100 * part / total)}%` : '—';
  const dtb = ind.doorToBalloon;
  return <div className="module-stack">
    <p className="field-hint hemo-note">Calculados só com o que está registrado nos procedimentos deste navegador (dados fictícios). Nada é estimado.</p>
    <div className="hemo-kpis">
      <div><span>Porta-balão (mediana)</span><strong className={dtb.median !== null && dtb.median > DOOR_TO_BALLOON_TARGET_MIN ? 'is-bad' : ''}>{dtb.median === null ? '—' : `${dtb.median} min`}</strong><small>{dtb.cases.length} urgência(s) · meta {DOOR_TO_BALLOON_TARGET_MIN} min</small></div>
      <div><span>Dentro da meta</span><strong>{pct(dtb.withinTarget, dtb.cases.length)}</strong><small>{dtb.withinTarget} de {dtb.cases.length}</small></div>
      <div><span>Procedimentos concluídos</span><strong>{ind.done}</strong><small>{ind.complications} com intercorrência</small></div>
      <div><span>Acesso radial</span><strong>{ind.radialShare === null ? '—' : `${ind.radialShare}%`}</strong><small>contraste médio {ind.avgContrastMl ?? '—'} mL</small></div>
      <div><span>Eventos em 30 dias</span><strong>{ind.followUp.events}</strong><small>{ind.followUp.done} contato(s) feito(s) · {ind.followUp.overdue} atrasado(s)</small></div>
      <div><span>Glosas pendentes</span><strong>{ind.glosas.Aberta + ind.glosas['Em recurso']}</strong><small>{ind.glosas.Aberta} aberta(s) · {ind.glosas['Em recurso']} em recurso · {ind.glosas.Revertida} revertida(s) · {ind.glosas.Aceita} aceita(s)</small></div>
    </div>
    <section className="panel"><div className="panel-head"><div><h2>Porta-balão por urgência</h2><p>Da chegada ao hospital até a abertura da artéria.</p></div></div>
      {dtb.cases.length === 0 ? <p className="empty-state">Nenhuma urgência com os dois horários registrados.</p> : <table className="hemo-table"><thead><tr><th>Paciente</th><th>Chegada</th><th>Abertura</th><th>Porta-balão</th></tr></thead><tbody>{dtb.cases.map(({ c, minutes }) => <tr key={c.id}><td>{patientOf(data, c).name}</td><td>{when(c.doorAt)}</td><td>{when(c.intra.balloonAt)}</td><td className={minutes > DOOR_TO_BALLOON_TARGET_MIN ? 'is-low' : ''}>{minutes} min</td></tr>)}</tbody></table>}
    </section>
    <section className="panel"><div className="panel-head"><div><h2>Radiação por hemodinamicista</h2><p>Soma do registrado nos procedimentos. A dose pessoal da equipe vem do dosímetro individual, que ainda não está integrado.</p></div></div>
      <table className="hemo-table"><thead><tr><th>Médico</th><th>Procedimentos</th><th>Fluoroscopia</th><th>Kerma no ar (pacientes)</th></tr></thead><tbody>{ind.byDoctor.map(d => <tr key={d.doctor.id}><td>{d.doctor.name}</td><td>{d.procedures}</td><td>{d.fluoroMin.toLocaleString('pt-BR')} min</td><td>{d.kermaMgy.toLocaleString('pt-BR')} mGy</td></tr>)}</tbody></table>
      {ind.highDosePatients.length > 0 ? <ul className="hemo-alerts">{ind.highDosePatients.map(x => <li key={x.patient.id} className="is-warn"><AlertTriangle size={15}/>{x.patient.name}: {x.kermaMgy.toLocaleString('pt-BR')} mGy acumulados. Avaliar pele.</li>)}</ul> : <p className="empty-state">Nenhum paciente acima de {SKIN_DOSE_FOLLOWUP_MGY.toLocaleString('pt-BR')} mGy acumulados (referência do serviço para avaliação de pele).</p>}
    </section>
    <ClinicalIndicators data={data}/>
    <StructuredIndicators data={data}/>
  </div>;
}

// ---------------- Notas fiscais ----------------
function InvoiceList({ data, cases }: { data: HemoData; cases: HemoCase[] }) {
  const all = cases.flatMap(c => c.invoices.map(i => ({ i, c })));
  if (all.length === 0) return <p className="empty-state">Nenhuma nota gerada ainda. As notas aparecem quando o faturamento de um procedimento é fechado.</p>;
  return <div className="hemo-invoices">{all.map(({ i, c }) => <article key={i.id} className="hemo-invoice"><header><strong>{i.kind === 'Serviço' ? 'Nota de serviço' : 'Nota de reposição de consignado'}</strong><span className="appointment-status status-waiting">Simulada · não emitida</span></header><small>Para: {i.recipient} · {patientOf(data, c).name} · {dateTime(i.createdAt)}</small><ul>{i.items.map(x => <li key={x}>{x}</li>)}</ul></article>)}</div>;
}
function Invoices({ data }: { data: HemoData }) {
  return <section className="panel"><div className="panel-head"><div><h2>Notas fiscais</h2><p>Notas preparadas no fechamento de cada procedimento. A emissão real exige o certificado digital do hospital e um emissor contratado (ou o eGestor, se for o emissor escolhido).</p></div></div><InvoiceList data={data} cases={data.cases}/></section>;
}

// ---------------- Integrações ----------------
const integrations = [
  { name: 'eGestor', use: 'Gestão financeira e emissão de notas fiscais (a confirmar com o cliente).' },
  { name: 'SPDATA', use: 'Sistema de gestão hospitalar: pacientes, atendimentos e contas (a confirmar com o cliente).' },
  { name: 'Apollo', use: 'Função no hospital a confirmar com o cliente.' },
];
function Integrations() {
  return <section className="panel"><div className="panel-head"><div><h2>Integrações</h2><p>Sistemas citados pelo cliente. Nenhuma conexão está ativa: cada uma depende da documentação e de um acesso de teste do fornecedor.</p></div></div>
    <div className="hemo-integrations">{integrations.map(x => <article key={x.name} className="hemo-integration"><header><Plug size={18}/><strong>{x.name}</strong><span className="appointment-status status-cancelled">Não conectada</span></header><p>{x.use}</p><small>Para conectar: documentação da API, credenciais de homologação e a lista de dados que cada lado envia e recebe.</small></article>)}</div>
  </section>;
}
