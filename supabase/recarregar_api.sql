-- Força a API do Supabase (PostgREST) a recarregar o "schema" do banco — incluindo as
-- políticas de RLS mais recentes. Às vezes, depois de mudar políticas via SQL Editor,
-- a API continua usando uma versão em cache por um tempo, mesmo com o banco já atualizado
-- (é por isso que a simulação direta no SQL funciona, mas o pedido real do app ainda falha).
notify pgrst, 'reload schema';
