import type { SupabaseClient } from '@supabase/supabase-js';
import { parseHemoData, type HemoData } from './domain.ts';

/**
 * Ponte entre a base da hemodinâmica (o mesmo HemoData do navegador) e as tabelas do Supabase
 * (supabase/migrations/20261126120000_hemodinamica_backend.sql).
 *
 * - Cada caso e cada paciente é uma linha; cadastros ficam em hemo_reference, uma linha por chave.
 * - Só o que mudou é enviado. Cada linha leva a revisão que o app leu + 1; se outra pessoa gravou
 *   antes, o banco recusa e o app avisa (mesma ideia do aviso de "outra aba" de hoje).
 * - O histórico do app vai para audit_log; o banco carimba autor e horário e encadeia o hash.
 * - A chave usada no navegador é a publicável (anon). Quem pode o quê é decidido pela RLS no banco.
 */

export const referenceKeys = ['rooms', 'doctors', 'types', 'onCall', 'roomBlocks', 'values'] as const;
type ReferenceKey = typeof referenceKeys[number];
export type Rows = {
  patients: { id: string; data: unknown }[];
  cases: { id: string; patient_id: string; stage: string; data: unknown }[];
  reference: { key: ReferenceKey; data: unknown }[];
};
/** Revisão de cada linha como o servidor devolveu (tabela:id → revisão). Linha ausente = ainda não existe no servidor. */
export type Revisions = Map<string, number>;
const rowKey = (table: string, id: string) => `${table}:${id}`;

/** Lê a configuração do servidor. Sem as duas variáveis, o app continua só no navegador. */
export function remoteConfig(env: Record<string, string | undefined>) {
  const url = env.VITE_SUPABASE_URL?.trim(), key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  if (!/^https:\/\//.test(url)) throw new Error('VITE_SUPABASE_URL deve começar com https://');
  return { url, key };
}

export function toRows(data: HemoData): Rows {
  return {
    patients: data.patients.map(p => ({ id: p.id, data: p })),
    cases: data.cases.map(c => ({ id: c.id, patient_id: c.patientId, stage: c.stage, data: c })),
    reference: referenceKeys.map(key => ({ key, data: data[key] })),
  };
}

/** Monta a base a partir das linhas do servidor e valida pelo mesmo esquema do navegador. */
export function fromRows(rows: Rows, audit: HemoData['audit'] = []): HemoData {
  const ref = Object.fromEntries(rows.reference.map(r => [r.key, r.data]));
  return parseHemoData({
    schemaVersion: 2, revision: 0,
    rooms: ref.rooms ?? [], doctors: ref.doctors ?? [], types: ref.types ?? [], onCall: ref.onCall ?? [], roomBlocks: ref.roomBlocks ?? [], values: ref.values,
    patients: rows.patients.map(p => p.data), cases: rows.cases.map(c => c.data), audit,
  });
}

/** O que mudou entre duas versões da base: linhas a gravar e entradas novas do histórico. */
export function changes(before: HemoData | null, after: HemoData) {
  const prev = before ? toRows(before) : { patients: [], cases: [], reference: [] } as Rows, next = toRows(after);
  const differs = <T extends { data: unknown }>(list: T[], id: (x: T) => string) => { const old = new Map(list.map(x => [id(x), JSON.stringify(x.data)])); return (x: T) => old.get(id(x)) !== JSON.stringify(x.data); };
  const known = new Set((before?.audit ?? []).map(a => a.id));
  return {
    patients: next.patients.filter(differs(prev.patients, p => p.id)),
    cases: next.cases.filter(differs(prev.cases, c => c.id)),
    reference: next.reference.filter(differs(prev.reference, r => r.key)),
    audit: after.audit.filter(a => !known.has(a.id)).reverse(), // do mais antigo para o mais novo
  };
}

export class RemoteConflict extends Error {}
const conflictCode = '40001';

type Table = 'hemo_patients' | 'hemo_cases' | 'hemo_reference';
/**
 * Envia as mudanças. Ordem: pacientes, cadastros, casos (o caso aponta para o paciente) e por último o histórico.
 * Devolve as revisões novas. Se o banco recusar por conflito, lança RemoteConflict: recarregue antes de seguir.
 */
export async function pushChanges(client: SupabaseClient, before: HemoData | null, after: HemoData, revisions: Revisions): Promise<Revisions> {
  const diff = changes(before, after), next = new Map(revisions);
  async function write(table: Table, id: string, idColumn: 'id' | 'key', row: Record<string, unknown>) {
    const known = next.get(rowKey(table, id));
    const result = known === undefined
      ? await client.from(table).insert({ ...row, revision: 0 }).select('revision').single()
      : await client.from(table).update({ ...row, revision: known + 1 }).eq(idColumn, id).select('revision').single();
    if (result.error) {
      if (result.error.code === conflictCode || /alterados por outra pessoa/.test(result.error.message)) throw new RemoteConflict('Os dados da hemodinâmica foram alterados por outra pessoa. Recarregue e tente de novo.');
      if (result.error.code === 'PGRST116') throw new RemoteConflict('Sem permissão para gravar este registro, ou ele foi alterado por outra pessoa.');
      throw new Error(`Não foi possível gravar no servidor (${table}): ${result.error.message}`);
    }
    next.set(rowKey(table, id), (result.data as { revision: number }).revision);
  }
  for (const p of diff.patients) await write('hemo_patients', p.id, 'id', { id: p.id, data: p.data });
  for (const r of diff.reference) await write('hemo_reference', r.key, 'key', { key: r.key, data: r.data });
  for (const c of diff.cases) await write('hemo_cases', c.id, 'id', { id: c.id, patient_id: c.patient_id, stage: c.stage, data: c.data });
  if (diff.audit.length) {
    const { error } = await client.from('audit_log').insert(diff.audit.map(a => ({ entity: a.caseId ? 'hemo_cases' : 'hemodinamica', entity_id: a.caseId, action: a.action, detail: a.detail, client_at: a.at })));
    if (error) throw new Error(`Não foi possível gravar o histórico no servidor: ${error.message}`);
  }
  return next;
}

/** Carrega tudo do servidor (leitura liberada pela RLS para usuários ativos) e as revisões de cada linha. */
export async function loadRemote(client: SupabaseClient): Promise<{ data: HemoData | null; revisions: Revisions }> {
  const [patients, cases, reference] = await Promise.all([
    client.from('hemo_patients').select('id, data, revision'),
    client.from('hemo_cases').select('id, patient_id, stage, data, revision'),
    client.from('hemo_reference').select('key, data, revision'),
  ]);
  const error = patients.error ?? cases.error ?? reference.error;
  if (error) throw new Error(`Não foi possível ler a hemodinâmica no servidor: ${error.message}`);
  const revisions: Revisions = new Map();
  for (const r of patients.data ?? []) revisions.set(rowKey('hemo_patients', r.id), r.revision);
  for (const r of cases.data ?? []) revisions.set(rowKey('hemo_cases', r.id), r.revision);
  for (const r of reference.data ?? []) revisions.set(rowKey('hemo_reference', r.key), r.revision);
  if (!(reference.data ?? []).length) return { data: null, revisions }; // servidor vazio: o app oferece enviar a base local
  return { data: fromRows({ patients: patients.data ?? [], cases: cases.data ?? [], reference: reference.data ?? [] } as Rows), revisions };
}
