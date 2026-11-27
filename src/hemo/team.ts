import { type Role } from '../auth/domain.ts';
import { bandStatus, recheckOverdue } from './clinical.ts';
import {
  allGlosas, DOOR_TO_BALLOON_TARGET_MIN, localStamp, minutesOf, patientOf, pendingFollowUps, prepMissing, typeOf, type HemoCase, type HemoData,
} from './domain.ts';

/**
 * Fluxo da equipe: o que cada perfil tem para fazer agora, avisos de tempo e o painel público
 * (sala de espera e recuperação), que mostra só iniciais.
 */

/** Iniciais para telas públicas e notificações do sistema operacional: "Maria das Graças Lima" → "M. G. L." */
export function initials(name: string) {
  const connectors = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return name.trim().split(/\s+/).filter(w => w && !connectors.has(w.toLocaleLowerCase('pt-BR'))).map(w => `${w[0].toLocaleUpperCase('pt-BR')}.`).join(' ');
}

// ---------- Avisos de tempo ----------
/** Laudo sem assinatura por mais que isto (horas) vira aviso. Referência do serviço. */
export const REPORT_SIGN_LIMIT_H = 24;
/** Minutos antes da meta do porta-balão em que o aviso começa. */
export const DTB_WARNING_MIN = 30;
/** Minutos antes do horário de soltar a pulseira em que o aviso começa. */
export const BAND_WARNING_MIN = 15;
export type TimeAlert = { key: string; caseId: string; level: 'alto' | 'atenção'; title: string; detail: string; patient: string };

/** Quando a recuperação terminou (entrada do histórico); casos antigos sem ela usam o fim do procedimento. */
function recoveryDoneAt(data: HemoData, c: HemoCase) {
  const entry = data.audit.find(a => a.caseId === c.id && a.action === 'Recuperação concluída');
  return entry ? localStamp(new Date(entry.at)) : c.intra.end;
}
const hm = (min: number) => min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;

export function timeAlerts(data: HemoData, now = new Date()): TimeAlert[] {
  const at = localStamp(now), out: TimeAlert[] = [];
  for (const c of data.cases) {
    const patient = patientOf(data, c).name;
    if (c.stage === 'Recuperação') {
      const band = bandStatus(c, now);
      if (band?.overdue) out.push({ key: `band-over-${c.id}`, caseId: c.id, level: 'alto', title: 'Pulseira radial passou do horário', detail: `Era para soltar às ${band.releaseAt.slice(11)} (há ${hm(-band.minutesLeft)}).`, patient });
      else if (band && band.minutesLeft <= BAND_WARNING_MIN) out.push({ key: `band-soon-${c.id}`, caseId: c.id, level: 'atenção', title: 'Soltar a pulseira radial', detail: `Às ${band.releaseAt.slice(11)} (em ${band.minutesLeft} min).`, patient });
    }
    if (c.stage === 'Laudo') {
      const since = recoveryDoneAt(data, c);
      const hours = since ? Math.floor((minutesOf(at) - minutesOf(since)) / 60) : 0;
      if (hours >= REPORT_SIGN_LIMIT_H) out.push({ key: `report-${c.id}`, caseId: c.id, level: 'atenção', title: 'Laudo sem assinatura', detail: `Há ${hours} h desde a liberação da recuperação (limite do serviço: ${REPORT_SIGN_LIMIT_H} h).`, patient });
    }
    if (c.priority === 'Urgência' && c.doorAt && !c.intra.balloonAt && ['Preparo', 'Sala'].includes(c.stage)) {
      const elapsed = minutesOf(at) - minutesOf(c.doorAt);
      if (elapsed >= DOOR_TO_BALLOON_TARGET_MIN) out.push({ key: `dtb-over-${c.id}`, caseId: c.id, level: 'alto', title: 'Porta-balão acima da meta', detail: `${hm(elapsed)} desde a chegada, sem abertura da artéria registrada (meta ${DOOR_TO_BALLOON_TARGET_MIN} min).`, patient });
      else if (elapsed >= DOOR_TO_BALLOON_TARGET_MIN - DTB_WARNING_MIN) out.push({ key: `dtb-soon-${c.id}`, caseId: c.id, level: 'atenção', title: 'Porta-balão perto da meta', detail: `${elapsed} min desde a chegada; faltam ${DOOR_TO_BALLOON_TARGET_MIN - elapsed} min para a meta.`, patient });
    }
  }
  return out.sort((a, b) => (a.level === 'alto' ? 0 : 1) - (b.level === 'alto' ? 0 : 1));
}

// ---------- Tarefas por perfil ----------
export type Task = { caseId: string; group: string; title: string; detail: string; urgent: boolean };
const name = (data: HemoData, c: HemoCase) => patientOf(data, c).name;
/**
 * O que é de cada perfil. Equipe de atendimento: preparo, pulseira, recuperação e contatos.
 * Médico: laudos, sala e resultados renais. Administrador: tudo isso mais autorização e faturamento.
 */
export function tasksFor(role: Role, data: HemoData, now = new Date()): Task[] {
  const active = data.cases.filter(c => !['Encerrado', 'Cancelado'].includes(c.stage));
  const nursing: Task[] = [
    ...active.filter(c => c.stage === 'Preparo').map(c => ({ c, missing: prepMissing(c) })).filter(x => x.missing.length).map(({ c, missing }) => ({ caseId: c.id, group: 'Preparo', title: name(data, c), detail: `${c.schedule ? `${c.schedule.start.slice(8, 10)}/${c.schedule.start.slice(5, 7)} ${c.schedule.start.slice(11)} · ` : ''}falta: ${missing.slice(0, 2).join('; ')}${missing.length > 2 ? ` (+${missing.length - 2})` : ''}`, urgent: c.priority === 'Urgência' })),
    ...active.filter(c => c.stage === 'Recuperação').map(c => {
      const band = bandStatus(c, now), pending = [band && `pulseira até ${band.releaseAt.slice(11)}`, !c.handoff.at && ['Internação', 'UTI'].includes(c.recovery.destination) && 'passagem de plantão', !c.reconciliation.doneAt && 'reconciliação de medicamentos', !c.discharge.deliveredAt && 'orientação de alta'].filter(Boolean);
      return { caseId: c.id, group: 'Recuperação', title: name(data, c), detail: pending.length ? `pendente: ${pending.join(' · ')}` : 'pronto para liberar', urgent: !!band?.overdue };
    }),
    ...pendingFollowUps(data, now).filter(x => x.days <= 0).map(({ c, days }) => ({ caseId: c.id, group: 'Contato de 30 dias', title: name(data, c), detail: days < 0 ? `atrasado ${-days} dia(s)` : 'para hoje', urgent: days < 0 })),
  ];
  const doctor: Task[] = [
    ...active.filter(c => c.stage === 'Laudo').map(c => ({ caseId: c.id, group: 'Laudos para assinar', title: name(data, c), detail: `${typeOf(data, c).name}${c.report.text ? ' · rascunho salvo' : ' · sem rascunho'}`, urgent: false })),
    ...active.filter(c => c.stage === 'Sala').map(c => ({ caseId: c.id, group: 'Em sala', title: name(data, c), detail: `${typeOf(data, c).name} · entrada ${c.intra.roomIn.slice(11)}`, urgent: c.priority === 'Urgência' })),
    ...data.cases.filter(c => recheckOverdue(c, now) || c.renal.aki).map(c => ({ caseId: c.id, group: 'Função renal', title: name(data, c), detail: c.renal.aki ? 'creatinina de controle sugere lesão renal aguda' : `creatinina de controle atrasada (prevista ${c.renal.recheckDue.split('-').reverse().join('/')})`, urgent: c.renal.aki })),
  ];
  const admin: Task[] = [
    ...active.filter(c => c.stage === 'Autorização').map(c => ({ caseId: c.id, group: 'Autorizações', title: name(data, c), detail: `${typeOf(data, c).name} · ${patientOf(data, c).insurance}`, urgent: false })),
    ...data.cases.filter(c => c.authorization.status === 'Regularizar').map(c => ({ caseId: c.id, group: 'Guias a regularizar', title: name(data, c), detail: 'urgência feita sem guia: a conta não fecha', urgent: true })),
    ...active.filter(c => c.stage === 'Faturamento').map(c => ({ caseId: c.id, group: 'Contas para fechar', title: name(data, c), detail: typeOf(data, c).name, urgent: false })),
    ...allGlosas(data).filter(x => x.g.status === 'Aberta').map(x => ({ caseId: x.c.id, group: 'Glosas abertas', title: x.patient, detail: `${x.g.item} · ${x.g.reason}`, urgent: false })),
  ];
  const list = role === 'equipe' ? nursing : role === 'medico' ? doctor : [...nursing, ...doctor, ...admin];
  return list.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

// ---------- Painel público (TV) ----------
export const publicStatus: Partial<Record<HemoCase['stage'], string>> = { Agendamento: 'Aguardando', Preparo: 'Em preparo', Sala: 'Em procedimento', Recuperação: 'Em recuperação', Laudo: 'Liberado da recuperação' };
/** Casos do dia para a TV: só iniciais, sala e situação. Nome, procedimento e convênio não aparecem. */
export function publicBoard(data: HemoData, now = new Date()) {
  const today = localStamp(now).slice(0, 10);
  return data.cases
    .filter(c => publicStatus[c.stage] && (c.schedule?.start.startsWith(today) || ['Sala', 'Recuperação'].includes(c.stage) || (c.stage === 'Laudo' && c.intra.end.startsWith(today))))
    .map(c => ({ id: c.id, who: initials(patientOf(data, c).name), room: c.schedule ? data.rooms.find(r => r.id === c.schedule!.roomId)?.name.split(' · ')[0] ?? '' : '', time: c.schedule?.start.slice(11) ?? '', status: publicStatus[c.stage]!, stage: c.stage }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
