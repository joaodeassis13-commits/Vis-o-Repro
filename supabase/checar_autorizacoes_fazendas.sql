-- Compara TODAS as fazendas que existem na tabela com quais delas o João Farias tem
-- autorização (usuario_fazendas) — isso mostra exatamente por que o app só exibe algumas.
select
  f.id, f.nome,
  exists (
    select 1 from usuario_fazendas uf
    where uf.fazenda_id = f.id and uf.usuario_id = 'e35b194f-870a-4e68-8e51-f1743664cc06'
  ) as joao_farias_autorizado,
  (select count(*) from usuario_fazendas uf2 where uf2.fazenda_id = f.id) as total_de_autorizacoes_nessa_fazenda
from fazendas f
order by f.criado_em;
