-- Teste definitivo: simula a sessão do João Farias e tenta inserir uma fazenda de teste
-- de verdade (não só chamar a função) — isso vai mostrar se o INSERT em si funciona sob
-- RLS com essa sessão, ou se falha mesmo com eh_administrador() retornando true.
-- Rode tudo de uma vez, selecionando as 4 linhas juntas.

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e35b194f-870a-4e68-8e51-f1743664cc06","role":"authenticated"}';
insert into fazendas (id, nome) values ('teste_diagnostico_999', 'Fazenda Teste Diagnostico');
rollback;
