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

// campos que existem só no app (derivados/locais) e nunca devem ser enviados
// ao Supabase — enviar um campo que não existe como coluna quebra o upsert
// inteiro daquela tabela.
const CAMPOS_SO_LOCAIS = {
  // a autorização de verdade mora na tabela usuario_fazendas; este campo no
  // app é só um espelho local para exibição/edição na tela de Usuários.
  usuarios: ["fazendasAutorizadas"],
};

// ---------- envia (upsert) uma coleção inteira ----------
async function enviarColecao(colecao, itens) {
  if (!supabaseConfigurado || !itens || itens.length === 0) return { ok: true, enviados: 0 };
  const tabela = TABELAS[colecao];
  if (!tabela) return { ok: true, enviados: 0 };
  const remover = CAMPOS_SO_LOCAIS[colecao] || [];
  const linhas = itens.map((item) => {
    const limpo = { ...item };
    remover.forEach((campo) => delete limpo[campo]);
    return linhaParaSupabase(limpo);
  });
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

// ---------- autorizações (usuario_fazendas) ----------
// "fazendasAutorizadas" não é uma coluna de "usuarios" — a fonte de verdade de
// quem pode acessar qual fazenda é a tabela usuario_fazendas. Por isso ela é
// sincronizada à parte: para cada usuário, substitui completamente as
// autorizações dele pelas que estão na cópia local (apaga tudo daquele
// usuário e insere de novo) — assim uma fazenda removida da lista também é
// removida no servidor, não só as adicionadas.
async function enviarAutorizacoes(usuarios) {
  if (!supabaseConfigurado || !usuarios || usuarios.length === 0) return { ok: true, erros: [] };
  const erros = [];
  for (const u of usuarios) {
    if (!u.id) continue;
    const fazendas = u.fazendasAutorizadas || [];
    const { error: erroDelete } = await supabase.from("usuario_fazendas").delete().eq("usuario_id", u.id);
    if (erroDelete) { erros.push(`${u.nome || u.id}: ${erroDelete.message}`); continue; }
    if (fazendas.length > 0) {
      const linhas = fazendas.map((fid) => ({ usuario_id: u.id, fazenda_id: fid }));
      const { error: erroInsert } = await supabase.from("usuario_fazendas").upsert(linhas, { onConflict: "usuario_id,fazenda_id" });
      if (erroInsert) erros.push(`${u.nome || u.id}: ${erroInsert.message}`);
    }
  }
  return { ok: erros.length === 0, erros };
}

// busca todas as autorizações que o usuário logado consegue enxergar (RLS já
// filtra: cada um vê a própria linha; Administrador também vê as do seu grupo).
async function buscarAutorizacoes() {
  if (!supabaseConfigurado) return { ok: true, mapa: {} };
  const { data, error } = await supabase.from("usuario_fazendas").select("usuario_id, fazenda_id");
  if (error) return { ok: false, erro: error.message, mapa: {} };
  const mapa = {};
  (data || []).forEach((row) => {
    if (!mapa[row.usuario_id]) mapa[row.usuario_id] = [];
    mapa[row.usuario_id].push(row.fazenda_id);
  });
  return { ok: true, mapa };
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

  const resultadoAutorizEnvio = await enviarAutorizacoes(estado.usuarios);
  if (!resultadoAutorizEnvio.ok) (resultadoAutorizEnvio.erros || []).forEach((e) => erros.push(`autorizações: ${e}`));

  const atualizado = {};
  for (const colecao of Object.keys(TABELAS)) {
    const resultado = await buscarColecao(colecao);
    if (resultado.ok) atualizado[colecao] = resultado.itens;
    else erros.push(`${colecao}: ${resultado.erro}`);
  }

  // aplica as autorizações atualizadas em cima dos usuários já buscados —
  // é assim que "fazendasAutorizadas" volta a existir nos dados locais.
  const resultadoAutorizBusca = await buscarAutorizacoes();
  if (resultadoAutorizBusca.ok) {
    if (atualizado.usuarios) {
      atualizado.usuarios = atualizado.usuarios.map((u) => ({ ...u, fazendasAutorizadas: resultadoAutorizBusca.mapa[u.id] || [] }));
    }
  } else {
    erros.push(`autorizações: ${resultadoAutorizBusca.erro}`);
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
