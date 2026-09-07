// src/lib/pinLocal.js
// PIN de recuperação local — resolve um problema específico: se a sessão do
// Supabase for perdida (logout, expiração, etc.) enquanto o aparelho está
// SEM internet, não tem como fazer login de verdade (a senha só é conferida
// no servidor). Sem esse PIN, a pessoa ficaria travada até achar conexão.
//
// Importante entender o que isso é e o que NÃO é:
// - O PIN NUNCA substitui a senha da conta, e nunca é enviado a lugar nenhum.
// - Ele só libera de volta o acesso aos dados que JÁ estavam salvos NESTE
//   aparelho, de uma sessão que já tinha sido validada pelo servidor antes.
// - Assim que a internet voltar, o app pede login de verdade (e-mail+senha)
//   de novo, pra revalidar a sessão e sincronizar.
// - Guardamos só um HASH do PIN (nunca o PIN em texto puro), com salt
//   aleatório e PBKDF2 (bem mais lento de forçar por tentativa e erro do
//   que um hash simples tipo SHA-256 puro).

import { lerMeta, gravarMeta } from "./db.js";

const ITERACOES_PBKDF2 = 150000; // alto o bastante pra desestimular tentativa por força bruta num PIN curto

function paraBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function deBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function derivarHash(pin, saltBytes) {
  const enc = new TextEncoder();
  const chaveBase = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: ITERACOES_PBKDF2, hash: "SHA-256" },
    chaveBase,
    256
  );
  return paraBase64(bits);
}

// salva (ou substitui) o PIN de recuperação para um usuário específico neste aparelho
export async function definirPinLocal(userId, pin) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivarHash(pin, saltBytes);
  await gravarMeta(`pinLocal:${userId}`, { hash, salt: paraBase64(saltBytes) });
}

// true/false — confere o PIN digitado contra o hash salvo, sem nunca comparar em texto puro
export async function conferirPinLocal(userId, pin) {
  const valor = await lerMeta(`pinLocal:${userId}`);
  if (!valor) return false;
  const { hash, salt } = valor;
  const tentativa = await derivarHash(pin, deBase64(salt));
  return tentativa === hash;
}

// true se esse usuário já tem um PIN configurado neste aparelho
export async function temPinLocal(userId) {
  const valor = await lerMeta(`pinLocal:${userId}`);
  return !!valor;
}

// remove o PIN local (ex.: ao trocar de aparelho ou se a pessoa preferir desativar)
export async function removerPinLocal(userId) {
  await gravarMeta(`pinLocal:${userId}`, null);
}
