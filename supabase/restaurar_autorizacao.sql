-- Restaura a autorização do João Farias na fazenda "Teste 2", que foi apagada sem querer
-- pelo bug do perfil incompleto após "Limpar dados".
insert into usuario_fazendas (usuario_id, fazenda_id)
values ('e35b194f-870a-4e68-8e51-f1743664cc06', 'faz_mtpz8tdc_9umr1')
on conflict do nothing;
