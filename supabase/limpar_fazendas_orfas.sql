-- Apaga só as fazendas que não têm NINGUÉM autorizado (órfãs, sobras das tentativas de
-- sincronização que falharam antes de corrigirmos o bug do "criado_em"). Não mexe em
-- nenhuma fazenda que já tenha pelo menos um usuário vinculado a ela (como a "Modelo 1",
-- que já pertence de verdade ao João Farias).
delete from fazendas f
where not exists (
  select 1 from usuario_fazendas uf where uf.fazenda_id = f.id
);
