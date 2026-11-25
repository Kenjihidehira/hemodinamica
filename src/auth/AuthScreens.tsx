import { useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, Eye, EyeOff, FileText, HeartPulse, KeyRound, Loader2, Lock, LogIn, Pencil, Plus, ScanBarcode, Search, ShieldCheck, Timer, User, UserPlus, UserRound, X } from 'lucide-react';
import { ProfileAvatar } from '../hospital/profileParts';
import { MIN_PASSWORD_LENGTH, roleLabel, roles, type Role, type UserInput } from './domain';
import { authError, type AuthSession } from './useAuth';
import './auth.css';

const localNote = 'Acesso local de demonstração: as contas ficam só neste navegador. Não use senhas que você usa em outros lugares.';

const highlights = [
  { icon: ClipboardList, title: 'Fluxo do procedimento', text: 'Autorização, preparo, sala, recuperação, laudo e faturamento.' },
  { icon: Timer, title: 'Urgência e porta-balão', text: 'Da chegada à abertura da artéria, com meta de 90 minutos.' },
  { icon: ScanBarcode, title: 'OPME rastreável', text: 'Lote e número de série do implante ligados ao paciente.' },
  { icon: FileText, title: 'Laudo com apoio do copilot', text: 'Rascunho para o médico revisar, editar e assinar.' },
];

/** Um batimento: onda P, complexo QRS e onda T, voltando à linha de base. */
const BEAT = 'h20 q6 -9 12 0 h10 l4 6 l6 -46 l6 56 l4 -16 h14 q10 -16 20 0 h48';
/** Pulso de calibração (1 mV) e cinco batimentos, como numa tira de ECG impressa. */
const ECG_PATH = `M0 60 h14 v-20 h10 v20 h10 ${Array(5).fill(BEAT).join(' ')}`;
function EcgStrip() {
  return <figure className="auth-strip" aria-hidden="true">
    <div className="auth-strip-head"><span>DII</span><span>25 mm/s · 10 mm/mV</span></div>
    <svg viewBox="0 0 754 92" preserveAspectRatio="none" focusable="false"><path pathLength={100} d={ECG_PATH}/></svg>
  </figure>;
}
function Field({ icon: Icon, label, children, action }: { icon: typeof User; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <label className="auth-field"><span>{label}</span><span className="auth-input"><Icon size={18} aria-hidden="true"/>{children}{action}</span></label>;
}

/** Tela antes de entrar: cria o primeiro administrador ou pede login e senha. */
export function AccessScreen({ auth }: { auth: AuthSession }) {
  const [form, setForm] = useState({ name: '', login: '', password: '', confirm: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false), [capsLock, setCapsLock] = useState(false);
  const setup = auth.needsSetup;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (setup && form.password !== form.confirm) { setError('As senhas não conferem.'); return; }
    setBusy(true);
    try { if (setup) await auth.setup(form); else await auth.login(form.login, form.password); }
    catch (err) { setError(authError(err)); setForm(f => ({ ...f, password: '', confirm: '' })); }
    finally { setBusy(false); }
  }
  const caps = (event: React.KeyboardEvent) => setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  const passwordType = showPassword ? 'text' : 'password';
  const toggle = <button type="button" className="auth-eye" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>;
  return <main className="auth-page">
    <aside className="auth-brand" aria-label="Sobre o sistema">
      <div className="auth-brand-top"><span className="auth-wordmark"><img src="/brand/hemodinamica.svg" alt=""/><span><strong>Hemodinâmica</strong><small>Gestão hospitalar integrada</small></span></span><span className="auth-unit"><HeartPulse size={15}/> Cardiologia intervencionista</span></div>
      <div className="auth-brand-body">
        <h2>Cada procedimento acompanhado do pedido médico ao faturamento</h2>
        <p className="auth-brand-lead">Sala, preparo, procedimento, laudo e materiais rastreados por paciente, em um só sistema.</p>
        <EcgStrip/>
        <ul className="auth-highlights">{highlights.map(({ icon: Icon, title, text }) => <li key={title}><span><Icon size={18}/></span><div><strong>{title}</strong><small>{text}</small></div></li>)}</ul>
      </div>
      <p className="auth-brand-foot">Protótipo de demonstração · dados fictícios · integrações simuladas</p>
    </aside>
    <section className="auth-panel">
      <div className="auth-card" aria-labelledby="auth-title">
        <span className="auth-restricted"><ShieldCheck size={15}/> Acesso restrito a profissionais autorizados</span>
        {auth.error ? <><h1 id="auth-title">Acesso indisponível</h1><p role="alert" className="auth-alert"><AlertTriangle size={17}/>{auth.error}</p></> : <>
          {setup && <span className="auth-step"><ShieldCheck size={14}/> Configuração inicial</span>}
          <h1 id="auth-title">{setup ? 'Crie o administrador' : 'Entrar'}</h1>
          <p className="auth-lead">{setup ? 'Nenhum usuário neste navegador ainda. O administrador cadastra a equipe, os médicos e define quem pode fazer o quê.' : 'Use seu login e senha para acessar o sistema Hemodinâmica.'}</p>
          <form className="auth-form" onSubmit={submit}>
            {setup && <Field icon={UserRound} label="Nome completo"><input required maxLength={160} autoComplete="name" placeholder="Como vai aparecer no sistema" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field>}
            <Field icon={User} label="Login"><input required autoFocus maxLength={120} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="E-mail ou usuário" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })}/></Field>
            <Field icon={Lock} label="Senha" action={toggle}><input required type={passwordType} maxLength={128} autoComplete={setup ? 'new-password' : 'current-password'} placeholder={setup ? 'Crie uma senha' : 'Sua senha'} value={form.password} onKeyUp={caps} onKeyDown={caps} onChange={e => setForm({ ...form, password: e.target.value })}/></Field>
            {setup && <Field icon={Lock} label="Confirmar senha"><input required type={passwordType} maxLength={128} autoComplete="new-password" placeholder="Repita a senha" value={form.confirm} onKeyUp={caps} onKeyDown={caps} onChange={e => setForm({ ...form, confirm: e.target.value })}/></Field>}
            {setup && <small className="auth-hint">Pelo menos {MIN_PASSWORD_LENGTH} caracteres, com letras e números.</small>}
            {capsLock && <small className="auth-caps" role="status"><AlertTriangle size={14}/> Caps Lock está ligado.</small>}
            {error && <p className="auth-alert" role="alert"><AlertTriangle size={17}/>{error}</p>}
            <button className="button primary auth-submit" disabled={busy}>{busy ? <><Loader2 size={17} className="auth-spin"/> {setup ? 'Criando…' : 'Entrando…'}</> : setup ? <><ShieldCheck size={17}/> Criar administrador e entrar</> : <><LogIn size={17}/> Entrar</>}</button>
          </form>
          {!setup && <p className="auth-help">Esqueceu a senha? Peça a um administrador para definir uma nova.</p>}
        </>}
        <p className="auth-note"><ShieldCheck size={14}/><span>{localNote}</span></p>
      </div>
    </section>
  </main>;
}
const blankUser = (): UserInput => ({ name: '', login: '', role: 'equipe', active: true, password: '' });
const roleHelp: Record<Role, string> = {
  admin: 'Tudo, inclusive usuários e perfis de médicos.',
  medico: 'Usa o sistema e cadastra pacientes.',
  equipe: 'Usa o sistema e cadastra pacientes.',
};
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/** Usuários e acesso: só administrador vê esta tela. Mesmo desenho dos outros perfis: lista à esquerda, formulário à direita. */
export function UsersAdmin({ auth }: { auth: AuthSession }) {
  const [form, setForm] = useState<UserInput>(blankUser), [search, setSearch] = useState('');
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const editor = useRef<HTMLElement>(null);
  const editing = auth.users.find(u => u.id === form.id);
  const self = editing?.id === auth.user?.id;
  const term = fold(search.trim());
  const users = auth.users.filter(u => fold(`${u.name} ${u.login} ${roleLabel[u.role]}`).includes(term)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  function open(next: UserInput) {
    setForm(next); setError(''); setMessage('');
    if (window.matchMedia('(max-width: 1099px)').matches) editor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => editor.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true }), 50);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      await auth.save({ ...form, password: form.password || undefined });
      setMessage(editing ? `Usuário ${form.name.trim()} atualizado.` : `Usuário ${form.name.trim()} criado. Passe o login e a senha inicial para a pessoa.`);
      setForm(blankUser());
    } catch (err) { setError(authError(err)); }
    finally { setBusy(false); }
  }
  return <div className="profiles-layout">
    <section className="panel profiles-directory">
      <div className="profiles-directory-head"><div><h2>Usuários</h2><p>{auth.users.length} cadastrados · {auth.users.filter(u => u.active).length} ativos</p></div><button type="button" className="button primary" onClick={() => open(blankUser())}><Plus size={16}/> Novo usuário</button></div>
      <div className="profiles-toolbar"><label className="profiles-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Buscar</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, login ou perfil"/>{search && <button type="button" className="icon-button" aria-label="Limpar busca" onClick={() => setSearch('')}><X size={15}/></button>}</label></div>
      <div className="profile-list">{users.map(u => <button key={u.id} type="button" className={`profile-card auth-user-card ${u.id === form.id ? 'is-selected' : ''}`} aria-current={u.id === form.id ? 'true' : undefined} onClick={() => open({ id: u.id, name: u.name, login: u.login, role: u.role, active: u.active, password: '' })}>
        <ProfileAvatar name={u.name} photoUrl=""/>
        <span className="profile-card-copy"><strong>{u.name}{u.id === auth.user?.id ? ' (você)' : ''}</strong><small className="profile-role">{roleLabel[u.role]}</small><small>{u.login}</small></span>
        <span className={`profile-status ${u.active ? 'is-active' : ''}`}>{u.active ? 'Ativo' : 'Desativado'}</span>
      </button>)}{users.length === 0 && <div className="profiles-empty"><p>Nenhum usuário encontrado para “{search}”.</p></div>}</div>
    </section>
    <section className="panel profiles-editor" ref={editor}>
      <div className="profiles-editor-head"><span className={`profiles-mode ${editing ? 'is-editing' : ''}`}>{editing ? <Pencil size={14}/> : <Plus size={14}/>}</span><div><h2>{editing ? 'Editar usuário' : 'Novo usuário'}</h2><p>{editing ? `${editing.name} · alterado por ${editing.updatedBy}` : 'Quem entra no sistema e o que pode fazer.'}</p></div>{editing && <button type="button" className="icon-button" aria-label="Fechar edição e voltar para novo usuário" title="Fechar edição" onClick={() => open(blankUser())}><X size={18}/></button>}</div>
      <form className="module-form profiles-form" onSubmit={submit}>
        {message && <p className="module-success" role="status">{message}</p>}
        {error && <p className="module-error" role="alert">{error}</p>}
        <label>Nome <span className="required-mark" aria-hidden="true">*</span><input name="name" required maxLength={160} autoComplete="off" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
        <label>Login <span className="required-mark" aria-hidden="true">*</span><input required maxLength={120} autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder="E-mail ou nome simples" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })}/></label>
        <fieldset className="auth-roles" disabled={self}><legend>Perfil de acesso</legend>{roles.map(r => <label key={r} className={form.role === r ? 'is-checked' : ''}><input type="radio" name="role" value={r} checked={form.role === r} onChange={() => setForm({ ...form, role: r })}/><span><strong>{roleLabel[r]}</strong><small>{roleHelp[r]}</small></span></label>)}</fieldset>
        <label>{editing ? <>Nova senha <span className="field-optional">(deixe vazio para manter)</span></> : <>Senha inicial <span className="required-mark" aria-hidden="true">*</span></>}<input type="password" required={!editing} maxLength={128} autoComplete="new-password" value={form.password ?? ''} onChange={e => setForm({ ...form, password: e.target.value })}/></label>
        <small className="auth-hint">Pelo menos {MIN_PASSWORD_LENGTH} caracteres, com letras e números.</small>
        <label className="hospital-check"><input type="checkbox" checked={form.active} disabled={self} onChange={e => setForm({ ...form, active: e.target.checked })}/> Pode entrar no sistema</label>
        {self && <p className="module-note">Este é o seu usuário: perfil e situação não podem ser alterados por você mesmo.</p>}
        <div className="module-actions profiles-actions"><button className="button primary" disabled={busy}>{editing ? <><KeyRound size={16}/> Salvar alterações</> : <><UserPlus size={16}/> Criar usuário</>}</button>{editing && <button type="button" className="button secondary" onClick={() => open(blankUser())}>Cancelar</button>}</div>
        <p className="module-note">{localNote}</p>
      </form>
    </section>
  </div>;
}