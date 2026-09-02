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
create table if not exists usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  login text unique not null,
  perfil text not null check (perfil in ('Administrador', 'Supervisor', 'Inseminador')),
  criado_em timestamptz not null default now()
);

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

-- Administrador vê tudo; Supervisor/Inseminador só as fazendas em usuario_fazendas.
-- Ajuste o nome da tabela/coluna de perfil conforme a implementação final de auth.
create or replace function fazenda_autorizada(fid uuid)
returns boolean as $$
  select exists (
    select 1 from usuarios u
    where u.id = auth.uid()
      and (
        u.perfil = 'Administrador'
        or exists (
          select 1 from usuario_fazendas uf
          where uf.usuario_id = u.id and uf.fazenda_id = fid
        )
      )
  );
$$ language sql stable;

create policy "fazendas: acesso autorizado" on fazendas
  for all using (fazenda_autorizada(id));

create policy "retiros: acesso autorizado" on retiros
  for all using (fazenda_autorizada(fazenda_id));

create policy "safras: acesso autorizado" on safras
  for all using (fazenda_autorizada(fazenda_id));

create policy "lotes: acesso autorizado" on lotes
  for all using (fazenda_autorizada(fazenda_id));

create policy "insumos: acesso autorizado" on insumos
  for all using (fazenda_id is null or fazenda_autorizada(fazenda_id));

create policy "manejos: acesso autorizado" on manejos
  for all using (fazenda_autorizada(fazenda_id));

create policy "movimentos: acesso autorizado" on movimentos
  for all using (fazenda_autorizada(fazenda_id));

create policy "sugestoes_ressinc: acesso autorizado" on sugestoes_ressinc
  for all using (fazenda_autorizada(fazenda_id));

create policy "agendamentos: acesso autorizado" on agendamentos
  for all using (fazenda_autorizada(fazenda_id));
