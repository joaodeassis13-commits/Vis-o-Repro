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

// "usuarios.id" precisa ser um uuid de verdade (o mesmo do Supabase Auth) — diferente de
// quase todas as outras tabelas, que usam um id de texto gerado no cliente. Um registro de
// usuário com id inválido (ex.: criado offline, num bug já corrigido) não pode ser
// sincronizado — mas não pode travar o envio dos demais usuários válidos também.
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  exclusoes: "exclusoes",
};

// campos que existem só no app (derivados/locais) e nunca devem ser enviados
// ao Supabase — enviar um campo que não existe como coluna quebra o upsert
// inteiro daquela tabela.
const CAMPOS_SO_LOCAIS = {
  // a autorização de verdade mora na tabela usuario_fazendas; este campo no
  // app é só um espelho local para exibição/edição na tela de Usuários.
  usuarios: ["fazendasAutorizadas"],
};

// coleções cuja tabela exige "criado_em" preenchido (not null) — usado como rede de
// segurança abaixo, pra nunca travar a sincronização por falta desse campo, seja qual
// for a coleção ou o motivo dele estar faltando.
const COLECOES_COM_CRIADO_EM = new Set([
  "usuarios", "fazendas", "retiros", "safras", "lotes", "insumos", "manejos",
  "movimentos", "agendamentos", "sugestoesRessinc", "sugestoesRepasse", "protocolosPadrao",
]);

// campos "not null default X" que foram adicionados numa tabela DEPOIS que ela já tinha
// registros — sem essa lista, ao enviar a coleção inteira num único lote, um registro
// antigo que nunca teve esse campo (undefined no lado do app) é interpretado pelo Supabase
// como "definir como vazio" (não como "usar o padrão"), e a linha toda falha com
// "violates not-null constraint" mesmo a coluna tendo um padrão definido no banco.
// Isso NÃO tem a ver com o campo em si ser opcional — é sobre registros antigos que nunca
// tiveram a chance de recebê-lo. Sempre que um campo assim for criado no futuro, basta
// adicionar aqui (coleção -> { campo: valorPadrão }).
const CAMPOS_COM_PADRAO_OBRIGATORIO = {
  manejos: { detalhes: [], animaisLidos: [], medicamentos: [], atualizadoEm: () => new Date().toISOString() },
  safras: { lancamentosDesabilitados: false },
};

function aplicarPadroesObrigatorios(colecao, itens) {
  const padroes = CAMPOS_COM_PADRAO_OBRIGATORIO[colecao];
  if (!padroes) return itens;
  return itens.map((item) => {
    let alterado = null;
    for (const [campo, valorPadrao] of Object.entries(padroes)) {
      if (item[campo] === undefined) {
        alterado = alterado || { ...item };
        alterado[campo] = typeof valorPadrao === "function" ? valorPadrao() : valorPadrao;
      }
    }
    return alterado || item;
  });
}

// coleções onde dois aparelhos DIFERENTES podem editar o MESMO registro (por id) enquanto
// ambos estão offline — sem isso, o sistema de sincronização usa "quem enviar por último
// vence" simplesmente por ORDEM DE ENVIO, o que não tem nada a ver com qual edição é
// realmente mais recente. Aqui comparamos pelo horário de fato de cada edição
// ("atualizadoEm"), e quem editou por último de verdade é quem vence — não quem sincronizou
// primeiro. Cada entrada aponta pro nome da coluna correspondente no banco.
const COLECOES_COM_PROTECAO_DE_CONFLITO = {
  manejos: "atualizado_em",
};

async function resolverConflitosPorTimestamp(colecao, itens) {
  const colunaTimestamp = COLECOES_COM_PROTECAO_DE_CONFLITO[colecao];
  if (!colunaTimestamp || !supabaseConfigurado) return { itens, conflitos: [] };
  const ids = itens.map((item) => item.id).filter(Boolean);
  if (ids.length === 0) return { itens, conflitos: [] };
  const tabela = TABELAS[colecao];
  const { data, error } = await supabase.from(tabela).select(`id, ${colunaTimestamp}`).in("id", ids);
  if (error || !data) return { itens, conflitos: [] }; // se a checagem falhar, segue o envio normal — não trava a sincronização por causa disso
  const timestampNoServidor = {};
  data.forEach((linha) => { timestampNoServidor[linha.id] = linha[colunaTimestamp]; });
  const conflitos = [];
  const itensSemConflito = itens.filter((item) => {
    const doServidor = timestampNoServidor[item.id];
    const local = item.atualizadoEm;
    // só é conflito de verdade se AMBOS os horários existirem e o do servidor for MAIS
    // recente que o que este aparelho tinha quando editou — sem isso (item novo, ou
    // servidor sem esse campo ainda), envia normalmente.
    if (doServidor && local && new Date(doServidor) > new Date(local)) { conflitos.push(item.id); return false; }
    return true;
  });
  return { itens: itensSemConflito, conflitos };
}

// ---------- envia (upsert) uma coleção inteira ----------
async function enviarColecao(colecao, itens) {
  if (!supabaseConfigurado || !itens || itens.length === 0) return { ok: true, enviados: 0 };
  const tabela = TABELAS[colecao];
  if (!tabela) return { ok: true, enviados: 0 };
  const remover = CAMPOS_SO_LOCAIS[colecao] || [];

  let validos = itens;
  let invalidos = [];
  if (colecao === "usuarios") {
    validos = itens.filter((u) => REGEX_UUID.test(u.id));
    invalidos = itens.filter((u) => !REGEX_UUID.test(u.id));
  }
  // "criado_em" é obrigatório (not null) em várias tabelas; um registro sem esse campo
  // (de qualquer coleção, criado antes de alguma correção, ou por um bug futuro) travaria
  // o lote inteiro daquela tabela — preenche na hora do envio em vez de bloquear tudo.
  if (COLECOES_COM_CRIADO_EM.has(colecao)) {
    validos = validos.map((item) => (item.criadoEm ? item : { ...item, criadoEm: new Date().toISOString() }));
  }
  // "manejos" já teve uma versão que gravava "numeroManejos"/"duracaoProtocolo" (nomes que
  // nunca existiram como coluna no banco — o certo sempre foi "tipoManejo"/"protocolo",
  // reaproveitando as colunas de D0/Ressinc). Registros importados antes dessa correção podem
  // continuar com os nomes antigos localmente; converte na hora do envio pra nunca mais travar
  // por causa disso, sem precisar que ninguém reimporte a planilha.
  if (colecao === "manejos") {
    validos = validos.map((item) => {
      if (item.numeroManejos === undefined && item.duracaoProtocolo === undefined) return item;
      const { numeroManejos, duracaoProtocolo, ...resto } = item;
      return { ...resto, tipoManejo: resto.tipoManejo || numeroManejos || null, protocolo: resto.protocolo || duracaoProtocolo || null };
    });
  }
  validos = aplicarPadroesObrigatorios(colecao, validos);
  // "usuarios.login" é único no banco — se dois usuários (criados em aparelhos diferentes,
  // antes de sincronizar entre si) acabaram com o mesmo login (ex.: e-mails com o mesmo
  // prefixo antes do @), o envio inteiro falhava. Desempata na hora do envio, sem apagar
  // nem misturar os dois usuários — só o login duplicado (o mais recente) ganha um sufixo.
  if (colecao === "usuarios") {
    const loginsVistos = new Set();
    validos = [...validos].sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || "")).map((item) => {
      if (!item.login || !loginsVistos.has(item.login)) { loginsVistos.add(item.login); return item; }
      let novoLogin = `${item.login}.${Math.random().toString(36).slice(2, 7)}`;
      while (loginsVistos.has(novoLogin)) novoLogin = `${item.login}.${Math.random().toString(36).slice(2, 7)}`;
      loginsVistos.add(novoLogin);
      return { ...item, login: novoLogin };
    });
  }
  // se outro aparelho editou o MESMO registro mais recentemente (enquanto ambos offline),
  // não sobrescreve — a busca que acontece logo depois do envio já traz a versão mais nova.
  const { itens: itensSemConflito, conflitos } = await resolverConflitosPorTimestamp(colecao, validos);
  validos = itensSemConflito;
  const avisoInvalidos = invalidos.length > 0
    ? `${invalidos.length} usuário(s) com id inválido não sincronizado(s): ${invalidos.map((u) => u.nome || u.id).join(", ")}. Exclua e recrie esse(s) usuário(s).`
    : null;
  if (validos.length === 0) {
    return avisoInvalidos ? { ok: false, erro: avisoInvalidos, conflitos } : { ok: true, enviados: 0, conflitos };
  }

  const linhas = validos.map((item) => {
    const limpo = { ...item };
    remover.forEach((campo) => delete limpo[campo]);
    return linhaParaSupabase(limpo);
  });
  const { error } = await supabase.from(tabela).upsert(linhas, { onConflict: "id" });
  if (error) return { ok: false, erro: error.message, conflitos };
  if (avisoInvalidos) return { ok: false, enviados: linhas.length, erro: avisoInvalidos, conflitos };
  return { ok: true, enviados: linhas.length, conflitos };
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
    if (!u.id || !REGEX_UUID.test(u.id)) continue; // id inválido: nem tenta, já foi avisado em enviarColecao
    // "fazendasAutorizadas" ausente (undefined) é diferente de "vazio de propósito" ([]) — o
    // primeiro caso significa "o app não sabe essa lista ainda" (ex.: perfil recém-resolvido
    // de um jeito incompleto) e NUNCA deve apagar a autorização real que já existe no
    // servidor; só uma lista efetivamente vazia (o usuário genuinamente sem fazenda nenhuma)
    // deve resultar em remover tudo.
    if (u.fazendasAutorizadas === undefined) continue;
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
// mescla o que veio do servidor com o que já existia localmente: o servidor manda pra quem
// já existe nos dois lados (é a versão mais atual), mas qualquer registro que exista SÓ
// localmente (porque o envio dele falhou nesta ou em alguma sincronização anterior) é
// mantido — nunca é apagado só porque ainda não chegou ao servidor. Sem isso, uma falha de
// envio (de qualquer motivo) faria a busca seguinte, da mesma sincronização, sobrescrever
// os dados locais com uma lista incompleta, apagando localmente o que nunca tinha ido pro ar.
function mesclarComLocal(local, doServidor) {
  if (!doServidor) return local || [];
  if (!local || local.length === 0) return doServidor;
  const idsDoServidor = new Set(doServidor.map((item) => item.id));
  const somenteLocais = local.filter((item) => item.id && !idsDoServidor.has(item.id));
  return [...doServidor, ...somenteLocais];
}

export async function sincronizar(estado) {
  if (!supabaseConfigurado) {
    return { ok: false, motivo: "Supabase não configurado. Veja src/lib/supabaseClient.js." };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { ok: false, motivo: "Sem conexão com a internet." };
  }

  const erros = [];

  // busca as lápides ANTES de mais nada — precisa saber o que já foi apagado em outros
  // aparelhos antes de enviar qualquer coleção, senão o envio mandaria de volta pro servidor
  // algo que este aparelho ainda não sabe que foi apagado (a "ressurreição" que esse mecanismo
  // inteiro existe pra evitar). idsApagados junta o que já sabíamos localmente com o que
  // acabou de vir do servidor — nunca "esquece" uma lápide, só acumula.
  const resultadoExclusoesBusca = await buscarColecao("exclusoes");
  const exclusoesConhecidas = resultadoExclusoesBusca.ok
    ? mesclarComLocal(estado.exclusoes, resultadoExclusoesBusca.itens)
    : (estado.exclusoes || []);
  if (!resultadoExclusoesBusca.ok) erros.push(`exclusoes: ${resultadoExclusoesBusca.erro}`);
  const idsApagados = new Set(exclusoesConhecidas.map((e) => e.id));

  const conflitosPorColecao = [];
  for (const colecao of Object.keys(TABELAS)) {
    if (colecao === "exclusoes") { estado = { ...estado, exclusoes: exclusoesConhecidas }; continue; }
    // nunca reenvia algo que já sabemos ter sido apagado (por este aparelho ou por outro)
    const itensSemApagados = (estado[colecao] || []).filter((item) => !item.id || !idsApagados.has(item.id));
    const resultado = await enviarColecao(colecao, itensSemApagados);
    if (!resultado.ok) erros.push(`${colecao}: ${resultado.erro}`);
    if (resultado.conflitos?.length > 0) conflitosPorColecao.push(`${colecao} (${resultado.conflitos.length})`);
  }
  // envia as lápides por último — depois de já ter usado a lista mesclada pra filtrar o envio
  // acima, evita qualquer condição de corrida entre "ler exclusões" e "enviar exclusões".
  const resultadoExclusoesEnvio = await enviarColecao("exclusoes", exclusoesConhecidas);
  if (!resultadoExclusoesEnvio.ok) erros.push(`exclusoes: ${resultadoExclusoesEnvio.erro}`);

  const resultadoAutorizEnvio = await enviarAutorizacoes(estado.usuarios);
  if (!resultadoAutorizEnvio.ok) (resultadoAutorizEnvio.erros || []).forEach((e) => erros.push(`autorizações: ${e}`));

  const atualizado = { exclusoes: exclusoesConhecidas };
  for (const colecao of Object.keys(TABELAS)) {
    if (colecao === "exclusoes") continue;
    const resultado = await buscarColecao(colecao);
    if (resultado.ok) {
      const mesclado = mesclarComLocal(estado[colecao], resultado.itens);
      // remove do resultado final qualquer item que, entre o momento em que lemos as lápides
      // (lá em cima) e agora, tenha sido apagado — cobre o caso raro de a exclusão ter
      // acontecido em outro aparelho bem no meio desta sincronização.
      atualizado[colecao] = mesclado.filter((item) => !item.id || !idsApagados.has(item.id));
    } else {
      erros.push(`${colecao}: ${resultado.erro}`);
    }
  }

  // aplica as autorizações atualizadas em cima dos usuários já buscados (e já mesclados
  // com os locais) — é assim que "fazendasAutorizadas" volta a existir nos dados locais.
  const resultadoAutorizBusca = await buscarAutorizacoes();
  if (resultadoAutorizBusca.ok) {
    if (atualizado.usuarios) {
      atualizado.usuarios = atualizado.usuarios.map((u) => ({ ...u, fazendasAutorizadas: resultadoAutorizBusca.mapa[u.id] || u.fazendasAutorizadas || [] }));
    }
  } else {
    erros.push(`autorizações: ${resultadoAutorizBusca.erro}`);
  }

  return {
    ok: erros.length === 0, erros, atualizado, sincronizadoEm: new Date().toISOString(),
    // não é um erro — é o sistema funcionando: outro aparelho editou o(s) mesmo(s) registro(s)
    // mais recentemente, então a versão dele foi mantida em vez de ser sobrescrita por esta
    // sincronização. A busca acima já trouxe a versão mais nova pra este aparelho também.
    aviso: conflitosPorColecao.length > 0
      ? `Alguns registros foram editados por outro aparelho mais recentemente e não foram sobrescritos: ${conflitosPorColecao.join(", ")}.`
      : null,
  };
}

// ---------- exclui um registro de verdade no Supabase (não só localmente) ----------
// Necessário porque a sincronização (mesclarComLocal, acima) sempre preserva o que existe
// só localmente — se um registro fosse só removido do estado local, sem avisar o servidor,
// a próxima sincronização traria ele de volta. Além de apagar a linha, grava uma "lápide"
// (tabela exclusoes) — é ela quem impede outro aparelho, que ainda tenha esse mesmo registro
// guardado localmente, de reenviá-lo de volta na sincronização dele.
export async function excluirRegistro(colecao, id) {
  if (!supabaseConfigurado) return { ok: true }; // nada pra apagar no servidor se não tem Supabase
  const tabela = TABELAS[colecao];
  if (!tabela) return { ok: true };
  const { error } = await supabase.from(tabela).delete().eq("id", id);
  if (error) return { ok: false, erro: error.message };
  // a lápide é best-effort — se essa segunda escrita falhar (ex.: caiu a conexão bem nesse
  // instante), a exclusão principal acima já valeu; a lápide em si também será reenviada
  // normalmente na próxima sincronização (ela mora no estado local igual qualquer coleção).
  await supabase.from("exclusoes").upsert({ id, tabela: colecao, apagado_em: new Date().toISOString() });
  return { ok: true };
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
    // busca também as fazendas autorizadas — sem isso, o perfil resolvido ficava sem esse
    // campo (undefined), e a sincronização seguinte, ao enviar esse usuário de volta,
    // apagava de verdade a autorização real que já existia no servidor (interpretando a
    // ausência do campo como "esse usuário não tem fazenda nenhuma").
    const { data: autorizacoes, error: erroAutoriz } = await supabase.from("usuario_fazendas").select("fazenda_id").eq("usuario_id", userId);
    const fazendasAutorizadas = erroAutoriz ? undefined : (autorizacoes || []).map((r) => r.fazenda_id);
    return { ok: true, perfil: { ...linhaDoSupabase(data), fazendasAutorizadas } };
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
