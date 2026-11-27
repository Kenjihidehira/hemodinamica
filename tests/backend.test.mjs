import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Roda a migração da hemodinâmica num Postgres real (PGlite) com o mínimo do ambiente do Supabase:
 * esquema auth com auth.uid() e os papéis anon e authenticated. Confere acesso por perfil,
 * concorrência, auditoria automática e que o histórico não pode ser alterado nem apagado.
 */
const migration = readFileSync(new URL('../supabase/migrations/20261126120000_hemodinamica_backend.sql', import.meta.url), 'utf8');
const ids = { admin: '00000000-0000-0000-0000-00000000000a', medico: '00000000-0000-0000-0000-00000000000b', inativo: '00000000-0000-0000-0000-00000000000c' };
const patient = JSON.stringify({ id: 'hp-1', name: 'Paciente fictício' });

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(migration);
  await db.exec(`
    insert into auth.users values ('${ids.admin}'), ('${ids.medico}'), ('${ids.inativo}');
    insert into public.profiles (id, name, role, active) values ('${ids.admin}', 'Ana Admin', 'admin', true), ('${ids.medico}', 'Dr. Paulo', 'medico', true), ('${ids.inativo}', 'Ex-funcionário', 'equipe', false);
  `);
  return db;
}
/** Age como um usuário logado (papel authenticated + sub do JWT), como faz o PostgREST no Supabase. */
const as = async (db, who) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who === 'anon' ? '' : ids[who]]); await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`); };
const superuser = async db => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); };
const rejects = async (promise, re) => { await assert.rejects(promise, err => re.test(err.message), `esperava erro ${re}`); };
async function seedCase(db) {
  await as(db, 'medico');
  await db.query(`insert into public.hemo_patients (id, data) values ('hp-1', $1)`, [patient]);
  await db.query(`insert into public.hemo_cases (id, patient_id, stage, data) values ('case-1', 'hp-1', 'Preparo', '{"id":"case-1"}')`);
}

test('anônimo não lê nada; usuário inativo não lê nem grava', async () => {
  const db = await setup();
  await seedCase(db);
  await as(db, 'anon');
  await rejects(db.query('select * from public.hemo_cases'), /permission denied/);
  await as(db, 'inativo');
  assert.equal((await db.query('select * from public.hemo_cases')).rows.length, 0);
  await rejects(db.query(`insert into public.hemo_patients (id, data) values ('hp-2', '{}')`), /row-level security/);
});

test('gravar caso gera auditoria no banco, com o autor carimbado pelo servidor', async () => {
  const db = await setup();
  await seedCase(db);
  await db.query(`update public.hemo_cases set stage = 'Sala', revision = 1 where id = 'case-1'`);
  const log = (await db.query(`select entity, entity_id, action, detail, actor, actor_name, seq from public.audit_log order by seq`)).rows;
  assert.deepEqual(log.map(r => [r.entity, r.entity_id, r.action, r.detail]), [
    ['hemo_patients', 'hp-1', 'insert', 'revisão 0'],
    ['hemo_cases', 'case-1', 'insert', 'etapa Preparo · revisão 0'],
    ['hemo_cases', 'case-1', 'update', 'etapa Preparo → Sala · revisão 1'],
  ]);
  assert.ok(log.every(r => r.actor === ids.medico && r.actor_name === 'Dr. Paulo'));
  assert.deepEqual(log.map(r => Number(r.seq)), [1, 2, 3]);
  // O app não consegue se passar por outra pessoa no histórico.
  await db.query(`insert into public.audit_log (entity, entity_id, action, detail, actor, actor_name) values ('app', 'case-1', 'Laudo salvo', 'x', '${ids.admin}', 'Ana Admin')`);
  const last = (await db.query(`select actor, actor_name from public.audit_log order by seq desc limit 1`)).rows[0];
  assert.deepEqual([last.actor, last.actor_name], [ids.medico, 'Dr. Paulo']);
});

test('concorrência: quem gravou com revisão desatualizada é recusado', async () => {
  const db = await setup();
  await seedCase(db);
  await rejects(db.query(`update public.hemo_cases set stage = 'Sala', revision = 5 where id = 'case-1'`), /alterados por outra pessoa/);
  await db.query(`update public.hemo_cases set stage = 'Sala', revision = 1 where id = 'case-1'`);
  await rejects(db.query(`update public.hemo_cases set stage = 'Recuperação', revision = 1 where id = 'case-1'`), /alterados por outra pessoa/);
  const row = (await db.query(`select revision, updated_by from public.hemo_cases where id = 'case-1'`)).rows[0];
  assert.deepEqual([row.revision, row.updated_by], [1, ids.medico]);
});

test('ninguém apaga casos; o histórico não muda nem para o superusuário', async () => {
  const db = await setup();
  await seedCase(db);
  await rejects(db.query(`delete from public.hemo_cases where id = 'case-1'`), /permission denied/);
  await rejects(db.query(`update public.audit_log set detail = 'apagado'`), /permission denied/);
  await rejects(db.query(`delete from public.audit_log`), /permission denied/);
  await superuser(db);
  await rejects(db.query(`update public.audit_log set detail = 'apagado'`), /não pode ser alterado nem apagado/);
  await rejects(db.query(`delete from public.audit_log`), /não pode ser alterado nem apagado/);
  await rejects(db.query(`truncate public.audit_log`), /não pode ser alterado nem apagado/);
  assert.equal((await db.query('select count(*)::int n from public.audit_log')).rows[0].n, 2);
});

test('tabela de valores: só administrador grava; outros cadastros, qualquer usuário ativo', async () => {
  const db = await setup();
  await as(db, 'medico');
  await rejects(db.query(`insert into public.hemo_reference (key, data) values ('values', '{"materials":{}}')`), /row-level security/);
  await db.query(`insert into public.hemo_reference (key, data) values ('rooms', '[]')`);
  await as(db, 'admin');
  await db.query(`insert into public.hemo_reference (key, data) values ('values', '{"materials":{"hem-5":600000}}')`);
  await as(db, 'medico');
  const updated = await db.query(`update public.hemo_reference set data = '{}', revision = 1 where key = 'values'`);
  assert.equal(updated.affectedRows, 0); // RLS esconde a linha da atualização: nada muda.
  assert.deepEqual((await db.query(`select data from public.hemo_reference where key = 'values'`)).rows[0].data, { materials: { 'hem-5': 600000 } });
  await db.query(`update public.hemo_reference set data = '[{"id":"sala-1"}]', revision = 1 where key = 'rooms'`);
});

test('a cadeia de hash denuncia alteração feita por fora', async () => {
  const db = await setup();
  await seedCase(db);
  await db.query(`update public.hemo_cases set stage = 'Sala', revision = 1 where id = 'case-1'`);
  assert.deepEqual((await db.query('select * from public.audit_verify()')).rows, []);
  // Alguém com acesso total desliga a proteção e muda uma linha antiga.
  await superuser(db);
  await db.exec(`alter table public.audit_log disable trigger audit_log_no_update; update public.audit_log set detail = 'etapa Preparo · revisão 9' where seq = 2; alter table public.audit_log enable trigger audit_log_no_update;`);
  const problems = (await db.query('select problem from public.audit_verify()')).rows.map(r => r.problem);
  assert.deepEqual(problems, ['conteúdo alterado']);
});
