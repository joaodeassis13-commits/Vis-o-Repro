-- Mostra exatamente quais políticas de RLS existem HOJE na tabela "fazendas" — pra conferir
-- se não sobrou nenhuma política antiga (de uma versão anterior do schema) com nome diferente,
-- que eu não tenha conseguido derrubar antes de criar a nova.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'fazendas'
order by cmd;
