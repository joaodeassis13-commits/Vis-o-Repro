-- Limpa todo o "lixo" de tentativas de sincronização que falharam, deixando o banco pronto
-- pra sincronização recomeçar do zero, com os dados do seu aparelho (que já estão certos).
--
-- NÃO apaga a tabela "usuarios" nem as contas de login (Supabase Auth) — só o que é dado
-- operacional (fazendas, lotes, manejos, etc.) e os vínculos de autorização, que é onde
-- ficou a inconsistência das tentativas anteriores.
--
-- "cascade" garante que a ordem das dependências (chaves estrangeiras) seja resolvida
-- automaticamente, então não precisa se preocupar com a ordem das tabelas abaixo.

truncate table
  usuario_fazendas,
  manejos,
  movimentos,
  agendamentos,
  sugestoes_ressinc,
  sugestoes_repasse,
  protocolos_padrao,
  lotes,
  insumos,
  safras,
  retiros,
  fazendas
cascade;
