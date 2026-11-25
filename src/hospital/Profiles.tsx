import { useRef, useState } from 'react';
import { Info, Lock, Pencil, Plus, Search, ShieldCheck, Stethoscope, UserRound, X } from 'lucide-react';
import { localNow, savePatient, saveProfessional, weekdays, type HospitalData, type Patient, type ProfessionalInput } from './domain';
import { type HospitalStore } from './useHospital';
import { age, DaysPicker, fold, formatPhone, ProfileAvatar, ProfilePhotoField } from './profileParts';
import { assertCan, can, roleLabel } from '../auth/domain';
import { UsersAdmin } from '../auth/AuthScreens';
import { type AuthSession, type PublicUser } from '../auth/useAuth';
import './profiles.css';

type Section = 'patients' | 'professionals' | 'users';
type Props = { data: HospitalData; store: HospitalStore; user: PublicUser | null };
const blankPatient = (): Patient => ({ id: crypto.randomUUID(), name: '', phone: '', birthDate: '', occupation: '', photoUrl: '' });
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'pt-BR');
/** Em telas estreitas o formulário fica abaixo da lista: leva a pessoa até ele. */
function reveal(el: HTMLElement | null) {
  if (!el) return;
  if (window.matchMedia('(max-width: 1099px)').matches) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => el.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true }), 50);
}

export default function Profiles({ store, auth }: { store: HospitalStore; auth?: AuthSession }) {
  const data = store.data!;
  const user = auth?.user ?? null;
  const [section, setSection] = useState<Section>('patients');
  const admin = can(user, 'usuarios.gerenciar') && !!auth;
  const cards: { id: Section; label: string; count: number; hint: string; icon: typeof UserRound; locked?: boolean }[] = [
    { id: 'patients', label: 'Pacientes', count: data.patients.length, hint: 'Qualquer usuário cadastra', icon: UserRound },
    { id: 'professionals', label: 'Médicos e profissionais', count: data.professionals.length, hint: can(user, 'profissionais.editar') ? 'Você pode criar e alterar' : 'Somente consulta', icon: Stethoscope, locked: !can(user, 'profissionais.editar') },
    ...(admin ? [{ id: 'users' as const, label: 'Usuários e acesso', count: auth!.users.length, hint: 'Quem entra e o que pode fazer', icon: ShieldCheck }] : []),
  ];
  return <div className="profiles">
    <div className="profiles-switcher" role="group" aria-label="Tipo de perfil">
      {cards.map(({ id, label, count, hint, icon: Icon, locked }) => <button key={id} type="button" aria-pressed={section === id} onClick={() => { setSection(id); store.clearError(); }}>
        <span className="profiles-switcher-icon"><Icon size={20}/></span>
        <span className="profiles-switcher-copy"><strong>{label}</strong><small>{locked && <Lock size={11}/>}{hint}</small></span>
        <span className="profiles-count">{count}</span>
      </button>)}
    </div>
    <p className="profiles-note"><Info size={14}/> Ambiente de demonstração: use dados fictícios. Os cadastros ficam só neste navegador.</p>
    {section === 'patients' && <Patients data={data} store={store} user={user}/>}
    {section === 'professionals' && <Professionals data={data} store={store} user={user}/>}
    {section === 'users' && admin && <UsersAdmin auth={auth!}/>}
  </div>;
}

function DirectoryHead({ title, total, shown, search, onSearch, placeholder, action }: { title: string; total: number; shown: number; search: string; onSearch: (v: string) => void; placeholder: string; action?: React.ReactNode }) {
  return <>
    <div className="profiles-directory-head"><div><h2>{title}</h2><p>{search ? `${shown} de ${total} encontrados` : `${total} cadastrados`}</p></div>{action}</div>
    <div className="profiles-toolbar"><label className="profiles-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Buscar</span><input value={search} onChange={e => onSearch(e.target.value)} placeholder={placeholder}/>{search && <button type="button" className="icon-button" aria-label="Limpar busca" onClick={() => onSearch('')}><X size={15}/></button>}</label></div>
  </>;
}

function FormError({ store }: { store: HospitalStore }) {
  return store.error ? <div className="module-error" role="alert">{store.error}<button type="button" className="message-close" aria-label="Fechar aviso" onClick={store.clearError}><X size={16}/></button></div> : null;
}

function EditorHead({ editing, kind, name, onClose }: { editing: boolean; kind: string; name: string; onClose?: () => void }) {
  return <div className="profiles-editor-head">
    <span className={`profiles-mode ${editing ? 'is-editing' : ''}`}>{editing ? <Pencil size={14}/> : <Plus size={14}/>}</span>
    <div><h2>{editing ? `Editar ${kind}` : `Novo ${kind}`}</h2><p>{editing ? name || 'Sem nome' : 'Preencha os dados e salve.'}</p></div>
    {editing && onClose && <button type="button" className="icon-button" aria-label="Fechar edição e voltar para novo cadastro" title="Fechar edição" onClick={onClose}><X size={18}/></button>}
  </div>;
}

function Patients({ data, store, user }: Props) {
  const [patient, setPatient] = useState(blankPatient), [search, setSearch] = useState('');
  const [message, setMessage] = useState(''), [highlight, setHighlight] = useState('');
  const editor = useRef<HTMLElement>(null);
  const editing = data.patients.some(p => p.id === patient.id);
  const term = fold(search.trim());
  const patients = data.patients.filter(p => fold(`${p.name} ${p.occupation} ${p.phone}`).includes(term) || (term && p.phone.replace(/\D/g, '').includes(term.replace(/\D/g, '') || '-'))).sort(byName);
  function open(p: Patient) { setPatient(p); setMessage(''); store.clearError(); reveal(editor.current); }
  function startNew(name = '') { setPatient({ ...blankPatient(), name }); setMessage(''); store.clearError(); reveal(editor.current); }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const wasEditing = editing, saved = patient;
    if (store.update(d => { assertCan(user, 'pacientes.editar'); return savePatient(d, saved); })) {
      setMessage(wasEditing ? `Alterações de ${saved.name.trim()} salvas.` : `Cadastro de ${saved.name.trim()} criado. Já aparece na agenda para marcar consulta.`);
      setHighlight(saved.id); setPatient(blankPatient());
    }
  }
  const field = <K extends keyof Patient>(key: K, value: Patient[K]) => setPatient(current => ({ ...current, [key]: value }));
  return <div className="profiles-layout">
    <section className="panel profiles-directory">
      <DirectoryHead title="Pacientes" total={data.patients.length} shown={patients.length} search={search} onSearch={setSearch} placeholder="Buscar por nome, ocupação ou telefone" action={<button type="button" className="button primary" onClick={() => startNew()}><Plus size={16}/> Novo paciente</button>}/>
      <div className="profile-list">
        {patients.map(p => { const years = age(p.birthDate); return <button key={p.id} type="button" className={`profile-card ${p.id === patient.id ? 'is-selected' : ''} ${p.id === highlight ? 'is-saved' : ''}`} aria-current={p.id === patient.id ? 'true' : undefined} onClick={() => open(p)}>
          <ProfileAvatar name={p.name} photoUrl={p.photoUrl}/>
          <span className="profile-card-copy"><strong>{p.name}</strong><small className="profile-role">{p.occupation || 'Ocupação não informada'}</small><small>{[p.phone || 'Sem telefone', years !== null && `${years} anos`].filter(Boolean).join(' · ')}</small></span>
          <span className="profile-edit-icon" aria-hidden="true"><Pencil size={16}/></span>
        </button>; })}
        {patients.length === 0 && <div className="profiles-empty">{search ? <><p>Nenhum paciente encontrado para “{search}”.</p><button type="button" className="button secondary" onClick={() => startNew(/\d/.test(search) ? '' : search.trim())}><Plus size={16}/> Cadastrar novo paciente</button></> : <><p>Nenhum paciente cadastrado ainda.</p><button type="button" className="button secondary" onClick={() => startNew()}><Plus size={16}/> Cadastrar o primeiro</button></>}</div>}
      </div>
    </section>
    <section className="panel profiles-editor" ref={editor}>
      <EditorHead editing={editing} kind="paciente" name={patient.name} onClose={() => startNew()}/>
      <form className="module-form profiles-form" onSubmit={submit}>
        {message && <p role="status" className="module-success">{message}</p>}<FormError store={store}/>
        <ProfilePhotoField name={patient.name} value={patient.photoUrl} onChange={v => field('photoUrl', v)}/>
        <label>Nome completo <span className="required-mark" aria-hidden="true">*</span><input name="name" required maxLength={160} autoComplete="off" placeholder="Como consta no documento" value={patient.name} onChange={e => field('name', e.target.value)}/></label>
        <div className="hospital-form-grid">
          <label>Telefone <span className="field-optional">(opcional)</span><input type="tel" inputMode="tel" maxLength={25} placeholder="(44) 99999-9999" value={patient.phone} onChange={e => field('phone', formatPhone(e.target.value))}/></label>
          <label>Nascimento <span className="field-optional">(opcional)</span><input type="date" max={localNow(data.config.timezone).date} value={patient.birthDate} onChange={e => field('birthDate', e.target.value)}/></label>
        </div>
        <label>Ocupação <span className="field-optional">(opcional)</span><input maxLength={120} placeholder="Ex.: Analista administrativo" value={patient.occupation} onChange={e => field('occupation', e.target.value)}/></label>
        <p className="module-note">Só dados administrativos. Informações clínicas ficam fora deste cadastro.</p>
        <div className="module-actions profiles-actions"><button className="button primary">{editing ? 'Salvar alterações' : 'Cadastrar paciente'}</button>{editing ? <button type="button" className="button secondary" onClick={() => startNew()}>Cancelar</button> : (patient.name || patient.phone || patient.occupation || patient.birthDate || patient.photoUrl) && <button type="button" className="button secondary" onClick={() => startNew()}>Limpar</button>}</div>
      </form>
    </section>
  </div>;
}

function Professionals({ data, store, user }: Props) {
  const blank = (): ProfessionalInput => ({ id: crypto.randomUUID(), name: '', occupation: '', photoUrl: '', unitId: data.units[0]?.id ?? '', specialtyId: data.specialties[0]?.id ?? '', days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00', duration: 30, active: true });
  const [pro, setPro] = useState(blank), [search, setSearch] = useState('');
  const [message, setMessage] = useState(''), [highlight, setHighlight] = useState('');
  const editor = useRef<HTMLElement>(null);
  const allowed = can(user, 'profissionais.editar');
  const editing = data.professionals.some(p => p.id === pro.id);
  const specialty = (id: string) => data.specialties.find(s => s.id === id)?.name ?? '';
  const term = fold(search.trim());
  const list = data.professionals.filter(p => fold(`${p.name} ${p.occupation} ${specialty(p.specialtyId)}`).includes(term)).sort(byName);
  function open(p: ProfessionalInput) { setPro(p); setMessage(''); store.clearError(); reveal(editor.current); }
  function startNew(name = '') { setPro({ ...blank(), name }); setMessage(''); store.clearError(); reveal(editor.current); }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const wasEditing = editing, saved = pro;
    if (store.update(d => { assertCan(user, 'profissionais.editar'); return saveProfessional(d, saved); })) {
      setMessage(wasEditing ? `Alterações de ${saved.name.trim()} salvas.` : `Cadastro de ${saved.name.trim()} criado na equipe.`);
      setHighlight(saved.id); setPro(blank());
    }
  }
  const set = (patch: Partial<ProfessionalInput>) => setPro(current => ({ ...current, ...patch }));
  return <div className="profiles-layout">
    <section className="panel profiles-directory">
      <DirectoryHead title="Médicos e profissionais" total={data.professionals.length} shown={list.length} search={search} onSearch={setSearch} placeholder="Buscar por nome, função ou especialidade" action={allowed ? <button type="button" className="button primary" onClick={() => startNew()}><Plus size={16}/> Novo profissional</button> : undefined}/>
      <div className="profile-list">
        {list.map(p => { const body = <><ProfileAvatar name={p.name} photoUrl={p.photoUrl}/><span className="profile-card-copy"><strong>{p.name}</strong><small className="profile-role">{p.occupation || specialty(p.specialtyId)}</small><small>{specialty(p.specialtyId)} · {data.units.find(u => u.id === p.unitId)?.name}</small><small>{p.days.map(d => weekdays[d]).join(', ')} · {p.start}–{p.end}</small></span><span className={`profile-status ${p.active ? 'is-active' : ''}`}>{p.active ? 'Ativo' : 'Inativo'}</span></>;
          return allowed ? <button key={p.id} type="button" className={`profile-card ${p.id === pro.id ? 'is-selected' : ''} ${p.id === highlight ? 'is-saved' : ''}`} aria-current={p.id === pro.id ? 'true' : undefined} onClick={() => open(p)}>{body}</button> : <div key={p.id} className="profile-card is-readonly">{body}</div>; })}
        {list.length === 0 && <div className="profiles-empty"><p>{search ? `Nenhum profissional encontrado para “${search}”.` : 'Nenhum profissional cadastrado.'}</p>{allowed && <button type="button" className="button secondary" onClick={() => startNew(search.trim())}><Plus size={16}/> Cadastrar profissional</button>}</div>}
      </div>
    </section>
    {allowed ? <section className="panel profiles-editor" ref={editor}>
      <EditorHead editing={editing} kind="profissional" name={pro.name} onClose={() => startNew()}/>
      <form className="module-form profiles-form" onSubmit={submit}>
        {message && <p role="status" className="module-success">{message}</p>}<FormError store={store}/>
        <div className="profiles-section"><h3>Identificação</h3>
          <ProfilePhotoField name={pro.name} value={pro.photoUrl ?? ''} onChange={photoUrl => set({ photoUrl })}/>
          <label>Nome do profissional <span className="required-mark" aria-hidden="true">*</span><input name="name" required maxLength={160} autoComplete="off" placeholder="Ex.: Dra. Ana Souza" value={pro.name} onChange={e => set({ name: e.target.value })}/></label>
          <label>Função <span className="field-optional">(opcional)</span><input maxLength={120} placeholder="Ex.: Médica responsável" value={pro.occupation ?? ''} onChange={e => set({ occupation: e.target.value })}/></label>
        </div>
        <div className="profiles-section"><h3>Onde atende</h3>
          <div className="hospital-form-grid"><label>Unidade<select value={pro.unitId} onChange={e => set({ unitId: e.target.value })}>{data.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>Especialidade<select value={pro.specialtyId} onChange={e => set({ specialtyId: e.target.value })}>{data.specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
        </div>
        <div className="profiles-section"><h3>Agenda</h3>
          <DaysPicker legend="Dias de atendimento" value={pro.days} onChange={days => set({ days })}/>
          <div className="hospital-form-grid profiles-grid-3"><label>Início<input type="time" required value={pro.start} onChange={e => set({ start: e.target.value })}/></label><label>Fim<input type="time" required value={pro.end} onChange={e => set({ end: e.target.value })}/></label><label>Consulta (min)<input type="number" min={10} max={180} required value={pro.duration} onChange={e => set({ duration: Number(e.target.value) })}/></label></div>
          <label className="hospital-check"><input type="checkbox" checked={pro.active} onChange={e => set({ active: e.target.checked })}/> Ativo: aparece na agenda para marcar consultas</label>
        </div>
        <div className="module-actions profiles-actions"><button className="button primary">{editing ? 'Salvar alterações' : 'Cadastrar profissional'}</button>{editing && <button type="button" className="button secondary" onClick={() => startNew()}>Cancelar</button>}</div>
      </form>
    </section> : <section className="panel profiles-editor profiles-locked">
      <span className="profiles-locked-icon"><Lock size={22}/></span>
      <h2>Cadastro restrito a administradores</h2>
      <p>Somente administradores criam ou alteram perfis de médicos e profissionais, a grade e os dias de atendimento.</p>
      <p className="module-note">Você entrou como {user ? `${user.name} (${roleLabel[user.role]})` : 'visitante'}. Pacientes você pode cadastrar normalmente. Para incluir ou corrigir um profissional, fale com um administrador.</p>
    </section>}
  </div>;
}
