-- Hemodinâmica no Supabase: dados no servidor, acesso por perfil e histórico que não se apaga.
--
-- Modelo: cada procedimento é um documento (jsonb) validado no app pelo mesmo esquema do navegador
-- (src/hemo/domain.ts). Colunas soltas (etapa, paciente, revisão) servem a filtros e à concorrência.
-- Pacientes ficam numa tabela própria. Cadastros (salas, médicos, tipos, escala, bloqueios e a tabela
-- de valores) ficam em hemo_reference, uma linha por chave.
--
-- Auditoria: audit_log só aceita INSERT. UPDATE, DELETE e TRUNCATE são recusados por gatilho,
-- inclusive para o service_role. Cada linha guarda o hash da anterior (cadeia SHA-256), então
-- qualquer alteração feita por fora do banco (ex.: restauração manual) fica detectável com
-- public.audit_verify(). Gravações nos casos geram auditoria no próprio banco, sem depender do app.

-- ---------- Perfis de acesso ----------
create type public.app_role as enum ('admin', 'medico', 'equipe');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  name text not null check (length(trim(name)) >= 2),
  role public.app_role not null default 'equipe',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Perfil do usuário logado, só se estiver ativo. security definer: lê profiles sem esbarrar na RLS.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create function public.current_app_name() returns text
language sql stable security definer set search_path = public as $$
  select name from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin');
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

-- ---------- Dados da hemodinâmica ----------
create table public.hemo_patients (
  id text primary key,
  data jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.hemo_cases (
  id text primary key,
  patient_id text not null references public.hemo_patients (id),
  stage text not null,
  data jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index hemo_cases_stage_idx on public.hemo_cases (stage);
create index hemo_cases_patient_idx on public.hemo_cases (patient_id);

create table public.hemo_reference (
  key text primary key check (key in ('rooms', 'doctors', 'types', 'onCall', 'roomBlocks', 'values')),
  data jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- Concorrência otimista: quem grava manda a revisão que leu + 1. Se outra pessoa gravou antes, recusa.
create function public.bump_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Os dados foram alterados por outra pessoa. Recarregue e tente de novo.' using errcode = '40001';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger hemo_patients_revision before update on public.hemo_patients for each row execute function public.bump_revision();
create trigger hemo_cases_revision before update on public.hemo_cases for each row execute function public.bump_revision();
create trigger hemo_reference_revision before update on public.hemo_reference for each row execute function public.bump_revision();

-- ---------- Auditoria só de inclusão, com cadeia de hash ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  actor_name text not null default '',
  entity text not null,
  entity_id text not null default '',
  action text not null,
  detail text not null default '',
  client_at timestamptz,
  -- Posição na cadeia, numerada dentro da trava (o id pode sair fora de ordem com gravações simultâneas).
  seq bigint not null default 0,
  prev_hash text not null default '',
  hash text not null default ''
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- Conteúdo que entra no hash. Horário em UTC com formato fixo, para não depender do fuso da sessão.
create function public.audit_digest(prev text, seq bigint, at timestamptz, actor uuid, entity text, entity_id text, action text, detail text) returns text
language sql stable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws('|', prev, seq::text, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(actor::text, ''), entity, entity_id, action, detail), 'UTF8')), 'hex')
$$;

-- Antes de inserir: carimba quem e quando (o app não escolhe o autor) e encadeia o hash.
create function public.audit_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare last record;
begin
  perform pg_advisory_xact_lock(hashtext('public.audit_log'));
  new.at := now();
  new.actor := auth.uid();
  new.actor_name := coalesce(public.current_app_name(), nullif(new.actor_name, ''), '');
  select a.seq, a.hash into last from public.audit_log a order by a.seq desc limit 1;
  new.seq := coalesce(last.seq, 0) + 1;
  new.prev_hash := coalesce(last.hash, '');
  new.hash := public.audit_digest(new.prev_hash, new.seq, new.at, new.actor, new.entity, new.entity_id, new.action, new.detail);
  return new;
end $$;
create unique index audit_log_seq_idx on public.audit_log (seq);
create trigger audit_log_chain before insert on public.audit_log for each row execute function public.audit_chain();

create function public.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'O histórico de auditoria não pode ser alterado nem apagado.' using errcode = '42501';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log for each row execute function public.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function public.audit_immutable();

-- Confere a cadeia inteira; devolve as linhas em que o hash não bate (vazio = íntegro).
create function public.audit_verify() returns table (id bigint, problem text)
language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := ''; expected_seq bigint := 1;
begin
  for r in select * from public.audit_log a order by a.seq loop
    if r.seq <> expected_seq then id := r.id; problem := format('falta a posição %s da cadeia', expected_seq); return next;
    elsif r.prev_hash <> prev then id := r.id; problem := 'elo anterior não confere'; return next;
    elsif r.hash <> public.audit_digest(prev, r.seq, r.at, r.actor, r.entity, r.entity_id, r.action, r.detail) then id := r.id; problem := 'conteúdo alterado'; return next;
    end if;
    prev := r.hash;
    expected_seq := r.seq + 1;
  end loop;
end $$;

-- Gravação em caso, paciente ou cadastro gera auditoria no banco, sem depender do app.
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur jsonb := to_jsonb(new); prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
begin
  -- Lê pelos campos do JSON: as três tabelas não têm as mesmas colunas (id/key, stage).
  insert into public.audit_log (entity, entity_id, action, detail)
  values (
    tg_table_name,
    coalesce(cur->>'id', cur->>'key', ''),
    lower(tg_op),
    case
      when cur ? 'stage' and prev is not null and prev->>'stage' is distinct from cur->>'stage' then format('etapa %s → %s · revisão %s', prev->>'stage', cur->>'stage', cur->>'revision')
      when cur ? 'stage' then format('etapa %s · revisão %s', cur->>'stage', cur->>'revision')
      else format('revisão %s', cur->>'revision')
    end
  );
  return new;
end $$;
create trigger hemo_cases_audit after insert or update on public.hemo_cases for each row execute function public.audit_row_change();
create trigger hemo_patients_audit after insert or update on public.hemo_patients for each row execute function public.audit_row_change();
create trigger hemo_reference_audit after insert or update on public.hemo_reference for each row execute function public.audit_row_change();

-- ---------- Acesso (RLS) ----------
-- Qualquer usuário ativo lê e grava casos e pacientes (como no app). Ninguém apaga: cancelar é mudar a etapa.
-- A tabela de valores só é alterada por administradores (mesma regra de src/auth/domain.ts).
alter table public.hemo_patients enable row level security;
alter table public.hemo_cases enable row level security;
alter table public.hemo_reference enable row level security;
alter table public.audit_log enable row level security;

create policy patients_read on public.hemo_patients for select to authenticated using (public.current_app_role() is not null);
create policy patients_insert on public.hemo_patients for insert to authenticated with check (public.current_app_role() is not null);
create policy patients_update on public.hemo_patients for update to authenticated using (public.current_app_role() is not null) with check (public.current_app_role() is not null);

create policy cases_read on public.hemo_cases for select to authenticated using (public.current_app_role() is not null);
create policy cases_insert on public.hemo_cases for insert to authenticated with check (public.current_app_role() is not null);
create policy cases_update on public.hemo_cases for update to authenticated using (public.current_app_role() is not null) with check (public.current_app_role() is not null);

create policy reference_read on public.hemo_reference for select to authenticated using (public.current_app_role() is not null);
create policy reference_insert on public.hemo_reference for insert to authenticated
  with check (public.current_app_role() is not null and (key <> 'values' or public.current_app_role() = 'admin'));
create policy reference_update on public.hemo_reference for update to authenticated
  using (public.current_app_role() is not null and (key <> 'values' or public.current_app_role() = 'admin'))
  with check (public.current_app_role() is not null and (key <> 'values' or public.current_app_role() = 'admin'));

create policy audit_read on public.audit_log for select to authenticated using (public.current_app_role() is not null);
create policy audit_insert on public.audit_log for insert to authenticated with check (public.current_app_role() is not null);

-- Privilégios explícitos: anônimo não acessa nada; autenticado não apaga nada.
revoke all on public.profiles, public.hemo_patients, public.hemo_cases, public.hemo_reference, public.audit_log from anon;
revoke delete, truncate on public.hemo_patients, public.hemo_cases, public.hemo_reference, public.audit_log from authenticated;
revoke update on public.audit_log from authenticated;
grant select, insert, update on public.hemo_patients, public.hemo_cases, public.hemo_reference to authenticated;
grant select, insert on public.audit_log to authenticated;
grant select, insert, update on public.profiles to authenticated;
revoke execute on function public.audit_verify() from public, anon;
grant execute on function public.audit_verify() to authenticated;
