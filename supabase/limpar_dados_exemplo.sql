-- Remove a(s) "Fazenda Santa Fé" de exemplo (dado de demonstração do app, não é uma fazenda
-- real sua) que acabou(aram) sendo sincronizada(s) por engano, junto com tudo que depende
-- dela: retiros, safras, lotes, insumos, manejos, etc. (o "cascade" nas chaves estrangeiras
-- cuida disso automaticamente).
delete from fazendas where nome = 'Fazenda Santa Fé';
