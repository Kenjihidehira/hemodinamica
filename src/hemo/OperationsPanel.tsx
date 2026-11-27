import { useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { assertCan, can, type User } from '../auth/domain';
/** Quem está logado: só o que a tela precisa (nome para a autoria, perfil para a permissão). */
export type Actor = Pick<User, 'name' | 'role' | 'active'>;
import { HEMO_CATEGORY } from '../data';
import { patientOf, typeOf } from './domain';
import { brl, cancellations, caseCost, costByType, delays, LATE_TOLERANCE_MIN, parseMoney, periodEndingToday, ROOM_WINDOW, roomUsage, saveValues, turnovers, type ValuesInput } from './operations';
import { dateTime, when, type Props } from './ui';

const periods = [7, 30, 90] as const;
const hours = (min: number) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
const money = (cents: number | null) => cents === null ? '—' : brl(cents);
const decimalPct = (value: number) => `${value.toLocaleString('pt-BR')}%`;
const showMoney = (cents: number | null | undefined) => cents === null || cents === undefined ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

/** Aba Gestão: ocupação das salas, atrasos, cancelamentos e custo por procedimento. */
export function Operations({ data, update, stock, user }: Props & { user: Actor }) {
  const [days, setDays] = useState<typeof periods[number]>(30);
  const period = periodEndingToday(days);
  const usage = roomUsage(data, period), turn = turnovers(data, period), late = delays(data, period), cancel = cancellations(data, period);
  const costs = costByType(data, stock.products, period);
  const totalInside = usage.reduce((s, u) => s + u.insideMin, 0), totalAvailable = usage.reduce((s, u) => s + u.availableMin, 0), totalBlocked = usage.reduce((s, u) => s + u.blockedMin, 0);
  const pct = (part: number, total: number) => total ? `${Math.round(100 * part / total)}%` : '—';
  return <div className="module-stack">
    <div className="hemo-period" role="group" aria-label="Período">
      <span>Período</span>
      {periods.map(p => <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>Últimos {p} dias</button>)}
      <small>{period.from.split('-').reverse().join('/')} a {period.to.split('-').reverse().join('/')} · só o que foi registrado nos procedimentos deste navegador</small>
    </div>
    <div className="hemo-kpis">
      <div><span>Uso das salas</span><strong>{totalAvailable ? decimalPct(Math.round(1000 * totalInside / totalAvailable) / 10) : '—'}</strong><small>{hours(totalInside)} de sala em {hours(totalAvailable)} disponíveis ({ROOM_WINDOW.from}–{ROOM_WINDOW.to}, {data.rooms.length} salas){totalBlocked ? ` · ${hours(totalBlocked)} parada(s) por bloqueio` : ''}</small></div>
      <div><span>Eletivos no horário</span><strong>{pct(late.onTime, late.items.length)}</strong><small>{late.items.length ? `${late.onTime} de ${late.items.length} · atraso mediano ${late.median} min · tolerância ${LATE_TOLERANCE_MIN} min` : 'nenhum eletivo com entrada em sala no período'}</small></div>
      <div><span>Intervalo entre casos</span><strong>{turn.median === null ? '—' : `${turn.median} min`}</strong><small>{turn.items.length ? `mediana de ${turn.items.length} troca(s) de paciente · ${turn.overPlanned} acima do preparo previsto` : 'nenhuma sala com dois casos seguidos no mesmo dia'}</small></div>
      <div><span>Cancelamentos</span><strong className={cancel.total ? 'is-bad' : ''}>{cancel.rate === null ? '—' : decimalPct(cancel.rate)}</strong><small>{cancel.total} cancelado(s) e {cancel.done} realizado(s) no período</small></div>
    </div>

    <section className="panel"><div className="panel-head"><div><h2>Ocupação por sala</h2><p>Tempo de sala = da entrada do paciente ao fim do procedimento. O percentual considera só a janela de {ROOM_WINDOW.from} às {ROOM_WINDOW.to}, todos os dias, descontado o tempo de sala bloqueada (manutenção). O uso fora da janela (urgências à noite) aparece à parte.</p></div></div>
      <table className="hemo-table"><thead><tr><th>Sala</th><th>Procedimentos</th><th>Tempo na janela</th><th>Parada (bloqueio)</th><th>Uso</th><th>Fora da janela</th></tr></thead>
        <tbody>{usage.map(u => <tr key={u.room.id}><td>{u.room.name}</td><td>{u.procedures}</td><td>{hours(u.insideMin)}</td><td className={u.blockedMin ? 'is-low' : ''}>{u.blockedMin ? hours(u.blockedMin) : '—'}</td><td><span className="hemo-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, u.utilization ?? 0)}%` }}/></span>{u.utilization === null ? '—' : `${u.utilization.toLocaleString('pt-BR')}%`}</td><td>{u.outsideMin ? hours(u.outsideMin) : '—'}</td></tr>)}</tbody></table>
    </section>

    <div className="hemo-two">
      <section className="panel"><div className="panel-head"><div><h2>Atrasos dos eletivos</h2><p>Entrada em sala comparada com o horário agendado.</p></div></div>
        {late.items.length === 0 ? <p className="empty-state">Nenhum eletivo entrou em sala no período.</p> : <table className="hemo-table"><thead><tr><th>Paciente</th><th>Agendado</th><th>Entrada</th><th>Diferença</th></tr></thead><tbody>{late.items.map(({ c, minutes }) => <tr key={c.id}><td>{patientOf(data, c).name}</td><td>{when(c.schedule!.start)}</td><td>{when(c.intra.roomIn)}</td><td className={minutes > LATE_TOLERANCE_MIN ? 'is-low' : ''}>{minutes > 0 ? `+${minutes}` : minutes} min</td></tr>)}</tbody></table>}
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Cancelamentos por motivo</h2><p>Motivo escolhido ao cancelar. Autorização negada entra sozinha.</p></div></div>
        {cancel.byCategory.length === 0 ? <p className="empty-state">Nenhum cancelamento no período.</p> : <table className="hemo-table"><thead><tr><th>Motivo</th><th>Casos</th></tr></thead><tbody>{cancel.byCategory.map(x => <tr key={x.category}><td>{x.category}<small className="hemo-code">{x.cases.map(c => patientOf(data, c).name).join(', ')}</small></td><td>{x.cases.length}</td></tr>)}</tbody></table>}
      </section>
    </div>

    {turn.items.length > 0 && <section className="panel"><div className="panel-head"><div><h2>Trocas de paciente</h2><p>Fim de um procedimento até a entrada do seguinte, na mesma sala e no mesmo dia.</p></div></div>
      <table className="hemo-table"><thead><tr><th>Sala</th><th>Depois de</th><th>Antes de</th><th>Intervalo</th><th>Preparo previsto</th></tr></thead><tbody>{turn.items.map(t => <tr key={t.after.id}><td>{data.rooms.find(r => r.id === t.roomId)?.name}</td><td>{patientOf(data, t.before).name} · {when(t.before.intra.end)}</td><td>{patientOf(data, t.after).name} · {when(t.after.intra.roomIn || t.after.intra.start)}</td><td className={t.minutes > t.plannedMin ? 'is-low' : ''}>{t.minutes} min</td><td>{t.plannedMin} min</td></tr>)}</tbody></table>
    </section>}

    <section className="panel"><div className="panel-head"><div><h2>Custo por procedimento</h2><p>Materiais usados × custo unitário da tabela de valores, comparado com o valor de referência do procedimento. Medicamentos, honorários e glosas não entram. Sem custo de algum material ou sem valor do procedimento, a margem não é calculada.</p></div></div>
      {costs.length === 0 ? <p className="empty-state">Nenhum procedimento concluído no período.</p> : <>
        <table className="hemo-table"><thead><tr><th>Procedimento</th><th>Concluídos</th><th>Materiais (média)</th><th>Valor de referência</th><th>Margem sobre materiais (média)</th></tr></thead>
          <tbody>{costs.map(x => <tr key={x.type.id}><td>{x.type.name}{x.incomplete ? <small className="hemo-code">{x.incomplete} caso(s) sem custo completo</small> : null}</td><td>{x.cases}</td><td>{money(x.avgMaterialsCents)}</td><td>{x.valueCents === null ? 'a definir' : brl(x.valueCents)}</td><td className={x.avgMarginCents !== null && x.avgMarginCents < 0 ? 'is-low' : ''}>{money(x.avgMarginCents)}</td></tr>)}</tbody></table>
        <details className="hemo-cost-cases"><summary>Ver caso a caso</summary>
          <table className="hemo-table"><thead><tr><th>Paciente</th><th>Procedimento</th><th>Materiais</th><th>Margem</th><th>Falta</th></tr></thead>
            <tbody>{costs.flatMap(x => x.items).map(({ c, cost }) => <tr key={c.id}><td>{patientOf(data, c).name}</td><td>{typeOf(data, c).name}</td><td>{money(cost.materialsCents)}</td><td className={cost.marginCents !== null && cost.marginCents < 0 ? 'is-low' : ''}>{money(cost.marginCents)}</td><td>{[cost.valueCents === null && 'valor do procedimento', cost.missing.length && `custo de ${cost.missing.join(', ')}`].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table>
        </details>
      </>}
    </section>

    <ValuesTable data={data} update={update} stock={stock} user={user}/>
  </div>;
}

/** Tabela de custos e valores. Começa vazia; só administradores alteram. */
function ValuesTable({ data, update, stock, user }: Pick<Props, 'data' | 'update' | 'stock'> & { user: Actor }) {
  const allowed = can(user, 'valores.editar');
  const materials = stock.products.filter(p => p.category === HEMO_CATEGORY);
  const initial = () => ({ materials: Object.fromEntries(materials.map(p => [p.id, showMoney(data.values.materials[p.id])])), procedures: Object.fromEntries(data.types.map(t => [t.id, showMoney(data.values.procedures[t.id])])) });
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState('');
  const dirty = JSON.stringify(form) !== JSON.stringify(initial());
  const empty = !Object.keys(data.values.materials).length && !Object.keys(data.values.procedures).length;
  function save() {
    setProblem('');
    const parse = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, parseMoney(v)]));
    let input: ValuesInput;
    try { input = { materials: parse(form.materials), procedures: parse(form.procedures) }; }
    catch (e) { setProblem((e as Error).message); return; }
    const reformat = (record: Record<string, number | null>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, showMoney(v)]));
    if (update(d => { assertCan(user, 'valores.editar'); return saveValues(d, input, user.name); })) setForm({ materials: reformat(input.materials), procedures: reformat(input.procedures) });
  }
  const field = (group: 'materials' | 'procedures', id: string, label: string) => <label key={id}>{label}<span className="hemo-money"><span>R$</span><input inputMode="decimal" value={form[group][id] ?? ''} disabled={!allowed} placeholder="a definir" onChange={e => setForm({ ...form, [group]: { ...form[group], [id]: e.target.value } })}/></span></label>;
  return <section className="panel"><div className="panel-head"><div><h2>Tabela de custos e valores</h2><p>Valores do serviço, preenchidos pelo financeiro: custo unitário de cada material e valor de referência de cada procedimento. Campo vazio fica "a definir" e não entra nas contas.{data.values.updatedAt ? ` Última alteração: ${data.values.updatedBy || 'sem autor'}, ${dateTime(data.values.updatedAt)}.` : ''}</p></div>{!allowed && <span className="count-label"><Lock size={13}/> somente administradores alteram</span>}</div>
    {empty && <p className="hemo-note-warn"><AlertTriangle size={15}/>Nenhum valor cadastrado ainda. O custo por procedimento aparece depois que a tabela for preenchida.</p>}
    <div className="hemo-values">
      <fieldset><legend>Procedimentos · valor de referência</legend>{data.types.map(t => field('procedures', t.id, t.name))}</fieldset>
      <fieldset><legend>Materiais da hemodinâmica · custo unitário</legend>{materials.map(p => field('materials', p.id, p.name))}</fieldset>
    </div>
    {problem && <p className="module-error" role="alert">{problem}</p>}
    {allowed && <div className="head-actions"><button className="button primary" disabled={!dirty} onClick={save}>Salvar tabela</button>{dirty && <button className="text-link" onClick={() => { setForm(initial()); setProblem(''); }}>Descartar alterações</button>}</div>}
  </section>;
}

/** Linha de custo no faturamento do caso. */
export function CaseCostLine({ data, stock, c }: Pick<Props, 'data' | 'stock'> & { c: Parameters<typeof caseCost>[2] }) {
  const cost = caseCost(data, stock.products, c);
  if (!c.materials.length && cost.valueCents === null) return null;
  return <p className="field-hint hemo-cost-line"><strong>Custo de materiais:</strong> {money(cost.materialsCents)}{cost.missing.length ? ` (sem custo cadastrado: ${cost.missing.join(', ')})` : ''} · <strong>valor de referência:</strong> {cost.valueCents === null ? 'a definir' : brl(cost.valueCents)}{cost.marginCents !== null ? <> · <strong>margem sobre materiais:</strong> {brl(cost.marginCents)}</> : null}</p>;
}
