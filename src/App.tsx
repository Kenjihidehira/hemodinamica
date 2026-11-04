import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Barcode, Bell, Boxes, ChartNoAxesCombined, Check, Download, LayoutDashboard, Menu, Plus, RotateCcw, Search, X } from 'lucide-react';
import { availableQuantity, daysToExpiry, formatDate, getProduct as findProduct, makeDemoData, normalizeData, storageKey, type DemoData, type Movement, type Stock, type Product } from './data';
import Analytics from './Analytics';
import Catalog from './Catalog';
import Inventory from './Inventory';
import StockControls from './StockControls';
import Orders, { type OrderFilter } from './OrderWorkspace';
import { moveStock } from './domain';
import { csvCell } from './importing';

type Page = 'analytics' | 'overview' | 'stock' | 'scan' | 'movements' | 'alerts' | 'catalog' | 'counts' | 'orders';
type MovementType = Movement['type'];
const nav: { page: Page; label: string; icon: typeof Boxes }[] = [
  { page: 'analytics', label: 'Dashboard', icon: ChartNoAxesCombined },
  { page: 'overview', label: 'Operação', icon: LayoutDashboard },
  { page: 'stock', label: 'Estoque', icon: Boxes },
  { page: 'orders', label: 'Pedidos', icon: ArrowUpRight },
  { page: 'catalog', label: 'Cadastro', icon: Plus },
  { page: 'counts', label: 'Inventário físico', icon: Check },
  { page: 'scan', label: 'Leitura de código', icon: Barcode },
  { page: 'movements', label: 'Movimentações', icon: ArrowLeftRight },
  { page: 'alerts', label: 'Alertas', icon: Bell },
];

function initialData(): DemoData {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as DemoData;
      if (Array.isArray(parsed.stock) && Array.isArray(parsed.movements)) return normalizeData(parsed);
    }
  } catch { /* Demo resets if browser storage is unavailable. */ }
  return makeDemoData();
}

function stockStatus(stock: Stock, all: Stock[], catalog: Product[]) {
  const getProduct = (id: string) => findProduct(id, catalog);
  const days = daysToExpiry(stock.expiresAt);
  const product = getProduct(stock.productId);
  const total = all.filter((item) => item.productId === stock.productId).reduce((sum, item) => sum + availableQuantity(item), 0);
  if (days < 0) return { label: 'Vencido', tone: 'danger' };
  if (stock.blocked) return { label: 'Com bloqueio', tone: 'danger' };
  if (stock.quarantined) return { label: 'Em quarentena', tone: 'warning' };
  if (days <= 30) return { label: `Vence em ${days} dias`, tone: 'warning' };
  if (total < product.minimum) return { label: 'Abaixo do mínimo', tone: 'warning' };
  return { label: 'Regular', tone: 'neutral' };
}

function downloadCsv(data: DemoData) {
  const getProduct = (id: string) => findProduct(id, data.products);
  const rows = [['Produto', 'Código', 'Lote', 'Localização', 'Validade', 'Físico', 'Disponível', 'Reservado', 'Bloqueado', 'Quarentena'], ...data.stock.map((item) => [getProduct(item.productId).name, getProduct(item.productId).code, item.lot, item.location, item.expiresAt, String(item.quantity), String(availableQuantity(item)), String(item.reserved), String(item.blocked), String(item.quarantined)])];
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'jusimed-estoque-demonstracao.csv'; link.click(); URL.revokeObjectURL(url);
}

export default function App() {
  const [data, setData] = useState<DemoData>(initialData);
  const products = data.products;
  const getProduct = (id: string) => findProduct(id, products);
  const [storageWarning, setStorageWarning] = useState(false);
  const [page, setPage] = useState<Page>('analytics');
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderView, setOrderView] = useState<{ filter: OrderFilter; unit: string }>({ filter: 'Abertos', unit: 'Todas as unidades' });
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [selectedId, setSelectedId] = useState('s1');
  const [movementType, setMovementType] = useState<'Entrada' | 'Saída' | 'Transferência'>('Saída');
  const [quantity, setQuantity] = useState('1');
  const [destination, setDestination] = useState('Porto Alegre · B1-01-02');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(data)); setStorageWarning(false); } catch { setStorageWarning(true); } }, [data]);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  useEffect(() => { if (page === 'scan') scanInputRef.current?.focus(); }, [page]);
  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus(); }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);
  useEffect(() => {
    if (!cameraOn || !videoRef.current) return;
    let active = true;
    let stop: (() => void) | undefined;
    const video = videoRef.current;
    import('@zxing/browser').then(({ BrowserMultiFormatReader }) => new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video, (result) => {
      if (result && active) {
        setScanInput(result.getText());
        setScanMessage('Código lido. Confira o produto antes de registrar.');
        setCameraOn(false);
      }
    })).then((controls) => { if (active) stop = () => controls.stop(); else controls.stop(); }).catch(() => {
      if (active) { setScanMessage('Não foi possível abrir a câmera. Use HTTPS ou localhost e confira a permissão do navegador.'); setCameraOn(false); }
    });
    return () => { active = false; stop?.(); };
  }, [cameraOn]);

  const sortedStock = useMemo(() => [...data.stock].sort((a, b) => daysToExpiry(a.expiresAt) - daysToExpiry(b.expiresAt)), [data.stock]);
  const filteredStock = sortedStock.filter((item) => `${getProduct(item.productId).name} ${getProduct(item.productId).code} ${item.lot} ${item.location}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const alertStock = sortedStock.filter((item) => stockStatus(item, data.stock, products).tone !== 'neutral');
  const expiring = data.stock.filter((item) => { const days = daysToExpiry(item.expiresAt); return item.quantity > 0 && days >= 0 && days <= 30; }).length;
  const lowProducts = products.filter((product) => data.stock.filter((item) => item.productId === product.id).reduce((sum, item) => sum + availableQuantity(item), 0) < product.minimum).length;
  const selected = data.stock.find((item) => item.id === selectedId) ?? data.stock[0];
  const pageTitle: Record<Page, string> = { analytics: 'Visão estratégica do estoque', overview: 'Operação de estoque', stock: 'Estoque por lote', scan: 'Leitura de código', movements: 'Movimentações', alerts: 'Alertas de estoque', catalog: 'Cadastro e importação', counts: 'Inventário físico', orders: 'Pedidos e expedição' };

  function openMovement(stockId?: string) { if (stockId) setSelectedId(stockId); setQuantity('1'); setMovementType('Saída'); setFormError(''); setModal(true); }
  function navigate(next: Page) { if (next === 'orders') setOrderView({ filter: 'Abertos', unit: 'Todas as unidades' }); setPage(next); setMenuOpen(false); setCameraOn(false); setSuccess(''); }
  function registerMovement(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      setData(moveStock(data, selected.id, movementType, Number(quantity), destination));
      setModal(false); setSuccess(movementType === 'Transferência' ? 'Transferência enviada. Confirme o recebimento na tela Estoque.' : 'Movimentação registrada.');
    } catch (error) { setFormError((error as Error).message); }
  }
  function findCode() {
    const value = scanInput.trim().toLocaleLowerCase('pt-BR');
    if (!value) { setScanMessage('Digite ou leia um código.'); return; }
    const found = data.stock.find((item) => item.lot.toLocaleLowerCase('pt-BR') === value || getProduct(item.productId).code.toLocaleLowerCase('pt-BR') === value);
    if (found) { setSelectedId(found.id); setScanMessage(`Encontrado: ${getProduct(found.productId).name} · lote ${found.lot}.`); }
    else setScanMessage('Código não encontrado nos dados de demonstração.');
  }
  function resetDemo() { if (window.confirm('Restaurar os dados fictícios e apagar as movimentações feitas neste navegador?')) { setData(makeDemoData()); setSuccess('Dados de demonstração restaurados.'); } }

  return <div className="app-shell">
    <header className="app-header">
      <div className="header-bar">
        <div className="brand"><img className="brand-logo" src="/brand/jusimed-logo.png" alt="Jusimed — Produtos para Saúde"/><span className="brand-product">Inteligência de estoque<small>Gestão de dispositivos médicos</small></span></div>
        <span className="prototype-label">Protótipo independente · dados fictícios</span>
        <button ref={menuButtonRef} className="header-menu-toggle icon-button" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen((current) => !current)}>{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
      </div>
      <nav id="main-navigation" className={`header-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Menu principal"><span className="header-nav-heading">Áreas do sistema</span>{nav.map(({ page: target, label, icon: Icon }) => <button key={target} type="button" className={`nav-item ${page === target ? 'active' : ''}`} aria-current={page === target ? 'page' : undefined} onClick={() => navigate(target)}><Icon size={18} strokeWidth={1.8}/><span>{label}</span></button>)}</nav>
    </header>
    {menuOpen && <button className="header-menu-backdrop" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }}/>}
    <main className="main">
      <div className="content">
        <div className="page-head"><div><div className="breadcrumb">{page === 'analytics' ? 'Gestão' : 'Operação'} <span>/</span> {pageTitle[page]}</div><h1>{pageTitle[page]}</h1><p className="subhead">{page === 'analytics' ? 'Disponibilidade de dispositivos, exposição por validade e fluxo entre unidades.' : 'Amostra fictícia para demonstrar a operação. Sem conexão com os dados da Jusimed.'}</p></div><div className="head-actions">{page === 'stock' && <button className="button secondary" onClick={() => downloadCsv(data)}><Download size={17}/> Exportar CSV</button>}{page === 'analytics' && <button className="button secondary" onClick={() => navigate('stock')}>Ver estoque <ArrowRight size={16}/></button>}{['overview', 'stock', 'movements', 'alerts'].includes(page) && <button className="button primary" onClick={() => openMovement()}><Plus size={18}/> Nova movimentação</button>}</div></div>
        {storageWarning && <p role="alert" className="module-error">Não foi possível salvar no navegador. As alterações desta sessão podem ser perdidas ao fechar a página.</p>}
        {page === 'catalog' && <Catalog data={data} onChange={setData}/>}
        {page === 'counts' && <Inventory data={data} onChange={setData}/>}
        {page === 'orders' && <Orders data={data} onChange={setData} initialFilter={orderView.filter} initialUnit={orderView.unit}/>}
        {success && <div className="notice success"><Check size={17}/>{success}<button aria-label="Fechar aviso" onClick={() => setSuccess('')}><X size={15}/></button></div>}
        {page === 'analytics' && <Analytics data={data} onViewAlerts={() => navigate('alerts')} onViewStock={() => navigate('stock')} onViewMovements={() => navigate('movements')} onViewCounts={() => navigate('counts')} onViewOrders={(filter, unit) => { navigate('orders'); setOrderView({ filter, unit }); }} />}
        {page === 'overview' && <>
          <div className="stats"><div><strong>{products.length}</strong><span>produtos cadastrados</span></div><div><strong>{data.stock.filter((item) => item.quantity > 0).length}</strong><span>posições de estoque</span></div><div><strong>{expiring}</strong><span>lotes a vencer em 30 dias</span></div><div><strong>{lowProducts}</strong><span>{lowProducts === 1 ? 'produto abaixo do mínimo' : 'produtos abaixo do mínimo'}</span></div></div>
          <div className="overview-grid"><section className="panel"><div className="panel-head"><div><h2>Prioridades de hoje</h2><p>Itens que exigem atenção da equipe.</p></div><button className="text-link" onClick={() => navigate('alerts')}>Ver alertas <ArrowRight size={16}/></button></div><StockTable items={alertStock.slice(0, 6)} all={data.stock} catalog={products} compact onSelect={openMovement}/></section><section className="panel activity-panel"><div className="panel-head"><div><h2>Últimas movimentações</h2><p>Registros feitos no protótipo.</p></div></div><MovementList items={data.movements.slice(0, 5)} catalog={products}/><button className="panel-footer" onClick={() => navigate('movements')}>Ver todas as movimentações <ArrowRight size={16}/></button></section></div>
        </>}
        {page === 'stock' && <section className="panel"><div className="panel-head toolbar"><div><h2>Posição por lote e local</h2><p>{filteredStock.length} registros encontrados</p></div><label className="search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto, lote ou local" aria-label="Buscar estoque"/></label></div><StockTable items={filteredStock} all={data.stock} catalog={products} onSelect={openMovement}/><div className="table-foot">Saldos armazenados apenas neste navegador. <button onClick={resetDemo}><RotateCcw size={14}/> Restaurar demonstração</button></div></section>}
        {page === 'stock' && <StockControls data={data} onChange={setData}/>}
        {page === 'scan' && <div className="scan-grid"><section className="panel scan-panel"><div className="panel-head"><div><h2>Consultar por código</h2><p>Use câmera, digitação ou leitor USB/Bluetooth em modo teclado.</p></div></div><div className="scan-body"><label className="field-label" htmlFor="scan-code">Código do produto ou lote</label><div className="scan-input"><input ref={scanInputRef} id="scan-code" value={scanInput} onChange={(event) => setScanInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') findCode(); }} placeholder="Ex.: IMP-PP-001 ou PP26A091"/><button className="button primary" onClick={findCode}>Consultar</button></div><p className="field-hint">Para bipador em modo teclado, mantenha o campo ativo e leia a etiqueta. A leitura termina com Enter.</p><button className="button secondary camera-button" onClick={() => { setScanMessage(''); setCameraOn((current) => !current); }}><Barcode size={18}/>{cameraOn ? 'Fechar câmera' : 'Ler com a câmera'}</button>{cameraOn && <video ref={videoRef} className="camera-preview" autoPlay muted playsInline/>}{scanMessage && <p className="scan-message" role="status">{scanMessage}</p>}{scanMessage.startsWith('Encontrado:') && <button className="button primary" onClick={() => openMovement(selectedId)}>Registrar movimentação <ArrowRight size={16}/></button>}</div></section><aside className="scan-help"><h2>Códigos para testar</h2><p>Esses códigos são fictícios. Clique para preencher a consulta.</p>{data.stock.slice(0, 4).map((item) => <button key={item.id} onClick={() => { setScanInput(item.lot); setScanMessage(''); }}><span>{getProduct(item.productId).name}</span><code>{item.lot}</code></button>)}</aside></div>}
        {page === 'movements' && <section className="panel"><div className="panel-head"><div><h2>Histórico de movimentações</h2><p>Entradas, saídas, transferências, recebimentos e ajustes registrados neste navegador.</p></div></div><div className="movement-table-wrap"><table className="data-table movement-table"><thead><tr><th>Data e hora</th><th>Tipo</th><th>Produto</th><th>Lote</th><th>Quantidade</th><th>Origem / destino</th><th>Responsável</th></tr></thead><tbody>{data.movements.map((item) => <tr key={item.id}><td>{new Date(item.date).toLocaleString('pt-BR')}</td><td><MovementLabel type={item.type}/></td><td className="cell-strong">{getProduct(item.productId).name}{item.orderId && <small>{item.reason}</small>}</td><td className="mono">{item.lot}</td><td>{item.quantity} un.</td><td>{item.from ? item.from : '—'}{item.to ? ` → ${item.to}` : ''}</td><td>{item.actor}</td></tr>)}</tbody></table></div></section>}
        {page === 'alerts' && <section className="panel"><div className="panel-head"><div><h2>Pontos de atenção</h2><p>Validade próxima, lotes vencidos, bloqueios, quarentena e saldo disponível abaixo do mínimo.</p></div><span className="count-label">{alertStock.length} registros</span></div><StockTable items={alertStock} all={data.stock} catalog={products} onSelect={openMovement}/><div className="table-foot">Regras ilustrativas. Critérios reais dependem da operação e da área da qualidade.</div></section>}
        <footer className="page-footer">Conceito de estoque para Jusimed · Protótipo independente e não oficial · Dados fictícios</footer>
      </div>
    </main>
    {modal && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(false); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><span className="modal-caption">MOVIMENTAÇÃO DE ESTOQUE</span><h2 id="modal-title">Novo registro</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setModal(false)}><X size={19}/></button></div><form onSubmit={registerMovement}><div className="modal-body"><label className="field-label" htmlFor="stock-select">Produto · lote · local</label><select id="stock-select" value={selected.id} onChange={(event) => { setSelectedId(event.target.value); setFormError(''); }}>{data.stock.map((item) => <option key={item.id} value={item.id}>{getProduct(item.productId).name} · {item.lot} · {item.location}</option>)}</select><p className="field-hint">Físico: <strong>{selected.quantity} un.</strong> · Disponível: <strong>{availableQuantity(selected)} un.</strong> · Validade: <strong>{formatDate(selected.expiresAt)}</strong></p><div className="form-row"><div><label className="field-label" htmlFor="movement-type">Tipo</label><select id="movement-type" value={movementType} onChange={(event) => { setMovementType(event.target.value as 'Entrada' | 'Saída' | 'Transferência'); setFormError(''); }}><option>Entrada</option><option>Saída</option><option>Transferência</option></select></div><div><label className="field-label" htmlFor="movement-quantity">Quantidade</label><input id="movement-quantity" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required/></div></div>{movementType === 'Transferência' && <><label className="field-label" htmlFor="destination">Destino</label><input id="destination" list="stock-locations" required value={destination} onChange={(event) => setDestination(event.target.value)}/><datalist id="stock-locations">{[...new Set(data.stock.map((item) => item.location))].map((location) => <option key={location} value={location}/>)}</datalist></>}{formError && <div className="form-error" role="alert"><AlertTriangle size={16}/>{formError}</div>}</div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(false)}>Cancelar</button><button type="submit" className="button primary">Registrar movimentação</button></div></form></div></div>}
  </div>;
}

function StockTable({ items, all, catalog, compact = false, onSelect }: { items: Stock[]; all: Stock[]; catalog: Product[]; compact?: boolean; onSelect: (id: string) => void }) {
  const getProduct = (id: string) => findProduct(id, catalog);
  return <div className="table-scroll"><table className={`data-table ${compact ? 'compact-table' : ''}`}><thead><tr><th>Produto</th><th>Código</th><th>Lote</th><th>Localização</th><th>Validade</th><th>Físico / disponível</th><th>Situação</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{items.length ? items.map((item) => { const status = stockStatus(item, all, catalog); return <tr key={item.id}><td className="cell-strong">{getProduct(item.productId).name}<small>{getProduct(item.productId).category}</small></td><td className="mono" data-label="Código">{getProduct(item.productId).code}</td><td className="mono" data-label="Lote">{item.lot}</td><td data-label="Localização">{item.location}</td><td data-label="Validade">{formatDate(item.expiresAt)}</td><td data-label="Físico / disponível">{item.quantity} un.<small>Disponível: {availableQuantity(item)} un.</small></td><td data-label="Situação"><span className={`status status-${status.tone}`}>{status.label}</span></td><td><button className="row-action" aria-label={`Movimentar ${getProduct(item.productId).name}, lote ${item.lot}`} onClick={() => onSelect(item.id)}><ArrowRight size={17}/></button></td></tr>; }) : <tr><td colSpan={8} className="empty-state">Nenhum registro encontrado.</td></tr>}</tbody></table></div>;
}

function MovementLabel({ type }: { type: MovementType }) { const Icon = type === 'Entrada' ? ArrowDownLeft : type === 'Saída' ? ArrowUpRight : ArrowLeftRight; return <span className="movement-label"><Icon size={16}/>{type}</span>; }
function MovementList({ items, catalog }: { items: Movement[]; catalog: Product[] }) { const getProduct = (id: string) => findProduct(id, catalog); return <div className="activity-list">{items.map((item) => <div className="activity" key={item.id}><div className="activity-icon">{item.type === 'Entrada' ? <ArrowDownLeft size={17}/> : item.type === 'Saída' ? <ArrowUpRight size={17}/> : <ArrowLeftRight size={17}/>}</div><div><div className="activity-top"><strong>{item.type}</strong><time>{new Date(item.date).toLocaleDateString('pt-BR')}</time></div><p>{getProduct(item.productId).name}</p><small>Lote {item.lot} · {item.quantity} un.</small></div></div>)}</div>; }
