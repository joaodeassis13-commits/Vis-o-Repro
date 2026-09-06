begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e35b194f-870a-4e68-8e51-f1743664cc06","role":"authenticated"}';
select
  auth.uid() as uid_da_sessao,
  (select usuario_id from usuario_fazendas where fazenda_id = 'faz_mtpz8tdc_9umr1') as usuario_id_salvo,
  (select usuario_id from usuario_fazendas where fazenda_id = 'faz_mtpz8tdc_9umr1') = auth.uid() as sao_iguais,
  fazenda_autorizada('faz_mtpz8tdc_9umr1') as fazenda_autorizada_resultado,
  eh_administrador() as eh_administrador_resultado;
rollback;
