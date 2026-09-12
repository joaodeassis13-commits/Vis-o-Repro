-- =====================================================================
-- VArepro — schema inicial para Supabase (Postgres)
-- Espelha as coleções em memória de visaorepro.jsx. Ponto de partida:
-- ajuste tipos/constraints conforme o app evoluir.
--
-- As tabelas estão em ORDEM DE DEPENDÊNCIA (cada uma só referencia
-- tabelas já criadas antes dela) — rode o arquivo inteiro de uma vez,
-- de cima para baixo, no SQL Editor do Supabase. É seguro rodar de novo
-- a qualquer momento (todo comando aqui é "se já existir, não recriar" —
-- exceto os "drop function"/"drop policy" pontuais, que servem só para
-- trocar o tipo de parâmetro ou a regra de uma função/política já
-- existente, sem apagar dado nenhum).

-- ---------- fazenda (raiz de tudo — nenhuma outra tabela depende dela vir depois) ----------
-- id text: mesmo id gerado no cliente (uid()), igual às demais tabelas — não é
-- um uuid de verdade, por isso não usar "uuid" nem gen_random_uuid() aqui.
create table if not exists fazendas (
  id text primary key,
  nome text not null,
  municipio text,
  area_total text,
  proprietario text,
  responsavel text,
  telefone text,
  licenciada boolean not null default true,
  criado_em timestamptz not null default now()
);

-- "create table if not exists" não adiciona coluna nova a uma tabela já existente — garante
-- que "licenciada" exista mesmo em bancos antigos, sem apagar fazenda nenhuma.
alter table fazendas add column if not exists licenciada boolean not null default true;

-- ---------- usuários (perfil + fazendas autorizadas) ----------
-- id = mesmo id do Supabase Auth (auth.users) — esse SIM é um uuid de verdade,
-- gerado pelo próprio Supabase, diferente de fazendas/retiros/safras acima.
-- criado_por: quem cadastrou este usuário — garante que o Administrador que
-- criou a conta sempre a enxergue, mesmo antes de autorizá-la a uma fazenda.
create table if not exists usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  login text unique not null,
  email text,
  perfil text not null check (perfil in ('Suporte Adm', 'Administrador', 'Supervisor', 'Inseminador')),
  criado_por uuid references usuarios (id),
  criado_em timestamptz not null default now()
);

-- Suporte Adm: perfil novo (acima de Administrador), exclusivo para cadastrar fazendas, safras,
-- usuários administrador e importar histórico de qualquer fazenda do sistema — ver
-- eh_suporte_adm() e as políticas que a usam, mais abaixo. Sem isto, um banco já existente
-- rejeitaria esse perfil (o "create table if not exists" acima não altera tabela já criada).
alter table usuarios drop constraint if exists usuarios_perfil_check;
alter table usuarios add constraint usuarios_perfil_check check (perfil in ('Suporte Adm', 'Administrador', 'Supervisor', 'Inseminador'));

-- "create table if not exists" não adiciona colunas a uma tabela que já
-- existia de uma rodada anterior do schema — estes comandos garantem que as
-- colunas mais novas (email, criado_por) existam mesmo em bancos antigos,
-- sem precisar apagar a tabela e recriar.
alter table usuarios add column if not exists email text;
alter table usuarios add column if not exists criado_por uuid references usuarios (id);

create table if not exists usuario_fazendas (
  usuario_id uuid references usuarios (id) on delete cascade,
  fazenda_id text references fazendas (id) on delete cascade,
  primary key (usuario_id, fazenda_id)
);

-- ---------- retiro / safra (dependem só de fazenda) ----------
create table if not exists retiros (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);

create table if not exists safras (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  nome text not null,  -- formato "2025/2026"
  lancamentos_desabilitados boolean not null default false,  -- Administrador pode travar lançamentos (agendamentos, manejos, estoque) numa safra, pra evitar lançar na safra errada
  criado_em timestamptz not null default now()
);

alter table safras add column if not exists lancamentos_desabilitados boolean not null default false;

-- garante a coluna mesmo em bancos criados antes dela existir nessas duas tabelas
-- (todas as outras tabelas do sistema já tinham "criado_em" desde o início; essas duas
-- ficaram de fora por um descuido, só corrigido agora).
alter table retiros add column if not exists criado_em timestamptz not null default now();
alter table safras add column if not exists criado_em timestamptz not null default now();

-- ---------- lote (depende de fazenda, safra, retiro) ----------
create table if not exists lotes (
  id text primary key,  -- mantém o id gerado no cliente (uid()) para sync sem conflito
  fazenda_id text not null references fazendas (id) on delete cascade,
  safra_id text references safras (id),
  retiro_id text references retiros (id),
  nome text not null,
  categoria text,
  ordem text,  -- '1º IATF' | '2º IATF' | '3º IATF'
  numero_animais integer,
  raca text,
  mes_paricao text,
  animais text[] not null default '{}',  -- brincos oficialmente atribuídos ao lote
  criado_em timestamptz not null default now()
);

-- renomeia a categoria "Novilha" para "Nulípara" em lotes já sincronizados antes dessa mudança
update lotes set categoria = 'Nulípara' where categoria = 'Novilha';

-- ---------- insumo (hormônio / sêmen / medicamento / utensílio) ----------
create table if not exists insumos (
  id text primary key,
  fazenda_id text references fazendas (id) on delete cascade,
  usuario_id uuid references usuarios (id),  -- não nulo quando local = 'externo'
  local text not null check (local in ('fazenda', 'externo')),
  categoria text not null check (categoria in ('Hormônio', 'Sêmen', 'Medicamento', 'Utensílio')),
  estoque numeric not null default 0,
  quantidade numeric,      -- quantidade da última entrada registrada (histórico/exibição)
  valor_unitario numeric,
  produto_comercial text,
  hormonio text,          -- quando categoria = 'Hormônio'
  tamanho_embalagem numeric,
  unidade_embalagem text,
  touro text,             -- quando categoria = 'Sêmen'
  raca text,
  partida date,
  motilidade_inicial numeric check (motilidade_inicial is null or (motilidade_inicial >= 0 and motilidade_inicial <= 100)),
  vigor_inicial smallint check (vigor_inicial is null or (vigor_inicial >= 1 and vigor_inicial <= 5)),
  motilidade_final numeric check (motilidade_final is null or (motilidade_final >= 0 and motilidade_final <= 100)),
  vigor_final smallint check (vigor_final is null or (vigor_final >= 1 and vigor_final <= 5)),
  tipo_medicamento text,  -- quando categoria = 'Medicamento'
  unidade text,           -- quando categoria = 'Utensílio'
  dose_media numeric,     -- Hormônio/Medicamento: quanto (em mL/unidade) é gasto por animal em cada aplicação
  criado_em timestamptz not null default now()
);

-- garante as colunas de qualidade do sêmen mesmo em bancos criados antes
-- delas existirem (create table if not exists não adiciona colunas novas)
alter table insumos add column if not exists motilidade_inicial numeric;
alter table insumos add column if not exists vigor_inicial smallint;
alter table insumos add column if not exists motilidade_final numeric;
alter table insumos add column if not exists vigor_final smallint;
alter table insumos add column if not exists quantidade numeric;
alter table insumos add column if not exists dose_media numeric;

-- ---------- manejo (indução, D0, ressinc, retirada, inseminação, diagnóstico) ----------
-- precisa vir ANTES de "movimentos", que referencia manejo_id
create table if not exists manejos (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  safra_id text references safras (id),
  lote_id text references lotes (id),
  lote_nome text,
  retiro_id text references retiros (id),
  tipo text not null check (tipo in ('novos_animais', 'inducao', 'implantacao', 'ressinc', 'retirada', 'inseminacao', 'diagnostico', 'repasse', 'diagnostico_repasse')),
  categoria text,
  ordem text,
  numero_animais integer,
  mes_paricao text,
  tipo_manejo text,   -- '3 manejos' | '4 manejos' (D0/Ressinc)
  protocolo text,
  protocolo_padrao text,  -- nome do protocolo padrão salvo (D0/Retirada, opcional)
  local_estoque text check (local_estoque in ('fazenda', 'externo')),
  operador text,
  inseminador text,  -- quem fisicamente aplicou a inseminação (pode ser diferente de quem registrou); inseminação
  data date not null,
  animais_lidos text[] not null default '{}',
  detalhes jsonb not null default '[]',      -- leitura individual por animal (ECC, peso, resultado, ...)
  medicamentos jsonb not null default '[]',  -- [{ medicamentoId, dose }]
  -- campos específicos por tipo de manejo (produto + dose), todos opcionais:
  produto_id text, quantidade numeric, unidade text,               -- indução
  implante_id text, benzoato_id text, dose_benzoato numeric,
  prostaglandina_id text, dose_prostaglandina numeric,              -- D0 / ressinc
  cipionato_id text, dose_cipionato numeric,
  ecg_hcg_id text, dose_ecg_hcg numeric,                            -- retirada
  gnrh_id text, dose_gnrh numeric,                                  -- D0 / inseminação
  perdas_implante numeric,                                          -- retirada (opcional)
  horario_inicial text, horario_final text,                         -- retirada (formato HH:MM, opcional)
  data_inicio date, data_fim date,                                  -- repasse (período em que os animais ficam em repasse)
  destino_vazias text check (destino_vazias is null or destino_vazias in ('Ressinc', 'Repasse', 'Descarte')), -- diagnóstico
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()  -- muda a cada edição — usado pra decidir quem "ganha" quando dois aparelhos editam o MESMO manejo offline, sem depender de quem sincroniza primeiro
);

alter table manejos add column if not exists atualizado_em timestamptz not null default now();

-- garante as colunas mais novas mesmo em bancos criados antes delas existirem
alter table manejos add column if not exists inseminador text;
alter table manejos add column if not exists protocolo_padrao text;
alter table manejos add column if not exists perdas_implante numeric;
alter table manejos add column if not exists horario_inicial text;
alter table manejos add column if not exists horario_final text;
alter table manejos add column if not exists data_inicio date;
alter table manejos add column if not exists data_fim date;
alter table manejos add column if not exists destino_vazias text;
alter table manejos add column if not exists raca_touro text;  -- Repasse: raça do(s) touro(s) usado(s), texto livre com memória (sugestões vêm do próprio histórico, sem cadastro à parte)

-- garante que a restrição de "tipo" já aceite os manejos mais novos mesmo em
-- bancos criados antes deles existirem (o nome da constraint é o padrão gerado pelo Postgres).
alter table manejos drop constraint if exists manejos_tipo_check;
alter table manejos add constraint manejos_tipo_check
  check (tipo in ('novos_animais', 'inducao', 'implantacao', 'ressinc', 'retirada', 'inseminacao', 'diagnostico', 'repasse', 'diagnostico_repasse'));

-- ---------- movimento de estoque (entrada / saída) — depende de manejos ----------
create table if not exists movimentos (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  insumo_id text not null references insumos (id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  quantidade numeric not null,
  valor_unitario numeric,
  local text not null check (local in ('fazenda', 'externo')),
  manejo_id text references manejos (id) on delete cascade,
  tipo_manejo text,  -- rótulo do manejo de origem, quando tipo = 'saida'
  data date not null,
  obs text,
  criado_em timestamptz not null default now()
);

-- garante o "on delete cascade" mesmo em bancos onde a tabela já existia sem ele — sem isso,
-- apagar um manejo que tinha desconto de estoque (movimentos tipo "saida") ficava bloqueado
-- pela chave estrangeira, e a exclusão do manejo falhava sempre (violava
-- "movimentos_manejo_id_fkey"), mesmo o app já tendo limpado esse movimento localmente.
alter table movimentos drop constraint if exists movimentos_manejo_id_fkey;
alter table movimentos add constraint movimentos_manejo_id_fkey foreign key (manejo_id) references manejos (id) on delete cascade;

-- ---------- sugestões de ressinc (fila de confirmação em D0 > Ressinc) ----------
create table if not exists sugestoes_ressinc (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  safra_id text references safras (id),
  lote_id text not null references lotes (id) on delete cascade,
  brincos text[] not null,
  origem_manejo_id text references manejos (id) on delete set null,
  status text not null check (status in ('pendente', 'confirmada', 'descartada')),
  data date not null,
  criado_em timestamptz not null default now()
);

-- ---------- sugestões de Repasse (nascem do Diagnóstico, "Destino para vazias" = Repasse) ----------
create table if not exists sugestoes_repasse (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  safra_id text references safras (id),
  lote_id text not null references lotes (id) on delete cascade,
  brincos text[] not null,
  origem_manejo_id text references manejos (id) on delete set null,
  status text not null check (status in ('pendente', 'confirmada', 'descartada')),
  data date not null,
  criado_em timestamptz not null default now()
);

-- garante o "on delete set null" mesmo em bancos onde essas tabelas já existiam sem ele —
-- pelo mesmo motivo do "movimentos" acima: sem isso, apagar um manejo de Inseminação ou
-- Diagnóstico que já tivesse gerado uma sugestão de Ressinc/Repasse ficava bloqueado pela
-- chave estrangeira. Aqui usa "set null" (não "cascade"): a sugestão continua existindo,
-- só perde a referência de qual manejo a originou.
alter table sugestoes_ressinc drop constraint if exists sugestoes_ressinc_origem_manejo_id_fkey;
alter table sugestoes_ressinc add constraint sugestoes_ressinc_origem_manejo_id_fkey foreign key (origem_manejo_id) references manejos (id) on delete set null;
alter table sugestoes_repasse drop constraint if exists sugestoes_repasse_origem_manejo_id_fkey;
alter table sugestoes_repasse add constraint sugestoes_repasse_origem_manejo_id_fkey foreign key (origem_manejo_id) references manejos (id) on delete set null;

-- ---------- protocolos padrão ("modelos" de D0/Retirada) ----------
-- Na primeira vez que um nome novo de protocolo padrão é usado num D0/Retirada,
-- o app cria uma linha aqui com os hormônios/doses daquele registro. Nas
-- próximas vezes, selecionar o mesmo nome preenche tudo de novo — os campos
-- guardados variam conforme "manejo" ('d0' ou 'retirada').
create table if not exists protocolos_padrao (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  manejo text not null check (manejo in ('d0', 'retirada')),
  nome text not null,
  -- campos usados quando manejo = 'd0':
  tipo_manejo text,           -- '3 manejos' | '4 manejos'
  protocolo text,             -- duração do protocolo ('7 dias', '8 dias', '9 dias')
  implante_id text,
  benzoato_id text, dose_benzoato numeric,
  gnrh_id text, dose_gnrh numeric,
  -- campos usados quando manejo = 'retirada' (prostaglandina é compartilhada com D0):
  cipionato_id text, dose_cipionato numeric,
  ecg_hcg_id text, dose_ecg_hcg numeric,
  -- comum aos dois:
  prostaglandina_id text, dose_prostaglandina numeric,
  criado_em timestamptz not null default now()
);

-- ---------- lápides (registro de exclusões) ----------
-- Resolve um problema real de sincronizar vários aparelhos offline: sem isso, se o
-- computador apaga um registro e sincroniza, mas o celular ainda tem esse mesmo registro
-- guardado localmente (por ainda não ter sincronizado desde a exclusão), o celular acaba
-- reenviando esse registro de volta pro servidor na sincronização dele — "ressuscitando"
-- algo que já tinha sido apagado. Toda exclusão passa a deixar uma "lápide" aqui (o id
-- original do registro apagado + de qual tabela), e cada aparelho consulta essa lista antes
-- de enviar ou mesclar dados, pra nunca reenviar nem readicionar algo já apagado em outro lugar.
create table if not exists exclusoes (
  id text primary key,  -- o mesmo id que o registro apagado tinha na tabela de origem
  tabela text not null,
  apagado_em timestamptz not null default now()
);

alter table exclusoes enable row level security;
drop policy if exists "exclusoes: leitura e escrita para autenticados" on exclusoes;
create policy "exclusoes: leitura e escrita para autenticados" on exclusoes
  for all using (auth.uid() is not null);

-- ---------- agenda ----------
create table if not exists agendamentos (
  id text primary key,
  fazenda_id text not null references fazendas (id) on delete cascade,
  retiro_id text references retiros (id),
  lote_nome text,
  ordem text,
  categoria text,
  numero_animais integer,
  tipo text not null,  -- 'Indução' | 'D0' | 'Retirada' | 'PGF 5' | 'Inseminação' | 'Diagnóstico' | 'Outro'
  tipo_manejo text,
  protocolo text,
  data date not null,
  titulo text,
  origem text not null check (origem in ('manual', 'automatico')),
  origem_agendamento_id text references agendamentos (id),  -- referência à própria tabela: ok, ela já existe neste ponto
  status text not null check (status in ('pendente', 'confirmado', 'descartado')),
  ordem_exibicao integer,  -- ordem manual dentro do mesmo dia (arrastar/mover pra cima ou pra baixo, na Agenda)
  criado_em timestamptz not null default now()
);

-- garante as colunas mesmo em bancos criados antes delas existirem
alter table agendamentos add column if not exists numero_animais integer;
alter table agendamentos add column if not exists ordem_exibicao integer;
alter table agendamentos add column if not exists categoria text;
alter table agendamentos add column if not exists sugestoes_descartadas text[];  -- tipos de sugestão automática que o usuário já apagou a partir deste agendamento (evita recriar sozinho ao editar/confirmar)

-- garante "criado_em" em TODAS as tabelas que precisam dele, mesmo nas que foram criadas
-- há mais tempo (antes dessa coluna existir na definição de "create table" acima) — "create
-- table if not exists" nunca adiciona coluna nova a uma tabela que já existe, só "alter table"
-- faz isso. Sem isso, a sincronização trava com "Could not find the criado_em column" em
-- qualquer uma dessas tabelas que tenha sido criada antes dessa coluna existir.
alter table fazendas add column if not exists criado_em timestamptz not null default now();
alter table usuarios add column if not exists criado_em timestamptz not null default now();
alter table retiros add column if not exists criado_em timestamptz not null default now();
alter table safras add column if not exists criado_em timestamptz not null default now();
alter table lotes add column if not exists criado_em timestamptz not null default now();
alter table insumos add column if not exists criado_em timestamptz not null default now();
alter table manejos add column if not exists criado_em timestamptz not null default now();
alter table movimentos add column if not exists criado_em timestamptz not null default now();
alter table sugestoes_ressinc add column if not exists criado_em timestamptz not null default now();
alter table sugestoes_repasse add column if not exists criado_em timestamptz not null default now();
alter table protocolos_padrao add column if not exists criado_em timestamptz not null default now();
alter table agendamentos add column if not exists criado_em timestamptz not null default now();

-- =====================================================================
-- RLS (row-level security) — cada usuário só vê as fazendas autorizadas
-- =====================================================================

alter table fazendas enable row level security;
alter table retiros enable row level security;
alter table safras enable row level security;
alter table lotes enable row level security;
alter table insumos enable row level security;
alter table manejos enable row level security;
alter table movimentos enable row level security;
alter table sugestoes_ressinc enable row level security;
alter table sugestoes_repasse enable row level security;
alter table protocolos_padrao enable row level security;
alter table agendamentos enable row level security;
alter table usuarios enable row level security;
alter table usuario_fazendas enable row level security;

-- "security definer" é essencial aqui: esta função lê a própria tabela
-- "usuarios" (que também tem RLS habilitado) para decidir permissões de
-- TODAS as outras tabelas — sem "security definer" isso vira uma referência
-- circular (RLS de "usuarios" bloqueando a própria checagem de RLS).
-- Cada usuário (INCLUSIVE Administrador) só acessa as fazendas do seu próprio
-- grupo, atribuídas em usuario_fazendas — um Administrador não vê as fazendas
-- de outro Administrador a menos que também esteja atribuído a elas.
-- "drop function" é necessário aqui porque o parâmetro mudou de tipo (uuid → text,
-- corrigindo o mesmo erro de id de fazenda) — "create or replace" não troca o
-- tipo de parâmetro de uma função já existente, só recriar do zero resolve.
drop function if exists fazenda_autorizada(uuid);
create or replace function fazenda_autorizada(fid text)
returns boolean as $$
  select exists (
    select 1 from usuario_fazendas uf
    where uf.usuario_id = auth.uid() and uf.fazenda_id = fid
  );
$$ language sql stable security definer set search_path = public;

-- ainda é útil para decidir QUEM PODE gerenciar usuários/criar fazendas novas
-- (uma ação de sistema, não ligada a uma fazenda específica ainda)
create or replace function eh_administrador()
returns boolean as $$
  select exists (select 1 from usuarios u where u.id = auth.uid() and u.perfil = 'Administrador');
$$ language sql stable security definer set search_path = public;

-- Suporte Adm: acima de Administrador — só ele pode criar fazendas, safras/retiros e
-- usuários Administrador, e importar histórico em QUALQUER fazenda do sistema (não só
-- as do próprio grupo). Ver políticas de fazendas/safras/retiros/lotes/manejos/usuarios abaixo.
create or replace function eh_suporte_adm()
returns boolean as $$
  select exists (select 1 from usuarios u where u.id = auth.uid() and u.perfil = 'Suporte Adm');
$$ language sql stable security definer set search_path = public;

-- fazenda "Não licenciada" (marcada pelo Suporte Adm): os dados continuam no banco e
-- permanecem 100% legíveis (relatórios/exportações), só ficam bloqueados os LANÇAMENTOS novos
-- (manejo, movimentação de estoque, agenda) — ver as políticas de escrita mais abaixo, que
-- combinam fazenda_autorizada(fazenda_id) com esta função só pra INSERT/UPDATE/DELETE, nunca
-- pra SELECT.
create or replace function fazenda_licenciada(fid text)
returns boolean as $$
  select coalesce((select f.licenciada from fazendas f where f.id = fid), true);
$$ language sql stable security definer set search_path = public;

-- (Revertido) Suporte Adm NÃO deve ficar vinculado em usuario_fazendas a todas as fazendas —
-- isso contornaria sem querer as restrições de estoque (insumos/movimentos) e agenda
-- (agendamentos), que dependem só de fazenda_autorizada() sem checar o perfil, e o Suporte
-- Adm não deve ter acesso a essas três coisas em NENHUMA fazenda. O acesso dele a fazendas/
-- retiros/safras/lotes/manejos já é garantido diretamente pela função eh_suporte_adm() nas
-- políticas abaixo, sem precisar de vínculo nenhum em usuario_fazendas.
drop trigger if exists trg_vincular_suporte_adm_a_fazenda_nova on fazendas;
drop trigger if exists trg_vincular_novo_suporte_adm_a_todas_fazendas on usuarios;
drop function if exists vincular_suporte_adm_a_fazenda_nova();
drop function if exists vincular_novo_suporte_adm_a_todas_fazendas();

-- limpeza: remove os vínculos que essas triggers (de uma versão anterior deste script) já
-- tinham criado — sem isso, o Suporte Adm continuaria com acesso de "membro" a estoque/agenda
-- de fazendas que não deveria, via fazenda_autorizada() puro.
delete from usuario_fazendas uf
using usuarios u
where uf.usuario_id = u.id and u.perfil = 'Suporte Adm';

-- true se auth.uid() e "outro_usuario_id" compartilham ao menos uma fazenda —
-- usado para um Administrador só enxergar, como usuário, quem está no mesmo
-- grupo de fazendas que ele (não vê outros Administradores de grupos diferentes).
create or replace function mesmo_grupo_de_fazendas(outro_usuario_id uuid)
returns boolean as $$
  select exists (
    select 1 from usuario_fazendas uf1
    join usuario_fazendas uf2 on uf1.fazenda_id = uf2.fazenda_id
    where uf1.usuario_id = auth.uid() and uf2.usuario_id = outro_usuario_id
  );
$$ language sql stable security definer set search_path = public;

-- fazendas: ver/editar/apagar só as do próprio grupo; CRIAR uma fazenda nova é
-- permitido a qualquer Administrador (a fazenda ainda não tem ninguém em
-- usuario_fazendas nesse momento) — o app já atribui automaticamente quem
-- criou a fazenda ao grupo dela logo em seguida (ver addFazenda em App.jsx).
drop policy if exists "fazendas: leitura/edicao/exclusao do proprio grupo" on fazendas;
create policy "fazendas: leitura/edicao/exclusao do proprio grupo" on fazendas
  for select using (
    fazenda_autorizada(id)
    -- Suporte Adm enxerga TODAS as fazendas do sistema (precisa pra cadastrar safra/importar
    -- histórico em qualquer uma delas, não só nas do próprio grupo).
    or eh_suporte_adm()
    -- sem isso, "INSERT ... ON CONFLICT DO UPDATE" (usado pela sincronização) não consegue
    -- nem verificar se existe conflito numa fazenda órfã (sem ninguém autorizado ainda) —
    -- o Postgres exige visibilidade (política de SELECT) da linha pra avaliar o ON CONFLICT,
    -- mesmo quando não existe conflito de verdade. Só vale pra fazenda SEM dono nenhum ainda;
    -- uma fazenda que já pertence a outro grupo continua invisível pra este Administrador.
    or (eh_administrador() and not exists (select 1 from usuario_fazendas uf where uf.fazenda_id = fazendas.id))
  );
drop policy if exists "fazendas: atualizacao do proprio grupo" on fazendas;
create policy "fazendas: atualizacao do proprio grupo" on fazendas
  for update using (
    fazenda_autorizada(id)
    -- Suporte Adm pode atualizar qualquer fazenda (ex.: dados cadastrais, mesmo fora do
    -- próprio grupo) — cobre também o "upsert" (INSERT ... ON CONFLICT DO UPDATE) da
    -- sincronização pra fazendas recém-criadas por ele.
    or eh_suporte_adm()
  );
drop policy if exists "fazendas: exclusao do proprio grupo" on fazendas;
create policy "fazendas: exclusao do proprio grupo" on fazendas
  for delete using (fazenda_autorizada(id));
drop policy if exists "fazendas: administrador pode criar" on fazendas;
create policy "fazendas: administrador pode criar" on fazendas
  for insert with check (
    -- só o Suporte Adm cria fazenda nova de verdade — Administrador não cadastra mais fazenda.
    eh_suporte_adm()
    -- sem isso, qualquer usuário autorizado (ex.: Inseminador, ou o próprio Administrador
    -- ressincronizando uma fazenda já existente sem mudar nada) cairia nesse "upsert" (ON
    -- CONFLICT DO UPDATE) e falharia — o Postgres exige que a política de INSERT também
    -- passe nesse tipo de comando, mesmo quando o resultado final é só uma atualização de
    -- uma linha que já existe e já é autorizada pra essa pessoa.
    or fazenda_autorizada(id)
  );

drop policy if exists "retiros: acesso autorizado" on retiros;
create policy "retiros: acesso autorizado" on retiros
  for all using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());

drop policy if exists "safras: acesso autorizado" on safras;
create policy "safras: acesso autorizado" on safras
  for all using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());

-- A partir daqui, lotes/insumos/manejos/movimentos/agendamentos separam LEITURA (sempre
-- liberada pra quem é autorizado na fazenda — histórico nunca some, mesmo "Não licenciada",
-- pra Relatórios/Exportações continuarem funcionando) de ESCRITA (exige também
-- fazenda_licenciada(), ou seja, só lança dado novo numa fazenda "Licenciada").
-- Suporte Adm só tem bypass (eh_suporte_adm()) em LOTES e MANEJOS — o que ele precisa pra
-- importar histórico de qualquer fazenda e pra montar os números do Painel de clientes. Ele
-- NÃO tem acesso a insumos/movimentos (estoque) nem a agendamentos (agenda) de fazenda
-- nenhuma além da própria — essas telas nem existem pra esse perfil no app.

drop policy if exists "lotes: acesso autorizado" on lotes;
drop policy if exists "lotes: leitura" on lotes;
create policy "lotes: leitura" on lotes
  for select using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());
drop policy if exists "lotes: insercao" on lotes;
create policy "lotes: insercao" on lotes
  for insert with check (
    (fazenda_autorizada(fazenda_id) and fazenda_licenciada(fazenda_id))
    or eh_suporte_adm()
    -- permite reenviar (upsert) um lote que JÁ EXISTE e já é autorizado, mesmo com a fazenda
    -- "Não licenciada" — a sincronização sempre reenvia a coleção inteira via "INSERT ... ON
    -- CONFLICT DO UPDATE", e o Postgres exige que a política de INSERT passe mesmo quando o
    -- resultado é só uma atualização de uma linha que já existia sem mudar nada.
    or (fazenda_autorizada(fazenda_id) and exists (select 1 from lotes t2 where t2.id = lotes.id))
  );
drop policy if exists "lotes: atualizacao" on lotes;
create policy "lotes: atualizacao" on lotes
  for update using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());
drop policy if exists "lotes: exclusao" on lotes;
create policy "lotes: exclusao" on lotes
  for delete using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());

drop policy if exists "insumos: acesso autorizado" on insumos;
drop policy if exists "insumos: leitura" on insumos;
create policy "insumos: leitura" on insumos
  for select using (fazenda_id is null or fazenda_autorizada(fazenda_id));
drop policy if exists "insumos: insercao" on insumos;
create policy "insumos: insercao" on insumos
  for insert with check (
    fazenda_id is null
    or (fazenda_autorizada(fazenda_id) and fazenda_licenciada(fazenda_id))
    or (fazenda_autorizada(fazenda_id) and exists (select 1 from insumos t2 where t2.id = insumos.id))
  );
drop policy if exists "insumos: atualizacao" on insumos;
create policy "insumos: atualizacao" on insumos
  for update using (fazenda_id is null or fazenda_autorizada(fazenda_id));
drop policy if exists "insumos: exclusao" on insumos;
create policy "insumos: exclusao" on insumos
  for delete using (fazenda_id is null or fazenda_autorizada(fazenda_id));

drop policy if exists "manejos: acesso autorizado" on manejos;
drop policy if exists "manejos: leitura" on manejos;
create policy "manejos: leitura" on manejos
  for select using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());
drop policy if exists "manejos: insercao" on manejos;
create policy "manejos: insercao" on manejos
  for insert with check (
    (fazenda_autorizada(fazenda_id) and fazenda_licenciada(fazenda_id))
    or eh_suporte_adm()
    or (fazenda_autorizada(fazenda_id) and exists (select 1 from manejos t2 where t2.id = manejos.id))
  );
drop policy if exists "manejos: atualizacao" on manejos;
create policy "manejos: atualizacao" on manejos
  for update using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());
drop policy if exists "manejos: exclusao" on manejos;
create policy "manejos: exclusao" on manejos
  for delete using (fazenda_autorizada(fazenda_id) or eh_suporte_adm());

drop policy if exists "movimentos: acesso autorizado" on movimentos;
drop policy if exists "movimentos: leitura" on movimentos;
create policy "movimentos: leitura" on movimentos
  for select using (fazenda_autorizada(fazenda_id));
drop policy if exists "movimentos: insercao" on movimentos;
create policy "movimentos: insercao" on movimentos
  for insert with check (
    (fazenda_autorizada(fazenda_id) and fazenda_licenciada(fazenda_id))
    or (fazenda_autorizada(fazenda_id) and exists (select 1 from movimentos t2 where t2.id = movimentos.id))
  );
drop policy if exists "movimentos: atualizacao" on movimentos;
create policy "movimentos: atualizacao" on movimentos
  for update using (fazenda_autorizada(fazenda_id));
drop policy if exists "movimentos: exclusao" on movimentos;
create policy "movimentos: exclusao" on movimentos
  for delete using (fazenda_autorizada(fazenda_id));

drop policy if exists "sugestoes_ressinc: acesso autorizado" on sugestoes_ressinc;
create policy "sugestoes_ressinc: acesso autorizado" on sugestoes_ressinc
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "sugestoes_repasse: acesso autorizado" on sugestoes_repasse;
create policy "sugestoes_repasse: acesso autorizado" on sugestoes_repasse
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "protocolos_padrao: acesso autorizado" on protocolos_padrao;
create policy "protocolos_padrao: acesso autorizado" on protocolos_padrao
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "agendamentos: acesso autorizado" on agendamentos;
drop policy if exists "agendamentos: leitura" on agendamentos;
create policy "agendamentos: leitura" on agendamentos
  for select using (fazenda_autorizada(fazenda_id));
drop policy if exists "agendamentos: insercao" on agendamentos;
create policy "agendamentos: insercao" on agendamentos
  for insert with check (
    (fazenda_autorizada(fazenda_id) and fazenda_licenciada(fazenda_id))
    or (fazenda_autorizada(fazenda_id) and exists (select 1 from agendamentos t2 where t2.id = agendamentos.id))
  );
drop policy if exists "agendamentos: atualizacao" on agendamentos;
create policy "agendamentos: atualizacao" on agendamentos
  for update using (fazenda_autorizada(fazenda_id));
drop policy if exists "agendamentos: exclusao" on agendamentos;
create policy "agendamentos: exclusao" on agendamentos
  for delete using (fazenda_autorizada(fazenda_id));

-- usuarios: cada um vê a si mesmo; um Administrador só vê OUTROS usuários se
-- (a) foi ele quem cadastrou aquela pessoa, ou (b) compartilha alguma fazenda
-- com ela — assim, dois Administradores de grupos diferentes não se enxergam
-- um ao outro nem enxergam os times um do outro.
-- O "insert" também libera id = auth.uid() para o próprio cadastro logo após
-- o signUp (antes de existir qualquer linha em "usuarios" que prove que
-- quem está inserindo é Administrador).
drop policy if exists "usuarios: leitura" on usuarios;
create policy "usuarios: leitura" on usuarios
  for select using (
    id = auth.uid()
    or criado_por = auth.uid()
    or eh_suporte_adm()
    or (eh_administrador() and mesmo_grupo_de_fazendas(id))
  );

-- Administrador só pode cadastrar Supervisor/Inseminador (cadastro de Administrador é
-- exclusivo do Suporte Adm) — reforça no banco a mesma regra já aplicada na tela.
drop policy if exists "usuarios: insercao" on usuarios;
create policy "usuarios: insercao" on usuarios
  for insert with check (
    id = auth.uid()
    or eh_suporte_adm()
    or (eh_administrador() and perfil in ('Supervisor', 'Inseminador'))
  );

drop policy if exists "usuarios: atualizacao" on usuarios;
create policy "usuarios: atualizacao" on usuarios
  for update using (
    id = auth.uid()
    or criado_por = auth.uid()
    or eh_suporte_adm()
    or (eh_administrador() and mesmo_grupo_de_fazendas(id))
  );

-- faltava por completo: sem uma política de exclusão, apagar um usuário (removerUsuario em
-- App.jsx) sempre falhava por RLS — a exclusão local sozinha nunca bastava, o usuário
-- continuava existindo no Supabase e voltava na sincronização seguinte.
drop policy if exists "usuarios: exclusao" on usuarios;
create policy "usuarios: exclusao" on usuarios
  for delete using (
    criado_por = auth.uid()
    or eh_suporte_adm()
    or (eh_administrador() and mesmo_grupo_de_fazendas(id))
  );

-- um Administrador só pode conceder/revogar acesso a uma fazenda que ELE
-- MESMO já tem no seu grupo (fazenda_autorizada) — isso também resolve o
-- "primeiro vínculo" de um usuário recém-criado, que ainda não compartilha
-- nenhuma fazenda com ninguém.
drop policy if exists "usuario_fazendas: acesso" on usuario_fazendas;
create policy "usuario_fazendas: acesso" on usuario_fazendas
  for all using (
    usuario_id = auth.uid()
    or eh_suporte_adm()
    or (eh_administrador() and fazenda_autorizada(fazenda_id))
  );

-- =====================================================================
-- BENCHMARKING — comparação anônima e agregada entre fazendas
-- =====================================================================
-- Estas funções rodam com "security definer" (ignoram a RLS por fazenda) só
-- para poderem enxergar dados de todas as fazendas do sistema — mas cada uma
-- devolve APENAS números agregados finais (médias em %), nunca uma linha de
-- dado bruto, nem o nome/id da fazenda de origem. Nenhum dado de uma fazenda
-- fica exposto a outra: só a estatística.
--
-- Metodologia: primeiro calcula a taxa de prenhez de CADA fazenda
-- individualmente (prenhas / avaliadas daquela fazenda). Só depois tira a
-- média ENTRE essas taxas já prontas — ex.: (42% + 35% + 54%) / 3 — nunca
-- soma os animais de todas as fazendas juntos numa conta só. Isso evita que
-- uma fazenda muito grande (com muito mais leituras) "pese" mais que as
-- outras na média.
--
-- Cada função devolve: média geral, média das 25% melhores fazendas, média
-- das 25% piores fazendas, e quantas fazendas entraram na conta. O tamanho
-- desse "top/bottom 25%" é sempre arredondado (nunca fração de fazenda) —
-- ex.: de 9 fazendas, 25% = 2,25 → arredonda para 2 fazendas nas piores e 2
-- nas melhores. Usa a mesma regra de arredondamento do lado do app (JS
-- Math.round / "arredonda para o inteiro mais próximo, 0,5 para cima").

-- taxa de prenhez comparando TODAS as fazendas do sistema (todos os grupos).
-- p_safra_nome: quando informado, considera só diagnósticos de manejos cuja
-- safra tenha esse NOME (ex.: "2024/2025") — o nome é o que permite comparar
-- "a mesma safra" entre fazendas diferentes, já que o id de safra é local a
-- cada fazenda. Null (padrão) = sem filtro de safra, todo o histórico.
-- "drop function" primeiro porque mudar a lista de parâmetros de uma função já
-- existente cria uma sobrecarga nova em vez de substituir — só apagar e
-- recriar do zero evita duas versões ambíguas da mesma função.
drop function if exists benchmarking_taxa_prenhez_sistema();
create or replace function benchmarking_taxa_prenhez_sistema(p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico'
      and (
        p_safra_nome is null
        or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome)
      )
    group by m.fazenda_id
    having count(*) > 0
  ),
  tamanho as (
    select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda
  ),
  ranqueadas as (
    select
      taxa,
      row_number() over (order by taxa asc)  as posicao_da_pior,
      row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_taxa_prenhez_sistema(text) to authenticated;

-- taxa de prenhez comparando só as fazendas do PRÓPRIO grupo de quem chamou
-- (auth.uid()) — usada quando o filtro "Meu Grupo" está selecionado no app.
-- Mesmo filtro opcional de safra (por nome) do que a função acima.
drop function if exists benchmarking_taxa_prenhez_grupo();
create or replace function benchmarking_taxa_prenhez_grupo(p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico'
      and exists (
        select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = m.fazenda_id
      )
      and (
        p_safra_nome is null
        or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome)
      )
    group by m.fazenda_id
    having count(*) > 0
  ),
  tamanho as (
    select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda
  ),
  ranqueadas as (
    select
      taxa,
      row_number() over (order by taxa asc)  as posicao_da_pior,
      row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_taxa_prenhez_grupo(text) to authenticated;

-- taxa de FERTILIDADE (Prenhas / total de animais nos lotes, diferente da taxa de prenhez/concepção
-- acima, que só considera quem já tem Diagnóstico) — mesma estrutura das duas funções anteriores,
-- uma pro sistema todo, outra só pro grupo de quem chamou.
drop function if exists benchmarking_taxa_fertilidade_sistema();
create or replace function benchmarking_taxa_fertilidade_sistema(p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with prenhas_por_fazenda as (
    select m.fazenda_id, count(*) filter (where d ->> 'resultado' = 'Prenha') as prenhas
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico'
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
  ),
  animais_por_fazenda as (
    select l.fazenda_id, sum(coalesce(array_length(l.animais, 1), 0)) as total_animais
    from lotes l
    where l.nome <> 'Desconhecidos'
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = l.safra_id and sf.nome = p_safra_nome))
    group by l.fazenda_id
  ),
  por_fazenda as (
    select a.fazenda_id, round(100.0 * coalesce(p.prenhas, 0) / a.total_animais, 1) as taxa
    from animais_por_fazenda a
    left join prenhas_por_fazenda p on p.fazenda_id = a.fazenda_id
    where a.total_animais > 0
  ),
  tamanho as (
    select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda
  ),
  ranqueadas as (
    select
      taxa,
      row_number() over (order by taxa asc)  as posicao_da_pior,
      row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_taxa_fertilidade_sistema(text) to authenticated;

drop function if exists benchmarking_taxa_fertilidade_grupo();
create or replace function benchmarking_taxa_fertilidade_grupo(p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with prenhas_por_fazenda as (
    select m.fazenda_id, count(*) filter (where d ->> 'resultado' = 'Prenha') as prenhas
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico'
      and exists (select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = m.fazenda_id)
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
  ),
  animais_por_fazenda as (
    select l.fazenda_id, sum(coalesce(array_length(l.animais, 1), 0)) as total_animais
    from lotes l
    where l.nome <> 'Desconhecidos'
      and exists (select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = l.fazenda_id)
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = l.safra_id and sf.nome = p_safra_nome))
    group by l.fazenda_id
  ),
  por_fazenda as (
    select a.fazenda_id, round(100.0 * coalesce(p.prenhas, 0) / a.total_animais, 1) as taxa
    from animais_por_fazenda a
    left join prenhas_por_fazenda p on p.fazenda_id = a.fazenda_id
    where a.total_animais > 0
  ),
  tamanho as (
    select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda
  ),
  ranqueadas as (
    select
      taxa,
      row_number() over (order by taxa asc)  as posicao_da_pior,
      row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_taxa_fertilidade_grupo(text) to authenticated;

-- ---------- concepção POR ORDEM (1º/2º/3º IATF ou "Repasse") ----------
-- mesma metodologia (média das médias) das funções acima, mas filtrando por uma ordem específica.
-- "Repasse" olha os manejos tipo 'diagnostico_repasse'; as demais olham 'diagnostico' com aquela ordem.
drop function if exists benchmarking_concepcao_por_ordem_sistema(text);
create or replace function benchmarking_concepcao_por_ordem_sistema(p_ordem text, p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where (
        (p_ordem = 'Repasse' and m.tipo = 'diagnostico_repasse')
        or (p_ordem <> 'Repasse' and m.tipo = 'diagnostico' and m.ordem = p_ordem)
      )
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
    having count(*) > 0
  ),
  tamanho as ( select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda ),
  ranqueadas as (
    select taxa, row_number() over (order by taxa asc) as posicao_da_pior, row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_concepcao_por_ordem_sistema(text, text) to authenticated;

drop function if exists benchmarking_concepcao_por_ordem_grupo(text);
create or replace function benchmarking_concepcao_por_ordem_grupo(p_ordem text, p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where (
        (p_ordem = 'Repasse' and m.tipo = 'diagnostico_repasse')
        or (p_ordem <> 'Repasse' and m.tipo = 'diagnostico' and m.ordem = p_ordem)
      )
      and exists (select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = m.fazenda_id)
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
    having count(*) > 0
  ),
  tamanho as ( select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda ),
  ranqueadas as (
    select taxa, row_number() over (order by taxa asc) as posicao_da_pior, row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_concepcao_por_ordem_grupo(text, text) to authenticated;

-- ---------- concepção POR CATEGORIA (Nulípara/Primípara/Multípara) ----------
-- a categoria não fica salva no manejo de diagnóstico, então cruza com o lote (categoria atual dele).
drop function if exists benchmarking_concepcao_por_categoria_sistema(text);
create or replace function benchmarking_concepcao_por_categoria_sistema(p_categoria text, p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    join lotes l on l.id = m.lote_id
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico' and l.categoria = p_categoria
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
    having count(*) > 0
  ),
  tamanho as ( select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda ),
  ranqueadas as (
    select taxa, row_number() over (order by taxa asc) as posicao_da_pior, row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_concepcao_por_categoria_sistema(text, text) to authenticated;

drop function if exists benchmarking_concepcao_por_categoria_grupo(text);
create or replace function benchmarking_concepcao_por_categoria_grupo(p_categoria text, p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    join lotes l on l.id = m.lote_id
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico' and l.categoria = p_categoria
      and exists (select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = m.fazenda_id)
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
    having count(*) > 0
  ),
  tamanho as ( select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda ),
  ranqueadas as (
    select taxa, row_number() over (order by taxa asc) as posicao_da_pior, row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_concepcao_por_categoria_grupo(text, text) to authenticated;

-- ---------- fertilidade POR CATEGORIA (Nulípara/Primípara/Multípara) ----------
-- Prenhas daquela categoria / total de animais nos lotes daquela categoria (não só quem tem Diagnóstico).
drop function if exists benchmarking_fertilidade_por_categoria_sistema(text);
create or replace function benchmarking_fertilidade_por_categoria_sistema(p_categoria text, p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with prenhas_por_fazenda as (
    select m.fazenda_id, count(*) filter (where d ->> 'resultado' = 'Prenha') as prenhas
    from manejos m
    join lotes l on l.id = m.lote_id
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico' and l.categoria = p_categoria
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
  ),
  animais_por_fazenda as (
    select l.fazenda_id, sum(coalesce(array_length(l.animais, 1), 0)) as total_animais
    from lotes l
    where l.nome <> 'Desconhecidos' and l.categoria = p_categoria
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = l.safra_id and sf.nome = p_safra_nome))
    group by l.fazenda_id
  ),
  por_fazenda as (
    select a.fazenda_id, round(100.0 * coalesce(p.prenhas, 0) / a.total_animais, 1) as taxa
    from animais_por_fazenda a
    left join prenhas_por_fazenda p on p.fazenda_id = a.fazenda_id
    where a.total_animais > 0
  ),
  tamanho as ( select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda ),
  ranqueadas as (
    select taxa, row_number() over (order by taxa asc) as posicao_da_pior, row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_fertilidade_por_categoria_sistema(text, text) to authenticated;

drop function if exists benchmarking_fertilidade_por_categoria_grupo(text);
create or replace function benchmarking_fertilidade_por_categoria_grupo(p_categoria text, p_safra_nome text default null)
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with prenhas_por_fazenda as (
    select m.fazenda_id, count(*) filter (where d ->> 'resultado' = 'Prenha') as prenhas
    from manejos m
    join lotes l on l.id = m.lote_id
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico' and l.categoria = p_categoria
      and exists (select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = m.fazenda_id)
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = m.safra_id and sf.nome = p_safra_nome))
    group by m.fazenda_id
  ),
  animais_por_fazenda as (
    select l.fazenda_id, sum(coalesce(array_length(l.animais, 1), 0)) as total_animais
    from lotes l
    where l.nome <> 'Desconhecidos' and l.categoria = p_categoria
      and exists (select 1 from usuario_fazendas uf where uf.usuario_id = auth.uid() and uf.fazenda_id = l.fazenda_id)
      and (p_safra_nome is null or exists (select 1 from safras sf where sf.id = l.safra_id and sf.nome = p_safra_nome))
    group by l.fazenda_id
  ),
  por_fazenda as (
    select a.fazenda_id, round(100.0 * coalesce(p.prenhas, 0) / a.total_animais, 1) as taxa
    from animais_por_fazenda a
    left join prenhas_por_fazenda p on p.fazenda_id = a.fazenda_id
    where a.total_animais > 0
  ),
  tamanho as ( select greatest(1, round(count(*) * 0.25)) as qtd from por_fazenda ),
  ranqueadas as (
    select taxa, row_number() over (order by taxa asc) as posicao_da_pior, row_number() over (order by taxa desc) as posicao_da_melhor
    from por_fazenda
  )
  select
    (select round(avg(taxa), 1) from por_fazenda) as media_geral,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_melhor <= tamanho.qtd) as media_top25,
    (select round(avg(taxa), 1) from ranqueadas, tamanho where posicao_da_pior  <= tamanho.qtd) as media_bottom25,
    (select count(*) from por_fazenda) as num_fazendas;
$$ language sql stable security definer set search_path = public;

grant execute on function benchmarking_fertilidade_por_categoria_grupo(text, text) to authenticated;

-- avisa a API (PostgREST) que o schema mudou — importante sempre que uma coluna nova é
-- adicionada (como "criado_em" em retiros/safras acima), pra ela não continuar usando uma
-- versão em cache das tabelas.
notify pgrst, 'reload schema';
