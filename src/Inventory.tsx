import { useRef, useState } from 'react';
import { getProduct, type DemoData } from './data';
import { canonical, reviewCount, submitCount } from './domain';
import CameraReader from './CameraReader';

export default function Inventory({ data, onChange }: { data: DemoData; onChange: (data: DemoData) => void }) {
  const [code, setCode] = useState(''), [matches, setMatches] = useState<string[] | null>(null);
  const [selection, setSelection] = useState<{ id: string; revision: number } | null>(null);
  const [counted, setCounted] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const quantityInput = useRef<HTMLInputElement>(null);
  function choose(id: string) { const stock = data.stock.find((s) => s.id === id); setSelection(stock ? { id, revision: stock.revision } : null); setCounted(''); setReason(''); setError(''); }
  function lookup(value = code) {
    setError(''); setMessage(''); setCode(value);
    const key = canonical(value);
    if (!key) { setError('Informe um código de produto ou lote.'); return; }
    const items = data.stock.filter((s) => canonical(s.lot) === key || canonical(getProduct(s.productId, data.products).code) === key);
    setMatches(items.map((s) => s.id)); choose(items.length === 1 ? items[0].id : '');
    setMessage(items.length ? `${items.length} posição(ões) encontrada(s). Confira o lote e o local.` : 'Código não encontrado.');
    if (items.length === 1) quantityInput.current?.focus();
  }
  function review(id: string, approve: boolean) { setError(''); setMessage(''); try { onChange(reviewCount(data, id, approve)); setMessage(approve ? 'Revisão simulada concluída. Saldo atualizado.' : 'Contagem rejeitada. Faça uma nova conferência.'); } catch (err) { setError((err as Error).message); } }
  const options = matches ? data.stock.filter((s) => matches.includes(s.id)) : data.stock;
  return <div className="module-stack">
    <div className="workflow-note"><strong>Contagem → conferência → ajuste</strong><span>O saldo esperado é mostrado após o registro. A revisão nesta demonstração não substitui aprovação por outro usuário.</span></div>
    {error && <p role="alert" className="module-error">{error}</p>}{message && <p role="status" className="module-success">{message}</p>}
    <section className="panel"><div className="panel-head"><div><h2>Nova contagem física</h2><p>Conte todas as unidades da posição, inclusive reservadas, bloqueadas e em quarentena.</p></div></div><div className="module-form">
      <label>Código ou lote para contagem<div className="scan-input"><input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} placeholder="Bipe ou digite a etiqueta"/><button type="button" className="button secondary" onClick={() => lookup()}>Localizar</button></div></label>
      <CameraReader onRead={lookup}/>
      <form className="module-form-inner" onSubmit={(e) => { e.preventDefault(); setError(''); setMessage(''); try { if (!selection || counted === '') throw new Error('Selecione a posição e informe a contagem.'); onChange(submitCount(data, selection.id, selection.revision, Number(counted), reason)); setMessage('Contagem registrada. Confira o resultado abaixo.'); setSelection(null); setCounted(''); setReason(''); } catch (err) { setError((err as Error).message); } }}>
        <label>Produto · lote · local<select required value={selection?.id ?? ''} onChange={(e) => choose(e.target.value)}><option value="">Selecione a posição a contar</option>{options.map((s) => <option key={s.id} value={s.id}>{getProduct(s.productId, data.products).name} · {s.lot} · {s.location}</option>)}</select></label>
        {matches && <button className="text-link" type="button" onClick={() => { setMatches(null); setCode(''); choose(''); }}>Mostrar todas as posições</button>}
        <div className="module-form-row"><label>Quantidade contada (un.)<input ref={quantityInput} type="number" required min="0" step="1" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)}/></label><label>Justificativa / observação<input placeholder="Obrigatória se houver divergência" value={reason} onChange={(e) => setReason(e.target.value)}/></label></div>
        <button className="button primary" type="submit">Registrar contagem</button>
      </form>
    </div></section>
    <section className="panel"><div className="panel-head"><div><h2>Conferência das contagens</h2><p>{data.counts.filter((c) => c.status === 'Pendente').length} pendentes de revisão</p></div></div><div className="count-list">{!data.counts.length && <p className="empty-state">Nenhuma contagem registrada.</p>}{data.counts.map((count) => {
      const stock = data.stock.find((s) => s.id === count.stockId)!;
      const diff = count.counted - count.expected;
      const stale = count.status === 'Pendente' && stock.revision !== count.revision;
      return <article className="count-record" key={count.id}><div className="record-title"><div><strong>{getProduct(stock.productId, data.products).name}</strong><small>{stock.lot} · {stock.location}</small></div><span className="record-status">{count.status}</span></div><div className="count-values"><span>Esperado<strong>{count.expected}</strong></span><span>Contado<strong>{count.counted}</strong></span><span>Diferença<strong className={diff ? 'import-error' : ''}>{diff > 0 ? '+' : ''}{diff}</strong></span></div><p className="module-note">{new Date(count.date).toLocaleString('pt-BR')} · {count.reason || 'Sem observação'}</p>{stale && <p className="module-error">Saldo alterado após a contagem. Rejeite e conte novamente.</p>}{count.status === 'Pendente' && <div className="module-actions"><button className="button primary" disabled={stale} onClick={() => review(count.id, true)}>Aplicar revisão simulada</button><button className="button secondary" onClick={() => review(count.id, false)}>Rejeitar contagem</button></div>}</article>;
    })}</div></section>
  </div>;
}
