import { useEffect, useState } from 'react';
import { type HemoData, type WithStock } from './domain';
import { type HemoStore } from './useHemo';
import { type DemoData } from '../data';

export type Update = HemoStore['update'];
/** stock = Estoque do hospital; commitBoth grava caso e estoque juntos (o estoque só muda se o caso gravar). */
export type Props = { data: HemoData; update: Update; stock: DemoData; commitBoth: (change: (hemo: HemoData, stock: DemoData) => WithStock) => boolean; onOpenLot: (stockId: string) => void };
export const when = (value: string) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)} ${value.slice(11, 16)}` : '—';
export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
export const shortDate = (date: string) => date ? date.split('-').reverse().join('/') : '—';
/** Relógio que atualiza sozinho (cronômetros da pulseira e do porta-balão). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), intervalMs); return () => window.clearInterval(id); }, [intervalMs]);
  return now;
}
