-- Simula exatamente a consulta que o app faz pra buscar as autorizações (usuario_fazendas),
-- como a sessão do João Farias — pra ver se ela retorna a linha ou vem vazia.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e35b194f-870a-4e68-8e51-f1743664cc06","role":"authenticated"}';
select usuario_id, fazenda_id from usuario_fazendas;
rollback;
