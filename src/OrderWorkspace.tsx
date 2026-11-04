import { useState } from 'react';
import { ArrowLeft, Plus, Search, X } from 'lucide-react';
import { availableQuantity, formatDate, getProduct, type DemoData, type Order, type OrderAllocation } from './data';
import { allocatedQuantity, allocationProblem, cancelOrder, candidates, checkOrderAllocation, createOrder, dispatchOrder, missingQuantity, orderStage, releaseOrderAllocation, reserveByExpiry, reserveOrder, resetOrderCheck, stockUnit, todayDate, type OrderInput } from './orderDomain';
import CameraReader from './CameraReader';

type Props = { data: DemoData; onChange: (data: DemoData) => void };
type Run = (change: (data: DemoData) => DemoData, message: string) => boolean;
export type OrderFilter = 'Abertos' | 'Reserva incompleta' | 'Prazo próximo' | 'Prontos' | 'Encerrados' | 'Todos';
const filters: OrderFilter[] = ['Abertos', 'Reserva incompleta', 'Prazo próximo', 'Prontos', 'Encerrados', 'Todos'];

export default function Orders({ data, onChange, initialFilter = 'Abertos', initialUnit = 'Todas as unidades' }: Props & { initialFilter?: OrderFilter; initialUnit?: string }) {
  const [creating, setCreating] = useState(false), [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<OrderFilter>(initialFilter), [unit, setUnit] = useState(initialUnit), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const selected = data.orders.find((o) => o.id === selectedId);
  const units = [...new Set([...data.stock.map(stockUnit), ...data.orders.map((o) => o.unit)])];
  const visible = data.orders.filter((order) => {
    const stage = orderStage(data, order), open = order.status === 'Aberto';
    const deadline = new Date(`${order.neededAt}T12:00:00`).getTime() - new Date(`${todayDate()}T12:00:00`).getTime();
    const matches = filter === 'Todos' || (filter === 'Abertos' && open) || (filter === 'Encerrados' && !open) || (filter === 'Prontos' && stage === 'Pronto para expedir') || (filter === 'Reserva incompleta' && open && missingQuantity(order) > 0) || (filter === 'Prazo próximo' && open && deadline <= 3 * 86400000 && stage !== 'Pronto para expedir');
    return matches && (unit === 'Todas as unidades' || order.unit === unit) && `${order.reference} ${order.hospital} ${order.procedure}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));
  }).sort((a, b) => a.neededAt.localeCompare(b.neededAt) || b.createdAt.localeCompare(a.createdAt));
  const run: Run = (change, text) => { setError(''); setMessage(''); try { onChange(change(data)); setMessage(text); return true; } catch (err) { setError((err as Error).message); return false; } };
  function open(id: string) { setSelectedId(id); setError(''); setMessage(''); }
  return <div className="module-stack orders-module">
    <div className="orders-intro"><p>Pedidos por hospital, reserva de lotes e conferência antes da saída.</p>{!creating && <button className="button primary" onClick={() => { setCreating(true); setError(''); setMessage(''); }}><Plus size={17}/> Novo pedido</button>}</div>
    {error && <p className="module-error" role="alert">{error}</p>}{message && <p className="module-success" role="status">{message}</p>}
    {creating ? <OrderForm data={data} onCancel={() => setCreating(false)} onSubmit={(input) => { const ok = run((current) => { const next = createOrder(current, input); setSelectedId(next.orders[0].id); return next; }, 'Pedido criado. Reserve os lotes para iniciar a separação.'); if (ok) { setCreating(false); setFilter('Abertos'); setUnit('Todas as unidades'); setSearch(''); } }}/>
      : <><div className={`orders-toolbar ${selected ? "with-selection" : ""}`}><label className="search"><Search size={16}/><input aria-label="Buscar pedidos" placeholder="Pedido, hospital ou procedimento" value={search} onChange={(e) => setSearch(e.target.value)}/></label><label>Situação<select value={filter} onChange={(e) => setFilter(e.target.value as OrderFilter)}>{filters.map((item) => <option key={item}>{item}</option>)}</select></label><label>Origem<select value={unit} onChange={(e) => setUnit(e.target.value)}><option>Todas as unidades</option>{units.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className={`orders-workspace ${selected ? 'has-selection' : ''}`}>
        <section className="panel orders-list" aria-label="Lista de pedidos"><div className="panel-head"><h2>Pedidos <span className="count-label">{visible.length}</span></h2></div>
          {!visible.length && <div className="orders-empty"><strong>{data.orders.length ? 'Nenhum pedido neste filtro.' : 'Nenhum pedido cadastrado.'}</strong><p>{data.orders.length ? 'Ajuste a busca ou a situação para consultar outros registros.' : 'Crie um pedido para vincular produtos a um hospital e reservar os lotes.'}</p>{data.orders.length > 0 ? <button className="button secondary" onClick={() => { setFilter('Todos'); setUnit('Todas as unidades'); setSearch(''); }}>Limpar filtros</button> : <button className="button secondary" onClick={() => setCreating(true)}>Criar primeiro pedido</button>}</div>}
          {visible.map((order) => <button className={`order-list-row ${order.id === selectedId ? 'selected' : ''}`} key={order.id} aria-pressed={order.id === selectedId} onClick={() => open(order.id)}><span className="order-row-top"><strong>{order.reference}</strong><time>{formatDate(order.neededAt)}</time></span><span className="order-hospital">{order.hospital}</span><small>{order.unit} · {order.lines.length} {order.lines.length === 1 ? 'produto' : 'produtos'}</small><Stage data={data} order={order}/></button>)}
        </section>
        {selected ? <section className="panel order-detail"><OrderDetail key={selected.id} data={data} order={selected} run={run} onBack={() => open('')}/></section> : <section className="panel orders-empty order-placeholder"><h2>Selecione um pedido</h2><p>O detalhe reúne a demanda, os lotes reservados e a conferência da expedição.</p><ol><li>Registre hospital, data e itens.</li><li>Reserve lotes elegíveis da unidade.</li><li>Confira códigos, lotes e quantidades.</li><li>Registre a expedição.</li></ol></section>}
      </div></>}
  </div>;
}

function Stage({ data, order }: { data: DemoData; order: Order }) {
  const stage = orderStage(data, order);
  return <span className={`order-stage ${stage === 'Pronto para expedir' || stage === 'Expedido' ? 'is-ready' : stage === 'Revisar reserva' ? 'is-risk' : ''}`}>{stage}</span>;
}

function OrderForm({ data, onSubmit, onCancel }: { data: DemoData; onSubmit: (input: OrderInput) => void; onCancel: () => void }) {
  const units = [...new Set(data.stock.map(stockUnit))];
  const [input, setInput] = useState<OrderInput>({ reference: '', hospital: '', procedure: '', neededAt: todayDate(), unit: units[0] ?? '', responsible: '', notes: '', lines: [{ productId: data.products[0]?.id ?? '', quantity: 1 }] });
  function field(key: keyof Omit<OrderInput, 'lines'>, value: string) { setInput((current) => ({ ...current, [key]: value })); }
  return <section className="panel order-create"><div className="panel-head"><div><h2>Novo pedido</h2><p>Use dados fictícios. Não registre nome ou informações de pacientes.</p></div><button className="icon-button" aria-label="Fechar novo pedido" onClick={onCancel}><X size={18}/></button></div><form className="module-form" onSubmit={(e) => { e.preventDefault(); onSubmit(input); }}>
    <div className="module-form-row"><label>Referência do pedido<input required maxLength={60} autoFocus value={input.reference} onChange={(e) => field('reference', e.target.value)} placeholder="Ex.: PED-DEMO-001"/></label><label>Hospital / destino<input required maxLength={160} value={input.hospital} onChange={(e) => field('hospital', e.target.value)} placeholder="Ex.: Hospital de demonstração"/></label></div>
    <div className="module-form-row"><label>Procedimento / finalidade<input required maxLength={160} value={input.procedure} onChange={(e) => field('procedure', e.target.value)} placeholder="Ex.: Atendimento de coluna — demonstração"/></label><label>Data necessária<input type="date" required min={todayDate()} value={input.neededAt} onChange={(e) => field('neededAt', e.target.value)}/></label></div>
    <div className="module-form-row"><label>Unidade de origem<select required value={input.unit} onChange={(e) => field('unit', e.target.value)}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>Responsável pelo pedido<input required maxLength={100} value={input.responsible} onChange={(e) => field('responsible', e.target.value)} placeholder="Ex.: Equipe comercial — demonstração"/></label></div>
    <fieldset className="order-items-fieldset"><legend>Produtos solicitados</legend>{input.lines.map((line, index) => <div className="order-input-line" key={index}><label>Produto {index + 1}<select required value={line.productId} onChange={(e) => setInput({ ...input, lines: input.lines.map((item, i) => i === index ? { ...item, productId: e.target.value } : item) })}>{data.products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}</select></label><label>Quantidade {index + 1}<input required type="number" min="1" step="1" inputMode="numeric" value={line.quantity || ''} onChange={(e) => setInput({ ...input, lines: input.lines.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) } : item) })}/></label><button type="button" className="icon-button" aria-label={`Remover produto ${index + 1}`} disabled={input.lines.length === 1} onClick={() => setInput({ ...input, lines: input.lines.filter((_, i) => i !== index) })}><X size={17}/></button></div>)}<button type="button" className="button secondary" disabled={input.lines.length >= data.products.length} onClick={() => setInput({ ...input, lines: [...input.lines, { productId: data.products.find((p) => !input.lines.some((l) => l.productId === p.id))?.id ?? '', quantity: 1 }] })}><Plus size={15}/> Adicionar produto</button></fieldset>
    <label>Observações (opcional)<textarea maxLength={600} rows={2} value={input.notes} onChange={(e) => field('notes', e.target.value)}/></label>
    <p className="module-note">A criação não compromete saldo. Depois de criar, reserve os lotes. Para corrigir os dados de um pedido criado, cancele com motivo e registre uma nova referência.</p>
    <div className="module-actions"><button className="button primary" type="submit">Criar pedido</button><button className="button secondary" type="button" onClick={onCancel}>Cancelar cadastro</button></div>
  </form></section>;
}

function OrderDetail({ data, order, run, onBack }: { data: DemoData; order: Order; run: Run; onBack: () => void }) {
  const [cancelReason, setCancelReason] = useState(''), [shipment, setShipment] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const stage = orderStage(data, order), isOpen = order.status === 'Aberto';
  const requested = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const reserved = order.allocations.reduce((sum, a) => sum + a.quantity, 0), checked = order.allocations.reduce((sum, a) => sum + a.checked, 0);
  return <>
    <div className="panel-head"><div><button className="text-link order-back" onClick={onBack}><ArrowLeft size={15}/> Voltar à lista</button><h2>{order.reference}</h2><p>{order.hospital}</p></div><Stage data={data} order={order}/></div>
    <div className="order-detail-body"><dl className="order-meta"><div><dt>Procedimento / finalidade</dt><dd>{order.procedure}</dd></div><div><dt>Data necessária</dt><dd>{formatDate(order.neededAt)}</dd></div><div><dt>Origem</dt><dd>{order.unit}</dd></div><div><dt>Responsável informado</dt><dd>{order.responsible}</dd></div></dl>{order.notes && <p className="module-note">{order.notes}</p>}
      <div className="order-progress" aria-label="Progresso do atendimento"><span>Solicitado<strong>{requested} un.</strong></span><span>{order.status === 'Expedido' ? 'Expedido' : 'Reservado'}<strong>{reserved} un.</strong></span><span>Conferido<strong>{checked} un.</strong></span></div>
      {order.status === 'Expedido' && <p className="module-success">Expedição registrada em {new Date(order.dispatchedAt!).toLocaleString('pt-BR')} · {order.shipment}. Saída de estoque concluída; entrega e consumo no hospital não são acompanhados nesta versão.</p>}
      {order.status === 'Cancelado' && <p className="module-note">Cancelado em {new Date(order.cancelledAt!).toLocaleString('pt-BR')}. Motivo: {order.cancelReason}. As reservas foram liberadas; o histórico permanece no registro local de alterações.</p>}
      <section className="order-section"><div className="order-section-head"><div><h3>1. Itens e reserva de lotes</h3><p>Saldo da unidade, com validade até a data necessária.</p></div>{isOpen && <button className="button secondary" disabled={!missingQuantity(order)} onClick={() => run((current) => reserveByExpiry(current, order.id), 'Reserva por validade aplicada. Confira abaixo os itens que ainda faltam.')}>Reservar por validade</button>}</div>
        <p className="module-note">A seleção prioriza o menor vencimento elegível. Reservas manuais anteriores e de outros pedidos são preservadas.</p>
        {order.lines.map((line) => { const product = getProduct(line.productId, data.products), allocated = allocatedQuantity(order, line.id); return <article className="order-line" key={line.id}><div className="order-line-heading"><div><strong>{product.name}</strong><small>{product.code}</small></div><span>{allocated} / {line.quantity} un. {order.status === 'Expedido' ? 'expedidas' : 'reservadas'}</span></div>{isOpen && allocated < line.quantity && <><p className="order-shortage">Faltam reservar {line.quantity - allocated} un.</p><ManualReservation key={`${line.id}:${allocated}`} data={data} order={order} lineId={line.id} run={run}/></>}{order.allocations.filter((a) => a.lineId === line.id).map((allocation) => <AllocationRow key={allocation.id} data={data} order={order} allocation={allocation} run={run}/>)}</article>; })}
      </section>
      {isOpen && <><section className="order-section"><div className="order-section-head"><div><h3>2. Separação e conferência</h3><p>Confira produto, lote e quantidade em cada posição reservada.</p></div></div>{order.allocations.length ? <PickingForm data={data} order={order} run={run}/> : <p className="module-note">Reserve ao menos um lote para iniciar a conferência.</p>}</section>
      <section className="order-section"><div className="order-section-head"><div><h3>3. Expedição</h3><p>Baixa o físico e encerra as reservas deste pedido em uma única operação.</p></div></div><form className="module-form-inner order-dispatch" onSubmit={(e) => { e.preventDefault(); if (confirmed) run((current) => dispatchOrder(current, order.id, shipment), 'Pedido expedido. A saída por lote foi registrada no histórico.'); }}><label>Referência de expedição / transporte<input required value={shipment} onChange={(e) => setShipment(e.target.value)} placeholder="Ex.: ROM-DEMO-001" disabled={stage !== 'Pronto para expedir'}/></label><label className="order-check"><input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={stage !== 'Pronto para expedir'}/>Conferi os volumes e o hospital de destino.</label>{stage !== 'Pronto para expedir' && <p className="module-note">A expedição será habilitada após reserva e conferência completas, com lotes válidos.</p>}<button className="button primary" disabled={stage !== 'Pronto para expedir' || !confirmed || !shipment.trim()}>Registrar expedição</button></form></section>
      <details className="order-cancel"><summary>Cancelar pedido e liberar reservas</summary><form className="module-form-inner" onSubmit={(e) => { e.preventDefault(); run((current) => cancelOrder(current, order.id, cancelReason), 'Pedido cancelado. Reservas liberadas e motivo registrado.'); }}><label>Motivo do cancelamento<input required value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}/></label><button className="button secondary">Confirmar cancelamento</button></form></details></>}
    </div>
  </>;
}

function ManualReservation({ data, order, lineId, run }: { data: DemoData; order: Order; lineId: string; run: Run }) {
  const line = order.lines.find((l) => l.id === lineId)!;
  const options = candidates(data, order, line.productId);
  const [stockId, setStockId] = useState(''), [quantity, setQuantity] = useState('1');
  return <details className="order-manual"><summary>Escolher lote manualmente</summary>{options.length ? <form className="module-form-inner" onSubmit={(e) => { e.preventDefault(); run((current) => reserveOrder(current, order.id, line.id, stockId, Number(quantity)), 'Reserva vinculada ao pedido.'); }}><label>Lote para {getProduct(line.productId, data.products).name}<select required value={stockId} onChange={(e) => setStockId(e.target.value)}><option value="">Selecione o lote e local</option>{options.map((stock) => <option key={stock.id} value={stock.id}>{stock.lot} · {stock.location} · {availableQuantity(stock)} livres · {formatDate(stock.expiresAt)}</option>)}</select></label><label>Quantidade a reservar<input type="number" min="1" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)}/></label><button className="button secondary">Reservar lote escolhido</button></form> : <p className="module-note">Sem saldo elegível na unidade. Revise disponibilidade e data necessária.</p>}</details>;
}

function AllocationRow({ data, order, allocation, run }: { data: DemoData; order: Order; allocation: OrderAllocation; run: Run }) {
  const stock = data.stock.find((s) => s.id === allocation.stockId)!;
  const [reason, setReason] = useState('');
  const problem = order.status === 'Aberto' ? allocationProblem(data, order, allocation) : '';
  return <div className="order-allocation"><div><strong>Lote {stock.lot}</strong><small>{stock.location} · validade {formatDate(stock.expiresAt)}</small><span>{allocation.quantity} un. · {allocation.checked} conferidas</span></div>{problem && <p className="module-error">{problem}</p>}{order.status === 'Aberto' && <details><summary>Liberar reserva</summary><form className="module-form-inner" onSubmit={(e) => { e.preventDefault(); run((current) => releaseOrderAllocation(current, order.id, allocation.id, reason), 'Reserva liberada. A conferência desse lote foi descartada.'); }}><label>Motivo para liberar {stock.lot}<input required value={reason} onChange={(e) => setReason(e.target.value)}/></label><button className="button secondary">Liberar {allocation.quantity} un.</button></form></details>}</div>;
}

function PickingForm({ data, order, run }: { data: DemoData; order: Order; run: Run }) {
  const [allocationId, setAllocationId] = useState(''), [code, setCode] = useState(''), [lot, setLot] = useState(''), [quantity, setQuantity] = useState('1');
  const allocation = order.allocations.find((a) => a.id === allocationId);
  return <div className="module-form-inner order-picking"><label>Posição reservada para conferência<select value={allocation?.id ?? ''} onChange={(e) => { setAllocationId(e.target.value); setCode(''); setLot(''); setQuantity('1'); }}><option value="">Selecione a posição reservada</option>{order.allocations.map((item) => { const stock = data.stock.find((s) => s.id === item.stockId)!; return <option key={item.id} value={item.id}>{getProduct(stock.productId, data.products).name} · {stock.lot} · {stock.location} · {item.checked}/{item.quantity} conferidas</option>; })}</select></label>
    {allocation && <form className="module-form-inner" onSubmit={(e) => { e.preventDefault(); if (run((current) => checkOrderAllocation(current, order.id, allocation.id, code, lot, Number(quantity)), 'Quantidade conferida. Confira o progresso do pedido.')) { setCode(''); setLot(''); setQuantity('1'); } }}>
      <p className="module-note">Leia o código interno do produto e o lote separadamente. Um código de produto não comprova o lote. No bipador em modo teclado, Enter avança para o próximo campo.</p>
      <label>Código do produto conferido<input required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.querySelector<HTMLInputElement>('[name="picking-lot"]')?.focus(); } }} placeholder="Bipe ou digite o código interno"/></label>
      <CameraReader onRead={setCode}/>
      <div className="module-form-row"><label>Lote conferido<input required name="picking-lot" autoComplete="off" value={lot} onChange={(e) => setLot(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.querySelector<HTMLInputElement>('[name="picking-quantity"]')?.focus(); } }}/></label><label>Quantidade nesta conferência<input required name="picking-quantity" type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)}/></label></div>
      <div className="module-actions"><button className="button primary" disabled={allocation.checked === allocation.quantity}>Conferir quantidade</button><button className="button secondary" type="button" disabled={!allocation.checked} onClick={() => run((current) => resetOrderCheck(current, order.id, allocation.id), 'Conferência reiniciada. Leia novamente o produto e lote.')}>Reiniciar conferência</button></div>
    </form>}
  </div>;
}
