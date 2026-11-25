import { useEffect, useState } from 'react';
import { ZodError } from 'zod';
import { authenticate, authStorageKey, createFirstAdmin, emptyUserStore, parseUserStore, publicUser, saveUser, sessionStorageKey, sessionUser, type PublicUser, type Session, type UserInput, type UserStore } from './domain';

export function authError(error: unknown) {
  return error instanceof ZodError ? error.issues.map(i => i.message).slice(0, 2).join(' ') : error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}
function readStore(): { store: UserStore | null; error: string } {
  try { const raw = localStorage.getItem(authStorageKey); return { store: raw ? parseUserStore(JSON.parse(raw)) : emptyUserStore(), error: '' }; }
  catch { return { store: null, error: 'Não foi possível ler os usuários salvos neste navegador. Os dados foram preservados; peça ajuda ao responsável pelo sistema.' }; }
}
function readSession(): Session | null {
  try { const raw = sessionStorage.getItem(sessionStorageKey); return raw ? JSON.parse(raw) as Session : null; } catch { return null; }
}
function writeSession(session: Session | null) {
  try { if (session) sessionStorage.setItem(sessionStorageKey, JSON.stringify(session)); else sessionStorage.removeItem(sessionStorageKey); } catch { /* Sessão some ao recarregar se o navegador bloquear. */ }
}
/** Sempre parte do que está gravado agora, para não sobrescrever mudança feita em outra aba. */
function persist(change: (store: UserStore) => Promise<UserStore>) {
  return async () => {
    const current = readStore();
    if (!current.store) throw new Error(current.error);
    const next = await change(current.store);
    localStorage.setItem(authStorageKey, JSON.stringify(next));
    return next;
  };
}

export function useAuth() {
  const [{ store, error }, setState] = useState(readStore);
  const [session, setSession] = useState(readSession);
  const [, tick] = useState(0);
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === authStorageKey || event.key === null) setState(readStore()); };
    window.addEventListener('storage', refresh);
    const timer = window.setInterval(() => tick(n => n + 1), 60_000); // expira a sessão sem precisar recarregar
    return () => { window.removeEventListener('storage', refresh); window.clearInterval(timer); };
  }, []);
  const user = store ? sessionUser(store, session) : null;
  function start(userId: string) { const next = { userId, startedAt: new Date().toISOString() }; writeSession(next); setSession(next); }
  return {
    error,
    needsSetup: !!store && store.users.length === 0,
    user,
    users: (store?.users ?? []).map(publicUser),
    async login(login: string, password: string) {
      const current = readStore();
      if (!current.store) throw new Error(current.error);
      const found = await authenticate(current.store, login, password);
      setState(current); start(found.id);
    },
    logout() { writeSession(null); setSession(null); },
    async setup(input: { name: string; login: string; password: string }) {
      const next = await persist(s => createFirstAdmin(s, input))();
      setState({ store: next, error: '' }); start(next.users[0].id);
    },
    async save(input: UserInput) {
      // A permissão é conferida com o usuário como está gravado agora, não como estava na tela.
      const next = await persist(s => saveUser(s, sessionUser(s, session), input))();
      setState({ store: next, error: '' });
    },
  };
}
export type AuthSession = ReturnType<typeof useAuth>;
export type { PublicUser };
