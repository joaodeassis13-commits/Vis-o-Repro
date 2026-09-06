-- Confere se sobrou algum registro de teste de uma tentativa anterior (que talvez não
-- tenha sido desfeita direito) — isso mudaria o comportamento do teste seguinte.
select * from fazendas where id = 'teste_diagnostico_999';
