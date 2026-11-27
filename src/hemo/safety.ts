import { availableQuantity, daysToExpiry, HEMO_CATEGORY, type DemoData, type Product } from '../data.ts';
import {
  commit, findCase, implantsOf, insured, isOpme, patientOf, productOf, reconcileDecisions, renalProfile, requireStage, type HemoCase, type HemoData, type HemoPatient, type ReconcileItem,
} from './domain.ts';

/**
 * Segurança do paciente na hemodinâmica: identificação pela pulseira, checagem do material bipado,
 * contador de contraste e reconciliação de medicamentos na alta.
 * Nada aqui decide conduta: o sistema confere o que foi lido e registrado e avisa.
 */

// ---------- Pulseira de identificação ----------
/** Código impresso na pulseira (Code 39: letras maiúsculas, números e hífen). */
export const wristbandCode = (p: Pick<HemoPatient, 'id'>) => `PAC-${p.id.toUpperCase().replace(/[^A-Z0-9-]/g, '')}`;
const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');
export const MANUAL_REASON_MIN = 10;

export type IdentityInput = { code: string } | { manualReason: string };
/**
 * Confirma que o paciente em preparo é quem o caso diz. Pulseira de outro paciente para tudo com aviso;
 * sem leitura possível (pulseira danificada, sem leitor), a conferência manual exige justificativa e fica no histórico.
 */
export function confirmIdentity(data: HemoData, caseId: string, input: IdentityInput, now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Preparo');
  const p = patientOf(data, c);
  if ('code' in input) {
    const code = normalizeCode(input.code);
    if (!code) throw new Error('Leia ou digite o código da pulseira.');
    if (code !== wristbandCode(p)) {
      const other = data.patients.find(x => wristbandCode(x) === code);
      throw new Error(other ? `PARE: esta pulseira é de outro paciente (${other.name}). O procedimento é de ${p.name}.` : 'Código não reconhecido como pulseira de paciente deste serviço.');
    }
    return commit(data, caseId, x => ({ ...x, identity: { at: now.toISOString(), method: 'Pulseira lida', reason: '' }, timeout: { ...x.timeout, identity: true } }), 'Paciente identificado', `pulseira ${code} lida`, now);
  }
  const reason = input.manualReason.trim();
  if (reason.length < MANUAL_REASON_MIN) throw new Error('Conferência manual: explique por que a pulseira não pôde ser lida (ex.: pulseira danificada; nome e nascimento conferidos com o paciente).');
  return commit(data, caseId, x => ({ ...x, identity: { at: now.toISOString(), method: 'Conferência manual', reason }, timeout: { ...x.timeout, identity: true } }), 'Paciente identificado sem leitura da pulseira', reason, now);
}

/** Code 39: cada caractere vira 9 elementos (barra/espaço), 3 deles largos. Basta para a pulseira e para o leitor do celular. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '*': 'nwnnwnwnn',
};
/** Barras do código como retângulos (x, largura) em módulos; a altura fica com quem desenha. */
export function code39Bars(value: string) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const ch of `*${value}*`) {
    const pattern = CODE39[ch];
    if (!pattern) throw new Error(`Caractere sem código de barras: ${ch}`);
    [...pattern].forEach((p, i) => { const w = p === 'w' ? 3 : 1; if (i % 2 === 0) bars.push({ x, w }); x += w; });
    x += 1; // espaço entre caracteres
  }
  return { bars, width: x - 1 };
}

// ---------- Material bipado na sala ----------
export type ScanIssue = { level: 'bloqueia' | 'atenção'; text: string };
const br = (iso: string) => iso.split('-').reverse().join('/');
/**
 * Confere o código bipado (lote ou código do produto) antes do uso no paciente: validade, bloqueio,
 * quarentena, saldo, se é material da hemodinâmica e, no convênio, se o OPME foi autorizado na guia.
 * Pelo código do produto, escolhe o lote utilizável que vence primeiro.
 */
export function checkMaterialScan(data: HemoData, stock: DemoData, caseId: string, scanned: string) {
  const c = findCase(data, caseId);
  const code = normalizeCode(scanned);
  const issues: ScanIssue[] = [];
  if (!code) return { position: undefined, product: undefined, issues: [{ level: 'bloqueia' as const, text: 'Leia ou digite o código do material.' }], ok: false };
  const byLot = stock.stock.filter(s => normalizeCode(s.lot) === code && s.quantity > 0);
  const byProduct = stock.stock.filter(s => normalizeCode(productOf(stock.products, s.productId).code) === code && s.quantity > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const candidates = byLot.length ? byLot : byProduct;
  const position = candidates.find(s => availableQuantity(s) > 0 && daysToExpiry(s.expiresAt) >= 0) ?? candidates[0];
  if (!position) return { position: undefined, product: undefined, issues: [{ level: 'bloqueia' as const, text: `Código ${code} não encontrado no Estoque (nem como lote, nem como produto).` }], ok: false };
  const product = productOf(stock.products, position.productId);
  const days = daysToExpiry(position.expiresAt);
  if (days < 0) issues.push({ level: 'bloqueia', text: `Lote ${position.lot} vencido em ${br(position.expiresAt)}. Não use; separe para descarte.` });
  else if (days <= 7) issues.push({ level: 'atenção', text: `Lote ${position.lot} vence em ${days} dia(s) (${br(position.expiresAt)}).` });
  if (position.blocked > 0 && availableQuantity(position) === 0) issues.push({ level: 'bloqueia', text: `Lote ${position.lot} bloqueado no Estoque.` });
  else if (position.quarantined > 0 && availableQuantity(position) === 0) issues.push({ level: 'bloqueia', text: `Lote ${position.lot} em quarentena: ainda não liberado para uso.` });
  else if (availableQuantity(position) === 0 && days >= 0) issues.push({ level: 'bloqueia', text: `Lote ${position.lot} sem saldo disponível (reservado, bloqueado ou em quarentena).` });
  if (product.category !== HEMO_CATEGORY) issues.push({ level: 'atenção', text: `${product.name} não é material cadastrado para a hemodinâmica. Confira se é o item certo.` });
  if (isOpme(product) && insured(patientOf(data, c)) && c.authorization.status === 'Autorizada') {
    const authorized = c.opme.items.filter(i => i.productId === product.id).reduce((s, i) => s + i.authorized, 0);
    const used = c.materials.filter(m => m.productId === product.id).reduce((s, m) => s + m.quantity, 0);
    if (!authorized) issues.push({ level: 'atenção', text: `${product.name} não foi autorizado na guia ${c.authorization.guide}. Usar vira glosa: peça complemento ao convênio.` });
    else if (used >= authorized) issues.push({ level: 'atenção', text: `${product.name}: o autorizado na guia (${authorized}) já foi usado. Mais uma unidade vira glosa sem complemento.` });
  }
  if (product.implantable) issues.push({ level: 'atenção', text: 'Implante: confira e registre o número de série da etiqueta.' });
  return { position, product, issues, ok: !issues.some(i => i.level === 'bloqueia') };
}

// ---------- Contador de contraste ----------
/** Faixa de aviso antes do limite sugerido (80% do limite). Referência do serviço. */
export const CONTRAST_NEAR_SHARE = 0.8;
/** Quanto do limite sugerido (TFG × razão do serviço) já foi usado. Sem limite calculável, só mostra o volume. */
export function contrastGauge(data: HemoData, c: HemoCase, ml: number) {
  const { contrastLimitMl: limit } = renalProfile(data, c);
  if (limit === null || limit <= 0) return { ml, limit: null, share: null, level: 'sem limite' as const, left: null };
  const share = ml / limit;
  return { ml, limit, share, left: limit - ml, level: share > 1 ? 'acima' as const : share >= CONTRAST_NEAR_SHARE ? 'perto' as const : 'ok' as const };
}

// ---------- Reconciliação de medicamentos na alta ----------
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * Pontos de atenção por medicamento, para quem decide conferir. Não sugere dose nem prazo:
 * a decisão (e a data de retomada) é do médico, conforme o protocolo do serviço.
 */
export function reconcileHint(drug: string, c: HemoCase, catalog: Product[]) {
  const d = plain(drug);
  if (/metformina/.test(d)) return 'Recebeu contraste: confirmar quando retomar, conforme função renal e protocolo.';
  if (/varfarina|apixabana|rivaroxabana|dabigatrana|edoxabana|enoxaparina/.test(d)) return 'Anticoagulante: confirmar retomada e associação com antiagregantes.';
  if (/clopidogrel|ticagrelor|prasugrel|\baas\b|acido acetilsalicilico/.test(d) && implantsOf(catalog, c).some(x => /stent/i.test(x.product.name))) return 'Paciente com stent: antiagregante não deve ser suspenso sem o cardiologista.';
  if (/insulina|glibenclamida|gliclazida/.test(d)) return 'Hipoglicemiante: conferir com o jejum e a alimentação após o procedimento.';
  return '';
}
/** Ponto de partida: os medicamentos de uso contínuo do paciente, ainda sem decisão. */
export function reconciliationDraft(data: HemoData, c: HemoCase): ReconcileItem[] {
  if (c.reconciliation.items.length) return c.reconciliation.items;
  return patientOf(data, c).medications.map((drug, i) => ({ id: `rec-${i}-${c.id}`, drug, decision: '', resumeOn: '', note: '' }));
}
export function reconciliationProblem(items: ReconcileItem[]) {
  if (!items.length) return 'Inclua os medicamentos de uso contínuo (ou registre "nenhum" como nova prescrição).';
  for (const item of items) {
    if (!item.drug.trim()) return 'Informe o nome de cada medicamento.';
    if (!reconcileDecisions.includes(item.decision as typeof reconcileDecisions[number])) return `Decida o que fazer com ${item.drug}.`;
    if (item.decision === 'Suspender' && !item.resumeOn && !item.note.trim()) return `${item.drug}: informe quando retomar ou a condição para retomar.`;
    if (item.resumeOn && !/^\d{4}-\d{2}-\d{2}$/.test(item.resumeOn)) return `${item.drug}: data de retomada inválida.`;
    if ((item.decision === 'Alterar dose' || item.decision === 'Nova prescrição') && !item.note.trim()) return `${item.drug}: descreva a nova orientação, conforme a receita.`;
  }
  return '';
}
export function saveReconciliation(data: HemoData, caseId: string, items: ReconcileItem[], now = new Date()): HemoData {
  const c = findCase(data, caseId);
  requireStage(c, 'Recuperação', 'Laudo', 'Faturamento', 'Encerrado');
  const clean = items.map(i => ({ ...i, drug: i.drug.trim(), note: i.note.trim() }));
  const problem = reconciliationProblem(clean);
  if (problem) throw new Error(problem);
  const count = (d: string) => clean.filter(i => i.decision === d).length;
  return commit(data, caseId, x => ({ ...x, reconciliation: { items: clean, doneAt: now.toISOString() } }), 'Reconciliação de medicamentos', `${count('Manter')} mantido(s) · ${count('Suspender')} suspenso(s) · ${count('Alterar dose')} alterado(s) · ${count('Nova prescrição')} novo(s)`, now);
}
/** Texto para o paciente, junto da orientação de alta. */
export function reconciliationText(c: HemoCase) {
  if (!c.reconciliation.doneAt) return '';
  const line = (i: ReconcileItem) => `• ${i.drug}: ${i.decision === 'Manter' ? 'continuar como antes' : i.decision === 'Suspender' ? `NÃO tomar${i.resumeOn ? ` até ${br(i.resumeOn)}` : ''}${i.note ? ` (${i.note})` : ''}` : i.decision === 'Alterar dose' ? `mudou: ${i.note}` : `novo: ${i.note}`}`;
  return ['SEUS REMÉDIOS DEPOIS DO PROCEDIMENTO', ...c.reconciliation.items.map(line), 'Dúvidas: fale com a equipe antes de mudar qualquer remédio.'].join('\n');
}
