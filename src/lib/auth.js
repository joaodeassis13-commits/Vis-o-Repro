// src/lib/auth.js
// Autenticação real (e-mail + senha verificados no servidor, via Supabase
// Auth) — substitui o login mockado anterior, onde qualquer senha era aceita.
//
// Se o Supabase não estiver configurado (ver src/lib/supabaseClient.js), as
// funções abaixo retornam erro explicando isso — o app cai de volta para um
// "modo de teste" local, claramente sinalizado como inseguro, só para
// permitir continuar testando offline sem backend configurado ainda.

import { supabase, supabaseParaCriarUsuario, supabaseConfigurado } from "./supabaseClient.js";

export { supabaseConfigurado };

export async function entrar(email, senha) {
  if (!supabaseConfigurado) {
    return { ok: false, erro: "Supabase não configurado — autenticação real indisponível neste ambiente." };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) return { ok: false, erro: traduzErro(error.message) };
  return { ok: true, sessao: data.session, authUser: data.user };
}

export async function sair() {
  if (!supabaseConfigurado) return;
  await supabase.auth.signOut();
}

export async function obterSessao() {
  if (!supabaseConfigurado) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// dispara `callback(sessao | null)` sempre que o login muda (login, logout,
// token renovado, sessão expirada) — inclusive se acontecer em outra aba.
export function escutarMudancaAuth(callback) {
  if (!supabaseConfigurado) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => callback(sessao));
  return () => data.subscription.unsubscribe();
}

// Cria uma conta de login real (usada pelo Administrador ao cadastrar um novo
// usuário). Retorna o id gerado pelo Supabase Auth — é esse id que vira a
// chave primária da linha correspondente na tabela `usuarios`. Usa um client
// Supabase separado (supabaseParaCriarUsuario) para não substituir a sessão
// do Administrador que está logado no momento (ver supabaseClient.js).
export async function criarUsuario(email, senha) {
  if (!supabaseConfigurado) {
    return { ok: false, erro: "Supabase não configurado — não é possível criar login real neste ambiente." };
  }
  const { data, error } = await supabaseParaCriarUsuario.auth.signUp({ email: email.trim(), password: senha });
  if (error) return { ok: false, erro: traduzErro(error.message) };
  // Dependendo da configuração do projeto Supabase, pode ser necessário o
  // usuário confirmar o e-mail antes do primeiro login (Authentication →
  // Settings → "Confirm email", no painel do Supabase — desative ali se
  // quiser que o Administrador já possa usar a conta na hora).
  await supabaseParaCriarUsuario.auth.signOut(); // limpa a sessão local (não persistida) desse client auxiliar
  return { ok: true, authUserId: data.user?.id || null, precisaConfirmarEmail: !data.session };
}

export async function trocarSenha(novaSenha) {
  if (!supabaseConfigurado) return { ok: false, erro: "Supabase não configurado." };
  const { error } = await supabase.auth.updateUser({ password: novaSenha });
  if (error) return { ok: false, erro: traduzErro(error.message) };
  return { ok: true };
}

function traduzErro(msg) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "E-mail ainda não confirmado. Verifique a caixa de entrada.";
  if (m.includes("user already registered")) return "Já existe uma conta com este e-mail.";
  if (m.includes("password") && m.includes("6")) return "A senha precisa ter pelo menos 6 caracteres.";
  return msg || "Erro ao autenticar.";
}
