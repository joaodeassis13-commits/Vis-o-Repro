-- =====================================================================
-- VisãoRepro — schema inicial para Supabase (Postgres)
-- Espelha as coleções em memória de visaorepro.jsx. Ponto de partida:
-- ajuste tipos/constraints conforme o app evoluir.
--
-- As tabelas estão em ORDEM DE DEPENDÊNCIA (cada uma só referencia
-- tabelas já criadas antes dela) — rode o arquivo inteiro de uma vez,
-- de cima para baixo, no SQL Editor do Supabase.
-- =====================================================================

-- ---------- fazenda (raiz de tudo — nenhuma outra tabela depende dela vir depois) ----------
create table if not exists fazendas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  municipio text,
  area text,
  proprietario text,
  responsavel text,
  telefone text,
  criado_em timestamptz not null default now()
);

-- ---------- usuários (perfil + fazendas autorizadas) ----------
-- id = mesmo id do Supabase Auth (auth.users) — a conta de login em si (e-mail
-- e senha) vive lá; aqui só ficam os dados de perfil do app.
-- criado_por: quem cadastrou este usuário — garante que o Administrador que
-- criou a conta sempre a enxergue, mesmo antes de autorizá-la a uma fazenda.
create table if not exists usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  login text unique not null,
  email text,
  perfil text not null check (perfil in ('Administrador', 'Supervisor', 'Inseminador')),
  criado_por uuid references usuarios (id),
  criado_em timestamptz not null default now()
);

-- "create table if not exists" não adiciona colunas a uma tabela que já
-- existia de uma rodada anterior do schema — estes comandos garantem que as
-- colunas mais novas (email, criado_por) existam mesmo em bancos antigos,
-- sem precisar apagar a tabela e recriar.
alter table usuarios add column if not exists email text;
alter table usuarios add column if not exists criado_por uuid references usuarios (id);

create table if not exists usuario_fazendas (
  usuario_id uuid references usuarios (id) on delete cascade,
  fazenda_id uuid references fazendas (id) on delete cascade,
  primary key (usuario_id, fazenda_id)
);

-- ---------- retiro / safra (dependem só de fazenda) ----------
create table if not exists retiros (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  nome text not null
);

create table if not exists safras (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  nome text not null  -- formato "2025/2026"
);

-- ---------- lote (depende de fazenda, safra, retiro) ----------
create table if not exists lotes (
  id text primary key,  -- mantém o id gerado no cliente (uid()) para sync sem conflito
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  safra_id uuid references safras (id),
  retiro_id uuid references retiros (id),
  nome text not null,
  categoria text,
  ordem text,  -- '1º IATF' | '2º IATF' | '3º IATF'
  numero_animais integer,
  raca text,
  mes_paricao text,
  animais text[] not null default '{}',  -- brincos oficialmente atribuídos ao lote
  criado_em timestamptz not null default now()
);

-- ---------- insumo (hormônio / sêmen / medicamento / utensílio) ----------
create table if not exists insumos (
  id text primary key,
  fazenda_id uuid references fazendas (id) on delete cascade,
  usuario_id uuid references usuarios (id),  -- não nulo quando local = 'externo'
  local text not null check (local in ('fazenda', 'externo')),
  categoria text not null check (categoria in ('Hormônio', 'Sêmen', 'Medicamento', 'Utensílio')),
  estoque numeric not null default 0,
  valor_unitario numeric,
  produto_comercial text,
  hormonio text,          -- quando categoria = 'Hormônio'
  tamanho_embalagem numeric,
  unidade_embalagem text,
  touro text,             -- quando categoria = 'Sêmen'
  raca text,
  partida date,
  tipo_medicamento text,  -- quando categoria = 'Medicamento'
  unidade text,           -- quando categoria = 'Utensílio'
  criado_em timestamptz not null default now()
);

-- ---------- manejo (indução, D0, ressinc, retirada, inseminação, diagnóstico) ----------
-- precisa vir ANTES de "movimentos", que referencia manejo_id
create table if not exists manejos (
  id text primary key,
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  safra_id uuid references safras (id),
  lote_id text references lotes (id),
  lote_nome text,
  retiro_id uuid references retiros (id),
  tipo text not null check (tipo in ('inducao', 'implantacao', 'ressinc', 'retirada', 'inseminacao', 'diagnostico')),
  categoria text,
  ordem text,
  numero_animais integer,
  mes_paricao text,
  tipo_manejo text,   -- '3 manejos' | '4 manejos' (D0/Ressinc)
  protocolo text,
  local_estoque text check (local_estoque in ('fazenda', 'externo')),
  operador text,
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
  criado_em timestamptz not null default now()
);

-- ---------- movimento de estoque (entrada / saída) — depende de manejos ----------
create table if not exists movimentos (
  id text primary key,
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  insumo_id text not null references insumos (id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  quantidade numeric not null,
  valor_unitario numeric,
  local text not null check (local in ('fazenda', 'externo')),
  manejo_id text references manejos (id),
  tipo_manejo text,  -- rótulo do manejo de origem, quando tipo = 'saida'
  data date not null,
  observacoes text,
  criado_em timestamptz not null default now()
);

-- ---------- sugestões de ressinc (fila de confirmação em D0 > Ressinc) ----------
create table if not exists sugestoes_ressinc (
  id text primary key,
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  safra_id uuid references safras (id),
  lote_id text not null references lotes (id) on delete cascade,
  brincos text[] not null,
  origem_manejo_id text references manejos (id),
  status text not null check (status in ('pendente', 'confirmada', 'descartada')),
  data date not null,
  criado_em timestamptz not null default now()
);

-- ---------- agenda ----------
create table if not exists agendamentos (
  id text primary key,
  fazenda_id uuid not null references fazendas (id) on delete cascade,
  retiro_id uuid references retiros (id),
  lote_nome text,
  ordem text,
  tipo text not null,  -- 'Indução' | 'D0' | 'Retirada' | 'PGF 5' | 'Inseminação' | 'Diagnóstico' | 'Outro'
  tipo_manejo text,
  protocolo text,
  data date not null,
  titulo text,
  origem text not null check (origem in ('manual', 'automatico')),
  origem_agendamento_id text references agendamentos (id),  -- referência à própria tabela: ok, ela já existe neste ponto
  status text not null check (status in ('pendente', 'confirmado', 'descartado')),
  criado_em timestamptz not null default now()
);

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
create or replace function fazenda_autorizada(fid uuid)
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
  for select using (fazenda_autorizada(id));
drop policy if exists "fazendas: atualizacao do proprio grupo" on fazendas;
create policy "fazendas: atualizacao do proprio grupo" on fazendas
  for update using (fazenda_autorizada(id));
drop policy if exists "fazendas: exclusao do proprio grupo" on fazendas;
create policy "fazendas: exclusao do proprio grupo" on fazendas
  for delete using (fazenda_autorizada(id));
drop policy if exists "fazendas: administrador pode criar" on fazendas;
create policy "fazendas: administrador pode criar" on fazendas
  for insert with check (eh_administrador());

drop policy if exists "retiros: acesso autorizado" on retiros;
create policy "retiros: acesso autorizado" on retiros
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "safras: acesso autorizado" on safras;
create policy "safras: acesso autorizado" on safras
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "lotes: acesso autorizado" on lotes;
create policy "lotes: acesso autorizado" on lotes
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "insumos: acesso autorizado" on insumos;
create policy "insumos: acesso autorizado" on insumos
  for all using (fazenda_id is null or fazenda_autorizada(fazenda_id));

drop policy if exists "manejos: acesso autorizado" on manejos;
create policy "manejos: acesso autorizado" on manejos
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "movimentos: acesso autorizado" on movimentos;
create policy "movimentos: acesso autorizado" on movimentos
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "sugestoes_ressinc: acesso autorizado" on sugestoes_ressinc;
create policy "sugestoes_ressinc: acesso autorizado" on sugestoes_ressinc
  for all using (fazenda_autorizada(fazenda_id));

drop policy if exists "agendamentos: acesso autorizado" on agendamentos;
create policy "agendamentos: acesso autorizado" on agendamentos
  for all using (fazenda_autorizada(fazenda_id));

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
    or (eh_administrador() and mesmo_grupo_de_fazendas(id))
  );

drop policy if exists "usuarios: insercao" on usuarios;
create policy "usuarios: insercao" on usuarios
  for insert with check (id = auth.uid() or eh_administrador());

drop policy if exists "usuarios: atualizacao" on usuarios;
create policy "usuarios: atualizacao" on usuarios
  for update using (
    id = auth.uid()
    or criado_por = auth.uid()
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

-- taxa de prenhez comparando TODAS as fazendas do sistema (todos os grupos)
create or replace function benchmarking_taxa_prenhez_sistema()
returns table(media_geral numeric, media_top25 numeric, media_bottom25 numeric, num_fazendas bigint) as $$
  with por_fazenda as (
    select
      m.fazenda_id,
      round(100.0 * count(*) filter (where d ->> 'resultado' = 'Prenha') / count(*), 1) as taxa
    from manejos m
    cross join lateral jsonb_array_elements(m.detalhes) as d
    where m.tipo = 'diagnostico'
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

grant execute on function benchmarking_taxa_prenhez_sistema() to authenticated;

-- taxa de prenhez comparando só as fazendas do PRÓPRIO grupo de quem chamou
-- (auth.uid()) — usada quando o filtro "Meu Grupo" está selecionado no app.
create or replace function benchmarking_taxa_prenhez_grupo()
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

grant execute on function benchmarking_taxa_prenhez_grupo() to authenticated;
