import { useMemo, useState } from 'react';
import { Download, FileUp, Plus } from 'lucide-react';
import { type DemoData, type Product } from './data';
import { addPosition, saveProduct } from './domain';
import { commitImport, downloadText, inspectImport, parseCsv, template, type SheetRows } from './importing';

type Props = { data: DemoData; onChange: (data: DemoData) => void };
const blank = (): Product => ({ id: crypto.randomUUID(), code: '', name: '', category: '', minimum: 0, manufacturer: '', supplier: '' });
export default function Catalog({ data, onChange }: Props) {
  const [tab, setTab] = useState<'products' | 'positions' | 'import'>('products');
  const [product, setProduct] = useState<Product>(blank);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function changeTab(next: typeof tab) { setTab(next); setMessage(''); setError(''); }
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    try { onChange(saveProduct(data, product)); setMessage('Produto salvo. Já está disponível para cadastro de lotes.'); setProduct(blank()); }
    catch (err) { setError((err as Error).message); }
  }
  return <div className="module-stack">
    <div className="module-tabs" role="group" aria-label="Áreas de cadastro">{[['products', 'Produtos'], ['positions', 'Novo lote'], ['import', 'Importar planilha']].map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => changeTab(key as typeof tab)}>{label}</button>)}</div>
    {message && <p role="status" className="module-success">{message}</p>}{error && <p role="alert" className="module-error">{error}</p>}
    {tab === 'products' && <div className="module-columns"><section className="panel"><div className="panel-head"><div><h2>{data.products.some((p) => p.id === product.id) ? 'Editar produto' : 'Novo produto'}</h2><p>Saldo mínimo global; quantidades em unidades.</p></div></div><form className="module-form" onSubmit={submit}>
      <label>Código interno<input required value={product.code} onChange={(e) => setProduct({ ...product, code: e.target.value })}/></label>
      <label>Nome do produto<input required value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })}/></label>
      <div className="module-form-row"><label>Especialidade<input required value={product.category} onChange={(e) => setProduct({ ...product, category: e.target.value })}/></label><label>Saldo mínimo<input required type="number" min="0" step="1" value={product.minimum} onChange={(e) => setProduct({ ...product, minimum: Number(e.target.value) })}/></label></div>
      <label>Fabricante<input value={product.manufacturer ?? ''} onChange={(e) => setProduct({ ...product, manufacturer: e.target.value })}/></label>
      <label>Fornecedor<input value={product.supplier ?? ''} onChange={(e) => setProduct({ ...product, supplier: e.target.value })}/></label>
      <div className="module-actions"><button className="button primary" type="submit">Salvar produto</button><button className="button secondary" type="button" onClick={() => setProduct(blank())}>Limpar</button></div>
    </form></section><section className="panel"><div className="panel-head"><div><h2>Catálogo de produtos</h2><p>{data.products.length} produtos cadastrados</p></div></div><div className="catalog-list">{data.products.map((item) => <button key={item.id} type="button" onClick={() => { setProduct({ ...item }); setError(''); setMessage(''); }}><span><strong>{item.name}</strong><small>{item.code} · {item.category}</small></span><span>Editar</span></button>)}</div></section></div>}
    {tab === 'positions' && <NewPosition data={data} onChange={onChange}/>}
    {tab === 'import' && <ImportPanel data={data} onChange={onChange}/>}
  </div>;
}
function NewPosition({ data, onChange }: Props) {
  const [productId, setProductId] = useState(data.products[0]?.id ?? '');
  const [lot, setLot] = useState(''), [location, setLocation] = useState(''), [expiresAt, setExpiresAt] = useState(''), [quantity, setQuantity] = useState('0');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  return <section className="panel module-narrow"><div className="panel-head"><div><h2>Cadastrar lote e posição</h2><p>Um registro para cada produto, lote e local.</p></div></div><form className="module-form" onSubmit={(e) => { e.preventDefault(); setError(''); setMessage(''); try { onChange(addPosition(data, { productId, lot, location, expiresAt, quantity: Number(quantity) })); setMessage('Lote cadastrado e saldo inicial registrado.'); setLot(''); setQuantity('0'); } catch (err) { setError((err as Error).message); } }}>
    <label>Produto<select value={productId} onChange={(e) => setProductId(e.target.value)} required>{data.products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
    <label>Lote<input required value={lot} onChange={(e) => setLot(e.target.value)}/></label><label>Localização<input required placeholder="Curitiba · A3-01-01" value={location} onChange={(e) => setLocation(e.target.value)}/></label>
    <div className="module-form-row"><label>Validade<input type="date" required value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}/></label><label>Saldo inicial (un.)<input required type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)}/></label></div>
    {error && <p role="alert" className="module-error">{error}</p>}{message && <p role="status" className="module-success">{message}</p>}<button className="button primary"><Plus size={16}/> Cadastrar lote</button>
  </form></section>;
}
function ImportPanel({ data, onChange }: Props) {
  const [sheets, setSheets] = useState<{ name: string; rows: SheetRows }[]>([]), [sheet, setSheet] = useState(0);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const rows = sheets[sheet]?.rows;
  const preview = useMemo(() => { if (!rows) return null; try { return { ...inspectImport(rows, data), error: '' }; } catch (err) { return { rows: [], error: (err as Error).message }; } }, [rows, data]);
  const invalid = preview?.rows.filter((row) => row.error).length ?? 0;
  async function readFile(file?: File) {
    if (!file) return;
    setError(''); setMessage(''); setSheets([]); setBusy(true); setSheet(0);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('O limite é 5 MB por arquivo.');
      if (/\.xlsx$/i.test(file.name)) {
        const { default: readXlsx } = await import('read-excel-file/browser');
        const workbook = await readXlsx(file);
        setSheets(workbook.map((item) => ({ name: item.sheet, rows: item.data })));
      } else if (/\.csv$/i.test(file.name)) { setSheets([{ name: file.name, rows: parseCsv(await file.text()) }]); }
      else throw new Error('Use um arquivo .xlsx ou .csv.');
    } catch (err) { setError((err as Error).message || 'Não foi possível ler a planilha.'); }
    finally { setBusy(false); }
  }
  function previewText() { setError(''); setMessage(''); try { setSheets([{ name: 'Texto CSV', rows: parseCsv(text) }]); setSheet(0); } catch (err) { setSheets([]); setError((err as Error).message); } }
  return <section className="panel"><div className="panel-head"><div><h2>Importar produtos e posições</h2><p>Valide todas as linhas antes de confirmar. Registros existentes são preservados.</p></div><button className="button secondary" onClick={() => downloadText('modelo-estoque-jusimed.csv', template)}><Download size={16}/> Baixar modelo</button></div><div className="module-form">
    <label className="upload-area"><FileUp size={22}/><span>Selecionar Excel (.xlsx) ou CSV</span><input aria-label="Arquivo de estoque" type="file" accept=".xlsx,.csv" disabled={busy} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }}/></label>
    <p className="module-note">Use as colunas do modelo. Excel: código e lote como texto; validade como data. CSV: UTF-8, validade AAAA-MM-DD ou DD/MM/AAAA. Até 2.000 linhas / 5 MB. Importação aditiva: posições já existentes geram erro, sem somar o saldo novamente.</p>
    <details><summary>Colar CSV ou experimentar um exemplo</summary><label>Conteúdo CSV<textarea rows={5} value={text} onChange={(e) => setText(e.target.value)}/></label><div className="module-actions"><button className="button secondary" onClick={() => { setText(template); setSheets([]); setMessage(''); }}>Preencher exemplo</button><button className="button secondary" onClick={previewText}>Validar CSV</button></div></details>
    {busy && <p role="status">Lendo planilha…</p>}{error && <p className="module-error" role="alert">{error}</p>}{message && <p className="module-success" role="status">{message}</p>}
    {sheets.length > 1 && <label>Aba da planilha<select value={sheet} onChange={(e) => setSheet(Number(e.target.value))}>{sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>}
    {preview && <><div className="import-summary"><strong>{preview.rows.length} {preview.rows.length === 1 ? 'linha' : 'linhas'} · {invalid} com erro</strong><span>Prévia — nenhuma alteração até a confirmação</span></div>{preview.error && <p className="module-error" role="alert">{preview.error}</p>}
      <div className="table-scroll"><table className="data-table import-table"><thead><tr><th>Linha</th><th>Produto / código</th><th>Lote / local</th><th>Quantidade</th><th>Validação</th></tr></thead><tbody>{preview.rows.slice(0, 100).map((row) => <tr key={row.line}><td data-label="Linha">{row.line}</td><td data-label="Produto" className="cell-strong">{row.product}<small>{row.code}</small></td><td data-label="Lote / local">{row.lot}<small>{row.location}</small></td><td data-label="Quantidade">{row.quantity}</td><td data-label="Validação" className={row.error ? 'import-error' : 'import-valid'}>{row.error ?? 'Pronta para importar'}</td></tr>)}</tbody></table></div>
      {preview.rows.length > 100 && <p className="module-note">Exibindo 100 linhas; todas as {preview.rows.length} linhas foram validadas.</p>}
      <button disabled={busy || !!preview.error || invalid > 0 || !preview.rows.length} className="button primary" onClick={() => { setError(''); try { onChange(commitImport(rows!, data)); setMessage(`${preview.rows.length} ${preview.rows.length === 1 ? 'posição importada' : 'posições importadas'}. Consulte a tela Estoque.`); setSheets([]); setText(''); } catch (err) { setError((err as Error).message); } }}>Confirmar importação</button>
    </>}
  </div></section>;
}
