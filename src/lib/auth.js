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
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) return { ok: false, erro: traduzErro(error.message) };
    return { ok: true, sessao: data.session, authUser: data.user };
  } catch (e) {
    // sem conexão de verdade (não é erro de credencial — o pedido nem chega a sair do
    // aparelho), ou o servidor está fora do ar: sem isso, o "Failed to fetch" (mensagem
    // técnica do navegador) vazava direto pra tela, sem explicar nada pra quem está usando.
    return { ok: false, erro: "Não foi possível conectar. Verifique sua internet e tente novamente." };
  }
}

export async function sair() {
  if (!supabaseConfigurado) return;
  await supabase.auth.signOut();
}

// envia um e-mail com um link pra redefinir a senha — precisa de internet, já que é o
// Supabase quem manda o e-mail e confere a nova senha depois.
export async function pedirRedefinicaoSenha(email) {
  if (!supabaseConfigurado) return { ok: false, erro: "Supabase não configurado — recuperação de senha indisponível neste ambiente." };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) return { ok: false, erro: traduzErro(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: "Não foi possível conectar. Verifique sua internet e tente novamente." };
  }
}

// define a nova senha — só funciona dentro da sessão temporária que o link do e-mail cria
// (o Supabase já deixa o usuário "autenticado" nesse contexto específico, só pra essa ação).
export async function definirNovaSenha(novaSenha) {
  if (!supabaseConfigurado) return { ok: false, erro: "Supabase não configurado." };
  try {
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    if (error) return { ok: false, erro: traduzErro(error.message) };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: "Não foi possível conectar. Verifique sua internet e tente novamente." };
  }
}

// sessão guardada pelo próprio Supabase no aparelho (localStorage), lida SEM falar com a rede.
// Serve pra abrir o app offline: o token pode estar vencido (dura 1h), mas a pessoa continua
// sendo a mesma que entrou aqui, e os dados locais continuam dela.
function lerSessaoLocal() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.+-auth-token$/.test(k)) {
        const v = JSON.parse(localStorage.getItem(k));
        if (v?.user?.id) return v;
      }
    }
  } catch (e) { /* ignora */ }
  return null;
}

export async function obterSessao() {
  if (!supabaseConfigurado) return null;
  try {
    // offline (ou sinal ruim), renovar um token vencido pode ficar pendurado — sem limite de
    // tempo isso deixava a tela em branco. Passados 4s, segue com a sessão guardada no aparelho.
    const r = await Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session || null),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 4000)),
    ]);
    if (r && r !== "timeout") return r;
    return lerSessaoLocal();
  } catch (e) {
    console.error("Falha ao obter sessão (provavelmente sem conexão):", e);
    return lerSessaoLocal();
  }
}

// dispara `callback(sessao | null)` sempre que o login muda (login, logout,
// token renovado, sessão expirada) — inclusive se acontecer em outra aba.
export function escutarMudancaAuth(callback) {
  if (!supabaseConfigurado) return () => {};
  // passa o "evento" também (não só a sessão) — precisa disso pra distinguir um login normal
  // de um clique no link de "Redefinir senha" (evento "PASSWORD_RECOVERY"), que também loga a
  // pessoa automaticamente, mas exige mostrar a tela de escolher a nova senha em vez do app.
  const { data } = supabase.auth.onAuthStateChange((evento, sessao) => callback(sessao, evento));
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
