import { useState } from 'react';
import { availableQuantity, daysToExpiry, getProduct, orderReservedQuantity, type DemoData, type Stock } from './data';
import { allocate, receiveTransfer } from './domain';

type Props = { data: DemoData; onChange: (data: DemoData) => void };
export default function StockControls({ data, onChange }: Props) {
  const [stockId, setStockId] = useState(data.stock[0]?.id ?? ''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const stock = data.stock.find((s) => s.id === stockId) ?? data.stock[0];
  const pending = data.transfers.filter((t) => !t.receivedAt);
  return <div className="module-stack stock-controls">
    {message && <p className="module-success" role="status">{message}</p>}
    <section className="panel"><div className="panel-head"><div><h2>Disponibilidade por situação</h2><p>Quantidades separadas dentro do saldo físico. Lotes vencidos nunca entram no disponível.</p></div></div><div className="module-form"><label>Posição para revisar<select value={stock?.id ?? ''} onChange={(e) => setStockId(e.target.value)}>{data.stock.map((s) => <option key={s.id} value={s.id}>{getProduct(s.productId, data.products).name} · {s.lot} · {s.location}</option>)}</select></label>{stock && <AllocationForm key={`${stock.id}:${stock.revision}`} stock={stock} data={data} onChange={(next) => { onChange(next); setMessage("Situações atualizadas. O saldo disponível foi recalculado."); }}/>}</div></section>
    <section className="panel"><div className="panel-head"><div><h2>Transferências em trânsito</h2><p>O saldo só entra no destino após a confirmação, em quarentena para conferência.</p></div></div><div className="module-form">{error && <p className="module-error" role="alert">{error}</p>}{!pending.length && <p className="module-note">Nenhuma transferência aguardando recebimento.</p>}{pending.map((transfer) => <article className="transfer-record" key={transfer.id}><div><strong>{getProduct(transfer.productId, data.products).name} · {transfer.quantity} un.</strong><small>Lote {transfer.lot} · {transfer.from} → {transfer.to}</small><small>{new Date(transfer.date).toLocaleString('pt-BR')}</small></div><button className="button secondary" onClick={() => { setError(''); setMessage(''); try { onChange(receiveTransfer(data, transfer.id)); setMessage('Recebimento confirmado em quarentena. Revise a posição no destino.'); } catch (err) { setError((err as Error).message); } }}>Confirmar recebimento</button></article>)}</div></section>
    <section className="panel"><div className="panel-head"><div><h2>Registro local de alterações</h2><p>Histórico demonstrativo de cadastros, situações e contagens. Sem auditoria de produção.</p></div></div><div className="audit-list">{!data.audit.length && <p className="module-note">As próximas alterações aparecerão aqui.</p>}{data.audit.slice(0, 30).map((event) => <div key={event.id}><time>{new Date(event.date).toLocaleString('pt-BR')}</time><strong>{event.action}</strong><span>{event.detail}</span></div>)}{data.audit.length > 30 && <p className="module-note">Exibindo as 30 alterações mais recentes.</p>}</div></section>
  </div>;
}
function AllocationForm({ stock, data, onChange }: Props & { stock: Stock }) {
  const linked = orderReservedQuantity(data, stock.id);
  const [reserved, setReserved] = useState(String(stock.reserved)), [blocked, setBlocked] = useState(String(stock.blocked)), [quarantined, setQuarantined] = useState(String(stock.quarantined));
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  return <form className="module-form-inner" onSubmit={(e) => { e.preventDefault(); setError(''); try { onChange(allocate(data, stock.id, Number(reserved), Number(blocked), Number(quarantined), reason)); } catch (err) { setError((err as Error).message); } }}>
    <div className="availability-summary"><span>Físico<strong>{stock.quantity} un.</strong></span><span>Disponível<strong>{availableQuantity(stock)} un.</strong></span></div>
    {daysToExpiry(stock.expiresAt) < 0 && <p className="module-error">Lote vencido: nenhuma quantidade disponível para saída ou transferência.</p>}
    <div className="module-form-row three-columns"><label>Reservado (un.)<input required type="number" min={linked} step="1" value={reserved} onChange={(e) => setReserved(e.target.value)}/></label><label>Bloqueado (un.)<input required type="number" min="0" step="1" value={blocked} onChange={(e) => setBlocked(e.target.value)}/></label><label>Quarentena (un.)<input required type="number" min="0" step="1" value={quarantined} onChange={(e) => setQuarantined(e.target.value)}/></label></div>
    <label>Motivo da alteração<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: reserva interna ou conferência concluída"/></label>
    <p className="module-note">Informe o total em cada situação. Das {stock.reserved} un. reservadas, {linked} estão vinculadas a pedidos e {stock.reserved - linked} são reservas internas. Reservas vinculadas só podem ser liberadas na tela Pedidos.</p>
    {error && <p className="module-error" role="alert">{error}</p>}<button className="button primary">Salvar situações</button>
  </form>;
}
