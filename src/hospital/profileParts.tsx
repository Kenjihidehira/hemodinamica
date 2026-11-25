import { useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { weekdays } from './domain';

export const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR') || '—';
export const age = (birthDate: string) => birthDate ? Math.max(0, Math.floor((Date.now() - new Date(`${birthDate}T12:00:00`).getTime()) / 31_557_600_000)) : null;
/** Busca sem diferenciar acentos nem maiúsculas. */
export const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
/** Máscara de telefone brasileiro: (44) 99999-9999. Números internacionais (com +) ficam como digitados. */
export function formatPhone(value: string) {
  if (value.trim().startsWith('+')) return value;
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function ProfileAvatar({ name, photoUrl, large = false }: { name: string; photoUrl: string; large?: boolean }) {
  return <span className={`profile-avatar ${large ? 'is-large' : ''}`}>{photoUrl ? <img src={photoUrl} alt={`Foto de ${name || 'perfil'}`}/> : <span aria-label={`Sem foto. Iniciais ${initials(name)}`}>{initials(name)}</span>}</span>;
}

export function ProfilePhotoField({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  const [error, setError] = useState('');
  function readPhoto(file?: File) {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Selecione um arquivo de imagem.'); return; }
    if (file.size > 700_000) { setError('A imagem deve ter no máximo 700 KB nesta demonstração local.'); return; }
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setError('Não foi possível ler a imagem.');
    reader.readAsDataURL(file);
  }
  return <div className="profiles-photo">
    <label className="profiles-photo-avatar" title={value ? 'Trocar foto' : 'Adicionar foto'}>
      <ProfileAvatar name={name} photoUrl={value} large/>
      <span className="profiles-photo-badge" aria-hidden="true"><Camera size={14}/></span>
      <input type="file" accept="image/*" aria-label={value ? 'Trocar foto' : 'Adicionar foto'} onChange={e => { readPhoto(e.target.files?.[0]); e.target.value = ''; }}/>
    </label>
    <div className="profiles-photo-copy">
      <strong>Foto <span className="field-optional">(opcional)</span></strong>
      <small>Clique na imagem para {value ? 'trocar' : 'adicionar'}. JPG, PNG ou WebP até 700 KB.</small>
      {value && <button type="button" className="text-link profiles-photo-remove" onClick={() => onChange('')}><Trash2 size={13}/> Remover foto</button>}
      {error && <p className="profile-photo-error" role="alert">{error}</p>}
    </div>
  </div>;
}

export function DaysPicker({ value, onChange, legend = 'Dias de funcionamento' }: { value: number[]; onChange: (days: number[]) => void; legend?: string }) {
  return <fieldset className="days-picker"><legend>{legend}</legend>{weekdays.map((day, i) => <label key={day}><input type="checkbox" checked={value.includes(i)} onChange={e => onChange(e.target.checked ? [...value, i].sort() : value.filter(d => d !== i))}/>{day}</label>)}</fieldset>;
}
