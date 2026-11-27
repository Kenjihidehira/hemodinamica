import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHemoData, findCase, savePrep, startProcedure, finishProcedure, startEmergency, parseHemoData } from '../src/hemo/domain.ts';
import { confirmIdentity } from '../src/hemo/safety.ts';
import { initials, publicBoard, tasksFor, timeAlerts } from '../src/hemo/team.ts';
import { can } from '../src/auth/domain.ts';

const now = new Date('2026-11-23T13:00:00Z'); // 10h em São Paulo.
const base = () => makeHemoData(now);
const allPrep = { fasting: true, labs: true, allergy: true, anticoagulant: true, consent: true, venousAccess: true };
const allTimeout = { identity: true, procedure: true, materials: true, team: true };
/** Caso 1 concluído às 10:40 por via radial: pulseira de compressão com liberação às 12:40. */
function inRecovery() {
  let data = savePrep(base(), 'case-1', allPrep, allTimeout, '', now);
  data = startProcedure(confirmIdentity(data, 'case-1', { code: 'PAC-HP-2' }, now), 'case-1', now);
  return finishProcedure(data, 'case-1', { roomIn: '', start: '2026-11-23T10:05', end: '2026-11-23T10:40', access: 'Radial direita', contrastMl: 80, fluoroMin: 6, kermaMgy: 400, complications: '' }, now);
}

test('iniciais: sem preposições', () => {
  assert.equal(initials('Maria das Graças Lima'), 'M. G. L.');
  assert.equal(initials('  José Roberto  Alves '), 'J. R. A.');
});

test('avisos: pulseira perto do horário e atrasada', () => {
  const data = inRecovery();
  assert.equal(timeAlerts(data, now).length, 0);
  const soon = timeAlerts(data, new Date('2026-11-23T15:30:00Z')); // 12:30
  assert.equal(soon[0].title, 'Soltar a pulseira radial'); assert.equal(soon[0].level, 'atenção');
  const late = timeAlerts(data, new Date('2026-11-23T16:00:00Z')); // 13:00
  assert.equal(late[0].title, 'Pulseira radial passou do horário'); assert.match(late[0].detail, /há 20 min/);
});

test('avisos: laudo sem assinatura há mais de 24 h e porta-balão perto/acima da meta', () => {
  const data = base(); // caso 4 terminou ontem às 15:10 e está em Laudo
  assert.ok(!timeAlerts(data, now).some(a => a.caseId === 'case-4'));
  assert.equal(timeAlerts(data, new Date('2026-11-23T19:30:00Z')).find(a => a.caseId === 'case-4').title, 'Laudo sem assinatura');
  const at = new Date('2026-11-24T11:50:00Z');
  const urg = startEmergency(base(), { patientId: 'hp-3', typeId: 'iam', roomId: 'sala-2', doctorId: 'doc-2', indication: 'IAM.', requestedBy: 'PS', doorAt: '2026-11-24T08:20' }, at);
  const id = urg.cases[0].id;
  assert.ok(!timeAlerts(urg, at).some(a => a.caseId === id));
  assert.equal(timeAlerts(urg, new Date('2026-11-24T12:30:00Z')).find(a => a.caseId === id).title, 'Porta-balão perto da meta');
  const over = timeAlerts(urg, new Date('2026-11-24T13:00:00Z')).find(a => a.caseId === id);
  assert.equal(over.level, 'alto');
});

test('tarefas: cada perfil vê o que é dele; administrador vê tudo', () => {
  const data = base();
  const team = tasksFor('equipe', data, now), doctor = tasksFor('medico', data, now), admin = tasksFor('admin', data, now);
  assert.ok(team.some(t => t.group === 'Preparo' && t.caseId === 'case-1'));
  assert.ok(!team.some(t => t.group === 'Laudos para assinar'));
  assert.ok(doctor.some(t => t.group === 'Laudos para assinar' && t.caseId === 'case-4'));
  assert.ok(!doctor.some(t => t.group === 'Preparo'));
  assert.ok(admin.some(t => t.group === 'Autorizações' && t.caseId === 'case-2'));
  assert.ok(admin.length >= team.length + doctor.length);
  const rec = tasksFor('equipe', inRecovery(), now).find(t => t.group === 'Recuperação');
  assert.match(rec.detail, /pulseira até 12:40/); assert.match(rec.detail, /reconciliação/);
});

test('painel da TV: só iniciais, sala e situação, nunca o nome', () => {
  const at = new Date('2026-11-24T11:50:00Z');
  const data = startEmergency(base(), { patientId: 'hp-3', typeId: 'iam', roomId: 'sala-2', doctorId: 'doc-2', indication: 'IAM.', requestedBy: 'PS', doorAt: '2026-11-24T08:20' }, at);
  const rows = publicBoard(data, at);
  assert.ok(rows.some(r => r.who === 'J. R. A.' && r.room === 'Sala 2' && r.status === 'Em preparo'));
  const text = JSON.stringify(rows);
  for (const p of data.patients) assert.ok(!text.includes(p.name), `não pode mostrar ${p.name}`);
  assert.ok(!text.includes('Angioplastia'));
  // O caso 1 está marcado para este dia; o caso 3 (sem horário) não aparece.
  assert.ok(rows.some(r => r.id === 'case-1' && r.who === 'M. G. L.'));
  assert.ok(!rows.some(r => r.id === 'case-3'));
  assert.ok(!publicBoard(data, new Date('2026-11-23T13:00:00Z')).some(r => r.id === 'case-1'));
});

test('permissão: qualidade por médico só para administrador', () => {
  assert.equal(can({ role: 'admin', active: true }, 'qualidade.ver'), true);
  assert.equal(can({ role: 'medico', active: true }, 'qualidade.ver'), false);
  assert.equal(can({ role: 'admin', active: false }, 'qualidade.ver'), false);
  assert.ok(parseHemoData(JSON.parse(JSON.stringify(base()))));
  assert.equal(findCase(base(), 'case-1').identity.at, '');
});
