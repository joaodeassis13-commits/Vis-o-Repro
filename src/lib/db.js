// src/lib/db.js
// Banco local (IndexedDB, via Dexie) — é aqui que os dados ficam salvos de
// verdade no aparelho, sobrevivendo a fechar o app, reiniciar o celular ou
// perder o sinal. O app inteiro (App.jsx) lê os dados daqui na abertura e
// grava aqui a cada alteração; a sincronização com o Supabase (src/lib/sync.js)
// é uma camada por cima disso, não o contrário — o app SEMPRE funciona
// primeiro localmente, com ou sem internet.

import Dexie from "dexie";

export const db = new Dexie("visaorepro");

// v1: uma "tabela" (object store) por coleção do app, todas indexadas por
// "id" (chave primária) — os ids já são gerados no cliente (uid()), então
// não há conflito ao sincronizar depois. "outbox" guarda a fila de
// alterações feitas offline, aguardando envio ao Supabase.
db.version(1).stores({
  usuarios: "id",
  fazendas: "id",
  retiros: "id, fazendaId",
  safras: "id, fazendaId",
  lotes: "id, fazendaId, safraId",
  insumos: "id, fazendaId",
  manejos: "id, fazendaId, safraId",
  movimentos: "id, fazendaId",
  agendamentos: "id, fazendaId",
  sugestoesRessinc: "id, fazendaId",
  rascunhos: "chave",
  outbox: "++seq, tabela, criadoEm",
  meta: "chave", // guarda coisas avulsas, ex: { chave: "currentUserId", valor: "..." }
});

// v2: "protocolos padrão" (modelos de D0/Retirada) — Dexie mantém as tabelas
// já existentes da v1 automaticamente, só é preciso declarar o que é novo.
db.version(2).stores({
  protocolosPadrao: "id, fazendaId, manejo",
});

// v3: "sugestões de Repasse" (nascem do Diagnóstico, aguardam confirmação em Repasse)
db.version(3).stores({
  sugestoesRepasse: "id, fazendaId",
});

// ---------- leitura de tudo, usada uma vez ao abrir o app ----------
export async function carregarTudo() {
  const [
    usuarios, fazendas, retiros, safras, lotes, insumos, manejos,
    movimentos, agendamentos, sugestoesRessinc, sugestoesRepasse, protocolosPadrao, rascunhosArr,
  ] = await Promise.all([
    db.usuarios.toArray(),
    db.fazendas.toArray(),
    db.retiros.toArray(),
    db.safras.toArray(),
    db.lotes.toArray(),
    db.insumos.toArray(),
    db.manejos.toArray(),
    db.movimentos.toArray(),
    db.agendamentos.toArray(),
    db.sugestoesRessinc.toArray(),
    db.sugestoesRepasse.toArray(),
    db.protocolosPadrao.toArray(),
    db.rascunhos.toArray(),
  ]);
  const rascunhos = Object.fromEntries(rascunhosArr.map((r) => [r.chave, r.valor]));
  return { usuarios, fazendas, retiros, safras, lotes, insumos, manejos, movimentos, agendamentos, sugestoesRessinc, sugestoesRepasse, protocolosPadrao, rascunhos };
}

// ---------- grava uma coleção inteira (substitui o conteúdo da tabela) ----------
// Simples e robusto o bastante para o volume de dados de uma fazenda; se o
// app crescer muito, trocar por updates incrementais por id.
export async function gravarColecao(tabela, itens) {
  await db.table(tabela).clear();
  if (itens && itens.length > 0) await db.table(tabela).bulkAdd(itens);
}

export async function gravarRascunhos(rascunhos) {
  await db.rascunhos.clear();
  const linhas = Object.entries(rascunhos || {}).map(([chave, valor]) => ({ chave, valor }));
  if (linhas.length > 0) await db.rascunhos.bulkAdd(linhas);
}

export async function lerMeta(chave) {
  const row = await db.meta.get(chave);
  return row?.valor ?? null;
}
export async function gravarMeta(chave, valor) {
  await db.meta.put({ chave, valor });
}

// ---------- fila de sincronização (outbox) ----------
// Cada chamada representa "isto precisa ser enviado ao Supabase quando
// houver internet". sync.js consome essa fila.
export async function enfileirar(tabela, operacao, payload) {
  await db.outbox.add({ tabela, operacao, payload, criadoEm: new Date().toISOString() });
}
export async function contarPendentes() {
  return db.outbox.count();
}
export async function listarPendentes() {
  return db.outbox.orderBy("seq").toArray();
}
export async function removerDaFila(seq) {
  await db.outbox.delete(seq);
}
