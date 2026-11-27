import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellOff, ClipboardCopy, ClipboardList, FileDown, Lock, Monitor, Printer, TrendingUp } from 'lucide-react';
import { can, roleLabel, type Role } from '../auth/domain';
import { type DemoData } from '../data';
import { DOOR_TO_BALLOON_TARGET_MIN, localStamp, type HemoData } from './domain';
import { currentMonth, doctorQuality, forecastText, monthlyReport, QUALITY_MIN_CASES, stockForecast } from './insights';
import { brl } from './operations';
import { initials, publicBoard, tasksFor, timeAlerts, type TimeAlert } from './team';
import { useNow } from './ui';
import { type Actor } from './OperationsPanel';

const fmt = (v: number | null, suffix = '') => v === null ? '—' : `${v.toLocaleString('pt-BR')}${suffix}`;

// ---------- Minhas tarefas ----------
export function MyTasks({ data, role, onOpen }: { data: HemoData; role: Role; onOpen: (caseId: string) => void }) {
  const now = useNow();
  const tasks = tasksFor(role, data, now);
  const groups = [...new Set(tasks.map(t => t.group))];
  return <section className="panel hemo-tasks">
    <div className="panel-head"><div><h2><ClipboardList size={16}/> Minhas tarefas</h2><p>{roleLabel[role]} · {tasks.length} {tasks.length === 1 ? 'pendência' : 'pendências'}{tasks.some(t => t.urgent) ? ` · ${tasks.filter(t => t.urgent).length} urgente(s)` : ''}</p></div></div>
    {tasks.length === 0 ? <p className="empty-state">Nada pendente para o seu perfil agora.</p> : <div className="hemo-task-groups">{groups.map(g => <div key={g} className="hemo-task-group">
      <h3>{g}<span>{tasks.filter(t => t.group === g).length}</span></h3>
      <ul>{tasks.filter(t => t.group === g).map((t, i) => <li key={t.caseId + g + i}><button type="button" className={t.urgent ? 'is-urgent' : ''} onClick={() => onOpen(t.caseId)}><strong>{t.title}</strong><small>{t.detail}</small></button></li>)}</ul>
    </div>)}</div>}
  </section>;
}

// ---------- Avisos de tempo ----------
const NOTIFY_KEY = 'hemo-avisos-navegador';
/** Faixa de avisos com tempo (pulseira, laudo, porta-balão). Opcionalmente avisa pelo navegador, só com iniciais. */
export function TimeAlertsBar({ data, onOpen }: { data: HemoData; onOpen: (caseId: string) => void }) {
  const now = useNow(30_000);
  const alerts = timeAlerts(data, now);
  const [notify, setNotify] = useState(() => { try { return localStorage.getItem(NOTIFY_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch { return false; } });
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const a of alerts) {
      if (seen.current.has(a.key)) continue;
      seen.current.add(a.key);
      // Notificação do sistema pode aparecer na tela bloqueada: só iniciais, nunca o nome.
      if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`Hemodinâmica · ${a.title}`, { body: `${initials(a.patient)} · ${a.detail}`, tag: a.key });
    }
  }, [alerts, notify]);
  async function toggleNotify() {
    if (notify) { setNotify(false); try { localStorage.setItem(NOTIFY_KEY, '0'); } catch { /* só nesta sessão */ } return; }
    if (typeof Notification === 'undefined') { window.alert('Este navegador não permite avisos.'); return; }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    const on = permission === 'granted';
    setNotify(on); try { localStorage.setItem(NOTIFY_KEY, on ? '1' : '0'); } catch { /* só nesta sessão */ }
    if (!on) window.alert('Os avisos do navegador estão bloqueados. Libere nas configurações do site.');
  }
  return <div className={`hemo-time-alerts ${alerts.length ? '' : 'is-empty'}`} role="region" aria-label="Avisos de tempo">
    <div className="hemo-time-alerts-head"><strong><Bell size={14}/> Avisos de tempo</strong><span>{alerts.length ? `${alerts.length} ativo(s)` : 'nenhum agora'}</span>
      <button type="button" className="text-link" onClick={() => void toggleNotify()} aria-pressed={notify}>{notify ? <><BellOff size={13}/> Desligar avisos do navegador</> : <><Bell size={13}/> Avisar pelo navegador</>}</button></div>
    {alerts.length > 0 && <ul>{alerts.map((a: TimeAlert) => <li key={a.key} className={a.level === 'alto' ? 'is-high' : 'is-warn'}><button type="button" onClick={() => onOpen(a.caseId)}><AlertTriangle size={14}/><span><strong>{a.title}</strong> · {a.patient}<small>{a.detail}</small></span></button></li>)}</ul>}
  </div>;
}

// ---------- Painel para TV ----------
export const PUBLIC_BOARD_HASH = '#/painel-sala';
/** Tela cheia para a sala de espera e a recuperação: iniciais, sala e situação. Atualiza quando outra aba grava. */
export function PublicBoardScreen({ data }: { data: HemoData }) {
  const now = useNow(15_000);
  const rows = publicBoard(data, now);
  const stamp = localStamp(now);
  return <div className="hemo-tv">
    <header><div><strong>Hemodinâmica</strong><span>Acompanhe pela inicial do nome</span></div><time>{stamp.slice(8, 10)}/{stamp.slice(5, 7)} · {stamp.slice(11)}</time></header>
    {rows.length === 0 ? <p className="hemo-tv-empty">Nenhum paciente em atendimento agora.</p> : <ol>{rows.map(r => <li key={r.id} className={`is-${r.stage}`}><span className="hemo-tv-who">{r.who}</span><span className="hemo-tv-room">{r.room || '—'}</span><span className="hemo-tv-status">{r.status}</span></li>)}</ol>}
    <footer>Por privacidade, só as iniciais aparecem. Dúvidas: fale com a recepção da Hemodinâmica.</footer>
  </div>;
}
export function openPublicBoard() { window.open(`${location.pathname}${PUBLIC_BOARD_HASH}`, 'hemo-painel', 'noopener'); }

// ---------- Relatório mensal ----------
export function MonthlyReport({ data, stock }: { data: HemoData; stock: DemoData }) {
  const [month, setMonth] = useState(currentMonth());
  const r = useMemo(() => monthlyReport(data, stock.products, month), [data, stock.products, month]);
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  function print() { document.body.classList.add('is-printing-report'); window.print(); document.body.classList.remove('is-printing-report'); }
  return <section className="panel hemo-report-panel">
    <div className="panel-head toolbar"><div><h2><FileDown size={16}/> Relatório mensal</h2><p>Para a reunião da diretoria. "Salvar como PDF" na janela de impressão.</p></div><div className="head-actions"><label className="hemo-day">Mês<input type="month" value={month} onChange={e => setMonth(e.target.value || currentMonth())}/></label><button className="button primary" onClick={print}><Printer size={15}/> Gerar PDF</button></div></div>
    <article className="hemo-print-report">
      <header><h1>Hemodinâmica · relatório de {monthName}</h1><p>{r.period.from.split('-').reverse().join('/')} a {r.period.to.split('-').reverse().join('/')} · gerado em {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · dados registrados no sistema</p></header>
      <div className="hemo-print-kpis">
        <div><span>Procedimentos</span><strong>{r.volume.total}</strong><small>{r.volume.elective} eletivo(s) · {r.volume.urgent} urgência(s)</small></div>
        <div><span>Porta-balão (mediana)</span><strong>{fmt(r.doorToBalloon.median, ' min')}</strong><small>{r.doorToBalloon.withinTarget} de {r.doorToBalloon.cases} na meta de {DOOR_TO_BALLOON_TARGET_MIN} min</small></div>
        <div><span>Intercorrências</span><strong>{fmt(r.complications.rate, '%')}</strong><small>{r.complications.cases} procedimento(s)</small></div>
        <div><span>Acesso radial</span><strong>{fmt(r.radialShare, '%')}</strong><small>contraste médio {fmt(r.avgContrastMl, ' mL')}</small></div>
        <div><span>Cancelamentos</span><strong>{fmt(r.cancellations.rate, '%')}</strong><small>{r.cancellations.total} cancelado(s)</small></div>
        <div><span>Glosas</span><strong>{r.glosas.Aberta + r.glosas['Em recurso']}</strong><small>pendentes · {r.glosas.Revertida} revertida(s) · {r.glosas.Aceita} aceita(s)</small></div>
      </div>
      <h2>Volume por procedimento</h2>
      {r.volume.byType.length ? <table className="hemo-table"><thead><tr><th>Procedimento</th><th>Casos</th></tr></thead><tbody>{r.volume.byType.map(x => <tr key={x.type.id}><td>{x.type.name}</td><td>{x.cases}</td></tr>)}</tbody></table> : <p className="field-hint">Nenhum procedimento concluído no mês.</p>}
      <h2>Ocupação das salas (07:00–19:00)</h2>
      <table className="hemo-table"><thead><tr><th>Sala</th><th>Procedimentos</th><th>Uso</th><th>Parada (bloqueio)</th></tr></thead><tbody>{r.rooms.map(x => <tr key={x.room.id}><td>{x.room.name}</td><td>{x.procedures}</td><td>{fmt(x.utilization, '%')}</td><td>{x.blockedMin ? `${Math.round(x.blockedMin / 60)} h` : '—'}</td></tr>)}</tbody></table>
      {r.complications.byEvent.length > 0 && <><h2>Intercorrências por tipo</h2><table className="hemo-table"><thead><tr><th>Intercorrência</th><th>Casos</th></tr></thead><tbody>{r.complications.byEvent.map(x => <tr key={x.event}><td>{x.event}</td><td>{x.cases}</td></tr>)}</tbody></table></>}
      {r.cancellations.byCategory.length > 0 && <><h2>Cancelamentos por motivo</h2><table className="hemo-table"><thead><tr><th>Motivo</th><th>Casos</th></tr></thead><tbody>{r.cancellations.byCategory.map(x => <tr key={x.category}><td>{x.category}</td><td>{x.cases.length}</td></tr>)}</tbody></table></>}
      <h2>Custo de materiais por procedimento</h2>
      {r.costs.length ? <table className="hemo-table"><thead><tr><th>Procedimento</th><th>Casos</th><th>Materiais (média)</th><th>Valor de referência</th><th>Margem média</th></tr></thead><tbody>{r.costs.map(x => <tr key={x.type.id}><td>{x.type.name}</td><td>{x.cases}{x.incomplete ? ` (${x.incomplete} sem custo completo)` : ''}</td><td>{x.avgMaterialsCents === null ? '—' : brl(x.avgMaterialsCents)}</td><td>{x.valueCents === null ? '—' : brl(x.valueCents)}</td><td>{x.avgMarginCents === null ? '—' : brl(x.avgMarginCents)}</td></tr>)}</tbody></table> : <p className="field-hint">Sem procedimentos com custo no mês.</p>}
      {!r.costComplete && <p className="field-hint">Custos incompletos: preencha a tabela de valores em Ocupação e custos. Valores ausentes não são estimados.</p>}
      <footer>Medicamentos, honorários e glosas não entram no custo. Indicadores calculados só com o que foi registrado.</footer>
    </article>
  </section>;
}

// ---------- Qualidade por médico ----------
/** Comparação com a média do serviço. Visível só para quem tem a permissão "qualidade.ver". */
export function DoctorQuality({ data, user }: { data: HemoData; user: Actor }) {
  if (!can(user, 'qualidade.ver')) return <section className="panel"><div className="panel-head"><div><h2><Lock size={15}/> Qualidade por hemodinamicista</h2><p>Visível só para administradores.</p></div></div></section>;
  const q = doctorQuality(data), s = q.service;
  const cmp = (v: number | null, ref: number | null, higherIsBetter: boolean) => v === null || ref === null || v === ref ? '' : (v > ref) === higherIsBetter ? 'is-better' : 'is-worse';
  return <section className="panel"><div className="panel-head"><div><h2><TrendingUp size={16}/> Qualidade por hemodinamicista</h2><p>Comparado com a média do serviço. Com menos de {QUALITY_MIN_CASES} casos, a diferença pode ser acaso: use para conversar, não para julgar.</p></div></div>
    <div className="table-scroll"><table className="hemo-table hemo-quality"><thead><tr><th>Médico</th><th>Casos</th><th>Intercorrência</th><th>Radial</th><th>Contraste médio</th><th>Fluoroscopia média</th><th>Kerma médio</th><th>Porta-balão</th></tr></thead>
      <tbody>{q.doctors.map(d => <tr key={d.doctor.id}><td><strong>{d.doctor.name}</strong>{d.cases < QUALITY_MIN_CASES && <small className="hemo-code">poucos casos</small>}</td><td>{d.cases}</td>
        <td className={cmp(d.complicationRate, s.complicationRate, false)}>{fmt(d.complicationRate, '%')}</td><td className={cmp(d.radialShare, s.radialShare, true)}>{fmt(d.radialShare, '%')}</td>
        <td className={cmp(d.avgContrastMl, s.avgContrastMl, false)}>{fmt(d.avgContrastMl, ' mL')}</td><td className={cmp(d.avgFluoroMin, s.avgFluoroMin, false)}>{fmt(d.avgFluoroMin, ' min')}</td>
        <td className={cmp(d.avgKermaMgy, s.avgKermaMgy, false)}>{fmt(d.avgKermaMgy, ' mGy')}</td><td className={cmp(d.dtbMedian, s.dtbMedian, false)}>{d.dtbCases ? fmt(d.dtbMedian, ' min') : '—'}</td></tr>)}
        <tr className="hemo-quality-service"><td><strong>Média do serviço</strong></td><td>{s.cases}</td><td>{fmt(s.complicationRate, '%')}</td><td>{fmt(s.radialShare, '%')}</td><td>{fmt(s.avgContrastMl, ' mL')}</td><td>{fmt(s.avgFluoroMin, ' min')}</td><td>{fmt(s.avgKermaMgy, ' mGy')}</td><td>{s.dtbCases ? fmt(s.dtbMedian, ' min') : '—'}</td></tr></tbody></table></div>
    {q.doctors.length === 0 && <p className="empty-state">Nenhum procedimento concluído ainda.</p>}
  </section>;
}

// ---------- Previsão de compra ----------
export function ForecastPanel({ data, stock }: { data: HemoData; stock: DemoData }) {
  const [days, setDays] = useState(14), [copied, setCopied] = useState(false);
  const f = stockForecast(data, stock, days);
  const text = forecastText(f, stock.products);
  return <section className="panel"><div className="panel-head toolbar"><div><h2><TrendingUp size={16}/> Previsão de compra</h2><p>Pela agenda: {f.upcoming} procedimento(s) agendado(s) nos próximos {days} dias. OPME pedido na autorização + média de uso do mesmo procedimento no histórico. É estimativa: confira antes de comprar.</p></div>
    <div className="head-actions hemo-period">{[7, 14, 30].map(n => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n} dias</button>)}</div></div>
    {f.rows.length === 0 ? <p className="empty-state">Nenhum material previsto para os procedimentos agendados no período.</p> : <table className="hemo-table"><thead><tr><th>Material</th><th>Previsto</th><th>Disponível</th><th>Mínimo</th><th>Sugestão de compra</th></tr></thead>
      <tbody>{f.rows.map(r => <tr key={r.product.id}><td><strong>{r.product.name}</strong><small className="hemo-code">{r.product.supplier || 'fornecedor não informado'}</small></td><td>{r.expected}</td><td>{r.available}</td><td>{r.minimum}</td><td className={r.suggest ? 'is-low' : ''}>{r.suggest ? `${r.suggest} un.` : '—'}</td></tr>)}</tbody></table>}
    {(f.typesWithoutHistory.length > 0 || f.unscheduled > 0) && <p className="field-hint hemo-forecast-note">{f.typesWithoutHistory.length > 0 && `Sem histórico para: ${f.typesWithoutHistory.join(', ')} (só o OPME pedido entra). `}{f.unscheduled > 0 && `${f.unscheduled} pedido(s) ainda sem data não entram na conta.`}</p>}
    {f.rows.some(r => r.suggest) && <div className="head-actions hemo-forecast-actions"><button className="button secondary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false)); }}><ClipboardCopy size={15}/> {copied ? 'Copiado' : 'Copiar sugestão'}</button></div>}
  </section>;
}

export function PublicBoardButton() {
  return <button type="button" className="button secondary" onClick={openPublicBoard}><Monitor size={15}/> Painel para TV</button>;
}
