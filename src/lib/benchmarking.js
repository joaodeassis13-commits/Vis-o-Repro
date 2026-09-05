// src/lib/benchmarking.js
// Busca estatísticas agregadas e anônimas de fazendas fora do grupo do
// usuário logado (escopo "Geral do Sistema") — usadas na aba Benchmarking.
//
// Importante: isso NUNCA busca dados linha-a-linha de outra fazenda. Só
// chama funções do Postgres (ver supabase/schema.sql, seção BENCHMARKING)
// que já devolvem exclusivamente médias agregadas — o "bypass" de RLS
// acontece só dentro dessas funções, no servidor, e nunca expõe qual
// fazenda contribuiu com o quê. A metodologia é sempre "média das médias":
// cada função calcula a taxa de CADA fazenda primeiro, e só depois tira a
// média entre essas taxas (não soma os animais de todas juntos).
//
// O escopo "Meu Grupo" não passa por aqui — o app já tem, localmente, todos
// os dados das fazendas do próprio grupo (via RLS normal), então calcula a
// mesma metodologia (média das médias) direto no cliente.

import { supabase, supabaseConfigurado } from "./supabaseClient.js";

function formatarResposta(data, error) {
  if (error) return { ok: false, motivo: error.message };
  const linha = data?.[0];
  if (!linha) return { ok: true, mediaGeral: null, mediaTop25: null, mediaBottom25: null, numFazendas: 0 };
  return {
    ok: true,
    mediaGeral: linha.media_geral != null ? Number(linha.media_geral) : null,
    mediaTop25: linha.media_top25 != null ? Number(linha.media_top25) : null,
    mediaBottom25: linha.media_bottom25 != null ? Number(linha.media_bottom25) : null,
    numFazendas: Number(linha.num_fazendas || 0),
  };
}

// taxa de prenhez — todas as fazendas do sistema, de todos os grupos.
// safraNome: quando informado, filtra para diagnósticos de manejos cuja safra
// tenha esse nome (ex.: "2024/2025") — comparável entre fazendas diferentes,
// já que o nome da safra é o que se repete entre elas (o id é local a cada uma).
export async function buscarBenchmarkTaxaPrenhezSistema(safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_taxa_prenhez_sistema", { p_safra_nome: safraNome });
  return formatarResposta(data, error);
}

// taxa de prenhez — só as fazendas do grupo do usuário logado, calculada no
// servidor (equivalente à conta que o app já faz no cliente para "Meu Grupo";
// fica disponível aqui também caso seja útil comparar os dois cálculos).
export async function buscarBenchmarkTaxaPrenhezGrupo(safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_taxa_prenhez_grupo", { p_safra_nome: safraNome });
  return formatarResposta(data, error);
}

// taxa de FERTILIDADE (Prenhas / total de animais nos lotes) — todas as fazendas do sistema.
export async function buscarBenchmarkTaxaFertilidadeSistema(safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_taxa_fertilidade_sistema", { p_safra_nome: safraNome });
  return formatarResposta(data, error);
}

// taxa de FERTILIDADE — só as fazendas do grupo do usuário logado.
export async function buscarBenchmarkTaxaFertilidadeGrupo(safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_taxa_fertilidade_grupo", { p_safra_nome: safraNome });
  return formatarResposta(data, error);
}

// concepção por ORDEM (1º/2º/3º IATF ou "Repasse") — todas as fazendas do sistema.
export async function buscarBenchmarkConcepcaoPorOrdemSistema(ordem, safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_concepcao_por_ordem_sistema", { p_ordem: ordem, p_safra_nome: safraNome });
  return formatarResposta(data, error);
}

// concepção por CATEGORIA (Nulípara/Primípara/Multípara) — todas as fazendas do sistema.
export async function buscarBenchmarkConcepcaoPorCategoriaSistema(categoria, safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_concepcao_por_categoria_sistema", { p_categoria: categoria, p_safra_nome: safraNome });
  return formatarResposta(data, error);
}

// fertilidade por CATEGORIA — todas as fazendas do sistema.
export async function buscarBenchmarkFertilidadePorCategoriaSistema(categoria, safraNome = null) {
  if (!supabaseConfigurado) return { ok: false, motivo: "Supabase não configurado." };
  const { data, error } = await supabase.rpc("benchmarking_fertilidade_por_categoria_sistema", { p_categoria: categoria, p_safra_nome: safraNome });
  return formatarResposta(data, error);
}
