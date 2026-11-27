import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHemoData, cancelCase, findCase } from '../src/hemo/domain.ts';
import { remoteConfig, toRows, fromRows, changes, pushChanges, loadRemote, RemoteConflict } from '../src/hemo/remote.ts';

const now = new Date('2026-11-23T13:00:00Z');
const base = () => makeHemoData(now);

/** Cliente falso com o mesmo contrato do supabase-js que remote.ts usa; aplica a regra de revisão da migração. */
function fakeClient() {
  const tables = { hemo_patients: new Map(), hemo_cases: new Map(), hemo_reference: new Map(), audit_log: [] };
  const calls = [];
  const idOf = (table, row) => table === 'hemo_reference' ? row.key : row.id;
  const from = table => {
    let op = null, row = null, filter = null;
    const run = () => {
      calls.push(`${op} ${table}${filter ? ` ${filter[1]}` : ''}`);
      if (table === 'audit_log') { tables.audit_log.push(...row); return { data: null, error: null }; }
      const store = tables[table];
      if (op === 'insert') { const id = idOf(table, row); if (store.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key' } }; store.set(id, { ...row }); return { data: { revision: row.revision }, error: null }; }
      if (op === 'update') { const cur = store.get(filter[1]); if (!cur) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }; if (row.revision !== cur.revision + 1) return { data: null, error: { code: '40001', message: 'Os dados foram alterados por outra pessoa.' } }; store.set(filter[1], { ...cur, ...row }); return { data: { revision: row.revision }, error: null }; }
      if (op === 'select') return { data: [...store.values()], error: null };
    };
    const builder = {
      insert(r) { op = 'insert'; row = r; return builder; },
      update(r) { op = 'update'; row = r; return builder; },
      eq(col, val) { filter = [col, val]; return builder; },
      select() { if (!op) op = 'select'; return builder; },
      single() { return builder; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
    };
    return builder;
  };
  return { client: { from }, tables, calls };
}

test('configuração: sem as variáveis o app fica só no navegador', () => {
  assert.equal(remoteConfig({}), null);
  assert.equal(remoteConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.deepEqual(remoteConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }), { url: 'https://x.supabase.co', key: 'sb_publishable_x' });
  assert.throws(() => remoteConfig({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }), /https/);
});

test('linhas do servidor e base do navegador são equivalentes', () => {
  const data = base();
  const rows = toRows(data);
  assert.equal(rows.cases.length, 5); assert.equal(rows.patients.length, 5);
  assert.deepEqual(rows.reference.map(r => r.key), ['rooms', 'doctors', 'types', 'onCall', 'roomBlocks', 'values']);
  const back = fromRows(rows);
  assert.deepEqual(back.cases, data.cases);
  assert.deepEqual(back.values, data.values);
});

test('só o que mudou é enviado, com o histórico novo do mais antigo para o mais novo', () => {
  const before = base();
  const after = cancelCase(cancelCase(before, 'case-1', 'Desistiu', now, 'Paciente desistiu'), 'case-3', 'Sem vaga', now, 'Outro');
  const diff = changes(before, after);
  assert.deepEqual(diff.cases.map(c => c.id), ['case-1', 'case-3']);
  assert.deepEqual([diff.patients.length, diff.reference.length], [0, 0]);
  assert.deepEqual(diff.audit.map(a => a.caseId), ['case-1', 'case-3']);
});

test('envio inicial, atualização com revisão e conflito quando outra pessoa gravou antes', async () => {
  const { client, tables, calls } = fakeClient();
  const data = base();
  let revisions = await pushChanges(client, null, data, new Map());
  assert.equal(tables.hemo_cases.size, 5);
  assert.equal(revisions.get('hemo_cases:case-1'), 0);
  assert.ok(calls.indexOf('insert hemo_patients') < calls.indexOf('insert hemo_cases'), 'paciente antes do caso');
  const next = cancelCase(data, 'case-1', 'Desistiu', now, 'Paciente desistiu');
  calls.length = 0;
  revisions = await pushChanges(client, data, next, revisions);
  assert.deepEqual(calls, ['update hemo_cases case-1', 'insert audit_log']);
  assert.equal(tables.hemo_cases.get('case-1').stage, 'Cancelado');
  assert.equal(revisions.get('hemo_cases:case-1'), 1);
  assert.equal(tables.audit_log.at(-1).action, 'Cancelado');
  // Outra pessoa grava o mesmo caso: a revisão que este app conhece ficou velha.
  tables.hemo_cases.get('case-1').revision = 2;
  const again = cancelCase(base(), 'case-3', 'x', now, 'Outro');
  await assert.rejects(pushChanges(client, data, { ...again, cases: again.cases.map(c => c.id === 'case-1' ? findCase(next, 'case-1') : c) }, new Map([...revisions].map(([k, v]) => [k, k === 'hemo_cases:case-1' ? 0 : v]))), RemoteConflict);
});

test('carregar do servidor devolve a base e as revisões; servidor vazio devolve nada', async () => {
  const { client } = fakeClient();
  assert.equal((await loadRemote(client)).data, null);
  await pushChanges(client, null, base(), new Map());
  const loaded = await loadRemote(client);
  assert.equal(loaded.data.cases.length, 5);
  assert.equal(loaded.revisions.get('hemo_reference:values'), 0);
});
