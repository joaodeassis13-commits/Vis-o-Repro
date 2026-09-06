-- Compara as permissões básicas (INSERT/SELECT/UPDATE/DELETE) que a role "authenticated"
-- tem em cada tabela — isso é uma camada SEPARADA das políticas de RLS. Mesmo com a
-- política perfeita, se a role não tiver a permissão básica na tabela, a operação falha
-- do mesmo jeito (e o Postgres usa o mesmo código de erro "42501" pros dois casos).
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_name in ('usuarios', 'fazendas', 'retiros', 'lotes')
order by table_name, privilege_type;
