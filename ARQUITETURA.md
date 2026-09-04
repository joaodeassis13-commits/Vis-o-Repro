# VArepro

Controle de inseminação artificial de bovinos (IATF) — cadastros, manejos
(Indução, D0, Retirada, Inseminação, Diagnóstico, Diagnóstico Final, Ressinc),
agenda, estoque, exportações e relatórios.

## Estado atual

`visaorepro.jsx` é um protótipo funcional completo, em um único componente
React, com todo o estado em memória (`useState`). Não há backend nem
persistência entre sessões. É o ponto de partida para o projeto real descrito
abaixo.

## Roteiro de migração

### 1. Estrutura do projeto

```
visaorepro/
├── src/
│   ├── lib/
│   │   ├── supabaseClient.js   # cria o client do Supabase (ver abaixo)
│   │   ├── db.js               # wrapper do IndexedDB (Dexie.js recomendado)
│   │   └── sync.js             # fila de sincronização (outbox)
│   ├── hooks/
│   │   ├── useFazendas.js
│   │   ├── useLotes.js
│   │   ├── useManejos.js
│   │   ├── useEstoque.js
│   │   └── useAgenda.js
│   ├── components/
│   │   └── Aba*.jsx            # um arquivo por Aba* já existente em visaorepro.jsx
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   └── schema.sql              # schema inicial (incluso neste pacote)
├── package.json
├── vite.config.js
└── .env.local                  # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

Comece criando o projeto com Vite:

```bash
npm create vite@latest visaorepro -- --template react
cd visaorepro
npm install @supabase/supabase-js dexie lucide-react xlsx
```

Copie `visaorepro.jsx` para dentro de `src/`, e vá quebrando cada componente
`Aba*` (já isolados no arquivo original) em seu próprio arquivo dentro de
`src/components/`.

### 2. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Rode `supabase/schema.sql` (incluso) no SQL Editor do projeto — ele cria
   as tabelas espelhando as coleções do app (fazendas, retiros, safras,
   lotes, insumos, movimentos, manejos, agendamentos, sugestões de ressinc,
   usuários) e ativa RLS por `fazenda_id`.
3. Em `src/lib/supabaseClient.js`:

   ```js
   import { createClient } from '@supabase/supabase-js';

   export const supabase = createClient(
     import.meta.env.VITE_SUPABASE_URL,
     import.meta.env.VITE_SUPABASE_ANON_KEY
   );
   ```

4. Troque o login mockado (`currentUser` local) por `supabase.auth`. Perfil
   (Administrador/Supervisor/Inseminador) e fazendas autorizadas passam a
   viver numa tabela `usuarios` ligada a `auth.users` (já prevista no schema).

### 3. Offline-first

- Cada escrita do app (hoje um `setX(...)` + `marcaPendencia()`) passa a:
  1. Gravar no IndexedDB local (via Dexie.js) — funciona sem internet.
  2. Empilhar um evento na tabela `outbox` local: `{ id, tabela, operacao,
     payload, criadoEm, sincronizado }`.
- O contador "pendências" que já existe na barra lateral do app passa a
  refletir o tamanho real dessa fila, em vez de ser simulado.
- Ao voltar a ficar online, `sync.js` percorre a `outbox` em ordem e faz
  `upsert` de cada item no Supabase (por `id`, gerado no cliente via `uid()`
  — já assim no protótipo, o que evita duplicidade). Marcar como sincronizado
  ao concluir, ou usar Supabase Realtime para refletir mudanças de outros
  usuários automaticamente.
- Conflitos: "last write wins" é suficiente dado o padrão de uso (um
  operador por lote/sessão).

### 4. PWA (app instalável, funciona offline)

```bash
npm install -D vite-plugin-pwa
```

Configurar `vite-plugin-pwa` no `vite.config.js` para cache do app shell —
os dados em si continuam vindo do IndexedDB local, não do cache do service
worker.

### 5. Git + Deploy (Vercel)

```bash
git init
git add .
git commit -m "Migração inicial do protótipo VArepro"
git remote add origin <url-do-repositorio>
git push -u origin main
```

Na [Vercel](https://vercel.com):
1. "Import Project" apontando para o repositório.
2. Framework preset: Vite.
3. Variáveis de ambiente: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   (nunca a `service_role` key no front-end).
4. Cada push na branch principal faz deploy automático.

### 6. Leitura de brinco por câmera (OCR)

O botão de câmera já existe em todas as telas de leitura de animal e hoje
só captura a foto. Para reconhecimento automático do número:
- Opção simples: um serviço de OCR (ex. Google Cloud Vision, Tesseract.js
  rodando no cliente) que recebe a foto e devolve o texto lido, preenchendo
  o campo de identificação automaticamente.
- Como o app já é offline-first, considerar um modelo local (Tesseract.js)
  para funcionar sem internet, com fallback para um serviço em nuvem quando
  online.
