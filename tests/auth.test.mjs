import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCan, authenticate, can, createFirstAdmin, emptyUserStore, hashPassword, parseUserStore, passwordProblem, saveUser, sessionUser, verifyPassword, SESSION_HOURS } from '../src/auth/domain.ts';
import { makeHospitalData, saveProfessional, savePatient } from '../src/hospital/domain.ts';

const now = new Date('2026-11-24T12:00:00Z');
const asInput = (u, extra = {}) => ({ id: u.id, name: u.name, login: u.login, role: u.role, active: u.active, ...extra });
async function withTeam() {
  let store = await createFirstAdmin(emptyUserStore(), { name: 'Ana Admin', login: 'Ana.Admin', password: 'senha1234' }, now);
  const admin = store.users[0];
  store = await saveUser(store, admin, { name: 'Dr. Paulo', login: 'paulo', role: 'medico', active: true, password: 'medico123' }, now);
  store = await saveUser(store, admin, { name: 'Recepção 1', login: 'recepcao', role: 'equipe', active: true, password: 'recepcao1' }, now);
  const [, medico, equipe] = store.users;
  return { store, admin, medico, equipe };
}

test('senha guardada como hash, nunca em texto', async () => {
  const stored = await hashPassword('senha1234');
  assert.match(stored.hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(stored).includes('senha1234'));
  assert.equal(await verifyPassword('senha1234', stored), true);
  assert.equal(await verifyPassword('senha1235', stored), false);
  const again = await hashPassword('senha1234');
  assert.notEqual(again.hash, stored.hash, 'sal diferente a cada senha');
});

test('regras de senha', () => {
  assert.match(passwordProblem('abc1'), /8 caracteres/);
  assert.match(passwordProblem('somenteletras'), /letras e números/);
  assert.equal(passwordProblem('senha1234'), '');
});

test('primeiro acesso cria um único administrador', async () => {
  const store = await createFirstAdmin(emptyUserStore(), { name: 'Ana', login: 'ana', password: 'senha1234' }, now);
  assert.equal(store.users[0].role, 'admin');
  assert.equal(store.users[0].active, true);
  await assert.rejects(createFirstAdmin(store, { name: 'Outro', login: 'outro', password: 'senha1234' }, now), /já foi criado/);
});

test('login: normaliza o login, mensagem única para erro e bloqueia desativado', async () => {
  const { store, admin, medico } = await withTeam();
  assert.equal(admin.login, 'ana.admin');
  assert.equal((await authenticate(store, ' ANA.admin ', 'senha1234')).id, admin.id);
  await assert.rejects(authenticate(store, 'ana.admin', 'errada123'), /Login ou senha incorretos/);
  await assert.rejects(authenticate(store, 'ninguem', 'senha1234'), /Login ou senha incorretos/);
  const off = await saveUser(store, admin, asInput(medico, { active: false }), now);
  await assert.rejects(authenticate(off, 'paulo', 'medico123'), /desativado/);
});

test('login pode ser e-mail', async () => {
  const store = await createFirstAdmin(emptyUserStore(), { name: 'Admin', login: ' Nome.Sobrenome@Empresa.com.br ', password: 'senha1234' }, now);
  assert.equal(store.users[0].login, 'nome.sobrenome@empresa.com.br');
  assert.equal((await authenticate(store, 'NOME.SOBRENOME@empresa.com.br', 'senha1234')).id, store.users[0].id);
  await assert.rejects(createFirstAdmin(emptyUserStore(), { name: 'A', login: 'nome@', password: 'senha1234' }, now), /Login/);
  await assert.rejects(createFirstAdmin(emptyUserStore(), { name: 'A', login: 'joão', password: 'senha1234' }, now), /Login/);
});

test('somente administrador cria e altera usuários', async () => {
  const { store, admin, medico, equipe } = await withTeam();
  await assert.rejects(saveUser(store, medico, { name: 'X', login: 'xxx', role: 'admin', active: true, password: 'senha1234' }, now), /Somente administradores/);
  await assert.rejects(saveUser(store, equipe, asInput(equipe, { role: 'admin' }), now), /Somente administradores/);
  await assert.rejects(saveUser(store, null, { name: 'X', login: 'xxx', role: 'equipe', active: true, password: 'senha1234' }, now), /Somente administradores/);
  await assert.rejects(saveUser(store, admin, { name: 'X', login: 'PAULO', role: 'equipe', active: true, password: 'senha1234' }, now), /mesmo login|com esse login/);
  await assert.rejects(saveUser(store, admin, { name: 'X', login: 'novo', role: 'equipe', active: true }, now), /senha inicial/);
  const kept = await saveUser(store, admin, { id: medico.id, name: 'Dr. Paulo Lima', login: 'paulo', role: 'medico', active: true }, now);
  assert.equal(await verifyPassword('medico123', kept.users.find(u => u.id === medico.id).password), true, 'sem nova senha, mantém a atual');
});

test('administrador não tira o próprio acesso e o sistema sempre tem um admin ativo', async () => {
  const { store, admin } = await withTeam();
  await assert.rejects(saveUser(store, admin, asInput(admin, { active: false }), now), /próprio usuário/);
  await assert.rejects(saveUser(store, admin, asInput(admin, { role: 'medico' }), now), /próprio usuário/);
});

test('permissões: pacientes para todos, médicos só para admin', async () => {
  const { admin, medico, equipe } = await withTeam();
  for (const u of [admin, medico, equipe]) assert.equal(can(u, 'pacientes.editar'), true);
  assert.equal(can(admin, 'profissionais.editar'), true);
  assert.equal(can(medico, 'profissionais.editar'), false);
  assert.equal(can(equipe, 'profissionais.editar'), false);
  assert.equal(can(null, 'pacientes.editar'), false);
  assert.equal(can({ ...admin, active: false }, 'profissionais.editar'), false);

  // Como a tela grava: a checagem roda dentro da alteração da agenda.
  const data = makeHospitalData(now);
  const doctor = { id: 'pro-9', name: 'Dra. Nova', occupation: 'Médica', photoUrl: '', unitId: 'unit-1', specialtyId: 'spec-1', days: [1], start: '08:00', end: '12:00', duration: 30, active: true };
  const saveDoctorAs = user => { assertCan(user, 'profissionais.editar'); return saveProfessional(data, doctor); };
  assert.throws(() => saveDoctorAs(equipe), /Somente administradores/);
  assert.throws(() => saveDoctorAs(medico), /Somente administradores/);
  assert.ok(saveDoctorAs(admin).professionals.some(p => p.id === 'pro-9'));
  const patient = { id: 'pat-9', name: 'Paciente novo', phone: '', birthDate: '', occupation: '', photoUrl: '' };
  for (const u of [admin, medico, equipe]) { assertCan(u, 'pacientes.editar'); assert.ok(savePatient(data, patient).patients.some(p => p.id === 'pat-9')); }
});

test('sessão expira, e usuário desativado perde a sessão', async () => {
  const { store, admin, medico } = await withTeam();
  const session = { userId: medico.id, startedAt: now.toISOString() };
  assert.equal(sessionUser(store, session, now)?.id, medico.id);
  assert.equal(sessionUser(store, session, now).password, undefined, 'a sessão não expõe o hash');
  assert.equal(sessionUser(store, session, new Date(now.getTime() + (SESSION_HOURS * 3600 + 1) * 1000)), null);
  const off = await saveUser(store, admin, asInput(medico, { active: false }), now);
  assert.equal(sessionUser(off, session, now), null);
  assert.equal(sessionUser(store, { userId: 'inexistente', startedAt: now.toISOString() }, now), null);
});

test('base de usuários inválida é recusada', async () => {
  const { store } = await withTeam();
  assert.throws(() => parseUserStore({ ...store, users: [...store.users, store.users[0]] }), /repetido/);
  assert.throws(() => parseUserStore({ version: 1, users: [{ ...store.users[0], password: { salt: 'x', hash: 'y', iterations: 1 } }] }));
});
