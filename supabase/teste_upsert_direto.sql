-- Reproduz EXATAMENTE o formato do pedido real do app: um "upsert" (INSERT ... ON CONFLICT
-- DO UPDATE), não um INSERT simples como no teste anterior. Rode tudo de uma vez.

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e35b194f-870a-4e68-8e51-f1743664cc06","role":"authenticated"}';
insert into fazendas (id, nome, municipio, area_total, proprietario, responsavel, telefone)
values ('teste_diagnostico_999', 'Fazenda Teste', null, null, null, null, null)
on conflict (id) do update set
  nome = excluded.nome, municipio = excluded.municipio, area_total = excluded.area_total,
  proprietario = excluded.proprietario, responsavel = excluded.responsavel, telefone = excluded.telefone;
rollback;
