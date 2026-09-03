// src/lib/supabaseClient.js
// Cria o client do Supabase a partir das variáveis de ambiente. Se elas não
// estiverem configuradas (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), o app
// continua funcionando 100% localmente — a sincronização simplesmente fica
// desativada (ver src/lib/sync.js), em vez de quebrar o app.
//
// Como configurar:
//   1) Crie um projeto em https://supabase.com
//   2) Rode o arquivo supabase/schema.sql no SQL Editor do projeto
//   3) Copie .env.example para .env.local e preencha as duas variáveis
//      com os valores em Project Settings → API do seu projeto Supabase
//   4) Reinicie `npm run dev` (ou o deploy na Vercel, com as mesmas
//      variáveis configuradas em Project Settings → Environment Variables)

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigurado = Boolean(url && anonKey);

export const supabase = supabaseConfigurado
  ? createClient(url, anonKey)
  : null;

// Cliente Supabase SEPARADO, usado só para o Administrador criar a conta de
// um novo usuário (Usuários > Adicionar). É essencial que seja uma instância
// à parte: chamar signUp() no MESMO cliente que o Administrador está logado
// trocaria a sessão ativa para a conta recém-criada (derrubando o
// Administrador sem querer). Com "persistSession: false" e uma chave de
// armazenamento própria, essa instância nunca toca na sessão principal.
export const supabaseParaCriarUsuario = supabaseConfigurado
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: "visaorepro-criacao-usuario" },
    })
  : null;

if (!supabaseConfigurado && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(
    "[VisãoRepro] Supabase não configurado — rodando só localmente (offline). " +
    "Veja src/lib/supabaseClient.js para ativar a sincronização entre usuários."
  );
}
