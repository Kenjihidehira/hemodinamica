import { z } from 'zod';

/**
 * Acesso local de demonstração: contas e sessão ficam só neste navegador.
 * A senha é guardada como hash PBKDF2 (nunca em texto), mas quem tem acesso ao navegador
 * pode alterar o armazenamento local. Em produção, login e permissões vão para o servidor.
 */
export const roles = ['admin', 'medico', 'equipe'] as const;
export type Role = typeof roles[number];
export const roleLabel: Record<Role, string> = { admin: 'Administrador', medico: 'Médico', equipe: 'Equipe de atendimento' };

/** Quem pode fazer o quê. Cadastro de pacientes é livre para qualquer usuário logado. */
export const permissions = {
  'pacientes.editar': ['admin', 'medico', 'equipe'],
  'profissionais.editar': ['admin'],
  'usuarios.gerenciar': ['admin'],
  'valores.editar': ['admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof permissions;
const deniedMessage: Record<Permission, string> = {
  'pacientes.editar': 'Entre no sistema para cadastrar pacientes.',
  'profissionais.editar': 'Somente administradores podem criar ou alterar perfis de médicos e profissionais.',
  'usuarios.gerenciar': 'Somente administradores podem criar ou alterar usuários.',
  'valores.editar': 'Somente administradores podem alterar a tabela de custos e valores.',
};
export function can(user: Pick<User, 'role' | 'active'> | null | undefined, permission: Permission) {
  return !!user && user.active && (permissions[permission] as readonly Role[]).includes(user.role);
}
export function assertCan(user: Pick<User, 'role' | 'active'> | null | undefined, permission: Permission) {
  if (!can(user, permission)) throw new Error(deniedMessage[permission]);
}

const passwordSchema = z.object({ salt: z.string().regex(/^[0-9a-f]{32}$/), hash: z.string().regex(/^[0-9a-f]{64}$/), iterations: z.number().int().min(100_000) });
/** Login simples (ex.: "admin") ou e-mail (ex.: "nome@empresa.com.br"). */
const loginSchema = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9._-]{3,80}|[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/, 'Login: use um e-mail ou de 3 a 80 caracteres com letras sem acento, números, ponto, hífen ou sublinhado.').max(120, 'Login muito longo.');
const userSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1, 'Informe o nome.').max(160),
  login: loginSchema,
  role: z.enum(roles),
  active: z.boolean(),
  password: passwordSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().max(160),
});
const storeSchema = z.object({ version: z.literal(1), users: z.array(userSchema) });
export type User = z.infer<typeof userSchema>;
export type UserStore = z.infer<typeof storeSchema>;
export type PublicUser = Omit<User, 'password'>;

export const authStorageKey = 'jusimed-acesso-v1';
export const sessionStorageKey = 'jusimed-sessao-v1';
export const SESSION_HOURS = 12;
export const MIN_PASSWORD_LENGTH = 8;
const ITERATIONS = 210_000;

export const emptyUserStore = (): UserStore => ({ version: 1, users: [] });
export function parseUserStore(value: unknown): UserStore {
  const store = storeSchema.parse(value);
  if (new Set(store.users.map(u => u.id)).size !== store.users.length) throw new Error('Usuários com identificador repetido.');
  if (new Set(store.users.map(u => u.login)).size !== store.users.length) throw new Error('Usuários com login repetido.');
  return store;
}
export const publicUser = ({ password: _password, ...rest }: User): PublicUser => rest;

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => new Uint8Array(value.match(/../g)!.map(h => parseInt(h, 16)));
export async function hashPassword(password: string, salt = toHex(crypto.getRandomValues(new Uint8Array(16))), iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations }, key, 256);
  return { salt, hash: toHex(new Uint8Array(bits)), iterations };
}
export async function verifyPassword(password: string, stored: User['password']) {
  const { hash } = await hashPassword(password, stored.salt, stored.iterations);
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0 && hash.length === stored.hash.length;
}
export function passwordProblem(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'A senha precisa ter letras e números.';
  return '';
}

export type UserInput = { id?: string; name: string; login: string; role: Role; active: boolean; password?: string };
const activeAdmins = (users: User[]) => users.filter(u => u.active && u.role === 'admin').length;

async function buildUser(store: UserStore, input: UserInput, actorName: string, now: Date): Promise<UserStore> {
  const existing = input.id ? store.users.find(u => u.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('Usuário não encontrado.');
  const login = loginSchema.parse(input.login);
  if (store.users.some(u => u.login === login && u.id !== existing?.id)) throw new Error('Já existe um usuário com esse login.');
  if (!existing && !input.password) throw new Error('Defina uma senha inicial.');
  if (input.password) { const problem = passwordProblem(input.password); if (problem) throw new Error(problem); }
  const at = now.toISOString();
  const user: User = userSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name,
    login,
    role: input.role,
    active: input.active,
    password: input.password ? await hashPassword(input.password) : existing!.password,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    updatedBy: actorName,
  });
  const users = existing ? store.users.map(u => u.id === user.id ? user : u) : [...store.users, user];
  if (activeAdmins(users) === 0) throw new Error('O sistema precisa de pelo menos um administrador ativo.');
  return parseUserStore({ ...store, users });
}

/** Primeiro acesso: sem nenhum usuário, quem abre o sistema cria o administrador. Não existe senha padrão. */
export async function createFirstAdmin(store: UserStore, input: { name: string; login: string; password: string }, now = new Date()) {
  if (store.users.length) throw new Error('O administrador inicial já foi criado. Entre com login e senha.');
  return buildUser(store, { ...input, role: 'admin', active: true }, 'Primeiro acesso', now);
}

/** Criar ou alterar usuário. Só administrador; ninguém tira o próprio acesso de administrador nem se desativa. */
export async function saveUser(store: UserStore, actor: User | PublicUser | null, input: UserInput, now = new Date()) {
  assertCan(actor, 'usuarios.gerenciar');
  if (input.id && input.id === actor!.id && (!input.active || input.role !== 'admin')) throw new Error('Você não pode desativar o próprio usuário nem tirar seu acesso de administrador.');
  return buildUser(store, input, actor!.name, now);
}

/** Mensagem única para login ou senha errados, para não revelar quais logins existem. */
export async function authenticate(store: UserStore, login: string, password: string): Promise<User> {
  const user = store.users.find(u => u.login === login.trim().toLowerCase());
  const ok = user ? await verifyPassword(password, user.password) : (await hashPassword(password), false);
  if (!user || !ok) throw new Error('Login ou senha incorretos.');
  if (!user.active) throw new Error('Usuário desativado. Fale com um administrador.');
  return user;
}

export type Session = { userId: string; startedAt: string };
export function sessionUser(store: UserStore, session: Session | null, now = new Date()): PublicUser | null {
  if (!session) return null;
  const started = Date.parse(session.startedAt);
  if (Number.isNaN(started) || now.getTime() - started > SESSION_HOURS * 3_600_000 || started > now.getTime() + 60_000) return null;
  const user = store.users.find(u => u.id === session.userId && u.active);
  return user ? publicUser(user) : null;
}
