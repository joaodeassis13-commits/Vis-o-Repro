// src/lib/sync.js
// Sincronização entre o banco local (IndexedDB, sempre a fonte principal de
// verdade no aparelho) e o Supabase (quando configurado e há internet).
//
// Estratégia: "push tudo, puxa tudo" por fazenda autorizada — simples e
// robusta para o volume de dados de uma operação de campo. Cada linha usa o
// mesmo "id" gerado no cliente (uid()) nos dois lados, então reenviar não
// duplica nada (upsert por id). Não é sincronização em tempo real (ainda) —
// é sincronização "ao reconectar" ou sob demanda (botão "Sincronizar agora").
//
// Rascunhos (leituras salvas em andamento) e usuários/login ficam só locais
// por enquanto — ver notas no final do arquivo.

import { supabase, supabaseConfigurado } from "./supabaseClient.js";

const toSnake = (s) => s.replace(/([A-Z])/g, "_$1").toLowerCase();
const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function linhaParaSupabase(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toSnake(k)] = v;
  return out;
}
function linhaDoSupabase(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toCamel(k)] = v;
  return out;
}

// coleção (nome usado no app) -> tabela no Supabase
const TABELAS = {
  usuarios: "usuarios",
  fazendas: "fazendas",
  retiros: "retiros",
  safras: "safras",
  lotes: "lotes",
  insumos: "insumos",
  manejos: "manejos",
  movimentos: "movimentos",
  agendamentos: "agendamentos",
  sugestoesRessinc: "sugestoes_ressinc",
  sugestoesRepasse: "sugestoes_repasse",
  protocolosPadrao: "protocolos_padrao",
};

// ---------- envia (upsert) uma coleção inteira ----------
async function enviarColecao(colecao, itens) {
  if (!supabaseConfigurado || !itens || itens.length === 0) return { ok: true, enviados: 0 };
  const tabela = TABELAS[colecao];
  if (!tabela) return { ok: true, enviados: 0 };
  const linhas = itens.map(linhaParaSupabase);
  const { error } = await supabase.from(tabela).upsert(linhas, { onConflict: "id" });
  if (error) return { ok: false, erro: error.message };
  return { ok: true, enviados: linhas.length };
}

// ---------- busca tudo que o usuário tem acesso (RLS já filtra por fazenda) ----------
async function buscarColecao(colecao) {
  if (!supabaseConfigurado) return { ok: true, itens: [] };
  const tabela = TABELAS[colecao];
  if (!tabela) return { ok: true, itens: [] };
  const { data, error } = await supabase.from(tabela).select("*");
  if (error) return { ok: false, erro: error.message, itens: [] };
  return { ok: true, itens: (data || []).map(linhaDoSupabase) };
}

// ---------- ponto de entrada usado pelo App: envia tudo, depois busca tudo ----------
// `estado` = { usuarios, fazendas, retiros, safras, lotes, insumos, manejos, movimentos, agendamentos, sugestoesRessinc }
export async function sincronizar(estado) {
  if (!supabaseConfigurado) {
    return { ok: false, motivo: "Supabase não configurado. Veja src/lib/supabaseClient.js." };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, motivo: "Sem conexão com a internet." };
  }

  const erros = [];
  for (const colecao of Object.keys(TABELAS)) {
    const resultado = await enviarColecao(colecao, estado[colecao]);
    if (!resultado.ok) erros.push(`${colecao}: ${resultado.erro}`);
  }

  const atualizado = {};
  for (const colecao of Object.keys(TABELAS)) {
    const resultado = await buscarColecao(colecao);
    if (resultado.ok) atualizado[colecao] = resultado.itens;
    else erros.push(`${colecao}: ${resultado.erro}`);
  }

  return { ok: erros.length === 0, erros, atualizado, sincronizadoEm: new Date().toISOString() };
}

// ---------- busca só a própria linha em "usuarios" ----------
// Usado logo após o login, para resolver o perfil (nome/perfil/fazendas) em
// um aparelho novo, que ainda não tem nada em cache local — a política de
// RLS de "usuarios" já permite a própria linha mesmo sem ser Administrador.
export async function buscarPerfilProprio(userId) {
  if (!supabaseConfigurado) return { ok: false, erro: "Supabase não configurado." };
  try {
    const { data, error } = await supabase.from("usuarios").select("*").eq("id", userId).maybeSingle();
    if (error) return { ok: false, erro: error.message };
    if (!data) return { ok: false, erro: "Nenhum registro encontrado na tabela usuarios para este login." };
    return { ok: true, perfil: linhaDoSupabase(data) };
  } catch (e) {
    return { ok: false, erro: e?.message || "Falha de rede ao buscar o perfil." };
  }
}

// NOTAS / PRÓXIMOS PASSOS DESTA CAMADA:
// - Autenticação: já é real (Supabase Auth, e-mail + senha — ver src/lib/auth.js),
//   com as policies de RLS usando auth.uid().
// - Tempo real: para ver alterações de outro usuário aparecerem sem precisar
//   clicar em "Sincronizar agora", trocar `buscarColecao` por uma inscrição
//   `supabase.channel(...).on('postgres_changes', ...)` por tabela.
// - Conflitos: hoje é "o que for enviado por último vence" (upsert simples).
//   Para o volume de uso de campo (poucos usuários por fazenda, sessões
//   curtas), isso é suficiente; se crescer, considerar um campo
//   `atualizado_em` + resolução por timestamp mais recente.
