export type Product = { id: string; name: string; code: string; category: string; minimum: number; manufacturer?: string; supplier?: string };
export type Stock = { id: string; productId: string; lot: string; location: string; expiresAt: string; quantity: number; reserved: number; blocked: number; quarantined: number; revision: number };
export type Movement = { id: string; type: 'Entrada' | 'Saída' | 'Transferência' | 'Recebimento' | 'Ajuste'; productId: string; lot: string; quantity: number; from?: string; to?: string; date: string; actor: string; reason?: string; orderId?: string };
export type Count = { id: string; stockId: string; expected: number; counted: number; revision: number; reason: string; date: string; status: 'Pendente' | 'Aplicada' | 'Rejeitada'; reviewedAt?: string };
export type Transfer = { id: string; productId: string; lot: string; expiresAt: string; quantity: number; from: string; to: string; date: string; receivedAt?: string };
export type Audit = { id: string; date: string; action: string; detail: string; stockId?: string };
export type OrderLine = { id: string; productId: string; quantity: number };
export type OrderAllocation = { id: string; lineId: string; stockId: string; quantity: number; checked: number };
export type Order = { id: string; reference: string; hospital: string; procedure: string; neededAt: string; unit: string; responsible: string; notes: string; createdAt: string; status: 'Aberto' | 'Expedido' | 'Cancelado'; lines: OrderLine[]; allocations: OrderAllocation[]; dispatchedAt?: string; shipment?: string; cancelledAt?: string; cancelReason?: string };
export type DemoData = { schemaVersion: 3; products: Product[]; stock: Stock[]; movements: Movement[]; counts: Count[]; transfers: Transfer[]; audit: Audit[]; orders: Order[] };

export const products: Product[] = [
  { id: 'p1', name: 'Parafuso pedicular 6,5 × 45 mm', code: 'IMP-PP-001', category: 'Coluna', minimum: 8 },
  { id: 'p2', name: 'Placa craniana titânio', code: 'IMP-PC-002', category: 'Crânio e face', minimum: 5 },
  { id: 'p3', name: 'Cage intersomático PEEK', code: 'IMP-CI-003', category: 'Coluna', minimum: 6 },
  { id: 'p4', name: 'Haste femoral cimentada', code: 'IMP-HF-004', category: 'Artroplastia', minimum: 4 },
  { id: 'p5', name: 'Componente acetabular 52 mm', code: 'IMP-CA-005', category: 'Artroplastia', minimum: 5 },
  { id: 'p6', name: 'Âncora de sutura 5,5 mm', code: 'IMP-AS-006', category: 'Ortopedia', minimum: 6 },
];

function dateAfter(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function makeDemoData(): DemoData {
  return {
    schemaVersion: 3, products: products.map((product) => ({ ...product })), counts: [], transfers: [], audit: [], orders: [],
    stock: [
      { id: 's1', productId: 'p1', lot: 'PP26A091', location: 'Curitiba · A1-02-03', expiresAt: dateAfter(22), quantity: 6 },
      { id: 's2', productId: 'p1', lot: 'PP26B114', location: 'Porto Alegre · B1-01-02', expiresAt: dateAfter(300), quantity: 11 },
      { id: 's3', productId: 'p2', lot: 'PC26C082', location: 'Curitiba · A1-03-01', expiresAt: dateAfter(260), quantity: 3 },
      { id: 's4', productId: 'p3', lot: 'CI26D105', location: 'Curitiba · A2-01-02', expiresAt: dateAfter(410), quantity: 12 },
      { id: 's5', productId: 'p4', lot: 'HF26E072', location: 'Porto Alegre · B1-01-01', expiresAt: dateAfter(370), quantity: 8 },
      { id: 's6', productId: 'p5', lot: 'CA26F095', location: 'Porto Alegre · B1-02-01', expiresAt: dateAfter(46), quantity: 7 },
      { id: 's7', productId: 'p6', lot: 'AS26G041', location: 'Curitiba · A2-02-01', expiresAt: dateAfter(18), quantity: 9 },
      { id: 's8', productId: 'p6', lot: 'AS26H058', location: 'Porto Alegre · B1-03-01', expiresAt: dateAfter(490), quantity: 8 },
    ].map((item) => ({ ...item, reserved: item.id === 's1' ? 2 : 0, blocked: item.id === 's3' ? 1 : 0, quarantined: item.id === 's7' ? 2 : 0, revision: 0 })),
    movements: [
      { id: 'm1', type: 'Saída', productId: 'p1', lot: 'PP26A091', quantity: 2, from: 'Curitiba · A1-02-03', date: new Date(Date.now() - 86_400_000).toISOString(), actor: 'Equipe de estoque' },
      { id: 'm2', type: 'Entrada', productId: 'p3', lot: 'CI26D105', quantity: 5, to: 'Curitiba · A2-01-02', date: new Date(Date.now() - 172_800_000).toISOString(), actor: 'Equipe de estoque' },
      { id: 'm3', type: 'Transferência', productId: 'p4', lot: 'HF26E072', quantity: 1, from: 'Curitiba · A2-01-02', to: 'Porto Alegre · B1-01-01', date: new Date(Date.now() - 259_200_000).toISOString(), actor: 'Equipe de estoque' },
    ],
  };
}

export const storageKey = 'nexo-estoque-demo-v1';

export function getProduct(id: string, catalog: Product[] = products) { return catalog.find((product) => product.id === id)!; }

export function normalizeData(value: Partial<DemoData>): DemoData {
  if (!Array.isArray(value.stock) || !Array.isArray(value.movements)) throw new Error('Base inválida.');
  const catalog = value.products ?? products.map((item) => ({ ...item }));
  const stock = value.stock.map((item) => ({ ...item, reserved: item.reserved ?? 0, blocked: item.blocked ?? 0, quarantined: item.quarantined ?? 0, revision: item.revision ?? 0 }));
  for (const item of stock) {
    if (!catalog.some((p) => p.id === item.productId) || ![item.quantity, item.reserved, item.blocked, item.quarantined].every((n) => Number.isSafeInteger(n) && n >= 0) || item.reserved + item.blocked + item.quarantined > item.quantity) throw new Error('Saldo inválido na base salva.');
  }
  const orders = value.orders ?? [];
  if (!Array.isArray(orders)) throw new Error('Pedidos inválidos na base salva.');
  for (const order of orders) {
    if (!Array.isArray(order.lines) || !Array.isArray(order.allocations) || !['Aberto', 'Expedido', 'Cancelado'].includes(order.status)) throw new Error('Pedido inválido.');
    for (const line of order.lines) if (!catalog.some((p) => p.id === line.productId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error('Item de pedido inválido.');
    for (const allocation of order.allocations) {
      const line = order.lines.find((l) => l.id === allocation.lineId), position = stock.find((s) => s.id === allocation.stockId);
      if (!line || !position || position.productId !== line.productId || !Number.isSafeInteger(allocation.quantity) || allocation.quantity < 1 || !Number.isSafeInteger(allocation.checked) || allocation.checked < 0 || allocation.checked > allocation.quantity) throw new Error('Reserva de pedido inválida.');
    }
    for (const line of order.lines) if (order.allocations.filter((a) => a.lineId === line.id).reduce((sum, a) => sum + a.quantity, 0) > line.quantity) throw new Error('Reserva acima do pedido.');
  }
  for (const position of stock) if (orderReservedQuantity({ orders }, position.id) > position.reserved) throw new Error('Reservas de pedidos excedem a reserva física.');
  return { schemaVersion: 3, products: catalog, stock, movements: value.movements, counts: value.counts ?? [], transfers: value.transfers ?? [], audit: value.audit ?? [], orders };
}

export function orderReservedQuantity(data: Pick<DemoData, 'orders'>, stockId: string) {
  return data.orders.filter((o) => o.status === 'Aberto').reduce((sum, o) => sum + o.allocations.filter((a) => a.stockId === stockId).reduce((total, a) => total + a.quantity, 0), 0);
}

export function availableQuantity(stock: Stock) {
  return daysToExpiry(stock.expiresAt) < 0 ? 0 : Math.max(0, stock.quantity - stock.reserved - stock.blocked - stock.quarantined);
}

export function daysToExpiry(date: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${date}T00:00:00`);
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

export function formatDate(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR'); }
