import { availableQuantity, daysToExpiry, orderReservedQuantity, type DemoData, type Order, type OrderAllocation, type Stock } from './data.ts';
import { audit, canonical, integer, validDate } from './domain.ts';

export type OrderInput = Pick<Order, 'reference' | 'hospital' | 'procedure' | 'neededAt' | 'unit' | 'responsible' | 'notes'> & { lines: { productId: string; quantity: number }[] };
export type OrderStage = 'Pendente' | 'Reserva parcial' | 'Em separação' | 'Revisar reserva' | 'Pronto para expedir' | 'Expedido' | 'Cancelado';
export const stockUnit = (stock: Stock) => stock.location.split('·')[0].trim();
export function todayDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export const allocatedQuantity = (order: Order, lineId: string) => order.allocations.filter((a) => a.lineId === lineId).reduce((sum, a) => sum + a.quantity, 0);
export const missingQuantity = (order: Order) => order.lines.reduce((sum, line) => sum + Math.max(0, line.quantity - allocatedQuantity(order, line.id)), 0);

function openOrder(data: DemoData, id: string) {
  const order = data.orders.find((o) => o.id === id);
  if (!order || order.status !== 'Aberto') throw new Error('Pedido encerrado ou não encontrado.');
  return order;
}
function eligible(stock: Stock, order: Order) {
  return canonical(stockUnit(stock)) === canonical(order.unit) && validDate(stock.expiresAt) && stock.expiresAt >= todayDate() && stock.expiresAt >= order.neededAt;
}
export function candidates(data: DemoData, order: Order, productId: string) {
  return data.stock.filter((s) => s.productId === productId && eligible(s, order) && availableQuantity(s) > 0)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.lot.localeCompare(b.lot) || a.location.localeCompare(b.location));
}
export function allocationProblem(data: DemoData, order: Order, allocation: OrderAllocation) {
  const stock = data.stock.find((s) => s.id === allocation.stockId);
  if (!stock || !eligible(stock, order)) return 'Lote vencido, validade insuficiente para a data ou unidade incompatível. Libere e reserve outro lote.';
  if (stock.reserved < orderReservedQuantity(data, stock.id) || stock.reserved + stock.blocked + stock.quarantined > stock.quantity) return 'Saldo comprometido inconsistente. Revise a posição antes de continuar.';
  return '';
}
export function orderStage(data: DemoData, order: Order): OrderStage {
  if (order.status !== 'Aberto') return order.status;
  if (order.allocations.some((a) => allocationProblem(data, order, a))) return 'Revisar reserva';
  if (!order.allocations.length) return 'Pendente';
  if (missingQuantity(order)) return 'Reserva parcial';
  return order.allocations.every((a) => a.checked === a.quantity) ? 'Pronto para expedir' : 'Em separação';
}
export function orderMetrics(data: DemoData, unit = 'Todas as unidades') {
  const orders = data.orders.filter((o) => o.status === 'Aberto' && (unit === 'Todas as unidades' || canonical(o.unit) === canonical(unit)));
  const incomplete = orders.filter((o) => missingQuantity(o) > 0);
  const ready = orders.filter((o) => orderStage(data, o) === 'Pronto para expedir');
  const urgent = orders.filter((o) => daysToExpiry(o.neededAt) <= 3 && orderStage(data, o) !== 'Pronto para expedir');
  return { open: orders.length, incomplete: incomplete.length, ready: ready.length, urgent: urgent.length };
}
export function createOrder(data: DemoData, input: OrderInput) {
  const clean = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'lines').map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])) as Omit<OrderInput, 'lines'>;
  if (!clean.reference || !clean.hospital || !clean.procedure || !clean.unit || !clean.responsible) throw new Error('Preencha referência, hospital, procedimento, unidade e responsável.');
  if (!validDate(clean.neededAt) || clean.neededAt < todayDate()) throw new Error('Informe uma data necessária válida, a partir de hoje.');
  if (data.orders.some((o) => canonical(o.reference) === canonical(clean.reference))) throw new Error('Já existe um pedido com essa referência.');
  if (!data.stock.some((s) => canonical(stockUnit(s)) === canonical(clean.unit))) throw new Error('Selecione uma unidade cadastrada no estoque.');
  if (!input.lines.length) throw new Error('Adicione ao menos um produto.');
  const productIds = new Set<string>();
  const lines = input.lines.map((line) => {
    if (!data.products.some((p) => p.id === line.productId)) throw new Error('Produto não encontrado.');
    if (productIds.has(line.productId)) throw new Error('Agrupe a quantidade do mesmo produto em uma única linha.');
    productIds.add(line.productId); integer(line.quantity, 'Quantidade solicitada', 1);
    return { ...line, id: crypto.randomUUID() };
  });
  const order: Order = { ...clean, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'Aberto', lines, allocations: [] };
  return audit({ ...data, orders: [order, ...data.orders] }, 'Pedido criado', `${order.reference} · ${order.hospital} · ${order.neededAt}`);
}
export function reserveOrder(data: DemoData, orderId: string, lineId: string, stockId: string, quantity: number) {
  const order = openOrder(data, orderId), line = order.lines.find((l) => l.id === lineId), stock = data.stock.find((s) => s.id === stockId);
  integer(quantity, 'Quantidade a reservar', 1);
  if (!line || !stock || line.productId !== stock.productId) throw new Error('Produto ou lote incompatível com o item do pedido.');
  if (!eligible(stock, order)) throw new Error('Selecione lote da unidade de origem, válido hoje e na data necessária.');
  if (quantity > line.quantity - allocatedQuantity(order, line.id)) throw new Error('A reserva excede a quantidade pendente do item.');
  if (quantity > availableQuantity(stock)) throw new Error('Saldo disponível insuficiente. Outra reserva pode ter utilizado o lote.');
  const previous = order.allocations.find((a) => a.lineId === line.id && a.stockId === stock.id);
  const allocations = previous ? order.allocations.map((a) => a.id === previous.id ? { ...a, quantity: a.quantity + quantity, checked: 0 } : a) : [...order.allocations, { id: crypto.randomUUID(), lineId, stockId, quantity, checked: 0 }];
  return audit({ ...data, orders: data.orders.map((o) => o.id === order.id ? { ...o, allocations } : o), stock: data.stock.map((s) => s.id === stock.id ? { ...s, reserved: s.reserved + quantity, revision: s.revision + 1 } : s) }, 'Reserva de pedido', `${order.reference} · ${quantity} un. · ${stock.lot} · ${stock.location}`, stock.id);
}
export function reserveByExpiry(data: DemoData, orderId: string) {
  let next = data;
  const order = openOrder(data, orderId);
  for (const line of order.lines) {
    for (const stock of candidates(next, order, line.productId)) {
      const current = openOrder(next, orderId), remaining = line.quantity - allocatedQuantity(current, line.id);
      if (!remaining) break;
      next = reserveOrder(next, orderId, line.id, stock.id, Math.min(remaining, availableQuantity(stock)));
    }
  }
  if (next === data) throw new Error(missingQuantity(order) ? 'Nenhum saldo elegível na unidade para completar a reserva. Confira validade, situações e disponibilidade.' : 'Todos os itens já estão reservados.');
  return next;
}
export function releaseOrderAllocation(data: DemoData, orderId: string, allocationId: string, reason: string) {
  const order = openOrder(data, orderId), allocation = order.allocations.find((a) => a.id === allocationId);
  if (!allocation || !reason.trim()) throw new Error('Selecione a reserva e informe o motivo da liberação.');
  const stock = data.stock.find((s) => s.id === allocation.stockId)!;
  integer(stock.reserved - allocation.quantity, 'Reserva resultante');
  return audit({ ...data, orders: data.orders.map((o) => o.id === order.id ? { ...o, allocations: o.allocations.filter((a) => a.id !== allocation.id) } : o), stock: data.stock.map((s) => s.id === stock.id ? { ...s, reserved: s.reserved - allocation.quantity, revision: s.revision + 1 } : s) }, 'Reserva liberada', `${order.reference} · ${allocation.quantity} un. · ${stock.lot} · ${reason.trim()}`, stock.id);
}
export function checkOrderAllocation(data: DemoData, orderId: string, allocationId: string, code: string, lot: string, quantity: number) {
  const order = openOrder(data, orderId), allocation = order.allocations.find((a) => a.id === allocationId);
  if (!allocation) throw new Error('Selecione a reserva a conferir.');
  const problem = allocationProblem(data, order, allocation);
  if (problem) throw new Error(problem);
  const stock = data.stock.find((s) => s.id === allocation.stockId)!, product = data.products.find((p) => p.id === stock.productId)!;
  if (canonical(code) !== canonical(product.code)) throw new Error('Código de produto diferente do item selecionado.');
  if (canonical(lot) !== canonical(stock.lot)) throw new Error('Lote diferente da reserva selecionada.');
  integer(quantity, 'Quantidade conferida', 1);
  if (allocation.checked + quantity > allocation.quantity) throw new Error('A conferência ultrapassa a quantidade reservada.');
  return audit({ ...data, orders: data.orders.map((o) => o.id === order.id ? { ...o, allocations: o.allocations.map((a) => a.id === allocation.id ? { ...a, checked: a.checked + quantity } : a) } : o) }, 'Item conferido', `${order.reference} · ${product.code} · ${lot.trim()} · +${quantity} un.`, stock.id);
}
export function resetOrderCheck(data: DemoData, orderId: string, allocationId: string) {
  const order = openOrder(data, orderId);
  if (!order.allocations.some((a) => a.id === allocationId && a.checked > 0)) throw new Error('Não há conferência para reiniciar.');
  return audit({ ...data, orders: data.orders.map((o) => o.id === order.id ? { ...o, allocations: o.allocations.map((a) => a.id === allocationId ? { ...a, checked: 0 } : a) } : o) }, 'Conferência reiniciada', order.reference);
}
export function cancelOrder(data: DemoData, orderId: string, reason: string) {
  let next = data;
  const order = openOrder(data, orderId);
  if (!reason.trim()) throw new Error('Informe o motivo do cancelamento.');
  for (const allocation of order.allocations) next = releaseOrderAllocation(next, orderId, allocation.id, reason);
  return audit({ ...next, orders: next.orders.map((o) => o.id === order.id ? { ...o, status: 'Cancelado', cancelledAt: new Date().toISOString(), cancelReason: reason.trim() } : o) }, 'Pedido cancelado', `${order.reference} · ${reason.trim()}`);
}
export function dispatchOrder(data: DemoData, orderId: string, shipment: string) {
  const order = openOrder(data, orderId);
  if (!shipment.trim()) throw new Error('Informe a referência de expedição / transporte.');
  if (orderStage(data, order) !== 'Pronto para expedir') throw new Error('Reserve e confira todos os itens com lotes válidos antes de expedir.');
  const date = new Date().toISOString();
  let stock = data.stock;
  const movements = order.allocations.map((allocation) => {
    const source = stock.find((s) => s.id === allocation.stockId)!;
    integer(source.quantity - allocation.quantity, 'Saldo físico resultante');
    integer(source.reserved - allocation.quantity, 'Reserva resultante');
    stock = stock.map((s) => s.id === source.id ? { ...s, quantity: s.quantity - allocation.quantity, reserved: s.reserved - allocation.quantity, revision: s.revision + 1 } : s);
    return { id: crypto.randomUUID(), type: 'Saída' as const, productId: source.productId, lot: source.lot, quantity: allocation.quantity, from: source.location, to: order.hospital, date, actor: 'Expedição simulada', orderId: order.id, reason: `Pedido ${order.reference} · ${shipment.trim()}` };
  });
  return audit({ ...data, stock, movements: [...movements, ...data.movements], orders: data.orders.map((o) => o.id === order.id ? { ...o, status: 'Expedido', dispatchedAt: date, shipment: shipment.trim() } : o) }, 'Pedido expedido', `${order.reference} · ${order.hospital} · ${shipment.trim()}`);
}
