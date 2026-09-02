# Como abrir o VisãoRepro no celular (offline + sincronização)

## O que já funciona hoje, sem nenhuma configuração extra

- **Funciona sem internet.** Todos os dados (fazendas, lotes, manejos,
  estoque, agenda) ficam salvos de verdade no aparelho (IndexedDB), não só
  na memória da aba. Fechar o app, reiniciar o celular, ficar sem sinal —
  os dados continuam lá quando você reabrir.
- **Abre sem internet.** O app é instalável (PWA) e guarda em cache o
  "esqueleto" (telas, botões, estilos) para abrir mesmo com o celular no
  modo avião.
- **Sincronização entre usuários/celulares é opcional** — só passa a
  funcionar depois que você configurar o Supabase (passo 3 abaixo). Sem
  isso, cada celular guarda seus próprios dados localmente, sem trocar
  informação com outros usuários.

## Passo 1 — Publicar o app (Vercel)

1. Suba esta pasta para um repositório no [GitHub](https://github.com)
   (pelo próprio site, "Add file → Upload files" — não precisa saber Git).
2. Em [vercel.com](https://vercel.com), "Add New → Project", escolha esse
   repositório e clique em "Deploy". Você recebe um link tipo
   `https://visaorepro.vercel.app`.

## Passo 2 — Instalar no celular

Abra o link no navegador do celular:
- **Android (Chrome):** três pontinhos → "Adicionar à tela inicial" /
  "Instalar aplicativo".
- **iPhone (Safari):** ícone de compartilhar → "Adicionar à Tela de Início".

A partir daqui, o app já funciona offline com dados salvos — pode testar em
campo sem sinal.

## Passo 3 — Ativar sincronização entre usuários (opcional)

Sem isso, cada celular é uma "ilha" — funciona sozinho, mas não troca dados
com outros usuários. Para conectar vários celulares/usuários:

1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. No projeto, abra o "SQL Editor" e rode o conteúdo do arquivo
   `supabase/schema.sql` (incluso nesta pasta) — ele cria todas as tabelas.
3. Em "Project Settings → API", copie a "Project URL" e a chave "anon
   public".
4. Na Vercel: "Project Settings → Environment Variables", adicione:
   - `VITE_SUPABASE_URL` = a Project URL que você copiou
   - `VITE_SUPABASE_ANON_KEY` = a chave anon public
5. Faça um novo deploy (a Vercel pergunta se quer "Redeploy" — clique).
6. No app, na barra lateral, vai aparecer o botão **"Sincronizar agora"**.
   Cada usuário que clicar nele envia seus dados locais para o Supabase e
   recebe os dados mais recentes de volta.

**Importante sobre este primeiro momento da sincronização:** hoje ela
funciona sob demanda (você clica em "Sincronizar agora" quando a internet
estiver disponível) — não é automática/em tempo real ainda. Para uso em
campo com sinal instável, isso é o comportamento certo: cada operador
trabalha offline à vontade, e sincroniza quando chegar perto de um Wi-Fi ou
tiver sinal de novo.

**Login:** hoje o login continua sendo uma lista de usuários local a cada
celular (sem senha real de verdade) — para autenticação de verdade
compartilhada entre celulares, o próximo passo é trocar isso por
`supabase.auth`, como descrito em `ARQUITETURA.md`.

## Testando localmente antes de publicar (opcional)

```bash
npm install
cp .env.example .env.local   # preencha se for testar a sincronização
npm run dev -- --host
```

O terminal mostra um endereço tipo `http://192.168.0.X:5173` — digite no
navegador do celular (mesma rede Wi-Fi do computador).

## Atualizações depois de publicado

Toda alteração de código enviada ao GitHub é publicada automaticamente pela
Vercel em menos de um minuto. O ícone instalado no celular continua o
mesmo — ele atualiza sozinho na próxima vez que o app for aberto com
internet.
