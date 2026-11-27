# Acesso e permissões

O sistema só abre depois do login. O código fica em `src/auth/`.

## Primeiro acesso

Se não há nenhum usuário neste navegador, a primeira tela pede para criar o **administrador**: nome, login e senha. O sistema não tem senha padrão.

## Perfis de acesso

| Ação | Administrador | Médico | Equipe de atendimento |
|---|:-:|:-:|:-:|
| Usar o sistema (agenda, hemodinâmica, estoque) | ✓ | ✓ | ✓ |
| Cadastrar e alterar **pacientes** (Perfis → Pacientes) | ✓ | ✓ | ✓ |
| Criar e alterar **perfis de médicos e profissionais** (Perfis → Profissionais) | ✓ | — | — |
| Criar usuários, definir perfil, redefinir senha, desativar (Perfis → Usuários e acesso) | ✓ | — | — |
| Alterar a **tabela de custos e valores** (Hemodinâmica → Ocupação e custos) | ✓ | — | — |
| Ver a **qualidade por hemodinamicista** (Hemodinâmica → Indicadores) | ✓ | — | — |

- Sem permissão, a aba Profissionais mostra a equipe só para consulta e explica que o cadastro é restrito.
- A permissão é conferida também na hora de gravar, não só escondendo o botão.
- As regras ficam em `permissions` (`src/auth/domain.ts`). Para mudar quem pode o quê, basta alterar a lista.

## Regras

- **Senha:** pelo menos 8 caracteres, com letras e números. É guardada como hash PBKDF2-SHA256 com sal, nunca em texto.
- **Login:** pode ser um e-mail (`nome@empresa.com.br`) ou um nome simples (`admin`). Não diferencia maiúsculas de minúsculas e não pode repetir. Login ou senha errados recebem a mesma mensagem.
- **Desativação:** um usuário desativado não entra e perde a sessão aberta.
- **Administradores:** o administrador não pode desativar a si mesmo nem tirar o próprio acesso de administrador, e sempre existe pelo menos um administrador ativo.
- **Esqueceu a senha:** um administrador define uma nova em Usuários e acesso.
- **Sessão:** termina ao clicar em sair (ícone ao lado do nome, no topo), ao fechar o navegador ou depois de 12 horas.

## Limites desta versão

Contas e sessão ficam **só neste navegador** (`jusimed-acesso-v1` no armazenamento local, sessão no armazenamento da aba).

- Quem tem acesso ao computador pode alterar o armazenamento pelo navegador. A proteção serve para demonstrar as regras, não para guardar dados reais.
- Cada navegador tem os próprios usuários; eles não são compartilhados entre computadores.
- Não há limite de tentativas de senha nem recuperação por e-mail.

## Autoria

Cada ação gravada leva o nome de quem está logado:

- **Histórico da hemodinâmica:** cada entrada da ficha do procedimento.
- **Histórico da agenda:** o registro interno de alterações.
- **Movimentações do Estoque:** coluna "Responsável".

Registros feitos antes do login continuam sem autor. Como as contas são locais, a autoria também vale só para demonstração.

Na versão com servidor, o login passa para o backend (Supabase Auth), e as mesmas regras viram políticas de acesso no banco. Assim o servidor recusa a gravação de quem não tem permissão. O mesmo login autoriza o copilot e registra a autoria nos históricos.
