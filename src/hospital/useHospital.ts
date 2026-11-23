import { useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
import { hospitalStorageKey, makeHospitalData, parseHospitalData, type HospitalData } from './domain';

export function hospitalError(error: unknown) { return error instanceof ZodError ? error.issues.map(i => i.message).slice(0, 3).join(' ') : error instanceof Error ? error.message : 'Não foi possível concluir a operação.'; }
function load() {
  try { const raw = localStorage.getItem(hospitalStorageKey); return { data: raw ? parseHospitalData(JSON.parse(raw)) : makeHospitalData(), error: '' }; }
  catch { return { data: null, error: 'Não foi possível ler a agenda salva. A base original foi preservada. Exporte uma cópia para revisão antes de recuperar os dados.' }; }
}
export function useHospital() {
  const [state, setState] = useState(load);
  const latest = useRef(state); latest.current = state;
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === hospitalStorageKey || event.key === null) { const next = load(); latest.current = next; setState(next); setError('A agenda mudou em outra aba. Confira os dados antes de continuar.'); } };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  function update(change: (data: HospitalData) => HospitalData): boolean {
    setError('');
    try {
      const current = latest.current.data;
      if (!current) throw new Error('A base está indisponível. Recupere os dados antes de alterar a agenda.');
      const raw = localStorage.getItem(hospitalStorageKey);
      if (raw && parseHospitalData(JSON.parse(raw)).revision !== current.revision) { const next = load(); latest.current = next; setState(next); throw new Error('A agenda foi atualizada em outra aba. Confira e tente novamente.'); }
      const next = parseHospitalData(change(current));
      localStorage.setItem(hospitalStorageKey, JSON.stringify(next));
      const result = { data: next, error: '' }; latest.current = result; setState(result);
      return true;
    } catch (err) { setError(hospitalError(err)); return false; }
  }
  return { data: state.data, error: state.error || error, update, clearError: () => setError('') };
}
export type HospitalStore = ReturnType<typeof useHospital>;
