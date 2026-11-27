# Backend no Supabase

O sistema ainda roda só no navegador. Este documento descreve a base no servidor que já está pronta e testada, e o que falta para ativá-la.

## O que está pronto

### Banco

A migração fica em `supabase/migrations/20261126120000_hemodinamica_backend.sql`.

| Tabela | Conteúdo |
|---|---|
| `profiles` | Usuário do Supabase Auth com nome, perfil (`admin`, `medico`, `equipe`) e se está ativo |
| `hemo_patients` | Um paciente por linha (documento JSON) |
| `hemo_cases` | Um procedimento por linha (documento JSON), com etapa e paciente em colunas próprias para filtro |
| `hemo_reference` | Cadastros: salas, médicos, tipos, sobreaviso, bloqueios de sala e tabela de valores |
| `audit_log` | Histórico |

Os documentos JSON seguem o mesmo esquema do navegador (`src/hemo/domain.ts`). Os dados atuais passam para o servidor sem conversão.

**Acesso (RLS):**

- **Anônimo:** não lê nada.
- **Usuário desativado:** não lê nem grava.
- **Usuário ativo:** lê e grava casos, pacientes e cadastros.
- **Exclusão:** ninguém apaga caso, paciente ou cadastro. Cancelar é mudar a etapa.
- **Tabela de valores:** só administradores gravam, a mesma regra de `valores.editar` em `src/auth/domain.ts`.

**Concorrência:** cada gravação manda a revisão que leu mais 1. Se outra pessoa gravou antes, o banco recusa com "Os dados foram alterados por outra pessoa".

### Auditoria que não se apaga

- **Só inclusão:** `audit_log` só aceita INSERT. UPDATE, DELETE e TRUNCATE são recusados por gatilho, inclusive para o superusuário e o `service_role`.
- **Gravação automática:** gravar caso, paciente ou cadastro gera uma linha no histórico pelo próprio banco, sem depender do app. Exemplo: "etapa Preparo → Sala · revisão 1".
- **Autor e horário:** quem carimba é o banco (`auth.uid()` e o nome do perfil). O app não consegue se passar por outra pessoa.
- **Cadeia de hash:** cada linha guarda o hash SHA-256 da anterior.
  - `select * from audit_verify()` aponta qualquer linha alterada por fora, por exemplo por alguém que desligou o gatilho com acesso total.
  - Resultado vazio significa que o histórico está íntegro.

### App

`src/hemo/remote.ts` faz a ponte com o banco:

- converte a base do navegador em linhas e de volta;
- descobre o que mudou e envia só isso, com a revisão de cada linha;
- envia o histórico do app;
- carrega tudo do servidor;
- avisa os conflitos com uma mensagem clara.

### Testes

- **`tests/backend.test.mjs`:** roda a migração num Postgres 18 real (PGlite), com `auth.uid()` e os papéis `anon` e `authenticated` simulados como no Supabase. Confere as regras acima, inclusive a detecção de adulteração.
- **`tests/remote.test.mjs`:** confere a ponte do app.

## O que falta para ativar

1. **Projeto Supabase.** Criar ou escolher um projeto e aplicar a migração com `supabase db push`, ou pelo painel.
2. **Login pelo Supabase Auth.** A tela de acesso troca as contas locais por login no Supabase. Cada usuário ganha uma linha em `profiles`, e o primeiro administrador é criado pelo painel.
3. **Variáveis em `.env.local`:**
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

   A chave publicável pode ir para o navegador. Quem decide o acesso é a RLS. Nunca use a `service_role` no app.
4. **Gravação no servidor.** `useHemo` passa a chamar `pushChanges` depois de cada gravação e `loadRemote` ao abrir. Na primeira vez, oferece enviar a base deste navegador.
5. **Dados reais.** Antes de cadastrar pacientes de verdade, é preciso:
   - o acordo de tratamento de dados (LGPD);
   - definir a região do projeto e a política de backup;
   - revisar quem recebe o perfil de administrador.
