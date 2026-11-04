import { availableQuantity, daysToExpiry, orderReservedQuantity, type DemoData, type Product, type Stock, type Movement } from './data.ts';

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const canonical = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function integer(value: number, label: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}: informe um inteiro a partir de ${minimum}.`);
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function audit(data: DemoData, action: string, detail: string, stockId?: string): DemoData {
  return { ...data, audit: [{ id: id(), date: now(), action, detail, stockId }, ...data.audit] };
}
function position(data: DemoData, stockId: string) {
  const stock = data.stock.find((item) => item.id === stockId);
  if (!stock) throw new Error('Posição de estoque não encontrada.');
  return stock;
}
export function saveProduct(data: DemoData, product: Product) {
  const clean = { ...product, code: product.code.trim(), name: product.name.trim(), category: product.category.trim(), manufacturer: product.manufacturer?.trim(), supplier: product.supplier?.trim() };
  if (!clean.code || !clean.name || !clean.category) throw new Error('Preencha código, produto e especialidade.');
  integer(clean.minimum, 'Saldo mínimo');
  if (data.products.some((p) => p.id !== clean.id && canonical(p.code) === canonical(clean.code))) throw new Error('Já existe um produto com esse código.');
  const exists = data.products.some((p) => p.id === clean.id);
  return audit({ ...data, products: exists ? data.products.map((p) => p.id === clean.id ? clean : p) : [...data.products, clean] }, exists ? 'Cadastro atualizado' : 'Produto cadastrado', `${clean.code} · ${clean.name}`);
}
export function addPosition(data: DemoData, input: Pick<Stock, 'productId' | 'lot' | 'location' | 'expiresAt' | 'quantity'>) {
  if (!data.products.some((p) => p.id === input.productId)) throw new Error('Selecione um produto cadastrado.');
  if (!input.lot.trim() || !input.location.trim() || !validDate(input.expiresAt)) throw new Error('Preencha lote, localização e uma validade válida.');
  integer(input.quantity, 'Quantidade');
  if (data.stock.some((s) => s.productId === input.productId && canonical(s.lot) === canonical(input.lot) && s.expiresAt !== input.expiresAt)) throw new Error('Este produto e lote já possuem outra validade cadastrada.');
  if (data.stock.some((s) => s.productId === input.productId && canonical(s.lot) === canonical(input.lot) && canonical(s.location) === canonical(input.location))) throw new Error('Produto, lote e local já cadastrados. Use uma entrada para acrescentar saldo.');
  const stock: Stock = { ...input, lot: input.lot.trim(), location: input.location.trim(), id: id(), reserved: 0, blocked: 0, quarantined: 0, revision: 0 };
  const movement: Movement = { id: id(), type: 'Entrada', productId: stock.productId, lot: stock.lot, quantity: stock.quantity, to: stock.location, date: now(), actor: 'Operação simulada', reason: 'Cadastro de posição / saldo inicial' };
  return audit({ ...data, stock: [...data.stock, stock], movements: input.quantity ? [movement, ...data.movements] : data.movements }, 'Posição cadastrada', `${stock.lot} · ${stock.location} · ${stock.quantity} un.`, stock.id);
}
export function allocate(data: DemoData, stockId: string, reserved: number, blocked: number, quarantined: number, reason: string) {
  const stock = position(data, stockId);
  [reserved, blocked, quarantined].forEach((n) => integer(n, 'Quantidade por situação'));
  const linked = orderReservedQuantity(data, stockId);
  if (reserved < linked) throw new Error(`${linked} un. estão vinculadas a pedidos. Libere essas reservas na tela Pedidos antes de reduzir o total.`);
  if (reserved + blocked + quarantined > stock.quantity) throw new Error('A soma de reservado, bloqueado e quarentena excede o saldo físico.');
  if (!reason.trim()) throw new Error('Informe o motivo da alteração.');
  if (reserved > stock.reserved && daysToExpiry(stock.expiresAt) < 0) throw new Error('Não é possível criar reserva em lote vencido.');
  return audit({ ...data, stock: data.stock.map((s) => s.id === stockId ? { ...s, reserved, blocked, quarantined, revision: s.revision + 1 } : s) }, 'Situações alteradas', `Reservado ${stock.reserved} → ${reserved}; bloqueado ${stock.blocked} → ${blocked}; quarentena ${stock.quarantined} → ${quarantined}. ${reason.trim()}`, stockId);
}
export function moveStock(data: DemoData, stockId: string, type: 'Entrada' | 'Saída' | 'Transferência', quantity: number, destination = '') {
  const stock = position(data, stockId);
  integer(quantity, 'Quantidade', 1);
  if (type !== 'Entrada' && quantity > availableQuantity(stock)) throw new Error('Quantidade maior que o saldo disponível. Reservas, bloqueios, quarentena e vencidos não podem sair.');
  integer(stock.quantity + (type === 'Entrada' ? quantity : -quantity), 'Saldo resultante');
  if (type === 'Transferência' && (!destination.trim() || canonical(destination) === canonical(stock.location))) throw new Error('Informe um destino diferente da origem.');
  if (type === 'Transferência' && data.stock.some((s) => s.productId === stock.productId && canonical(s.lot) === canonical(stock.lot) && canonical(s.location) === canonical(destination) && s.expiresAt !== stock.expiresAt)) throw new Error('O lote no destino tem outra validade. Confira o cadastro.');
  const date = now();
  const movement: Movement = { id: id(), type, productId: stock.productId, lot: stock.lot, quantity, date, actor: 'Operação simulada', ...(type !== 'Entrada' ? { from: stock.location } : {}), ...(type !== 'Saída' ? { to: type === 'Entrada' ? stock.location : destination.trim() } : {}) };
  return audit({ ...data, stock: data.stock.map((s) => s.id === stockId ? { ...s, quantity: s.quantity + (type === 'Entrada' ? quantity : -quantity), revision: s.revision + 1 } : s), movements: [movement, ...data.movements], transfers: type === 'Transferência' ? [{ id: id(), productId: stock.productId, lot: stock.lot, expiresAt: stock.expiresAt, quantity, from: stock.location, to: destination.trim(), date }, ...data.transfers] : data.transfers }, type, `${quantity} un. · lote ${stock.lot}${type === 'Transferência' ? ' · aguardando recebimento em ' + destination.trim() : ''}`, stockId);
}
export function receiveTransfer(data: DemoData, transferId: string) {
  const transfer = data.transfers.find((t) => t.id === transferId);
  if (!transfer || transfer.receivedAt) throw new Error('Transferência inexistente ou já recebida.');
  const target = data.stock.find((s) => s.productId === transfer.productId && canonical(s.lot) === canonical(transfer.lot) && canonical(s.location) === canonical(transfer.to));
  if (target && target.expiresAt !== transfer.expiresAt) throw new Error('Validade divergente no destino. Revise o cadastro.');
  const quarantine = transfer.quantity; // Receiving requires a separate stock release.
  const destination: Stock = target ? { ...target, quantity: target.quantity + transfer.quantity, quarantined: target.quarantined + quarantine, revision: target.revision + 1 } : { id: id(), productId: transfer.productId, lot: transfer.lot, location: transfer.to, expiresAt: transfer.expiresAt, quantity: transfer.quantity, reserved: 0, blocked: 0, quarantined: quarantine, revision: 0 };
  integer(destination.quantity, 'Saldo no destino');
  const date = now();
  return audit({ ...data, stock: target ? data.stock.map((s) => s.id === target.id ? destination : s) : [...data.stock, destination], transfers: data.transfers.map((t) => t.id === transferId ? { ...t, receivedAt: date } : t), movements: [{ id: id(), type: 'Recebimento', productId: transfer.productId, lot: transfer.lot, quantity: transfer.quantity, from: transfer.from, to: transfer.to, date, actor: 'Operação simulada', reason: 'Recebido em quarentena para conferência' }, ...data.movements] }, 'Transferência recebida', `${transfer.quantity} un. em quarentena · ${transfer.to}`, destination.id);
}
export function submitCount(data: DemoData, stockId: string, revision: number, counted: number, reason: string) {
  const stock = position(data, stockId);
  integer(counted, 'Contagem');
  if (stock.revision !== revision) throw new Error('O saldo mudou durante a contagem. Reinicie a conferência.');
  if (data.counts.some((c) => c.stockId === stockId && c.status === 'Pendente')) throw new Error('Já existe uma contagem pendente para esta posição.');
  if (counted !== stock.quantity && !reason.trim()) throw new Error('Informe uma justificativa para a divergência.');
  return audit({ ...data, counts: [{ id: id(), stockId, expected: stock.quantity, counted, revision, reason: reason.trim(), date: now(), status: 'Pendente' }, ...data.counts] }, 'Contagem registrada', `${stock.lot} · ${counted} un. contadas · aguardando revisão`, stockId);
}
export function reviewCount(data: DemoData, countId: string, approve: boolean) {
  const count = data.counts.find((c) => c.id === countId);
  if (!count || count.status !== 'Pendente') throw new Error('Contagem já revisada ou inexistente.');
  const stock = position(data, count.stockId);
  if (approve && stock.revision !== count.revision) throw new Error('Houve movimentação ou alteração desde a contagem. Rejeite e faça uma nova contagem.');
  if (approve && count.counted < stock.reserved + stock.blocked + stock.quarantined) throw new Error('A contagem é menor que as quantidades comprometidas. Rejeite, revise as situações e conte novamente.');
  const difference = count.counted - count.expected;
  const date = now();
  return audit({ ...data, counts: data.counts.map((c) => c.id === countId ? { ...c, status: approve ? 'Aplicada' : 'Rejeitada', reviewedAt: date } : c), stock: approve ? data.stock.map((s) => s.id === stock.id ? { ...s, quantity: count.counted, revision: s.revision + 1 } : s) : data.stock, movements: approve && difference ? [{ id: id(), type: 'Ajuste', productId: stock.productId, lot: stock.lot, quantity: difference, to: stock.location, date, actor: 'Revisão simulada', reason: count.reason }, ...data.movements] : data.movements }, approve ? 'Contagem aplicada' : 'Contagem rejeitada', `${count.expected} → ${count.counted} un. · ${count.reason || 'Sem divergência'}`, stock.id);
}
