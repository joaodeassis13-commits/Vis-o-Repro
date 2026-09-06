-- Diagnóstico: simula exatamente o que a política de "fazendas" verifica na hora de
-- criar uma fazenda nova, usando o UID do João Farias. Roda cada bloco separadamente
-- (selecione só aquele trecho e rode) e me manda o resultado de cada um.

-- 1) Confirma que a função enxerga a linha certa (sem RLS envolvida ainda, direto)
select id, perfil from usuarios where id = 'e35b194f-870a-4e68-8e51-f1743664cc06';

-- 2) Simula a sessão autenticada como o João Farias e testa a função que a política usa
set local role authenticated;
set local request.jwt.claims = '{"sub":"e35b194f-870a-4e68-8e51-f1743664cc06","role":"authenticated"}';
select auth.uid() as uid_visto_pela_sessao, eh_administrador() as resultado_eh_administrador;
