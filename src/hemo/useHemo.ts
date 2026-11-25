import { useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
import { hemoStorageKey, makeHemoData, parseHemoData, type HemoData } from './domain';
import { stampAudit } from './clinical';

export function hemoError(error: unknown) { return error instanceof ZodError ? error.issues.map(i => i.message).slice(0, 3).join(' ') : error instanceof Error ? error.message : 'Não foi possível concluir a operação.'; }
function load() {
  try { const raw = localStorage.getItem(hemoStorageKey); return { data: raw ? parseHemoData(JSON.parse(raw)) : makeHemoData(), error: '' }; }
  catch { return { data: null as HemoData | null, error: 'Não foi possível ler os dados da hemodinâmica salvos neste navegador. A base original foi preservada.' }; }
}
/** Mesmo padrão da agenda: grava no navegador e recusa a gravação se outra aba mudou os dados antes. */
/** actor = usuário logado; cada entrada nova do histórico leva o nome dele. */
export function useHemo(actor = '') {
  const [state, setState] = useState(load);
  const actorRef = useRef(actor); actorRef.current = actor;
  const latest = useRef(state); latest.current = state;
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === hemoStorageKey || event.key === null) { const next = load(); latest.current = next; setState(next); setError('Os dados mudaram em outra aba. Confira antes de continuar.'); } };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  function update(change: (data: HemoData) => HemoData): boolean {
    setError('');
    try {
      const current = latest.current.data;
      if (!current) throw new Error('A base está indisponível.');
      const raw = localStorage.getItem(hemoStorageKey);
      if (raw && parseHemoData(JSON.parse(raw)).revision !== current.revision) { const next = load(); latest.current = next; setState(next); throw new Error('Os dados foram atualizados em outra aba. Confira e tente novamente.'); }
      const next = parseHemoData(stampAudit(current, change(current), actorRef.current));
      localStorage.setItem(hemoStorageKey, JSON.stringify(next));
      const result = { data: next, error: '' }; latest.current = result; setState(result);
      return true;
    } catch (err) { setError(hemoError(err)); return false; }
  }
  function reset() { const result = { data: makeHemoData(), error: '' }; localStorage.setItem(hemoStorageKey, JSON.stringify(result.data)); latest.current = result; setState(result); setError(''); }
  return { data: state.data, error: state.error || error, update, reset, clearError: () => setError('') };
}
export type HemoStore = ReturnType<typeof useHemo>;
