select f.id, f.nome, uf.usuario_id, u.nome as nome_usuario
from fazendas f
left join usuario_fazendas uf on uf.fazenda_id = f.id
left join usuarios u on u.id = uf.usuario_id
order by f.criado_em;
