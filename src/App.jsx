import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  Users, Home, Building2, Layers, FlaskConical, Droplet, Syringe,
  ClipboardList, Stethoscope, Warehouse, ArrowDownToLine, ArrowUpFromLine,
  LogOut, Plus, Trash2, ScanLine, Wifi, WifiOff, Download, ChevronRight,
  Tag, Package, CheckCircle2, Circle, X, Search, FileDown,
  Calendar, CalendarClock, Bell, Check, XCircle, Pencil, Save, Camera, CloudOff, RefreshCw, Menu, TrendingUp, Upload
} from "lucide-react";
import { carregarTudo, gravarColecao, gravarRascunhos } from "./lib/db.js";
import { sincronizar, buscarPerfilProprio } from "./lib/sync.js";
import { buscarBenchmarkTaxaPrenhezSistema } from "./lib/benchmarking.js";
import { supabaseConfigurado } from "./lib/supabaseClient.js";
import { entrar, sair, obterSessao, escutarMudancaAuth, criarUsuario } from "./lib/auth.js";
import logoImg from "./assets/logo.png";

/* ---------------------------------------------------------------
   VISÃOREPRO — controle de inseminação artificial de bovinos

   ARQUITETURA ATUAL (este arquivo)
   Todo o estado vive em memória, no componente <App/> (useState),
   com um contador de "pendências" (marcaPendencia) que já é chamado
   em toda escrita de dado do sistema — cadastros, manejos, estoque,
   agenda. O botão Online/Offline na barra lateral simula o modo
   offline hoje (só acumula um contador); ele é o ponto de entrada
   para a sincronização real, descrita abaixo.

   PRÓXIMOS PASSOS — Offline + Supabase + Git + Vercel
   ----------------------------------------------------------------
   1) BANCO LOCAL (offline-first)
      - Trocar o useState puro por um hook de persistência local
        (IndexedDB via idb ou Dexie.js) espelhando cada coleção já
        existente aqui: fazendas, retiros, safras, lotes, insumos,
        movimentos, manejos, agendamentos, sugestoesRessinc,
        rascunhos, usuários.
      - Cada escrita (setLotes, setManejos, ...) passa a: (a) gravar
        no IndexedDB imediatamente (funciona sem internet) e (b)
        empilhar um evento numa fila de sincronização (tabela
        "outbox": { id, tabela, operacao, payload, criadoEm,
        sincronizado }). O contador "pendencias" hoje já mede
        exatamente isso — é só trocar sua fonte para o tamanho real
        dessa fila.

   2) SUPABASE (Postgres + Auth + Realtime)
      - Uma tabela por coleção acima, todas com fazenda_id (FK) e
        RLS (row-level security) filtrando por fazenda_id conforme
        as fazendas autorizadas do usuário logado (equivalente ao
        fazendasAutorizadas de hoje).
      - Autenticação: trocar o login mockado (currentUser local) por
        supabase.auth — o perfil (Administrador/Supervisor/
        Inseminador) e as fazendas autorizadas passam a viver numa
        tabela "usuarios" ligada a auth.users.
      - Sincronização: ao voltar a ficar online, percorrer a fila
        "outbox" em ordem e fazer upsert em cada tabela do Supabase;
        marcar cada item como sincronizado (ou usar Supabase
        Realtime para já refletir mudanças de outros usuários/
        dispositivos automaticamente).
      - Conflitos: como cada manejo tem um "id" gerado no cliente
        (uid()), upsert por id evita duplicidade; para edições
        concorrentes, "last write wins" por enquanto é suficiente
        dado o padrão de uso (um operador por lote/sessão).

   3) ESTRUTURA DE PROJETO (Git)
      Este arquivo hoje é um componente único para facilitar a
      iteração. Ao migrar para um repositório real, dividir em:
        src/
          lib/supabaseClient.js      (cria o client do Supabase)
          lib/db.js                  (wrapper do IndexedDB/outbox)
          lib/sync.js                (fila de sincronização)
          hooks/useFazendas.js, useManejos.js, ...  (um por coleção)
          components/Aba*.jsx        (um arquivo por Aba* já existente
                                       aqui — a divisão de componentes
                                       já está pronta, é só extrair)
          App.jsx
        package.json, vite.config.js (ou next.config.js)
      Um README.md e um supabase/schema.sql ficam junto com este
      arquivo em /mnt/user-data/outputs como ponto de partida.

   4) DEPLOY (Vercel)
      - Vite + React (ou Next.js) buildam para estático; conectar o
        repositório Git à Vercel faz deploy automático a cada push.
      - Variáveis de ambiente na Vercel: VITE_SUPABASE_URL e
        VITE_SUPABASE_ANON_KEY (nunca a service_role key no front-end).
      - PWA: registrar um service worker (ex.: vite-plugin-pwa) para
        cache do app shell, permitindo abrir o app mesmo sem rede —
        os dados em si continuam vindo do IndexedDB local.

   Nada disso está implementado ainda dentro deste arquivo — ele
   continua funcionando 100% em memória, como protótipo. Esta nota
   é o mapa para quando o projeto for migrado para um repositório
   com backend de verdade.
----------------------------------------------------------------*/

const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
// converte texto digitado pelo usuário (aceita vírgula OU ponto como separador decimal) em número
const numBR = (v) => Number(String(v ?? "").trim().replace(",", "."));
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// formata uma chave de mês "aaaa-mm" (usada para agrupar a Concepção por data de
// inseminação quando a visão está em "Por mês") para "mm/aaaa".
const fmtMes = (chaveAnoMes) => {
  const [y, m] = chaveAnoMes.split("-");
  return `${m}/${y}`;
};

const resumoMedicamentos = (arr, insumos) => {
  if (!arr || arr.length === 0) return "—";
  return arr.map((m) => {
    const item = insumos.find((i) => i.id === m.medicamentoId);
    return `${item?.produtoComercial || "?"} (${m.dose} ${item?.unidadeEmbalagem || ""})`;
  }).join(", ");
};

/* ---------- dados iniciais de demonstração ---------- */

const seedFazendas = [
  { id: uid("faz"), nome: "Fazenda Santa Fé", municipio: "Querência - MT", areaTotal: "3200", proprietario: "José Martins", responsavel: "Carlos Andrade", telefone: "(66) 99911-2233" },
];

const seedUsers = [
  { id: uid("u"), nome: "Marcos Vieira", login: "marcos", perfil: "Administrador", fazendasAutorizadas: [] },
  { id: uid("u"), nome: "Carlos Andrade", login: "carlos", perfil: "Inseminador", fazendasAutorizadas: [seedFazendas[0].id] },
  { id: uid("u"), nome: "Renata Souza", login: "renata", perfil: "Supervisor", fazendasAutorizadas: [seedFazendas[0].id] },
];

/* Pré-cadastro de insumos só para agilizar testes (versão de teste) — cobre um exemplo de cada
   hormônio, um sêmen, alguns medicamentos e utensílios, todos no Estoque da fazenda seed. */
const seedInsumos = [
  // Hormônios
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "CIDR", hormonio: "Progesterona", tamanhoEmbalagem: 1, unidadeEmbalagem: "unid", quantidade: 20, estoque: 20, valorUnitario: 32.9, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "Sincrogest", hormonio: "Progesterona injetável", tamanhoEmbalagem: 10, unidadeEmbalagem: "mL", quantidade: 15, estoque: 15, valorUnitario: 18.5, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "Sincrocio", hormonio: "Prostaglandina", tamanhoEmbalagem: 20, unidadeEmbalagem: "mL", quantidade: 20, estoque: 20, valorUnitario: 24.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "Cipiostin", hormonio: "Cipionato", tamanhoEmbalagem: 20, unidadeEmbalagem: "mL", quantidade: 15, estoque: 15, valorUnitario: 21.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "RIC-BE", hormonio: "Benzoato", tamanhoEmbalagem: 20, unidadeEmbalagem: "mL", quantidade: 15, estoque: 15, valorUnitario: 19.9, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "Gonaxal", hormonio: "GnRH", tamanhoEmbalagem: 10, unidadeEmbalagem: "mL", quantidade: 10, estoque: 10, valorUnitario: 45.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "Novormon", hormonio: "ECG", tamanhoEmbalagem: 10, unidadeEmbalagem: "mL", quantidade: 10, estoque: 10, valorUnitario: 38.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Hormônio", produtoComercial: "Vetecor", hormonio: "HCG", tamanhoEmbalagem: 10, unidadeEmbalagem: "mL", quantidade: 10, estoque: 10, valorUnitario: 41.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  // Sêmen
  { id: uid("ins"), categoria: "Sêmen", touro: "Touro Zeus FIV", raca: "Nelore", partida: "2026-06-01", quantidade: 50, estoque: 50, valorUnitario: 35.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Sêmen", touro: "Touro Hércules", raca: "Angus", partida: "2026-05-15", quantidade: 30, estoque: 30, valorUnitario: 42.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  // Medicamentos
  { id: uid("ins"), categoria: "Medicamento", produtoComercial: "Ivermectina 1%", tipoMedicamento: "Vermífugo", tamanhoEmbalagem: 500, unidadeEmbalagem: "mL", quantidade: 5, estoque: 5, valorUnitario: 68.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Medicamento", produtoComercial: "Complexo B", tipoMedicamento: "Suplemento", tamanhoEmbalagem: 50, unidadeEmbalagem: "mL", quantidade: 10, estoque: 10, valorUnitario: 15.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Medicamento", produtoComercial: "Vacina Aftosa", tipoMedicamento: "Vacina", tamanhoEmbalagem: 20, unidadeEmbalagem: "mL", quantidade: 8, estoque: 8, valorUnitario: 12.5, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Medicamento", produtoComercial: "Anti-inflamatório X", tipoMedicamento: "Outro", tamanhoEmbalagem: 50, unidadeEmbalagem: "mL", quantidade: 6, estoque: 6, valorUnitario: 22.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  // Utensílios
  { id: uid("ins"), categoria: "Utensílio", produtoComercial: "Luva de palpação", unidade: "caixa", quantidade: 10, estoque: 10, valorUnitario: 28.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
  { id: uid("ins"), categoria: "Utensílio", produtoComercial: "Bainha para inseminação", unidade: "caixa", quantidade: 20, estoque: 20, valorUnitario: 33.0, local: "fazenda", fazendaId: seedFazendas[0].id, usuarioId: null },
];

/* ---------- ícone customizado do implante (D0), no mesmo padrão visual dos ícones lucide-react ---------- */

function ImplantIcon({ size = 24, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      {/* corpo sólido em T, com traços grossos e pontas arredondadas simulando o silhueta preenchida */}
      <path d="M12 6.5 L12 16" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M12 7.5 L4.2 4.3" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 7.5 L19.8 5.3" strokeWidth="3" strokeLinecap="round" />
      {/* fio fino saindo da base */}
      <path d="M12 16.5 C13 19 17 20.5 19.5 16.8" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

function SpermIcon({ size = 24, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      {/* cauda ondulada */}
      <path d="M15 8.5 C12.3 9.5 13.3 11.3 10.8 12.2 C8.3 13.2 9.3 15 6.8 16 C4.3 17 5 19 3.3 20"
        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {/* cabeça oval preenchida */}
      <ellipse cx="18" cy="6.3" rx="2.9" ry="2" fill="currentColor" stroke="none" transform="rotate(-32 18 6.3)" />
    </svg>
  );
}

function UltrasoundIcon({ size = 24, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      {/* monitor */}
      <rect x="9.2" y="2.2" width="12.6" height="9.2" rx="1" strokeWidth="1.5" />
      <path d="M13 15.4 L18 15.4" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15.5 11.4 L15.5 15.4" strokeWidth="1.5" strokeLinecap="round" />
      {/* onda do ultrassom na tela */}
      <path d="M11.3 8.6 C12.6 5.6 14 5.6 15.2 7.2 C16.4 8.8 17.8 8.8 19 6.4"
        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {/* sonda (probe) */}
      <path d="M2 8.5 C2 5.8 3.8 4 6.2 4 C8.6 4 10 5.8 10 8 C10 10 9 10.8 7.6 11.4 L7.6 15.5 C7.6 17.2 6.4 18 5 18 C3.6 18 2.5 17.2 2.5 15.5 L2.5 11.2 C1 10.6 2 9.8 2 8.5 Z"
        fill="currentColor" stroke="none" />
      {/* cabo curvo saindo da base da sonda */}
      <path d="M4.8 18 C4.8 19.8 3 19.8 3 21.4 C3 22.8 4.4 22.9 5 21.6"
        strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- badge estilo brinco de gado (elemento assinatura) ---------- */

function EarTag({ children, size = "md" }) {
  const pad = size === "sm" ? "3px 9px" : "5px 12px";
  const fs = size === "sm" ? 11 : 13;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: fs,
        fontWeight: 600,
        color: "#4A2E10",
        background: "#EFC257",
        border: "1px solid #C98F2B",
        borderRadius: "3px 9px 9px 3px",
        padding: pad,
        letterSpacing: "0.3px",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.35)",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4A2E10", opacity: 0.55, flexShrink: 0 }} />
      {children}
    </span>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "#166336", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={18} color="#FFFFFF" />
        </div>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 21, fontWeight: 600, color: "#232520", margin: 0 }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 13.5, color: "#6B685E", margin: "6px 0 0 44px", maxWidth: 560 }}>{subtitle}</p>}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 7,
  border: "1px solid #D6D6D6",
  fontSize: 14,
  fontFamily: "'Work Sans', sans-serif",
  color: "#232520",
  background: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle = { fontSize: 12, fontWeight: 600, color: "#0B4D2A", marginBottom: 5, display: "block", textTransform: "uppercase", letterSpacing: "0.4px" };
const cardStyle = { background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 12, padding: "18px 20px" };

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// Agrupa um campo de produto e o campo da dose correspondente lado a lado, DENTRO de um
// único item da grade — assim os dois nunca "quebram" para linhas diferentes, não importa
// quantas colunas cabem na tela. Usado em todos os manejos que têm par produto + dose
// (Indução, D0, Ressinc, Retirada, Inseminação).
function CampoProdutoDose({ labelProduto, produto, labelDose, dose }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
      <div style={{ flex: 1.6, minWidth: 0 }}><Field label={labelProduto}>{produto}</Field></div>
      <div style={{ flex: 1, minWidth: 0 }}><Field label={labelDose}>{dose}</Field></div>
    </div>
  );
}

function BtnPrimary({ children, onClick, style, type = "button", disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: disabled ? "#C4C4C4" : "#166336", color: "#FFFFFF",
        border: "none", borderRadius: 8, padding: "9px 16px",
        fontSize: 13.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "'Work Sans', sans-serif",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function BtnGhost({ children, onClick, style, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "transparent", color: danger ? "#A32D2D" : "#166336",
        border: `1px solid ${danger ? "#E3B8B8" : "#C5D8C9"}`, borderRadius: 8,
        padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        fontFamily: "'Work Sans', sans-serif",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function FazendaAtivaBanner({ fazendaAtiva }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "#166336", background: "#E6EFE5", border: "1px solid #C5D8C9", borderRadius: 20, padding: "5px 12px", marginBottom: 18 }}>
      <Home size={13} /> {fazendaAtiva ? fazendaAtiva.nome : "Nenhuma fazenda ativa"}
    </div>
  );
}

/* Bloco reutilizável nos manejos: medicamentos usados junto com o manejo (opcional, além dos insumos já exigidos). */
/* Avisa o navegador para perguntar "sair sem salvar?" quando há uma leitura em
   andamento (animais já lidos, mas ainda não registrados/finalizados) — protege
   contra atualização acidental da página, fechar a aba, etc. */
function useAvisarSaidaComPendencia(haPendencia) {
  React.useEffect(() => {
    const handler = (e) => {
      if (!haPendencia) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [haPendencia]);
}

function SeletorLocalEstoque({ local, setLocal, style }) {
  return (
    <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2, marginBottom: 14, width: "fit-content", ...style }}>
      {[["fazenda", "Estoque da fazenda"], ["externo", "Estoque externo"]].map(([key, label]) => (
        <button key={key} onClick={() => setLocal(key)}
          style={{
            padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 12.5, fontWeight: 600,
            background: local === key ? "#166336" : "transparent",
            color: local === key ? "#FFFFFF" : "#6B685E",
          }}>{label}</button>
      ))}
    </div>
  );
}

/* Leitor de código de barras / QR pela câmera do celular, usando a biblioteca
   html5-qrcode (decodifica ao vivo, sem precisar de app nativo nem backend).
   Ao detectar um código, devolve o texto lido via onLido(texto) e fecha sozinho. */
function ScannerCodigoBarras({ aberto, onFechar, onDetectado }) {
  const instanciaRef = React.useRef(null);
  const [erro, setErro] = useState("");
  const divId = "leitor-camera-visaorepro";

  React.useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setErro("");
    import("html5-qrcode").then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (cancelado) return;
      const instancia = new Html5Qrcode(divId, {
        // cobre QR e os formatos de barras mais comuns em brincos/etiquetas
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.ITF,
        ],
      });
      instanciaRef.current = instancia;
      instancia
        .start(
          { facingMode: "environment" },
          { fps: 12, qrbox: { width: 270, height: 150 } },
          (textoDecodificado) => { onDetectado(textoDecodificado); },
          () => {} // callback de "não achou nada neste frame" — ignorar, é normal
        )
        .catch((e) => {
          setErro("Não foi possível abrir a câmera. Verifique se o navegador tem permissão de câmera.");
          console.error(e);
        });
    });
    return () => {
      cancelado = true;
      const instancia = instanciaRef.current;
      if (instancia) {
        instancia.stop().then(() => instancia.clear()).catch(() => {});
        instanciaRef.current = null;
      }
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,15,12,0.92)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: "#FFFFFF", fontSize: 14, fontWeight: 600 }}>Aponte para o código de barras / QR do brinco</span>
          <button onClick={onFechar} style={{ background: "none", border: "none", color: "#FFFFFF", cursor: "pointer", padding: 4 }} aria-label="Fechar leitor">
            <X size={22} />
          </button>
        </div>
        <div id={divId} style={{ width: "100%", borderRadius: 12, overflow: "hidden", background: "#000" }} />
        {erro && <p style={{ color: "#E3A45C", fontSize: 12.5, marginTop: 10 }}>{erro}</p>}
        <button onClick={onFechar} style={{ marginTop: 14, width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #4C6E56", background: "transparent", color: "#FFFFFF", fontSize: 13, cursor: "pointer" }}>
          Cancelar e digitar manualmente
        </button>
      </div>
    </div>
  );
}

/* Botão de câmera para leitura de identificação (brinco/QR): abre o leitor acima
   e, assim que detecta um código, preenche o campo automaticamente. */
function BotaoCameraLeitura({ onLido, disabled }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setAberto(true)}
        title="Ler identificação pela câmera (código de barras / QR)"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 38, height: 38, borderRadius: 8, border: "1px solid #D6D6D6", background: "#FFFFFF",
          color: "#4A473E", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, flexShrink: 0,
        }}>
        <Camera size={16} />
      </button>
      <ScannerCodigoBarras aberto={aberto} onFechar={() => setAberto(false)}
        onDetectado={(texto) => { setAberto(false); onLido && onLido(texto); }} />
    </>
  );
}

function CampoMedicamentos({ insumos, local, selecionados, setSelecionados }) {
  const medicamentos = insumos.filter((i) => i.categoria === "Medicamento" && (!local || i.local === local));
  const [medicamentoId, setMedicamentoId] = useState(medicamentos[0]?.id || "");
  const [dose, setDose] = useState("");

  React.useEffect(() => { setMedicamentoId(medicamentos[0]?.id || ""); }, [medicamentos.map((m) => m.id).join(","), local]);

  const item = medicamentos.find((m) => m.id === medicamentoId);

  const adicionar = () => {
    if (!medicamentoId || !dose || numBR(dose) <= 0) return;
    if (selecionados.some((s) => s.medicamentoId === medicamentoId)) return;
    setSelecionados((a) => [...a, { medicamentoId, dose: numBR(dose) }]);
    setDose("");
  };
  const remover = (id) => setSelecionados((a) => a.filter((s) => s.medicamentoId !== id));

  if (medicamentos.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6B685E", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.3px" }}>Medicamentos utilizados (opcional)</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select style={{ ...inputStyle, flex: 2 }} value={medicamentoId} onChange={(e) => setMedicamentoId(e.target.value)}>
          {medicamentos.map((m) => <option key={m.id} value={m.id}>{m.produtoComercial}</option>)}
        </select>
        <input style={{ ...inputStyle, flex: 1 }} type="number" step="any" placeholder={`Dose (${item?.unidadeEmbalagem || "un"})`} value={dose}
          onChange={(e) => setDose(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionar())} />
        <BtnGhost onClick={adicionar}><Plus size={14} /></BtnGhost>
      </div>
      {selecionados.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {selecionados.map((s) => {
            const m = insumos.find((i) => i.id === s.medicamentoId);
            return (
              <span key={s.medicamentoId} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EEEEEE", border: "1px solid #DDDDDD", borderRadius: 20, padding: "4px 10px", fontSize: 12.5 }}>
                {m?.produtoComercial} ({s.dose} {m?.unidadeEmbalagem})
                <button onClick={() => remover(s.medicamentoId)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D", display: "flex" }}><X size={12} /></button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: "26px 10px", textAlign: "center", color: "#9B9686", fontSize: 13.5, border: "1px dashed #DDD6C3", borderRadius: 10 }}>
      {text}
    </div>
  );
}

/* =========================================================
   LOGIN
========================================================= */

function Login({ users, onLoginLocal, onEntrarReal }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  // modo de teste (sem Supabase configurado): seleciona um usuário local, qualquer senha
  const [selected, setSelected] = useState(users[0]?.id || "");

  const doLoginReal = async () => {
    if (!email.trim() || !senha) { setErro("Informe e-mail e senha."); return; }
    setErro(""); setCarregando(true);
    const r = await onEntrarReal(email, senha);
    setCarregando(false);
    if (!r.ok) setErro(r.erro);
  };

  const doLoginLocal = () => {
    const u = users.find((x) => x.id === selected);
    if (!u) return;
    if (senha.trim() === "") { setErro("Informe a senha."); return; }
    onLoginLocal(u);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F7F7F7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Work Sans', sans-serif", padding: 20 }}>
      <div style={{ width: 380, maxWidth: "100%", background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 16, padding: "34px 30px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <img src={logoImg} alt="VArepro" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, color: "#232520" }}>VArepro</div>
            <div style={{ fontSize: 12, color: "#9B9686" }}>Controle de IATF a campo</div>
          </div>
        </div>
        <div style={{ height: 1, background: "#EEEEEE", margin: "20px 0" }} />

        {supabaseConfigurado ? (
          <>
            <Field label="E-mail">
              <input type="email" placeholder="seu.email@fazenda.com" style={inputStyle} value={email}
                onChange={(e) => { setEmail(e.target.value); setErro(""); }} autoComplete="username" />
            </Field>
            <Field label="Senha">
              <input type="password" placeholder="Digite sua senha" style={inputStyle} value={senha}
                onChange={(e) => { setSenha(e.target.value); setErro(""); }}
                onKeyDown={(e) => e.key === "Enter" && doLoginReal()} autoComplete="current-password" />
            </Field>
            {erro && <p style={{ color: "#A32D2D", fontSize: 12.5, margin: "0 0 12px" }}>{erro}</p>}
            <BtnPrimary onClick={doLoginReal} disabled={carregando} style={{ width: "100%", justifyContent: "center", padding: "11px 0" }}>
              {carregando ? "Entrando…" : "Entrar"}
            </BtnPrimary>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: "#166336", background: "#FBF3E4", border: "1px solid #E3B8A0", borderRadius: 8, padding: 10, margin: "0 0 14px" }}>
              ⚠ Modo de teste local — o Supabase ainda não está configurado neste ambiente, então não há verificação real de senha. Configure o Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) para login seguro de verdade.
            </p>
            <Field label="Usuário">
              <select style={inputStyle} value={selected} onChange={(e) => setSelected(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.nome} — {u.perfil}</option>
                ))}
              </select>
            </Field>
            <Field label="Senha">
              <input type="password" placeholder="Digite qualquer senha" style={inputStyle} value={senha}
                onChange={(e) => { setSenha(e.target.value); setErro(""); }}
                onKeyDown={(e) => e.key === "Enter" && doLoginLocal()} />
            </Field>
            {erro && <p style={{ color: "#A32D2D", fontSize: 12.5, margin: "0 0 12px" }}>{erro}</p>}
            <BtnPrimary onClick={doLoginLocal} style={{ width: "100%", justifyContent: "center", padding: "11px 0" }}>Entrar (modo de teste)</BtnPrimary>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [users, setUsers] = useState(seedUsers);
  const [currentUser, setCurrentUser] = useState(null);
  const [sessaoAuthCarregada, setSessaoAuthCarregada] = useState(!supabaseConfigurado);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pendencias, setPendencias] = useState(0);
  const [carregadoDoBanco, setCarregadoDoBanco] = useState(false);
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);

  const [fazendas, setFazendas] = useState(seedFazendas);
  const [fazendaAtivaId, setFazendaAtivaId] = useState(seedFazendas[0]?.id || "");
  const [retiros, setRetiros] = useState([]);
  const [safras, setSafras] = useState([]);
  const [safraAtivaId, setSafraAtivaId] = useState("");
  const [lotes, setLotes] = useState([]);
  const [insumos, setInsumos] = useState(seedInsumos);
  const [manejos, setManejos] = useState([]);
  const [movimentos, setMovimentos] = useState([]); // estoque: entrada/saida
  const [agendamentos, setAgendamentos] = useState([]);

  // ---------- carrega o banco local (IndexedDB) uma única vez, ao abrir o app ----------
  // Se já havia dados salvos de uma sessão anterior (mesmo sem internet), eles
  // substituem os dados de exemplo (seed) assim que terminam de carregar.
  React.useEffect(() => {
    carregarTudo().then((dados) => {
      if (dados.usuarios.length) setUsers(dados.usuarios);
      if (dados.fazendas.length) setFazendas(dados.fazendas);
      if (dados.retiros.length) setRetiros(dados.retiros);
      if (dados.safras.length) setSafras(dados.safras);
      if (dados.lotes.length) setLotes(dados.lotes);
      if (dados.insumos.length) setInsumos(dados.insumos);
      if (dados.manejos.length) setManejos(dados.manejos);
      if (dados.movimentos.length) setMovimentos(dados.movimentos);
      if (dados.agendamentos.length) setAgendamentos(dados.agendamentos);
      if (dados.sugestoesRessinc.length) setSugestoesRessinc(dados.sugestoesRessinc);
      if (dados.sugestoesRepasse?.length) setSugestoesRepasse(dados.sugestoesRepasse);
      if (dados.protocolosPadrao?.length) setProtocolosPadrao(dados.protocolosPadrao);
      if (Object.keys(dados.rascunhos).length) setRascunhos(dados.rascunhos);
      setCarregadoDoBanco(true);
    }).catch((e) => {
      console.error("Falha ao carregar banco local:", e);
      setCarregadoDoBanco(true); // segue com os dados de exemplo em memória mesmo assim
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- sessão de login real (Supabase Auth) ----------
  // Ao abrir o app, verifica se já existe uma sessão válida (login persistido
  // com segurança pelo próprio Supabase) e, se sim, entra direto sem pedir
  // e-mail/senha de novo. Também escuta logout/expiração em qualquer aba.
  React.useEffect(() => {
    if (!supabaseConfigurado) return;
    obterSessao().then((sessao) => {
      if (sessao?.user) setCurrentUser((atual) => atual || { id: sessao.user.id, _aguardandoPerfil: true });
      setSessaoAuthCarregada(true);
    });
    const cancelarEscuta = escutarMudancaAuth((sessao) => {
      if (!sessao?.user) { setCurrentUser(null); return; }
      setCurrentUser((atual) => (atual && atual.id === sessao.user.id && !atual._aguardandoPerfil) ? atual : { id: sessao.user.id, _aguardandoPerfil: true });
    });
    return cancelarEscuta;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Depois de autenticado (id confirmado pelo Supabase), busca o perfil
  // completo (nome, perfil de acesso, fazendas autorizadas) na lista local de
  // usuários — que já foi sincronizada da tabela `usuarios` do Supabase. Se
  // não encontrar localmente (aparelho novo, ainda sem cache), busca só essa
  // linha direto no Supabase — a política de RLS já permite a própria linha.
  const [erroPerfil, setErroPerfil] = useState("");
  React.useEffect(() => {
    if (!currentUser?._aguardandoPerfil || !carregadoDoBanco) return;
    const perfil = users.find((u) => u.id === currentUser.id);
    if (perfil) { setCurrentUser(perfil); setErroPerfil(""); return; }
    if (!supabaseConfigurado) { setErroPerfil("Supabase não configurado — não há como buscar seu perfil."); return; }
    buscarPerfilProprio(currentUser.id).then((r) => {
      if (r.ok) { setUsers((a) => [...a, r.perfil]); setErroPerfil(""); setCurrentUser(r.perfil); }
      else setErroPerfil(r.erro);
    });
  }, [currentUser, users, carregadoDoBanco]);

  // Mantém o currentUser sempre em dia com a lista de usuários — essencial agora que as
  // próprias fazendas atribuídas ao Administrador podem mudar em tempo real (ex.: logo
  // após ele criar uma fazenda nova, que já entra automaticamente no seu próprio grupo).
  React.useEffect(() => {
    if (!currentUser || currentUser._aguardandoPerfil) return;
    const atualizado = users.find((u) => u.id === currentUser.id);
    if (atualizado && JSON.stringify(atualizado) !== JSON.stringify(currentUser)) setCurrentUser(atualizado);
  }, [users, currentUser]);

  const entrarComEmailSenha = async (email, senha) => {
    const r = await entrar(email, senha);
    if (!r.ok) return r;
    setCurrentUser({ id: r.authUser.id, _aguardandoPerfil: true });
    return r;
  };

  const sairDaConta = async () => {
    await sair();
    setCurrentUser(null);
  };

  // ---------- grava cada coleção no IndexedDB sempre que ela muda ----------
  // Só começa a gravar DEPOIS do carregamento inicial (senão sobrescreveria os
  // dados salvos com os dados de exemplo antes de eles serem lidos).
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("usuarios", users); }, [carregadoDoBanco, users]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("fazendas", fazendas); }, [carregadoDoBanco, fazendas]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("retiros", retiros); }, [carregadoDoBanco, retiros]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("safras", safras); }, [carregadoDoBanco, safras]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("lotes", lotes); }, [carregadoDoBanco, lotes]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("insumos", insumos); }, [carregadoDoBanco, insumos]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("manejos", manejos); }, [carregadoDoBanco, manejos]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("movimentos", movimentos); }, [carregadoDoBanco, movimentos]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("agendamentos", agendamentos); }, [carregadoDoBanco, agendamentos]);

  // ---------- detecta volta da internet automaticamente e sincroniza ----------
  React.useEffect(() => {
    const aoFicarOnline = () => setOnline(true);
    const aoFicarOffline = () => setOnline(false);
    window.addEventListener("online", aoFicarOnline);
    window.addEventListener("offline", aoFicarOffline);
    return () => {
      window.removeEventListener("online", aoFicarOnline);
      window.removeEventListener("offline", aoFicarOffline);
    };
  }, []);

  const [erroSincronizacao, setErroSincronizacao] = useState("");
  const sincronizarAgora = async () => {
    if (!supabaseConfigurado) { setPendencias(0); return; }
    setSincronizando(true);
    setErroSincronizacao("");
    const resultado = await sincronizar({ usuarios: users, fazendas, retiros, safras, lotes, insumos, manejos, movimentos, agendamentos, sugestoesRessinc, sugestoesRepasse, protocolosPadrao });
    // aplica o que veio certo mesmo que outra tabela tenha falhado — nunca descarta dados
    // válidos só porque outra parte da sincronização deu erro.
    if (resultado.atualizado) {
      const a = resultado.atualizado;
      // "fazendasAutorizadas" agora vem sincronizado de verdade (via usuario_fazendas,
      // resolvido dentro de sincronizar()) — o servidor já é a fonte confiável aqui.
      if (a.usuarios) setUsers(a.usuarios);
      if (a.fazendas) setFazendas(a.fazendas);
      if (a.retiros) setRetiros(a.retiros);
      if (a.safras) setSafras(a.safras);
      if (a.lotes) setLotes(a.lotes);
      if (a.insumos) setInsumos(a.insumos);
      if (a.manejos) setManejos(a.manejos);
      if (a.movimentos) setMovimentos(a.movimentos);
      if (a.agendamentos) setAgendamentos(a.agendamentos);
      if (a.sugestoesRessinc) setSugestoesRessinc(a.sugestoesRessinc);
      if (a.sugestoesRepasse) setSugestoesRepasse(a.sugestoesRepasse);
      if (a.protocolosPadrao) setProtocolosPadrao(a.protocolosPadrao);
    }
    if (resultado.ok) {
      setPendencias(0);
      setUltimaSincronizacao(resultado.sincronizadoEm);
    } else {
      // mostra o motivo real em vez de falhar silenciosamente
      setErroSincronizacao(resultado.motivo || (resultado.erros || []).join(" · ") || "Falha desconhecida na sincronização.");
    }
    setSincronizando(false);
    return resultado;
  };

  const [section, setSection] = useState("cadastros");
  const [sub, setSub] = useState("fazenda");

  const marcaPendencia = () => {
    // conta como "pendente de sincronizar" sempre que não há como enviar ao Supabase
    // agora mesmo (sem Supabase configurado, ou sem internet) — os dados já foram
    // salvos localmente (useEffects de persistência acima), então nada se perde.
    if (!online || !supabaseConfigurado) setPendencias((p) => p + 1);
  };

  /* ---------- filtro global pela fazenda ativa ---------- */
  /* Toda alteração feita fora do cadastro de fazendas é atribuída à fazenda selecionada aqui. */

  const fazendaAtiva = fazendas.find((f) => f.id === fazendaAtivaId) || null;
  // Todo perfil (inclusive Administrador) só enxerga/opera nas fazendas atribuídas a ele —
  // cada Administrador cuida do seu próprio grupo, sem ver as fazendas de outros Administradores.
  const fazendasVisiveis = fazendas.filter((f) => (currentUser?.fazendasAutorizadas || []).includes(f.id));
  const retirosAtivos = useMemo(() => retiros.filter((r) => r.fazendaId === fazendaAtivaId), [retiros, fazendaAtivaId]);
  const safrasAtivas = useMemo(() => safras.filter((s) => s.fazendaId === fazendaAtivaId), [safras, fazendaAtivaId]);
  const safraAtiva = safras.find((s) => s.id === safraAtivaId) || null;
  const lotesAtivos = useMemo(
    () => lotes.filter((l) => l.fazendaId === fazendaAtivaId && (safraAtivaId ? l.safraId === safraAtivaId : true)),
    [lotes, fazendaAtivaId, safraAtivaId]
  );
  // todas as safras da fazenda — usado na Importação de histórico, que precisa ver o
  // panorama completo (lotesAtivos só mostra a safra ativa no momento)
  const lotesDaFazenda = useMemo(
    () => lotes.filter((l) => l.fazendaId === fazendaAtivaId),
    [lotes, fazendaAtivaId]
  );
  const insumosAtivos = useMemo(
    () => insumos.filter((i) => i.local === "externo" ? i.usuarioId === currentUser?.id : i.fazendaId === fazendaAtivaId),
    [insumos, fazendaAtivaId, currentUser]
  );
  const manejosAtivos = useMemo(
    () => manejos.filter((m) => m.fazendaId === fazendaAtivaId && (safraAtivaId ? m.safraId === safraAtivaId : true)),
    [manejos, fazendaAtivaId, safraAtivaId]
  );
  const movimentosAtivos = useMemo(
    () => movimentos.filter((m) => m.local === "externo" ? insumos.find((i) => i.id === m.insumoId)?.usuarioId === currentUser?.id : m.fazendaId === fazendaAtivaId),
    [movimentos, fazendaAtivaId, insumos, currentUser]
  );
  const agendamentosAtivos = useMemo(() => agendamentos.filter((a) => a.fazendaId === fazendaAtivaId), [agendamentos, fazendaAtivaId]);
  // todos os agendamentos das fazendas que o usuário logado pode acessar (para a visualização multi-fazenda na Agenda)
  const agendamentosVisiveis = useMemo(
    () => agendamentos.filter((a) => fazendasVisiveis.some((f) => f.id === a.fazendaId)),
    [agendamentos, fazendasVisiveis]
  );

  /* ---------- ações de dados ---------- */

  const addFazenda = (f, retirosNomes = [], safrasAnos = []) => {
    const fazId = uid("faz");
    setFazendas((a) => [...a, { ...f, id: fazId }]);
    if (retirosNomes.length > 0) {
      setRetiros((a) => [...a, ...retirosNomes.map((nome) => ({ id: uid("ret"), fazendaId: fazId, nome }))]);
    }
    if (safrasAnos.length > 0) {
      setSafras((a) => [...a, ...safrasAnos.map((ano) => ({ id: uid("saf"), fazendaId: fazId, nome: `${ano}/${Number(ano) + 1}` }))]);
    }
    // quem cria a fazenda já entra automaticamente no próprio grupo dela — senão ela
    // desapareceria da visão de quem acabou de criar (cada perfil só vê seu grupo agora).
    if (currentUser) toggleAutorizacaoFazenda(currentUser.id, fazId);
    setFazendaAtivaId(fazId);
    marcaPendencia();
  };
  const addRetiro = (r) => { setRetiros((a) => [...a, { ...r, id: uid("ret") }]); marcaPendencia(); };
  const removeRetiro = (id) => { setRetiros((a) => a.filter((r) => r.id !== id)); marcaPendencia(); };
  const addSafra = (fazendaId, ano) => { setSafras((a) => [...a, { id: uid("saf"), fazendaId, nome: `${ano}/${Number(ano) + 1}` }]); marcaPendencia(); };
  const removeSafra = (id) => { setSafras((a) => a.filter((s) => s.id !== id)); marcaPendencia(); };

  // ---------- importação em massa de lotes/animais/manejos históricos (planilha) ----------
  // Diferente de addLote (que sempre usa a safra ativa e começa sem animais), aqui cada
  // lote pode ir para uma safra/retiro específicos e já vem com a lista de animais pronta —
  // pensado para trazer o histórico de safras anteriores de uma vez, via Excel. Além do
  // cadastro do lote, também recria os manejos de Inseminação e Diagnóstico quando a
  // planilha tiver essas colunas preenchidas (agrupando os animais por lote+ordem+data).
  const importarLotesHistoricos = (linhas) => {
    // linhas: [{ safra, retiro, lote, categoria, brinco, raca, mesParicao, ordem,
    //            dataInseminacao, touro, dataDiagnostico, resultado, tempoGestacaoInformado }, ...]
    //
    // IMPORTANTE: dado histórico é passado (já aconteceu), então os manejos aqui são
    // adicionados direto via setManejos — de propósito, SEM passar pela função
    // registrarManejo() normal do app. Isso garante que a importação NUNCA:
    //   (a) gera sugestão de Ressinc/Repasse (criarSugestaoRessinc/criarSugestaoRepasse
    //       não são chamadas aqui);
    //   (b) cria pré-agendamento na Agenda (só registrarManejo() chama
    //       gerarPreAgendamentos — a importação não passa por ela);
    //   (c) desconta estoque (registrarSaidaEstoque não é chamada aqui — mesmo quando o
    //       touro da planilha bate com um sêmen já cadastrado, é só um vínculo
    //       informativo no manejo, sem mexer na quantidade disponível).
    let safrasCriadas = 0, retirosCriados = 0, lotesCriados = 0, lotesAtualizados = 0, manejosCriados = 0, manejosAtualizados = 0;
    let safrasAtuais = [...safras];
    let retirosAtuais = [...retiros];
    let lotesAtuais = [...lotes];
    let manejosAtuais = [...manejos]; // começa com os já existentes — re-importar deve achar e atualizar, não duplicar

    const acharOuCriarSafra = (nome) => {
      const nomeLimpo = nome.trim();
      const existente = safrasAtuais.find((s) => s.fazendaId === fazendaAtivaId && s.nome.trim().toLowerCase() === nomeLimpo.toLowerCase());
      if (existente) return existente.id;
      const nova = { id: uid("saf"), fazendaId: fazendaAtivaId, nome: nomeLimpo };
      safrasAtuais = [...safrasAtuais, nova];
      safrasCriadas++;
      return nova.id;
    };
    const acharOuCriarRetiro = (nome) => {
      const nomeLimpo = nome.trim();
      const existente = retirosAtuais.find((r) => r.fazendaId === fazendaAtivaId && r.nome.trim().toLowerCase() === nomeLimpo.toLowerCase());
      if (existente) return existente.id;
      const novo = { id: uid("ret"), fazendaId: fazendaAtivaId, nome: nomeLimpo };
      retirosAtuais = [...retirosAtuais, novo];
      retirosCriados++;
      return novo.id;
    };
    // tenta achar um sêmen já cadastrado com esse touro, para vincular o manejo ao insumo
    // de verdade; se não achar, guarda o nome digitado mesmo assim (sem vincular estoque).
    const acharSemenPorTouro = (nomeTouro) => {
      if (!nomeTouro) return null;
      const encontrado = insumos.find((i) => i.categoria === "Sêmen" && i.fazendaId === fazendaAtivaId && (i.touro || "").trim().toLowerCase() === nomeTouro.trim().toLowerCase());
      return encontrado?.id || null;
    };
    // acha um manejo (Inseminação/Diagnóstico) já existente para o mesmo lote+ordem+data — é
    // assim que uma reimportação corrige/completa dados em vez de duplicar o manejo inteiro.
    // Quando encontra, mescla por brinco: quem já estava e continua na planilha é atualizado,
    // quem é novo é adicionado — nenhum animal antigo que não veio nesta reimportação é removido.
    const criarOuAtualizarManejo = (tipo, grupo, detalhesNovos) => {
      const existente = manejosAtuais.find((m) => m.tipo === tipo && m.loteId === grupo.infoLote.loteId && m.ordem === grupo.ordem && m.data === grupo.data);
      if (existente) {
        const porBrinco = new Map((existente.detalhes || []).map((d) => [d.brinco, d]));
        detalhesNovos.forEach((d) => porBrinco.set(d.brinco, d));
        const detalhesFinal = [...porBrinco.values()];
        manejosAtuais = manejosAtuais.map((m) => m.id === existente.id ? { ...m, detalhes: detalhesFinal, animaisLidos: detalhesFinal.map((d) => d.brinco) } : m);
        manejosAtualizados++;
      } else {
        manejosAtuais = [...manejosAtuais, {
          id: uid("man"), tipo, fazendaId: fazendaAtivaId, safraId: grupo.infoLote.safraId,
          loteId: grupo.infoLote.loteId, loteNome: grupo.infoLote.loteNome, retiroId: grupo.infoLote.retiroId, ordem: grupo.ordem,
          data: grupo.data, animaisLidos: detalhesNovos.map((d) => d.brinco), detalhes: detalhesNovos,
          operador: currentUser?.nome || "Importação", criadoEm: new Date().toISOString(),
        }];
        manejosCriados++;
      }
    };

    // 1) agrupa as linhas por (safra, retiro, lote) — cada grupo vira um lote com a lista de animais
    const gruposLote = new Map();
    linhas.forEach((linha) => {
      const chave = `${linha.safra.trim().toLowerCase()}|${linha.retiro.trim().toLowerCase()}|${linha.lote.trim().toLowerCase()}`;
      if (!gruposLote.has(chave)) {
        gruposLote.set(chave, {
          safraNome: linha.safra.trim(), retiroNome: linha.retiro.trim(), loteNome: linha.lote.trim(),
          categoria: linha.categoria?.trim() || null, raca: linha.raca?.trim() || null, mesParicao: linha.mesParicao?.trim() || null,
          animais: [], ordemMaisAvancada: null,
        });
      }
      const grupo = gruposLote.get(chave);
      if (linha.brinco && !grupo.animais.includes(linha.brinco.trim())) grupo.animais.push(linha.brinco.trim());
      const ordemLinha = linha.ordem?.trim();
      if (ordemLinha && ORDENS_IATF.includes(ordemLinha)) {
        const indiceAtual = ORDENS_IATF.indexOf(ordemLinha);
        const indiceGrupo = grupo.ordemMaisAvancada ? ORDENS_IATF.indexOf(grupo.ordemMaisAvancada) : -1;
        if (indiceAtual > indiceGrupo) grupo.ordemMaisAvancada = ordemLinha;
      }
    });

    const chaveLote = new Map(); // "safra|retiro|lote" -> loteId, para os passos 2 e 3 acharem o lote de cada linha
    gruposLote.forEach((grupo, chave) => {
      const safraId = acharOuCriarSafra(grupo.safraNome);
      const retiroId = acharOuCriarRetiro(grupo.retiroNome);
      const loteExistente = lotesAtuais.find((l) =>
        l.fazendaId === fazendaAtivaId && l.safraId === safraId && l.retiroId === retiroId &&
        l.nome.trim().toLowerCase() === grupo.loteNome.toLowerCase()
      );
      let loteId;
      if (loteExistente) {
        const animaisMesclados = [...new Set([...(loteExistente.animais || []), ...grupo.animais])];
        const ordemFinal = grupo.ordemMaisAvancada && (!loteExistente.ordem || ORDENS_IATF.indexOf(grupo.ordemMaisAvancada) > ORDENS_IATF.indexOf(loteExistente.ordem))
          ? grupo.ordemMaisAvancada : loteExistente.ordem;
        // reimportar também corrige categoria/raça/mês de parição — usa o valor novo da planilha
        // quando preenchido; se a linha vier em branco nesse campo, mantém o que já estava.
        lotesAtuais = lotesAtuais.map((l) => l.id === loteExistente.id ? {
          ...l, animais: animaisMesclados, numeroAnimais: animaisMesclados.length, ordem: ordemFinal,
          categoria: grupo.categoria || l.categoria, raca: grupo.raca || l.raca, mesParicao: grupo.mesParicao || l.mesParicao,
        } : l);
        lotesAtualizados++;
        loteId = loteExistente.id;
      } else {
        loteId = uid("lot");
        const novoLote = {
          id: loteId, fazendaId: fazendaAtivaId, safraId, retiroId, nome: grupo.loteNome,
          categoria: grupo.categoria, raca: grupo.raca, mesParicao: grupo.mesParicao, ordem: grupo.ordemMaisAvancada || ORDENS_IATF[0],
          numeroAnimais: grupo.animais.length, animais: grupo.animais,
        };
        lotesAtuais = [...lotesAtuais, novoLote];
        lotesCriados++;
      }
      chaveLote.set(chave, { loteId, safraId, retiroId, loteNome: grupo.loteNome, retiroNome: grupo.retiroNome });
    });

    // 2) agrupa as linhas com dado de Inseminação (por lote + ordem + data) e cria/atualiza um manejo por grupo
    const gruposInsem = new Map();
    linhas.forEach((linha) => {
      if (!linha.dataInseminacao) return;
      const chaveL = `${linha.safra.trim().toLowerCase()}|${linha.retiro.trim().toLowerCase()}|${linha.lote.trim().toLowerCase()}`;
      const infoLote = chaveLote.get(chaveL);
      if (!infoLote) return;
      const ordem = (linha.ordem?.trim() && ORDENS_IATF.includes(linha.ordem.trim())) ? linha.ordem.trim() : ORDENS_IATF[0];
      const chave = `${infoLote.loteId}|${ordem}|${linha.dataInseminacao}`;
      if (!gruposInsem.has(chave)) gruposInsem.set(chave, { infoLote, ordem, data: linha.dataInseminacao, animais: [] });
      gruposInsem.get(chave).animais.push({ brinco: linha.brinco.trim(), semenId: acharSemenPorTouro(linha.touro), touroInformado: linha.touro?.trim() || null });
    });
    gruposInsem.forEach((grupo) => criarOuAtualizarManejo("inseminacao", grupo, grupo.animais));

    // 3) mesma coisa para Diagnóstico
    const gruposDiag = new Map();
    linhas.forEach((linha) => {
      if (!linha.dataDiagnostico || !linha.resultado) return;
      const chaveL = `${linha.safra.trim().toLowerCase()}|${linha.retiro.trim().toLowerCase()}|${linha.lote.trim().toLowerCase()}`;
      const infoLote = chaveLote.get(chaveL);
      if (!infoLote) return;
      const ordem = (linha.ordem?.trim() && ORDENS_IATF.includes(linha.ordem.trim())) ? linha.ordem.trim() : ORDENS_IATF[0];
      const chave = `${infoLote.loteId}|${ordem}|${linha.dataDiagnostico}`;
      const resultadoNormalizado = linha.resultado.trim().toUpperCase().startsWith("P") ? "Prenha" : "Vazia";
      if (!gruposDiag.has(chave)) gruposDiag.set(chave, { infoLote, ordem, data: linha.dataDiagnostico, animais: [] });
      gruposDiag.get(chave).animais.push({
        brinco: linha.brinco.trim(), resultado: resultadoNormalizado,
        tempoGestacaoInformado: linha.tempoGestacaoInformado?.trim() ? numBR(linha.tempoGestacaoInformado) : null,
      });
    });
    gruposDiag.forEach((grupo) => criarOuAtualizarManejo("diagnostico", grupo, grupo.animais));

    setSafras(safrasAtuais);
    setRetiros(retirosAtuais);
    setLotes(lotesAtuais);
    setManejos(manejosAtuais);
    marcaPendencia();
    return { safrasCriadas, retirosCriados, lotesCriados, lotesAtualizados, manejosCriados, manejosAtualizados, animaisImportados: linhas.length };
  };

  /* ---------- usuários (Administrador cadastra e autoriza acesso a fazendas) ---------- */

  // Se o Supabase estiver configurado, cria uma conta de login de verdade
  // (Supabase Auth) e usa o id dela para a linha em "usuarios" — é assim que
  // as duas tabelas ficam ligadas (ver supabase/schema.sql). Sem Supabase,
  // cai no cadastro só local de antes (sem senha real), para seguir
  // testável offline.
  const addUsuario = async (u) => {
    if (supabaseConfigurado && u.email && u.senha) {
      const r = await criarUsuario(u.email, u.senha);
      if (!r.ok) return { ok: false, erro: r.erro };
      setUsers((a) => [...a, { id: r.authUserId, nome: u.nome, login: u.login, email: u.email, perfil: u.perfil, criadoPor: currentUser?.id || null, fazendasAutorizadas: [] }]);
      marcaPendencia();
      return { ok: true, precisaConfirmarEmail: r.precisaConfirmarEmail };
    }
    setUsers((a) => [...a, { ...u, id: uid("u"), criadoPor: currentUser?.id || null, fazendasAutorizadas: u.fazendasAutorizadas || [] }]);
    marcaPendencia();
    return { ok: true };
  };
  const toggleAutorizacaoFazenda = (userId, fazendaId) => {
    setUsers((a) => a.map((u) => u.id === userId
      ? { ...u, fazendasAutorizadas: (u.fazendasAutorizadas || []).includes(fazendaId)
          ? u.fazendasAutorizadas.filter((id) => id !== fazendaId)
          : [...(u.fazendasAutorizadas || []), fazendaId] }
      : u));
    marcaPendencia();
  };
  const addLote = (l) => {
    const id = uid("lot");
    setLotes((a) => [...a, { ...l, id, fazendaId: fazendaAtivaId, safraId: safraAtivaId || null, animais: [] }]);
    marcaPendencia();
    return id;
  };
  const atualizarLote = (loteId, campos) => {
    setLotes((a) => a.map((l) => l.id === loteId ? { ...l, ...campos } : l));
    marcaPendencia();
  };
  const addAnimalAoLote = (loteId, brinco) => {
    setLotes((a) => a.map((l) => l.id === loteId && !l.animais.includes(brinco) ? { ...l, animais: [...l.animais, brinco] } : l));
    marcaPendencia();
  };
  const removeAnimalDoLote = (loteId, brinco) => {
    setLotes((a) => a.map((l) => l.id === loteId ? { ...l, animais: l.animais.filter((b) => b !== brinco) } : l));
  };

  // Ao ser identificado na leitura da 1º IATF, o animal passa a "herdar" retroativamente os
  // manejos que já haviam sido feitos no lote (Indução, D0, Retirada) antes dele ser identificado
  // individualmente — necessário para permitir análises futuras por animal, além de por lote.
  const atribuirManejosRetroativos = (loteId, brincos) => {
    setManejos((a) => a.map((m) => {
      if (m.loteId === loteId && ["inducao", "implantacao", "retirada"].includes(m.tipo)) {
        const jaTem = new Set(m.animaisLidos || []);
        brincos.forEach((b) => jaTem.add(b));
        return { ...m, animaisLidos: Array.from(jaTem) };
      }
      return m;
    }));
    marcaPendencia();
  };

  // Quando um animal "novo" é lido numa Inseminação de um lote que já tem outros animais atribuídos,
  // ele herda apenas as informações dos manejos (D0/Ressinc, Retirada) daquele lote NA ORDEM atual —
  // não do histórico inteiro do lote.
  const atribuirManejosRetroativosPorOrdem = (loteId, brincos, ordem) => {
    setManejos((a) => a.map((m) => {
      if (m.loteId === loteId && ["implantacao", "ressinc", "retirada"].includes(m.tipo) && m.ordem === ordem) {
        const jaTem = new Set(m.animaisLidos || []);
        brincos.forEach((b) => jaTem.add(b));
        return { ...m, animaisLidos: Array.from(jaTem) };
      }
      return m;
    }));
    marcaPendencia();
  };

  // lote especial para agrupar animais dos quais não temos as informações completas
  // (ex.: aparecem no Diagnóstico sem nenhuma Inseminação registrada)
  const garantirLoteDesconhecidos = () => {
    const existente = lotes.find((l) =>
      l.fazendaId === fazendaAtivaId && (safraAtivaId ? l.safraId === safraAtivaId : true) && l.nome === "Desconhecidos"
    );
    if (existente) return existente.id;
    return addLote({ nome: "Desconhecidos", retiroId: null, categoria: null, numeroAnimais: null, raca: null, mesParicao: null, ordem: null });
  };

  /* ---------- sugestões de Ressinc: nascem ao finalizar um Diagnóstico com animais Vazia,
     ficam aguardando confirmação na aba Ressinc (dentro de D0) ---------- */

  const [sugestoesRessinc, setSugestoesRessinc] = useState([]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("sugestoesRessinc", sugestoesRessinc); }, [carregadoDoBanco, sugestoesRessinc]);
  const sugestoesRessincAtivas = useMemo(
    () => sugestoesRessinc.filter((s) => s.fazendaId === fazendaAtivaId && (safraAtivaId ? s.safraId === safraAtivaId : true) && s.status === "pendente"),
    [sugestoesRessinc, fazendaAtivaId, safraAtivaId]
  );
  const criarSugestaoRessinc = (loteId, brincos, origemManejoId) => {
    setSugestoesRessinc((a) => [...a, {
      id: uid("sug"), loteId, brincos, origemManejoId, fazendaId: fazendaAtivaId, safraId: safraAtivaId || null,
      data: todayISO(), status: "pendente",
    }]);
    marcaPendencia();
  };
  const descartarSugestaoRessinc = (id) => {
    setSugestoesRessinc((a) => a.map((s) => s.id === id ? { ...s, status: "descartada" } : s));
    marcaPendencia();
  };
  const removerSugestaoRessinc = (id) => {
    setSugestoesRessinc((a) => a.map((s) => s.id === id ? { ...s, status: "confirmada" } : s));
    marcaPendencia();
  };

  /* ---------- sugestões de Repasse: nascem ao finalizar um Diagnóstico com animais Vazia e
     "Destino para vazias" = Repasse; ficam aguardando confirmação na aba Repasse ---------- */

  const [sugestoesRepasse, setSugestoesRepasse] = useState([]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("sugestoesRepasse", sugestoesRepasse); }, [carregadoDoBanco, sugestoesRepasse]);
  const sugestoesRepasseAtivas = useMemo(
    () => sugestoesRepasse.filter((s) => s.fazendaId === fazendaAtivaId && (safraAtivaId ? s.safraId === safraAtivaId : true) && s.status === "pendente"),
    [sugestoesRepasse, fazendaAtivaId, safraAtivaId]
  );
  const criarSugestaoRepasse = (loteId, brincos, origemManejoId) => {
    setSugestoesRepasse((a) => [...a, {
      id: uid("sug"), loteId, brincos, origemManejoId, fazendaId: fazendaAtivaId, safraId: safraAtivaId || null,
      data: todayISO(), status: "pendente",
    }]);
    marcaPendencia();
  };
  const descartarSugestaoRepasse = (id) => {
    setSugestoesRepasse((a) => a.map((s) => s.id === id ? { ...s, status: "descartada" } : s));
    marcaPendencia();
  };
  const removerSugestaoRepasse = (id) => {
    setSugestoesRepasse((a) => a.map((s) => s.id === id ? { ...s, status: "confirmada" } : s));
    marcaPendencia();
  };

  /* ---------- protocolos padrão: "modelos" de D0/Retirada — na primeira vez que um nome novo
     de protocolo padrão é usado, salva os hormônios/doses daquele registro; nas próximas vezes,
     selecionar o mesmo nome preenche tudo de novo automaticamente (mas continua editável). ---------- */

  const [protocolosPadrao, setProtocolosPadrao] = useState([]);
  React.useEffect(() => { if (carregadoDoBanco) gravarColecao("protocolosPadrao", protocolosPadrao); }, [carregadoDoBanco, protocolosPadrao]);
  const protocolosPadraoDaFazenda = (manejo) => protocolosPadrao.filter((p) => p.fazendaId === fazendaAtivaId && p.manejo === manejo);
  // só cria um cadastro novo se ainda não existir um com esse nome (para aquele manejo/fazenda) —
  // combinações já existentes não são sobrescritas automaticamente.
  const addProtocoloPadraoSeNovo = (manejo, nome, campos) => {
    const nomeLimpo = (nome || "").trim();
    if (!nomeLimpo) return;
    const jaExiste = protocolosPadrao.some((p) => p.fazendaId === fazendaAtivaId && p.manejo === manejo && p.nome.trim().toLowerCase() === nomeLimpo.toLowerCase());
    if (jaExiste) return;
    setProtocolosPadrao((a) => [...a, { id: uid("prot"), fazendaId: fazendaAtivaId, manejo, nome: nomeLimpo, ...campos }]);
    marcaPendencia();
  };

  /* ---------- rascunhos: permitem salvar leituras em andamento (Inseminação, Diagnóstico,
     Diagnóstico Final) e continuar depois, mesmo trocando de aba ou de fazenda/safra ---------- */

  const [rascunhos, setRascunhos] = useState({});
  React.useEffect(() => { if (carregadoDoBanco) gravarRascunhos(rascunhos); }, [carregadoDoBanco, rascunhos]);
  const salvarRascunho = (chave, dados) => {
    setRascunhos((a) => ({ ...a, [chave]: { ...dados, salvoEm: new Date().toISOString() } }));
    marcaPendencia();
  };
  const limparRascunho = (chave) => {
    setRascunhos((a) => { const cp = { ...a }; delete cp[chave]; return cp; });
  };

  /* ---------- estoque: entrada cadastra o item (se novo) e já lança a entrada ---------- */

  const itemEquivalente = (existente, campos, categoria) => {
    const norm = (s) => (s || "").trim().toLowerCase();
    if (categoria === "Hormônio") return norm(existente.produtoComercial) === norm(campos.produtoComercial) && existente.hormonio === campos.hormonio;
    if (categoria === "Sêmen") return norm(existente.touro) === norm(campos.touro) && norm(existente.partida) === norm(campos.partida);
    if (categoria === "Medicamento") return norm(existente.produtoComercial) === norm(campos.produtoComercial) && existente.tipoMedicamento === campos.tipoMedicamento;
    if (categoria === "Utensílio") return norm(existente.produtoComercial) === norm(campos.produtoComercial);
    return false;
  };

  const registrarEntradaEstoque = (categoria, camposItem, quantidade, data, obs, valorUnitario, local) => {
    const dono = local === "externo"
      ? { local: "externo", usuarioId: currentUser?.id, fazendaId: null }
      : { local: "fazenda", fazendaId: fazendaAtivaId, usuarioId: null };
    const existente = insumos.find((i) =>
      i.categoria === categoria && i.local === dono.local &&
      (dono.local === "externo" ? i.usuarioId === dono.usuarioId : i.fazendaId === dono.fazendaId) &&
      itemEquivalente(i, camposItem, categoria)
    );
    const insumoId = existente ? existente.id : uid("ins");
    if (existente) {
      setInsumos((a) => a.map((i) => i.id === insumoId ? { ...i, ...camposItem, estoque: i.estoque + quantidade, quantidade, valorUnitario } : i));
    } else {
      setInsumos((a) => [...a, { ...camposItem, id: insumoId, ...dono, categoria, quantidade, estoque: quantidade, valorUnitario }]);
    }
    setMovimentos((a) => [{ id: uid("mov"), tipo: "entrada", insumoId, quantidade, data, obs, valorUnitario, local: dono.local, fazendaId: fazendaAtivaId }, ...a]);
    marcaPendencia();
    return insumoId;
  };

  const registrarSaidaEstoque = (insumoId, quantidade, manejoId, tipoManejo) => {
    const item = insumos.find((i) => i.id === insumoId);
    setInsumos((a) => a.map((i) => i.id === insumoId ? { ...i, estoque: Math.max(0, i.estoque - quantidade) } : i));
    setMovimentos((a) => [{ id: uid("mov"), tipo: "saida", insumoId, quantidade, data: todayISO(), manejoId, tipoManejo, local: item?.local || "fazenda", fazendaId: fazendaAtivaId }, ...a]);
  };

  const removerEntradaEstoque = (movimentoId) => {
    const mov = movimentos.find((m) => m.id === movimentoId);
    if (!mov || mov.tipo !== "entrada") return;
    setInsumos((a) => a.map((i) => i.id === mov.insumoId ? { ...i, estoque: Math.max(0, i.estoque - mov.quantidade) } : i));
    setMovimentos((a) => a.filter((m) => m.id !== movimentoId));
    marcaPendencia();
  };

  const registrarManejo = (manejo) => {
    const id = uid("man");
    // respeita uma data escolhida na tela (permite registro retroativo); se nada for
    // enviado, usa a data de hoje como padrão.
    const manejoCompleto = { ...manejo, id, data: manejo.data || todayISO(), operador: currentUser.nome, fazendaId: fazendaAtivaId, safraId: safraAtivaId || null };
    setManejos((a) => [manejoCompleto, ...a]);
    marcaPendencia();
    gerarPreAgendamentos(manejoCompleto);
    return id;
  };

  const atualizarManejo = (id, campos) => {
    setManejos((a) => a.map((m) => m.id === id ? { ...m, ...campos } : m));
    marcaPendencia();
  };

  // remove um manejo e devolve ao estoque tudo que havia sido descontado por ele
  const removerManejo = (id) => {
    const saidasDoManejo = movimentos.filter((mv) => mv.tipo === "saida" && mv.manejoId === id);
    if (saidasDoManejo.length > 0) {
      setInsumos((a) => a.map((i) => {
        const total = saidasDoManejo.filter((mv) => mv.insumoId === i.id).reduce((soma, mv) => soma + mv.quantidade, 0);
        return total > 0 ? { ...i, estoque: i.estoque + total } : i;
      }));
      setMovimentos((a) => a.filter((mv) => !(mv.tipo === "saida" && mv.manejoId === id)));
    }
    setManejos((a) => a.filter((m) => m.id !== id));
    marcaPendencia();
  };

  /* ---------- pré-agendamentos automáticos, de acordo com o manejo (ou agendamento) de origem ---------- */

  const gerarPreAgendamentos = (m) => {
    const addDiasISO = (iso, n) => ymd(addDays(parseISODate(iso), n));
    const base = { loteNome: m.loteNome || "", retiroId: m.retiroId || null, ordem: m.ordem || null, origemAgendamentoId: m.origemAgendamentoId || null, numeroAnimais: m.numeroAnimais || null };
    const sugerir = (tipo, dias, dataBase = m.data) => {
      const data = addDiasISO(dataBase, dias);
      criarPreAgendamento({ ...base, tipo, data, titulo: `${tipo} — ${base.loteNome}` });
    };

    if (m.tipo === "inducao") {
      sugerir("D0", 30);
    } else if (m.tipo === "implantacao" || m.tipo === "ressinc") {
      if (m.tipoManejo === "3 manejos") {
        const x = parseInt((m.protocolo || "").replace(/\D/g, ""), 10);
        if (x) sugerir("Retirada", x);
      } else if (m.tipoManejo === "4 manejos") {
        sugerir("PGF 5", 7);
        sugerir("Retirada", 9);
      }
    } else if (m.tipo === "retirada") {
      sugerir("Inseminação", 2);
    } else if (m.tipo === "inseminacao") {
      sugerir("Diagnóstico", 30);
    } else if (m.tipo === "repasse" && m.dataFim) {
      sugerir("Diagnóstico - repasse", 30, m.dataFim);
    }
  };

  /* ---------- agenda ---------- */
  /* origem: "manual" (criado pelo operador) ou "automatico" (sugerido a partir de um manejo — ou de
     outro agendamento — fica com status "pendente" até o operador confirmar).
     origemAgendamentoId: quando um agendamento é sugerido a partir de outro agendamento (ex: Retirada
     sugerida a partir de um D0), guarda o id do agendamento de origem. Ao editar o agendamento
     de origem, os agendamentos que dependem dele são recriados com base nos novos dados. */

  const addAgendamento = (ag) => {
    const id = uid("ag");
    setAgendamentos((a) => [...a, { ...ag, id, fazendaId: fazendaAtivaId, origem: "manual", status: "confirmado" }]);
    marcaPendencia();
    const tipoInterno = TIPO_AGENDAMENTO_PARA_MANEJO[ag.tipo];
    if (tipoInterno) {
      gerarPreAgendamentos({
        tipo: tipoInterno, data: ag.data, loteNome: ag.loteNome, retiroId: ag.retiroId, ordem: ag.ordem,
        tipoManejo: ag.tipoManejo, protocolo: ag.protocolo, origemAgendamentoId: id,
      });
    }
  };

  const existeSugestaoDeInseminacao = (retiradaId) =>
    agendamentos.some((ag) => ag.origemAgendamentoId === retiradaId && ag.tipo === "Inseminação" && ag.status !== "descartado");

  // Duplicidades (mesmo lote + mesma ordem + mesmo manejo) não são bloqueadas na criação: elas
  // aparecem normalmente e o próprio usuário decide qual manter, na seção "Agendamentos duplicados"
  // da Agenda (veja gruposDuplicados em AbaAgenda).
  const criarPreAgendamento = (ag) => {
    const id = uid("ag");
    setAgendamentos((a) => [...a, { ...ag, id, fazendaId: fazendaAtivaId, origem: "automatico", status: "pendente" }]);
    marcaPendencia();
    // a retirada, assim que agendada (mesmo ainda pendente de confirmação), já sugere a inseminação
    if (ag.tipo === "Retirada") {
      gerarPreAgendamentos({ tipo: "retirada", data: ag.data, loteNome: ag.loteNome, retiroId: ag.retiroId, ordem: ag.ordem, origemAgendamentoId: id, numeroAnimais: ag.numeroAnimais || null });
    }
  };

  const confirmarAgendamento = (id) => {
    setAgendamentos((a) => a.map((ag) => ag.id === id ? { ...ag, status: "confirmado" } : ag));
    marcaPendencia();
    const ag = agendamentos.find((x) => x.id === id);
    if (ag && ag.tipo === "Retirada" && !existeSugestaoDeInseminacao(id)) {
      gerarPreAgendamentos({ tipo: "retirada", data: ag.data, loteNome: ag.loteNome, retiroId: ag.retiroId, ordem: ag.ordem, origemAgendamentoId: id, numeroAnimais: ag.numeroAnimais || null });
    }
  };

  const descartarAgendamento = (id) => {
    setAgendamentos((a) => a.map((ag) => ag.id === id ? { ...ag, status: "descartado" } : ag));
  };

  const removerAgendamento = (id) => {
    setAgendamentos((a) => a.filter((ag) => ag.id !== id));
  };

  const atualizarAgendamento = (id, campos) => {
    const atual = agendamentos.find((ag) => ag.id === id);
    const atualizado = atual ? { ...atual, ...campos } : null;

    // atualiza o agendamento e remove os agendamentos que haviam sido sugeridos a partir dele,
    // já que os critérios (data, número de manejos, protocolo etc.) podem ter mudado
    setAgendamentos((a) => a.map((ag) => ag.id === id ? { ...ag, ...campos } : ag).filter((ag) => ag.origemAgendamentoId !== id));
    marcaPendencia();

    if (atualizado) {
      const tipoInterno = TIPO_AGENDAMENTO_PARA_MANEJO[atualizado.tipo];
      if (tipoInterno) {
        gerarPreAgendamentos({
          tipo: tipoInterno, data: atualizado.data, loteNome: atualizado.loteNome, retiroId: atualizado.retiroId, ordem: atualizado.ordem,
          tipoManejo: atualizado.tipoManejo, protocolo: atualizado.protocolo, origemAgendamentoId: id,
        });
      }
    }
  };

  /* ---------- navegação ---------- */

  const NAV = currentUser?.perfil === "Supervisor"
    ? [
        { key: "relatorios", label: "Relatórios", icon: ClipboardList },
        { key: "benchmarking", label: "Benchmarking", icon: TrendingUp },
        { key: "exportacoes", label: "Exportações", icon: FileDown },
      ]
    : currentUser?.perfil === "Administrador"
    ? [
        { key: "cadastros", label: "Cadastros", icon: Layers },
        { key: "usuarios", label: "Usuários", icon: Users },
        { key: "relatorios", label: "Relatórios", icon: ClipboardList },
        { key: "benchmarking", label: "Benchmarking", icon: TrendingUp },
        { key: "exportacoes", label: "Exportações", icon: FileDown },
      ]
    : [
        { key: "manejo", label: "Registrar manejo", icon: Syringe },
        { key: "agenda", label: "Agenda", icon: Calendar },
        { key: "estoque", label: "Estoque", icon: Warehouse },
        { key: "relatorios", label: "Relatórios", icon: ClipboardList },
        { key: "benchmarking", label: "Benchmarking", icon: TrendingUp },
        { key: "exportacoes", label: "Exportações", icon: FileDown },
      ];

  const SUBTABS = {
    cadastros: [
      { key: "fazenda", label: "Fazenda", icon: Home },
      { key: "importar", label: "Importar histórico", icon: Upload },
    ],
    manejo: [
      { key: "inducao", label: "Indução", icon: Syringe },
      { key: "implantacao", label: "D0", icon: ImplantIcon },
      { key: "retirada", label: "Retirada", icon: Syringe },
      { key: "inseminacao", label: "Inseminação", icon: SpermIcon },
      { key: "diagnostico", label: "Diagnóstico", icon: UltrasoundIcon },
      { key: "repasse", label: "Repasse", icon: RefreshCw },
      { key: "diagnostico_final", label: "Diagnóstico Final", icon: Search },
    ],
    estoque: [
      { key: "entrada", label: "Entrada", icon: ArrowDownToLine },
      { key: "saida", label: "Saída", icon: ArrowUpFromLine },
      { key: "saldo", label: "Saldo", icon: Package },
    ],
  };

  React.useEffect(() => {
    if (!currentUser) return;
    if (currentUser.perfil === "Supervisor") { setSection("relatorios"); return; }
    if (currentUser.perfil === "Administrador") { setSection("cadastros"); setSub("fazenda"); return; }
    setSection("manejo");
  }, [currentUser]);

  React.useEffect(() => {
    if (SUBTABS[section]) setSub(SUBTABS[section][0].key);
  }, [section]);

  React.useEffect(() => {
    if (!safrasAtivas.some((s) => s.id === safraAtivaId)) setSafraAtivaId(safrasAtivas[0]?.id || "");
  }, [fazendaAtivaId, safras]);

  // Todo perfil (inclusive Administrador) só pode ter como fazenda ativa uma das fazendas atribuídas a ele
  React.useEffect(() => {
    if (!currentUser) return;
    const autorizadas = currentUser.fazendasAutorizadas || [];
    if (!autorizadas.includes(fazendaAtivaId)) setFazendaAtivaId(autorizadas[0] || "");
  }, [currentUser]);

  // ---------- layout responsivo: no celular a barra lateral vira um menu retrátil ----------
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 860 : false);
  const [menuAberto, setMenuAberto] = useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const aoMudar = (e) => setIsMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", aoMudar) : mq.addListener(aoMudar);
    setIsMobile(mq.matches);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", aoMudar) : mq.removeListener(aoMudar));
  }, []);
  // fecha o menu automaticamente ao trocar de seção/aba (celular)
  React.useEffect(() => { setMenuAberto(false); }, [section, sub]);

  if (!sessaoAuthCarregada) return null; // evita piscar a tela de login antes de checar sessão salva
  if (!currentUser) return <Login users={users} onLoginLocal={setCurrentUser} onEntrarReal={entrarComEmailSenha} />;
  if (currentUser._aguardandoPerfil) {
    return (
      <div style={{ minHeight: "100vh", background: "#F7F7F7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Work Sans', sans-serif", color: "#6B685E", fontSize: 13, padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          {!erroPerfil ? (
            "Carregando seu perfil…"
          ) : (
            <>
              <p style={{ color: "#A32D2D", marginBottom: 14 }}>
                Não foi possível carregar seu perfil.<br />
                <span style={{ fontSize: 12, color: "#8A3E15" }}>{erroPerfil}</span>
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <BtnPrimary onClick={() => { setErroPerfil(""); setCurrentUser((u) => ({ ...u })); }}>Tentar de novo</BtnPrimary>
                <BtnGhost onClick={() => (supabaseConfigurado ? sairDaConta() : setCurrentUser(null))}>Sair</BtnGhost>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Work Sans', sans-serif", minHeight: "100vh", background: "#F7F7F7", display: "flex" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Work+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        select, input { font-family: 'Work Sans', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #8B8676; padding: 8px 10px; border-bottom: 1px solid #E5DFCC; }
        td { padding: 9px 10px; font-size: 13.5px; color: #159FDB; border-bottom: 1px solid #F0F0F0; }
        tr:hover td { background: #F8F8F8; }
        /* campos de dose: remove as setas de aumentar/diminuir do number input, deixando livre para digitar */
        input.campo-dose::-webkit-outer-spin-button,
        input.campo-dose::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input.campo-dose { -moz-appearance: textfield; appearance: textfield; }
        /* Relatórios: 3 gráficos lado a lado no computador, empilhados no celular */
        .grid-relatorios-3 { grid-template-columns: repeat(3, 1fr); }
        @media (max-width: 860px) {
          th { font-size: 10.5px; padding: 7px 8px; }
          td { padding: 8px 8px; font-size: 13px; }
          .grid-relatorios-3 { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* fundo escurecido atrás do menu, no celular — toque para fechar */}
      {isMobile && menuAberto && (
        <div onClick={() => setMenuAberto(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }} />
      )}

      {/* SIDEBAR — fixa na lateral em telas largas; menu retrátil (fora da tela até abrir) no celular */}
      <aside style={{
        width: isMobile ? "82vw" : 224, maxWidth: isMobile ? 300 : "none",
        background: "#083C26", color: "#FFFFFF", display: "flex", flexDirection: "column", flexShrink: 0,
        ...(isMobile ? {
          position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 50,
          transform: menuAberto ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.22s ease", overflowY: "auto",
        } : {}),
      }}>
        <div style={{ padding: "20px 18px", display: "flex", alignItems: "center", gap: 9 }}>
          <img src={logoImg} alt="VArepro" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18 }}>VArepro</div>
          {isMobile && (
            <button onClick={() => setMenuAberto(false)} aria-label="Fechar menu"
              style={{ marginLeft: "auto", background: "none", border: "none", color: "#FFFFFF", cursor: "pointer", padding: 4 }}>
              <X size={20} />
            </button>
          )}
        </div>

        <nav style={{ padding: "6px 10px", flex: 1 }}>
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = section === n.key;
            const pendentes = n.key === "agenda" ? agendamentosVisiveis.filter((a) => a.status === "pendente").length : 0;
            return (
              <button key={n.key} onClick={() => setSection(n.key)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", marginBottom: 3, borderRadius: 8, border: "none",
                  background: active ? "#166336" : "transparent", color: active ? "#FFFFFF" : "#CCCCCC",
                  fontSize: 13.5, fontWeight: 500, cursor: "pointer", textAlign: "left",
                }}>
                <Icon size={16} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {pendentes > 0 && (
                  <span style={{ background: "#EFC257", color: "#4A2E10", fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: "1px 7px" }}>{pendentes}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: 12, borderTop: "1px solid #3F5B49" }}>
          {currentUser?.perfil !== "Administrador" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9FA890", textTransform: "uppercase", letterSpacing: "0.4px", padding: "0 10px 5px" }}>Fazenda ativa</div>
                <select
                  value={fazendaAtivaId}
                  onChange={(e) => setFazendaAtivaId(e.target.value)}
                  style={{
                    width: "100%", background: "#166336", color: "#FFFFFF", border: "1px solid #4C6E56",
                    borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  }}>
                  {fazendasVisiveis.length === 0 && <option value="">Nenhuma fazenda</option>}
                  {fazendasVisiveis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9FA890", textTransform: "uppercase", letterSpacing: "0.4px", padding: "0 10px 5px" }}>Safra ativa</div>
                <select
                  value={safraAtivaId}
                  onChange={(e) => setSafraAtivaId(e.target.value)}
                  style={{
                    width: "100%", background: "#166336", color: "#FFFFFF", border: "1px solid #4C6E56",
                    borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  }}>
                  {safrasAtivas.length === 0 && <option value="">Nenhuma safra</option>}
                  {safrasAtivas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
            </>
          )}
          <div style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #3F5B49", marginBottom: 8, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#CCCCCC", marginBottom: supabaseConfigurado ? 6 : 0 }}>
              {online ? <Wifi size={14} color="#8FBF7A" /> : <WifiOff size={14} color="#E3A45C" />}
              {online ? "Conectado" : "Sem internet — salvando localmente"}
              {pendencias > 0 && ` · ${pendencias} alteração(ões) não sincronizada(s)`}
            </div>
            {supabaseConfigurado && (
              <button onClick={sincronizarAgora} disabled={!online || sincronizando}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "6px 8px", borderRadius: 6, border: "1px solid #4C6E56",
                  background: "transparent", color: online ? "#CCCCCC" : "#6B7A6F", fontSize: 11.5,
                  cursor: online && !sincronizando ? "pointer" : "not-allowed",
                }}>
                <RefreshCw size={12} />
                {sincronizando ? "Sincronizando…" : ultimaSincronizacao ? "Sincronizar agora" : "Sincronizar pela 1ª vez"}
              </button>
            )}
            {erroSincronizacao && (
              <p style={{ fontSize: 10.5, color: "#E3A45C", margin: "6px 0 0", lineHeight: 1.4 }}>⚠ {erroSincronizacao}</p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#EFC257", color: "#4A2E10", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {currentUser.nome.split(" ").map((s) => s[0]).slice(0, 2).join("")}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.nome}</div>
              <div style={{ fontSize: 10.5, color: "#9FA890" }}>{currentUser.perfil}</div>
            </div>
            <button onClick={() => (supabaseConfigurado ? sairDaConta() : setCurrentUser(null))} title="Sair" style={{ background: "transparent", border: "none", color: "#CCCCCC", cursor: "pointer" }}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* CONTEÚDO */}
      <main style={{ flex: 1, minWidth: 0 }}>
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "#083C26", color: "#FFFFFF", position: "sticky", top: 0, zIndex: 20 }}>
            <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu"
              style={{ background: "none", border: "none", color: "#FFFFFF", cursor: "pointer", padding: 4, display: "flex" }}>
              <Menu size={22} />
            </button>
            <img src={logoImg} alt="VArepro" style={{ width: 26, height: 26, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} />
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 16 }}>VArepro</div>
          </div>
        )}
        {SUBTABS[section] && (
          <div className={isMobile ? "rola-horizontal" : ""} style={{ display: "flex", gap: 6, padding: isMobile ? "12px 14px 0" : "16px 28px 0", borderBottom: "1px solid #E5DFCC", background: "#FFFFFF", overflowX: isMobile ? "auto" : "visible" }}>
            {SUBTABS[section].map((t) => {
              const Icon = t.icon;
              const active = sub === t.key;
              const pendentesSubtab = t.key === "implantacao" ? sugestoesRessincAtivas.length : t.key === "repasse" ? sugestoesRepasseAtivas.length : 0;
              return (
                <button key={t.key} onClick={() => setSub(t.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "9px 14px",
                    border: "none", borderBottom: active ? "2px solid #166336" : "2px solid transparent",
                    background: "transparent", color: active ? "#166336" : "#6B685E",
                    fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: -1,
                  }}>
                  <Icon size={14} />
                  {t.label}
                  {pendentesSubtab > 0 && (
                    <span style={{ background: "#166336", color: "#FFFFFF", fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: "1px 7px" }}>{pendentesSubtab}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ padding: isMobile ? "16px 14px 60px" : "26px 28px 60px", maxWidth: isMobile ? "100%" : 1320 }}>
          {/* Cada aba fica sempre montada (só escondida via CSS) para não perder o que foi digitado
              e ainda não registrado ao trocar de aba. */}
          <div style={{ display: section === "cadastros" && sub === "fazenda" ? "block" : "none" }}>
            <AbaFazenda fazendas={fazendasVisiveis} retiros={retiros} safras={safras} addFazenda={addFazenda} addRetiro={addRetiro} removeRetiro={removeRetiro}
              addSafra={addSafra} removeSafra={removeSafra} fazendaAtivaId={fazendaAtivaId} setFazendaAtivaId={setFazendaAtivaId} />
          </div>
          <div style={{ display: section === "cadastros" && sub === "importar" ? "block" : "none" }}>
            <AbaImportarHistorico fazendaAtiva={fazendaAtiva} lotes={lotesDaFazenda} importarLotesHistoricos={importarLotesHistoricos} />
          </div>

          <div style={{ display: section === "manejo" && sub === "inducao" ? "block" : "none" }}>
            <AbaManejoSimples tipo="inducao" fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} retiros={retirosAtivos} insumos={insumosAtivos}
              registrarManejo={registrarManejo} registrarSaidaEstoque={registrarSaidaEstoque} manejos={manejosAtivos}
              addLote={addLote} atualizarLote={atualizarLote} atualizarManejo={atualizarManejo} removerManejo={removerManejo} />
          </div>
          <div style={{ display: section === "manejo" && sub === "implantacao" ? "block" : "none" }}>
            <AbaImplantacao fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} retiros={retirosAtivos} insumos={insumosAtivos}
              registrarManejo={registrarManejo} registrarSaidaEstoque={registrarSaidaEstoque} manejos={manejosAtivos}
              addLote={addLote} atualizarLote={atualizarLote} atualizarManejo={atualizarManejo} removerManejo={removerManejo}
              sugestoesRessinc={sugestoesRessincAtivas} descartarSugestaoRessinc={descartarSugestaoRessinc} removerSugestaoRessinc={removerSugestaoRessinc}
              protocolosPadraoDaFazenda={protocolosPadraoDaFazenda} addProtocoloPadraoSeNovo={addProtocoloPadraoSeNovo} />
          </div>
          <div style={{ display: section === "manejo" && sub === "retirada" ? "block" : "none" }}>
            <AbaRetirada fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} insumos={insumosAtivos}
              registrarManejo={registrarManejo} registrarSaidaEstoque={registrarSaidaEstoque} manejos={manejosAtivos}
              atualizarManejo={atualizarManejo} removerManejo={removerManejo}
              protocolosPadraoDaFazenda={protocolosPadraoDaFazenda} addProtocoloPadraoSeNovo={addProtocoloPadraoSeNovo} />
          </div>
          <div style={{ display: section === "manejo" && sub === "inseminacao" ? "block" : "none" }}>
            <AbaInseminacao fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} retiros={retirosAtivos} insumos={insumosAtivos} registrarManejo={registrarManejo}
              registrarSaidaEstoque={registrarSaidaEstoque} manejos={manejosAtivos} addAnimalAoLote={addAnimalAoLote} atribuirManejosRetroativos={atribuirManejosRetroativos}
              atribuirManejosRetroativosPorOrdem={atribuirManejosRetroativosPorOrdem} garantirLoteDesconhecidos={garantirLoteDesconhecidos}
              atualizarManejo={atualizarManejo} removerManejo={removerManejo}
              rascunhos={rascunhos} salvarRascunho={salvarRascunho} limparRascunho={limparRascunho} currentUser={currentUser} />
          </div>
          <div style={{ display: section === "manejo" && sub === "diagnostico" ? "block" : "none" }}>
            <AbaDiagnostico fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} insumos={insumosAtivos} registrarManejo={registrarManejo}
              registrarSaidaEstoque={registrarSaidaEstoque} manejos={manejosAtivos} atualizarLote={atualizarLote}
              addAnimalAoLote={addAnimalAoLote} atribuirManejosRetroativos={atribuirManejosRetroativos} garantirLoteDesconhecidos={garantirLoteDesconhecidos}
              criarSugestaoRessinc={criarSugestaoRessinc} criarSugestaoRepasse={criarSugestaoRepasse} atualizarManejo={atualizarManejo} removerManejo={removerManejo}
              rascunhos={rascunhos} salvarRascunho={salvarRascunho} limparRascunho={limparRascunho} />
          </div>
          <div style={{ display: section === "manejo" && sub === "repasse" ? "block" : "none" }}>
            <AbaRepasse fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} retiros={retirosAtivos} registrarManejo={registrarManejo}
              manejos={manejosAtivos} atualizarManejo={atualizarManejo} removerManejo={removerManejo}
              sugestoesRepasse={sugestoesRepasseAtivas} descartarSugestaoRepasse={descartarSugestaoRepasse} removerSugestaoRepasse={removerSugestaoRepasse} />
          </div>
          <div style={{ display: section === "manejo" && sub === "diagnostico_final" ? "block" : "none" }}>
            <AbaDiagnosticoFinal fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} retiros={retirosAtivos} insumos={insumosAtivos} manejos={manejosAtivos}
              rascunhos={rascunhos} salvarRascunho={salvarRascunho} limparRascunho={limparRascunho} />
          </div>

          <div style={{ display: section === "estoque" && sub === "entrada" ? "block" : "none" }}>
            <AbaEstoqueEntrada fazendaAtiva={fazendaAtiva} currentUser={currentUser} insumos={insumosAtivos} movimentos={movimentosAtivos} registrarEntradaEstoque={registrarEntradaEstoque} removerEntradaEstoque={removerEntradaEstoque} />
          </div>
          <div style={{ display: section === "estoque" && sub === "saida" ? "block" : "none" }}>
            <AbaEstoqueSaida fazendaAtiva={fazendaAtiva} insumos={insumosAtivos} movimentos={movimentosAtivos} manejos={manejosAtivos} />
          </div>
          <div style={{ display: section === "estoque" && sub === "saldo" ? "block" : "none" }}>
            <AbaEstoqueSaldo fazendaAtiva={fazendaAtiva} insumos={insumosAtivos} />
          </div>

          <div style={{ display: section === "agenda" ? "block" : "none" }}>
            <AbaAgenda fazendaAtiva={fazendaAtiva} fazendas={fazendasVisiveis} lotes={lotesAtivos} retiros={retirosAtivos} agendamentos={agendamentosVisiveis}
              addAgendamento={addAgendamento} confirmarAgendamento={confirmarAgendamento}
              descartarAgendamento={descartarAgendamento} removerAgendamento={removerAgendamento} atualizarAgendamento={atualizarAgendamento} />
          </div>

          <div style={{ display: section === "usuarios" ? "block" : "none" }}>
            <AbaUsuarios users={users} fazendas={fazendasVisiveis} addUsuario={addUsuario} toggleAutorizacaoFazenda={toggleAutorizacaoFazenda} />
          </div>
          <div style={{ display: section === "relatorios" ? "block" : "none" }}>
            <AbaRelatorios fazendaAtiva={fazendaAtiva} lotes={lotesAtivos} retiros={retirosAtivos} insumos={insumosAtivos} manejos={manejosAtivos} movimentos={movimentosAtivos} perfil={currentUser.perfil} />
          </div>
          <div style={{ display: section === "benchmarking" ? "block" : "none" }}>
            <AbaBenchmarking fazendaAtiva={fazendaAtiva} fazendaAtivaId={fazendaAtivaId} manejosDoGrupo={manejos} safraAtiva={safraAtiva} safras={safras} />
          </div>
          <div style={{ display: section === "exportacoes" ? "block" : "none" }}>
            <AbaExportacoes fazendaAtiva={fazendaAtiva} safraAtiva={safraAtiva} lotes={lotesAtivos} retiros={retirosAtivos} insumos={insumosAtivos} manejos={manejosAtivos} />
          </div>
        </div>
      </main>
    </div>
  );
}

/* =========================================================
   CADASTROS
========================================================= */

function AbaFazenda({ fazendas, retiros, safras, addFazenda, addRetiro, removeRetiro, addSafra, removeSafra, fazendaAtivaId, setFazendaAtivaId }) {
  const empty = { nome: "", municipio: "", areaTotal: "", proprietario: "", responsavel: "", telefone: "" };
  const [form, setForm] = useState(empty);
  const [retirosNovos, setRetirosNovos] = useState([]); // nomes ainda não salvos, junto com a fazenda
  const [nomeRetiro, setNomeRetiro] = useState("");
  const [safrasNovas, setSafrasNovas] = useState([]); // anos de início ainda não salvos, junto com a fazenda
  const [anoSafra, setAnoSafra] = useState("");
  const [fazendaAberta, setFazendaAberta] = useState(null);
  const [nomeRetiroExistente, setNomeRetiroExistente] = useState("");
  const [anoSafraExistente, setAnoSafraExistente] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.nome.trim() !== "";

  const adicionarRetiroNovo = () => {
    if (!nomeRetiro.trim()) return;
    setRetirosNovos((a) => [...a, nomeRetiro.trim()]);
    setNomeRetiro("");
  };
  const removerRetiroNovo = (i) => setRetirosNovos((a) => a.filter((_, idx) => idx !== i));

  const adicionarSafraNova = () => {
    if (!anoSafra.trim() || !/^\d{4}$/.test(anoSafra.trim())) return;
    setSafrasNovas((a) => [...a, anoSafra.trim()]);
    setAnoSafra("");
  };
  const removerSafraNova = (i) => setSafrasNovas((a) => a.filter((_, idx) => idx !== i));

  const salvarFazenda = () => {
    addFazenda(form, retirosNovos, safrasNovas);
    setForm(empty);
    setRetirosNovos([]);
    setSafrasNovas([]);
  };

  const retirosDe = (fazId) => retiros.filter((r) => r.fazendaId === fazId);
  const safrasDe = (fazId) => safras.filter((s) => s.fazendaId === fazId);
  const adicionarRetiroExistente = (fazId) => {
    if (!nomeRetiroExistente.trim()) return;
    addRetiro({ fazendaId: fazId, nome: nomeRetiroExistente.trim() });
    setNomeRetiroExistente("");
  };
  const adicionarSafraExistente = (fazId) => {
    if (!anoSafraExistente.trim() || !/^\d{4}$/.test(anoSafraExistente.trim())) return;
    addSafra(fazId, anoSafraExistente.trim());
    setAnoSafraExistente("");
  };

  return (
    <div>
      <SectionTitle icon={Home} title="Fazendas" subtitle="Cadastre a propriedade e já informe os retiros (subdivisões) e as safras que ela possui. A fazenda ativa (menu lateral) é a que recebe lotes, insumos, manejos e estoque lançados no sistema." />

      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          <Field label="Nome da fazenda"><input style={inputStyle} value={form.nome} onChange={set("nome")} placeholder="Ex: Fazenda Santa Fé" /></Field>
          <Field label="Município"><input style={inputStyle} value={form.municipio} onChange={set("municipio")} placeholder="Ex: Querência - MT" /></Field>
          <Field label="Área total (ha)"><input style={inputStyle} type="number" value={form.areaTotal} onChange={set("areaTotal")} placeholder="0" /></Field>
          <Field label="Proprietário"><input style={inputStyle} value={form.proprietario} onChange={set("proprietario")} /></Field>
          <Field label="Responsável"><input style={inputStyle} value={form.responsavel} onChange={set("responsavel")} /></Field>
          <Field label="Telefone para contato"><input style={inputStyle} value={form.telefone} onChange={set("telefone")} placeholder="(00) 00000-0000" /></Field>
        </div>

        <Field label="Retiros desta fazenda">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={inputStyle} placeholder="Ex: Retiro do Brejo" value={nomeRetiro}
              onChange={(e) => setNomeRetiro(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarRetiroNovo())} />
            <BtnGhost onClick={adicionarRetiroNovo}><Plus size={14} /> Adicionar</BtnGhost>
          </div>
          {retirosNovos.length === 0 ? (
            <span style={{ fontSize: 12, color: "#9B9686" }}>Nenhum retiro adicionado ainda (opcional).</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {retirosNovos.map((nome, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EEEEEE", border: "1px solid #DDDDDD", borderRadius: 20, padding: "4px 10px", fontSize: 12.5 }}>
                  <Building2 size={12} /> {nome}
                  <button onClick={() => removerRetiroNovo(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D", display: "flex" }}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </Field>

        <Field label="Safras desta fazenda">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={{ ...inputStyle, maxWidth: 140 }} type="number" placeholder="Ano de início, ex: 2025" value={anoSafra}
              onChange={(e) => setAnoSafra(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarSafraNova())} />
            <BtnGhost onClick={adicionarSafraNova}><Plus size={14} /> Adicionar</BtnGhost>
          </div>
          {safrasNovas.length === 0 ? (
            <span style={{ fontSize: 12, color: "#9B9686" }}>Nenhuma safra adicionada ainda (opcional). Formato gerado automaticamente: ano/ano.</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {safrasNovas.map((ano, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EEEEEE", border: "1px solid #DDDDDD", borderRadius: 20, padding: "4px 10px", fontSize: 12.5 }}>
                  <Calendar size={12} /> {ano}/{Number(ano) + 1}
                  <button onClick={() => removerSafraNova(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D", display: "flex" }}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </Field>

        <BtnPrimary disabled={!canSave} onClick={salvarFazenda}>
          <Plus size={15} /> Salvar fazenda
        </BtnPrimary>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Fazendas cadastradas</div>
      {fazendas.length === 0 ? (
        <EmptyState text="Nenhuma fazenda cadastrada ainda." />
      ) : (
        <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Fazenda</th>
                <th>Município</th>
                <th>Área (ha)</th>
                <th>Proprietário</th>
                <th>Responsável</th>
                <th>Telefone</th>
                <th>Retiros</th>
                <th>Safras</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fazendas.map((f) => {
                const rets = retirosDe(f.id);
                const safs = safrasDe(f.id);
                const aberta = fazendaAberta === f.id;
                const ativa = f.id === fazendaAtivaId;
                return (
                  <React.Fragment key={f.id}>
                    <tr onClick={() => setFazendaAberta(aberta ? null : f.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>{f.nome}</span>
                          {ativa && <span style={{ fontSize: 10, fontWeight: 700, color: "#2A4531", background: "#E6EFE5", borderRadius: 20, padding: "2px 8px" }}>ATIVA</span>}
                        </div>
                      </td>
                      <td>{f.municipio || "—"}</td>
                      <td>{f.areaTotal || "—"}</td>
                      <td>{f.proprietario || "—"}</td>
                      <td>{f.responsavel || "—"}</td>
                      <td>{f.telefone || "—"}</td>
                      <td>{rets.length}</td>
                      <td>{safs.length}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                          {!ativa && (
                            <BtnGhost onClick={(e) => { e.stopPropagation(); setFazendaAtivaId(f.id); }}>Usar</BtnGhost>
                          )}
                          <ChevronRight size={15} color="#9B9686" style={{ transform: aberta ? "rotate(90deg)" : "none" }} />
                        </div>
                      </td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={9} style={{ background: "#FFFFFF", padding: "14px 16px" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Retiros de {f.nome}</div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 10, maxWidth: 380 }}>
                            <input style={inputStyle} placeholder="Nome do novo retiro" value={nomeRetiroExistente}
                              onChange={(e) => setNomeRetiroExistente(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && adicionarRetiroExistente(f.id)} />
                            <BtnPrimary onClick={() => adicionarRetiroExistente(f.id)}><Plus size={15} /></BtnPrimary>
                          </div>
                          {rets.length === 0 ? <EmptyState text="Nenhum retiro cadastrado para esta fazenda." /> : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                              {rets.map((r) => (
                                <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EEEEEE", border: "1px solid #DDDDDD", borderRadius: 20, padding: "4px 10px", fontSize: 12.5 }}>
                                  <Building2 size={12} /> {r.nome}
                                  <button onClick={() => removeRetiro(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D", display: "flex" }}><X size={12} /></button>
                                </span>
                              ))}
                            </div>
                          )}

                          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8, marginTop: rets.length === 0 ? 0 : 16 }}>Safras de {f.nome}</div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 10, maxWidth: 380 }}>
                            <input style={inputStyle} type="number" placeholder="Ano de início, ex: 2025" value={anoSafraExistente}
                              onChange={(e) => setAnoSafraExistente(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && adicionarSafraExistente(f.id)} />
                            <BtnPrimary onClick={() => adicionarSafraExistente(f.id)}><Plus size={15} /></BtnPrimary>
                          </div>
                          {safs.length === 0 ? <EmptyState text="Nenhuma safra cadastrada para esta fazenda." /> : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {safs.map((s) => (
                                <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#EEEEEE", border: "1px solid #DDDDDD", borderRadius: 20, padding: "4px 10px", fontSize: 12.5 }}>
                                  <Calendar size={12} /> {s.nome}
                                  <button onClick={() => removeSafra(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D", display: "flex" }}><X size={12} /></button>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CATEGORIAS_LOTE = ["Nulípara", "Primípara", "Multípara"];


const HORMONIOS = ["Progesterona", "Progesterona injetável", "Prostaglandina", "Cipionato", "Benzoato", "GnRH", "ECG", "HCG"];
const UNIDADES_EMBALAGEM = ["unid", "mL"];
const TIPOS_MEDICAMENTO = ["Suplemento", "Vermífugo", "Vacina", "Outro"];
const CATEGORIAS_ESTOQUE = ["Hormônios", "Sêmen", "Medicamentos", "Utensílios"];


/* =========================================================
   IMPORTAR HISTÓRICO — sobe uma planilha (.xlsx) com lotes, animais e o
   histórico de Inseminação/Diagnóstico de safras anteriores, e já cadastra
   tudo de uma vez (criando safra/retiro/lote automaticamente quando ainda
   não existem, e um manejo de Inseminação/Diagnóstico por lote+ordem+data
   quando essas colunas estiverem preenchidas).
========================================================= */

const COLUNAS_IMPORTACAO_OBRIGATORIAS = ["safra", "retiro", "lote", "brinco"];
const MAPA_COLUNAS_IMPORTACAO = {
  safra: "safra",
  retiro: "retiro",
  lote: "lote",
  categoria: "categoria",
  brinco: "brinco", identificacao: "brinco", animal: "brinco",
  raca: "raca",
  mesdeparicao: "mesParicao", mesparicao: "mesParicao",
  ordem: "ordem",
  datainseminacao: "dataInseminacao", datadeinseminacao: "dataInseminacao",
  touro: "touro",
  datadiagnostico: "dataDiagnostico", datadodiagnostico: "dataDiagnostico",
  resultado: "resultado", resultadodiagnostico: "resultado", diagnostico: "resultado",
  tempodegestacaoinformado: "tempoGestacaoInformado", tempodegestacao: "tempoGestacaoInformado",
};
const normalizarCabecalho = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// aceita data já como objeto Date (célula formatada como data no Excel), como texto
// dd/mm/aaaa (comum no Brasil) ou já em aaaa-mm-dd — devolve sempre em aaaa-mm-dd.
const paraDataISO = (valor) => {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) {
    const ano = valor.getFullYear(), mes = String(valor.getMonth() + 1).padStart(2, "0"), dia = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  const texto = String(valor).trim();
  const m1 = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  const m2 = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
  return null;
};

function AbaImportarHistorico({ fazendaAtiva, lotes, importarLotesHistoricos }) {
  const [arquivoNome, setArquivoNome] = useState("");
  const [linhasValidas, setLinhasValidas] = useState([]);
  const [linhasComErro, setLinhasComErro] = useState([]);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState(null);
  const [importando, setImportando] = useState(false);
  const inputRef = React.useRef(null);

  const baixarModelo = () => {
    const dadosModelo = [
      { Safra: "2023/2024", Retiro: "Retiro 1", Lote: "Lote Antigo 01", Categoria: "Multípara", Brinco: "1234", Raça: "Nelore", "Mês de parição": "Março", Ordem: "1º IATF", "Data Inseminação": "15/09/2023", Touro: "Touro Zeus FIV", "Data Diagnóstico": "15/10/2023", Resultado: "Prenha", "Tempo de gestação informado": "" },
      { Safra: "2023/2024", Retiro: "Retiro 1", Lote: "Lote Antigo 01", Categoria: "Multípara", Brinco: "1235", Raça: "Nelore", "Mês de parição": "Março", Ordem: "1º IATF", "Data Inseminação": "15/09/2023", Touro: "Touro Zeus FIV", "Data Diagnóstico": "15/10/2023", Resultado: "Vazia", "Tempo de gestação informado": "" },
    ];
    const ws = XLSX.utils.json_to_sheet(dadosModelo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo");
    XLSX.writeFile(wb, "modelo-importacao-historico.xlsx");
  };

  const processarArquivo = (file) => {
    setErro(""); setResultado(null); setLinhasValidas([]); setLinhasComErro([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const linhasBrutas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        if (linhasBrutas.length === 0) { setErro("A planilha está vazia."); return; }

        const cabecalhos = Object.keys(linhasBrutas[0]);
        const mapaEncontrado = {};
        cabecalhos.forEach((c) => {
          const norm = normalizarCabecalho(c);
          if (MAPA_COLUNAS_IMPORTACAO[norm]) mapaEncontrado[c] = MAPA_COLUNAS_IMPORTACAO[norm];
        });
        const encontradas = Object.values(mapaEncontrado);
        const faltando = COLUNAS_IMPORTACAO_OBRIGATORIAS.filter((campo) => !encontradas.includes(campo));
        if (faltando.length > 0) {
          setErro(`Não encontrei as colunas obrigatórias: ${faltando.join(", ")}. Baixe o modelo abaixo para conferir os nomes esperados.`);
          return;
        }

        const validas = [];
        const comErro = [];
        linhasBrutas.forEach((linhaBruta, i) => {
          const linha = {};
          Object.entries(mapaEncontrado).forEach(([colOriginal, campo]) => {
            const bruto = linhaBruta[colOriginal];
            if (campo === "dataInseminacao" || campo === "dataDiagnostico") linha[campo] = paraDataISO(bruto) || "";
            else linha[campo] = String(bruto ?? "").trim();
          });
          if (!linha.safra || !linha.retiro || !linha.lote || !linha.brinco) comErro.push(i + 2);
          else validas.push(linha);
        });
        setLinhasValidas(validas);
        setLinhasComErro(comErro);
        setArquivoNome(file.name);
      } catch (err) {
        setErro("Não consegui ler esse arquivo. Confirme que é um .xlsx válido.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const lotesDistintos = new Set(linhasValidas.map((l) => `${l.safra}|${l.retiro}|${l.lote}`.toLowerCase())).size;
  const comInseminacao = linhasValidas.filter((l) => l.dataInseminacao).length;
  const comDiagnostico = linhasValidas.filter((l) => l.dataDiagnostico && l.resultado).length;

  const confirmarImportacao = () => {
    if (linhasValidas.length === 0) return;
    setImportando(true);
    const r = importarLotesHistoricos(linhasValidas);
    setResultado(r);
    setImportando(false);
    setLinhasValidas([]); setLinhasComErro([]); setArquivoNome("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <SectionTitle icon={Upload} title="Importar histórico" subtitle="Traga de uma vez os lotes, animais e o histórico de Inseminação/Diagnóstico de safras anteriores, a partir de uma planilha Excel." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para importar dados." />
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Como funciona</div>
            <p style={{ fontSize: 12.5, color: "#4A473E", lineHeight: 1.6, margin: "0 0 10px" }}>
              Uma linha por animal, com as colunas <strong>Safra</strong>, <strong>Retiro</strong>, <strong>Lote</strong> e <strong>Brinco</strong> (obrigatórias) —
              <strong> Categoria</strong>, <strong>Raça</strong> e <strong>Mês de parição</strong> são opcionais.
              Safras, retiros e lotes que ainda não existem são criados automaticamente; se um lote já existir (mesmo nome, safra e retiro), os animais novos são adicionados a ele.
            </p>
            <p style={{ fontSize: 12.5, color: "#4A473E", lineHeight: 1.6, margin: "0 0 14px" }}>
              Para trazer também o <strong>histórico de manejo</strong>, preencha ainda: <strong>Ordem</strong> (1º/2º/3º IATF — se vazio, assume 1º IATF),
              <strong> Data Inseminação</strong> e <strong>Touro</strong> (cria um manejo de Inseminação), e <strong>Data Diagnóstico</strong>, <strong>Resultado</strong> (P ou V) e
              <strong> Tempo de gestação informado</strong> (cria um manejo de Diagnóstico). Animais da mesma safra/lote/ordem/data são agrupados num único manejo, igual ao que
              aconteceria se tivessem sido lidos juntos na hora. Se o Touro informado já existir cadastrado no estoque de sêmen, o manejo já fica vinculado a ele.
            </p>
            <BtnGhost onClick={baixarModelo}><Download size={14} /> Baixar modelo de planilha</BtnGhost>
          </div>

          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Selecionar planilha</div>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) processarArquivo(f); }} style={inputStyle} />
            {erro && <p style={{ fontSize: 12.5, color: "#A32D2D", marginTop: 12 }}>⚠ {erro}</p>}

            {linhasValidas.length > 0 && (
              <div style={{ marginTop: 16, background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 8, padding: 14 }}>
                <p style={{ fontSize: 12.5, color: "#4A473E", margin: "0 0 6px" }}><strong>{arquivoNome}</strong></p>
                <p style={{ fontSize: 12.5, color: "#166336", margin: "0 0 4px" }}>✓ {linhasValidas.length} animal(is) lido(s), em {lotesDistintos} lote(s) distinto(s).</p>
                <p style={{ fontSize: 12.5, color: "#166336", margin: "0 0 4px" }}>
                  {comInseminacao > 0 ? `✓ ${comInseminacao} linha(s) com Inseminação` : "— nenhuma linha com Inseminação"}
                  {" · "}
                  {comDiagnostico > 0 ? `✓ ${comDiagnostico} linha(s) com Diagnóstico` : "nenhuma linha com Diagnóstico"}
                </p>
                {linhasComErro.length > 0 && (
                  <p style={{ fontSize: 12.5, color: "#166336", margin: "4px 0 0" }}>
                    ⚠ {linhasComErro.length} linha(s) ignorada(s) por faltar Safra, Retiro, Lote ou Brinco (linha(s) {linhasComErro.slice(0, 10).join(", ")}{linhasComErro.length > 10 ? "…" : ""} da planilha).
                  </p>
                )}
                <BtnPrimary onClick={confirmarImportacao} disabled={importando} style={{ marginTop: 12 }}>
                  {importando ? "Importando…" : `Confirmar importação (${linhasValidas.length} animais)`}
                </BtnPrimary>
              </div>
            )}

            {resultado && (
              <div style={{ marginTop: 16, background: "#E6EFE5", border: "1px solid #B7D4AC", borderRadius: 8, padding: 14 }}>
                <p style={{ fontSize: 12.5, color: "#2A4531", margin: 0, lineHeight: 1.6 }}>
                  ✓ Importação concluída: {resultado.safrasCriadas} safra(s) nova(s), {resultado.retirosCriados} retiro(s) novo(s), {resultado.lotesCriados} lote(s) novo(s)
                  {resultado.lotesAtualizados > 0 ? `, ${resultado.lotesAtualizados} lote(s) já existente(s) atualizado(s)` : ""}
                  {resultado.manejosCriados > 0 ? `, ${resultado.manejosCriados} manejo(s) de Inseminação/Diagnóstico criado(s)` : ""}
                  {resultado.manejosAtualizados > 0 ? `, ${resultado.manejosAtualizados} manejo(s) já existente(s) atualizado(s)` : ""} — {resultado.animaisImportados} animal(is) no total.
                </p>
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Lotes já cadastrados nesta fazenda</div>
          {lotes.length === 0 ? (
            <EmptyState text="Nenhum lote cadastrado ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead><tr><th>Lote</th><th>Categoria</th><th>Nº animais</th></tr></thead>
                <tbody>
                  {lotes.slice(0, 20).map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 700 }}>{l.nome}</td>
                      <td>{l.categoria || "—"}</td>
                      <td>{(l.animais || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   MANEJO — Indução / D0 / Retirada (padrão comum)
========================================================= */

const TITULOS_MANEJO = {
  inducao: "Indução",
  implantacao: "D0",
  retirada: "Retirada",
};

function AbaManejoSimples({ tipo, fazendaAtiva, safraAtiva, lotes, retiros, insumos, registrarManejo, registrarSaidaEstoque, manejos, addLote, atualizarManejo, removerManejo }) {
  const [localEstoque, setLocalEstoque] = useState("fazenda");
  const produtosTodos = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "Progesterona injetável");
  const produtos = produtosTodos.filter((i) => i.local === localEstoque);

  const [novoNome, setNovoNome] = useState("");
  const [novoRetiroId, setNovoRetiroId] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS_LOTE[0]);
  const [numeroAnimais, setNumeroAnimais] = useState("");
  const [dataManejo, setDataManejo] = useState(todayISO());
  const [produtoId, setProdutoId] = useState(produtos[0]?.id || "");
  const [quantidade, setQuantidade] = useState("");
  const [unidadeDose, setUnidadeDose] = useState(UNIDADES_EMBALAGEM[0]);
  const [comLeitura, setComLeitura] = useState(false);
  const [animaisLidos, setAnimaisLidos] = useState([]);
  useAvisarSaidaComPendencia(animaisLidos.length > 0);
  const [brinco, setBrinco] = useState("");
  const brincoInputRef = React.useRef(null);
  const [medicamentos, setMedicamentos] = useState([]);
  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  React.useEffect(() => {
    if (!produtos.some((p) => p.id === produtoId)) setProdutoId(produtos[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEstoque, produtos.map((p) => p.id).join(",")]);

  const lerAnimal = () => {
    if (!brinco.trim()) return;
    if (!animaisLidos.includes(brinco.trim())) setAnimaisLidos((a) => [...a, brinco.trim()]);
    setBrinco("");
  };

  // evita criar um lote duplicado (mesmo nome, na mesma fazenda/safra) a cada nova Indução registrada
  const nomeDuplicado = novoNome.trim() !== "" &&
    lotes.some((l) => l.nome.trim().toLowerCase() === novoNome.trim().toLowerCase());

  const canSave = !nomeDuplicado && novoNome.trim() !== "" && novoRetiroId !== "" && String(numeroAnimais).trim() !== "" && numBR(numeroAnimais) > 0 && produtoId !== "" && String(quantidade).trim() !== "" && numBR(quantidade) > 0;

  const submetendoRef = React.useRef(false);
  const salvar = () => {
    if (submetendoRef.current) return;
    const qtd = numBR(quantidade);
    if (nomeDuplicado) { setMsg("Já existe um lote com este nome nesta fazenda/safra. Use um nome diferente."); return; }
    if (!canSave) { setMsg("Preencha o lote, o retiro, o nº de animais, a progesterona injetável e uma quantidade válida."); return; }
    submetendoRef.current = true;

    const idDoLote = addLote({ retiroId: novoRetiroId, nome: novoNome, categoria, numeroAnimais: numBR(numeroAnimais), raca: null, mesParicao: null });

    const manejoId = registrarManejo({
      tipo, loteId: idDoLote, loteNome: novoNome, retiroId: novoRetiroId, categoria, numeroAnimais: numBR(numeroAnimais), produtoId, quantidade: qtd, unidade: unidadeDose, medicamentos,
      localEstoque, animaisLidos: comLeitura ? animaisLidos : [], data: dataManejo,
    });
    registrarSaidaEstoque(produtoId, qtd, manejoId, tipo);
    medicamentos.forEach((m) => registrarSaidaEstoque(m.medicamentoId, m.dose, manejoId, tipo));
    setNovoNome(""); setNovoRetiroId(""); setCategoria(CATEGORIAS_LOTE[0]); setNumeroAnimais(""); setDataManejo(todayISO()); setQuantidade(""); setAnimaisLidos([]); setMedicamentos([]); setMsg("Manejo registrado.");
    setTimeout(() => { submetendoRef.current = false; }, 0);
  };

  const historico = manejos.filter((m) => m.tipo === tipo).slice(0, 8);
  const nomeLote = (id) => lotes.find((l) => l.id === id)?.nome || "—";
  const nomeProduto = (id) => insumos.find((i) => i.id === id)?.produtoComercial || "—";

  const [editandoId, setEditandoId] = useState(null);
  const [editNumeroAnimais, setEditNumeroAnimais] = useState("");
  const [editCategoria, setEditCategoria] = useState(CATEGORIAS_LOTE[0]);
  const iniciarEdicaoHistorico = (m) => { setEditandoId(m.id); setEditNumeroAnimais(String(m.numeroAnimais ?? "")); setEditCategoria(m.categoria || CATEGORIAS_LOTE[0]); };
  const cancelarEdicaoHistorico = () => setEditandoId(null);
  const salvarEdicaoHistorico = () => {
    atualizarManejo(editandoId, { numeroAnimais: numBR(editNumeroAnimais), categoria: editCategoria });
    setEditandoId(null);
  };
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState(null);

  const bloqueadoSemPreRequisitos = !fazendaAtiva ? "fazenda" : !safraAtiva ? "safra" : produtosTodos.length === 0 ? "produto" : retiros.length === 0 ? "retiro" : null;

  return (
    <div>
      <SectionTitle icon={Syringe} title={TITULOS_MANEJO[tipo]} subtitle="Manejo opcional. Se for o primeiro manejo deste lote, ele já é criado aqui (Lote + Retiro)." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {bloqueadoSemPreRequisitos === "fazenda" ? (
        <EmptyState text="Selecione uma fazenda ativa para registrar manejos." />
      ) : bloqueadoSemPreRequisitos === "safra" ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos. Todo manejo e lote precisa pertencer a uma safra." />
      ) : bloqueadoSemPreRequisitos === "produto" ? (
        <EmptyState text="Cadastre ao menos um produto comercial de Progesterona injetável (Estoque > Entrada > Hormônios) desta fazenda antes de registrar este manejo." />
      ) : bloqueadoSemPreRequisitos === "retiro" ? (
        <EmptyState text="Esta fazenda ainda não tem retiros cadastrados. Adicione um retiro no cadastro de Fazenda antes de criar um lote por aqui." />
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Local de estoque</div>
            <SeletorLocalEstoque local={localEstoque} setLocal={setLocalEstoque} />
            {produtos.length === 0 && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>Nenhuma progesterona injetável cadastrada neste local de estoque.</p>
            )}
            {nomeDuplicado && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>Já existe um lote com este nome neste retiro. Use um nome diferente.</p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
              <Field label="Lote (nome)"><input style={inputStyle} value={novoNome} onChange={(e) => { limparMsgSeSucesso(); setNovoNome(e.target.value); }} placeholder="Ex: Lote 01" /></Field>
              <Field label="Categoria">
                <select style={inputStyle} value={categoria} onChange={(e) => { limparMsgSeSucesso(); setCategoria(e.target.value); }}>
                  {CATEGORIAS_LOTE.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Retiro">
                <select style={inputStyle} value={novoRetiroId} onChange={(e) => { limparMsgSeSucesso(); setNovoRetiroId(e.target.value); }}>
                  <option value="">Selecione um retiro</option>
                  {retiros.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </Field>
              <Field label="Nº de animais"><input style={inputStyle} type="number" min="1" value={numeroAnimais} onChange={(e) => { limparMsgSeSucesso(); setNumeroAnimais(e.target.value); }} placeholder="0" /></Field>
              <Field label="Data"><input style={inputStyle} type="date" value={dataManejo} onChange={(e) => { limparMsgSeSucesso(); setDataManejo(e.target.value); }} /></Field>
              <div style={{ display: "flex", gap: 10, alignItems: "end", gridColumn: "span 2" }}>
                <div style={{ flex: 2, minWidth: 0 }}>
                  <Field label="Progesterona injetável">
                    <select style={inputStyle} value={produtoId} onChange={(e) => { limparMsgSeSucesso(); setProdutoId(e.target.value); }}>
                      {produtos.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Dose"><input style={inputStyle} type="number" value={quantidade} onChange={(e) => { limparMsgSeSucesso(); setQuantidade(e.target.value); }} placeholder="0" /></Field>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Unidade">
                    <select style={inputStyle} value={unidadeDose} onChange={(e) => { limparMsgSeSucesso(); setUnidadeDose(e.target.value); }}>
                      {UNIDADES_EMBALAGEM.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 14px", cursor: "pointer" }} onClick={() => setComLeitura((v) => !v)}>
              {comLeitura ? <CheckCircle2 size={18} color="#166336" /> : <Circle size={18} color="#B0AA98" />}
              <span style={{ fontSize: 13, color: "#4A473E" }}>Registrar leitura individual dos animais (opcional)</span>
            </div>

            {comLeitura && (
              <div style={{ marginBottom: 14, background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR e Enter" value={brinco}
                    onChange={(e) => setBrinco(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lerAnimal()} />
                  <BtnPrimary onClick={lerAnimal}>Registrar animal</BtnPrimary>
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {animaisLidos.map((b) => {
                    const loteExistente = lotes.find((l) => (l.animais || []).includes(b));
                    return (
                      <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <EarTag size="sm">{b}</EarTag>
                        {loteExistente && <span style={{ fontSize: 10.5, color: "#166336" }}>({loteExistente.nome})</span>}
                      </span>
                    );
                  })}
                  {animaisLidos.length === 0 && <span style={{ fontSize: 12, color: "#9B9686" }}>Nenhum animal lido ainda.</span>}
                </div>
              </div>
            )}

            <CampoMedicamentos insumos={insumos} local={localEstoque} selecionados={medicamentos} setSelecionados={setMedicamentos} />

            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginBottom: 10 }}>{msg}</p>}
            <BtnPrimary disabled={!canSave} onClick={salvar}><Plus size={15} /> Registrar {TITULOS_MANEJO[tipo].toLowerCase()}</BtnPrimary>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>{TITULOS_MANEJO[tipo]}s registradas</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum registro ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Categoria</th>
                    <th>Nº animais</th>
                    <th>Progesterona injetável</th>
                    <th>Medicamentos</th>
                    <th>Local</th>
                    <th>Data</th>
                    <th>Leitura individual</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 700 }}>{nomeLote(m.loteId)}</td>
                      {editandoId === m.id ? (
                        <>
                          <td>
                            <select style={inputStyle} value={editCategoria} onChange={(e) => setEditCategoria(e.target.value)}>
                              {CATEGORIAS_LOTE.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td><input style={inputStyle} type="number" min="1" value={editNumeroAnimais} onChange={(e) => setEditNumeroAnimais(e.target.value)} /></td>
                        </>
                      ) : (
                        <>
                          <td>{m.categoria || "—"}</td>
                          <td>{m.numeroAnimais ?? "—"}</td>
                        </>
                      )}
                      <td>{nomeProduto(m.produtoId)} ({m.quantidade} {m.unidade || "un"})</td>
                      <td>{resumoMedicamentos(m.medicamentos, insumos)}</td>
                      <td>{m.localEstoque === "externo" ? "Externo" : "Fazenda"}</td>
                      <td>{fmtDate(m.data)}</td>
                      <td>{m.animaisLidos.length > 0 ? `${m.animaisLidos.length} animais` : "—"}</td>
                      <td>
                        {confirmandoExclusaoId === m.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                            <button onClick={() => { removerManejo(m.id); setConfirmandoExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : editandoId === m.id ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={salvarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                            <button onClick={cancelarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => iniciarEdicaoHistorico(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4A473E" }}><Pencil size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   IMPLANTAÇÃO — Implante (progesterona) + Benzoato + Prostaglandina,
   coleta os dados completos do lote e permite leitura individual
   opcional com ECC e Peso.
========================================================= */

const OPCOES_ECC = ["< 2,50", "2,50", "2,75", "3,00", "3,25", "3,50", "3,75", "4,00", "> 4,00"];

const TIPOS_MANEJO_IMPLANTACAO = ["3 manejos", "4 manejos"];
const PROTOCOLOS_IMPLANTACAO = ["7 dias", "8 dias", "9 dias"];
const protocolosPara = (tipoManejo) => tipoManejo === "4 manejos" ? ["8 dias", "9 dias"] : PROTOCOLOS_IMPLANTACAO;
const ORDENS_IATF = ["1º IATF", "2º IATF", "3º IATF"];
const proximaOrdem = (ordemAtual) => {
  const i = ORDENS_IATF.indexOf(ordemAtual);
  return i >= 0 && i < ORDENS_IATF.length - 1 ? ORDENS_IATF[i + 1] : ORDENS_IATF[0];
};

function AbaImplantacao({ fazendaAtiva, safraAtiva, lotes, retiros, insumos, registrarManejo, registrarSaidaEstoque, manejos, addLote, atualizarLote, atualizarManejo, removerManejo, sugestoesRessinc, descartarSugestaoRessinc, removerSugestaoRessinc, protocolosPadraoDaFazenda, addProtocoloPadraoSeNovo }) {
  const [abaInterna, setAbaInterna] = useState("d0"); // "d0" | "ressinc"

  const [localEstoque, setLocalEstoque] = useState("fazenda");
  const implantesTodos = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "Progesterona");
  const benzoatosTodos = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "Benzoato");
  const prostaglandinasTodas = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "Prostaglandina");
  const gnrhTodos = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "GnRH");
  const implantes = implantesTodos.filter((i) => i.local === localEstoque);
  const benzoatos = benzoatosTodos.filter((i) => i.local === localEstoque);
  const prostaglandinas = prostaglandinasTodas.filter((i) => i.local === localEstoque);
  const gnrh = gnrhTodos.filter((i) => i.local === localEstoque);

  const [novoNome, setNovoNome] = useState("");
  const [novoRetiroId, setNovoRetiroId] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS_LOTE[0]);
  const [ordem, setOrdem] = useState(ORDENS_IATF[0]);
  const [numeroAnimais, setNumeroAnimais] = useState("");
  const [mesParicao, setMesParicao] = useState("");
  const [dataManejo, setDataManejo] = useState(todayISO());
  const [tipoManejo, setTipoManejo] = useState(TIPOS_MANEJO_IMPLANTACAO[0]);
  const [protocolo, setProtocolo] = useState(PROTOCOLOS_IMPLANTACAO[0]);

  const [implanteId, setImplanteId] = useState(implantes[0]?.id || "");
  const [benzoatoId, setBenzoatoId] = useState(benzoatos[0]?.id || "");
  const [doseBenzoato, setDoseBenzoato] = useState("");
  const [prostaglandinaId, setProstaglandinaId] = useState(prostaglandinas[0]?.id || "");
  const [doseProstaglandina, setDoseProstaglandina] = useState("");
  const [gnrhId, setGnrhId] = useState("");
  const [doseGnrh, setDoseGnrh] = useState("");

  // "Protocolo padrão": na primeira vez que um nome novo é digitado aqui, ao registrar o D0
  // o app salva os hormônios/doses/duração como um modelo com esse nome. Da próxima vez, digitar
  // (ou escolher da lista) o mesmo nome preenche tudo de novo — mas continua editável depois.
  const [protocoloPadraoNome, setProtocoloPadraoNome] = useState("");
  const protocolosPadraoD0 = protocolosPadraoDaFazenda ? protocolosPadraoDaFazenda("d0") : [];
  const aplicarProtocoloPadrao = (nome) => {
    setProtocoloPadraoNome(nome);
    const modelo = protocolosPadraoD0.find((p) => p.nome.trim().toLowerCase() === nome.trim().toLowerCase());
    if (!modelo) return;
    if (modelo.tipoManejo) setTipoManejo(modelo.tipoManejo);
    if (modelo.protocolo) setProtocolo(modelo.protocolo);
    if (modelo.implanteId && implantes.some((i) => i.id === modelo.implanteId)) setImplanteId(modelo.implanteId);
    if (modelo.benzoatoId && benzoatos.some((i) => i.id === modelo.benzoatoId)) setBenzoatoId(modelo.benzoatoId);
    if (modelo.doseBenzoato != null) setDoseBenzoato(String(modelo.doseBenzoato));
    if (modelo.prostaglandinaId && prostaglandinas.some((i) => i.id === modelo.prostaglandinaId)) setProstaglandinaId(modelo.prostaglandinaId);
    if (modelo.doseProstaglandina != null) setDoseProstaglandina(String(modelo.doseProstaglandina));
    if (modelo.gnrhId && gnrh.some((i) => i.id === modelo.gnrhId)) setGnrhId(modelo.gnrhId);
    if (modelo.doseGnrh != null) setDoseGnrh(String(modelo.doseGnrh));
  };

  const [comLeitura, setComLeitura] = useState(false);
  const [animaisLidos, setAnimaisLidos] = useState([]);
  useAvisarSaidaComPendencia(animaisLidos.length > 0);
  const [brinco, setBrinco] = useState("");
  const brincoInputRef = React.useRef(null);
  const [ecc, setEcc] = useState(OPCOES_ECC[1]);
  const [peso, setPeso] = useState("");
  const [medicamentos, setMedicamentos] = useState([]);

  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  React.useEffect(() => {
    if (!implantes.some((p) => p.id === implanteId)) setImplanteId(implantes[0]?.id || "");
    if (!benzoatos.some((p) => p.id === benzoatoId)) setBenzoatoId(benzoatos[0]?.id || "");
    if (!prostaglandinas.some((p) => p.id === prostaglandinaId)) setProstaglandinaId(prostaglandinas[0]?.id || "");
    if (gnrhId && !gnrh.some((p) => p.id === gnrhId)) setGnrhId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEstoque, implantes.map((p) => p.id).join(","), benzoatos.map((p) => p.id).join(","), prostaglandinas.map((p) => p.id).join(","), gnrh.map((p) => p.id).join(",")]);

  const adicionarAnimal = () => {
    if (!brinco.trim()) { setMsg("Leia o brinco do animal."); return; }
    if (animaisLidos.some((a) => a.brinco === brinco.trim())) { setMsg("Este animal já foi lido."); return; }
    setAnimaisLidos((a) => [...a, { brinco: brinco.trim(), ecc, peso: peso.trim() || null }]);
    setBrinco(""); setPeso(""); setMsg("");
  };
  const removerAnimal = (b) => setAnimaisLidos((a) => a.filter((x) => x.brinco !== b));

  // localiza um lote existente com o mesmo nome que AINDA NÃO passou por D0/Ressinc — normalmente
  // criado apenas na Indução (opcional). Nesse caso o D0 é o próximo passo natural da sequência e
  // deve completar esse mesmo lote, em vez de ser bloqueado ou criar um lote duplicado.
  const loteDaInducaoSemD0 = novoNome.trim() === "" ? null : lotes.find((l) =>
    l.nome.trim().toLowerCase() === novoNome.trim().toLowerCase() &&
    !manejos.some((m) => (m.tipo === "implantacao" || m.tipo === "ressinc") && m.loteId === l.id)
  );

  // só bloqueia quando já existe um lote com esse nome que JÁ teve D0/Ressinc registrado
  const nomeDuplicado = novoNome.trim() !== "" && !loteDaInducaoSemD0 &&
    lotes.some((l) => l.nome.trim().toLowerCase() === novoNome.trim().toLowerCase());

  const canSave = !nomeDuplicado && novoNome.trim() !== "" && novoRetiroId !== "" && categoria !== "" &&
    String(numeroAnimais).trim() !== "" && numBR(numeroAnimais) > 0 &&
    implanteId !== "" && benzoatoId !== "" && String(doseBenzoato).trim() !== "" && numBR(doseBenzoato) > 0 &&
    prostaglandinaId !== "" && String(doseProstaglandina).trim() !== "" && numBR(doseProstaglandina) > 0;

  const submetendoRef = React.useRef(false);
  const salvar = () => {
    if (submetendoRef.current) return;
    if (nomeDuplicado) { setMsg("Já existe um lote com este nome nesta fazenda/safra com D0 já registrado. Use um nome diferente, ou registre um Ressinc a partir do Diagnóstico para dar sequência ao mesmo lote."); return; }
    if (!canSave) { setMsg("Preencha o lote, a categoria, o nº de animais e os produtos com suas doses."); return; }
    submetendoRef.current = true;
    const nAnimais = numBR(numeroAnimais);
    const dB = numBR(doseBenzoato);
    const dP = numBR(doseProstaglandina);
    const dG = doseGnrh.trim() !== "" ? numBR(doseGnrh) : null;
    const implanteItem = implantes.find((i) => i.id === implanteId);
    const benzoatoItem = benzoatos.find((i) => i.id === benzoatoId);
    const pgfItem = prostaglandinas.find((i) => i.id === prostaglandinaId);
    const gnrhItem = gnrhId ? gnrh.find((i) => i.id === gnrhId) : null;

    // se já existe um lote com este nome vindo só da Indução (sem D0 ainda), completa esse mesmo
    // lote em vez de criar um novo — Indução e D0 são manejos diferentes na mesma sequência cronológica
    let idDoLote;
    if (loteDaInducaoSemD0) {
      idDoLote = loteDaInducaoSemD0.id;
      atualizarLote(idDoLote, { retiroId: novoRetiroId, categoria, ordem, numeroAnimais: nAnimais, mesParicao: mesParicao || null });
    } else {
      idDoLote = addLote({ retiroId: novoRetiroId, nome: novoNome, categoria, ordem, numeroAnimais: nAnimais, raca: null, mesParicao: mesParicao || null });
    }

    const contexto = {
      loteNome: novoNome, categoria, ordem, numeroAnimais: nAnimais, mesParicao: mesParicao || null, tipoManejo, protocolo,
      implante: implanteItem?.produtoComercial || "", benzoato: benzoatoItem?.produtoComercial || "", doseBenzoato: dB,
      prostaglandina: pgfItem?.produtoComercial || "", doseProstaglandina: dP,
      gnrh: gnrhItem?.produtoComercial || "", doseGnrh: dG,
    };

    const manejoId = registrarManejo({
      tipo: "implantacao", loteId: idDoLote, loteNome: novoNome, retiroId: novoRetiroId, categoria, ordem, numeroAnimais: nAnimais, mesParicao: mesParicao || null, tipoManejo, protocolo, medicamentos, localEstoque,
      implanteId, benzoatoId, doseBenzoato: dB, prostaglandinaId, doseProstaglandina: dP,
      gnrhId: gnrhId || null, doseGnrh: dG, data: dataManejo,
      animaisLidos: comLeitura ? animaisLidos.map((a) => a.brinco) : [],
      detalhes: comLeitura ? animaisLidos.map((a) => ({ ...a, ...contexto })) : [],
    });

    registrarSaidaEstoque(implanteId, nAnimais, manejoId, "implantacao");
    registrarSaidaEstoque(benzoatoId, dB * nAnimais, manejoId, "implantacao");
    registrarSaidaEstoque(prostaglandinaId, dP * nAnimais, manejoId, "implantacao");
    if (gnrhId && dG) registrarSaidaEstoque(gnrhId, dG * nAnimais, manejoId, "implantacao");
    medicamentos.forEach((m) => registrarSaidaEstoque(m.medicamentoId, m.dose, manejoId, "implantacao"));

    if (addProtocoloPadraoSeNovo) {
      addProtocoloPadraoSeNovo("d0", protocoloPadraoNome, {
        tipoManejo, protocolo, implanteId, benzoatoId, doseBenzoato: dB, prostaglandinaId, doseProstaglandina: dP,
        gnrhId: gnrhId || null, doseGnrh: gnrhId ? dG : null,
      });
    }

    setNovoNome(""); setNovoRetiroId(""); setNumeroAnimais(""); setMesParicao(""); setDataManejo(todayISO()); setProtocoloPadraoNome(""); setDoseBenzoato(""); setDoseProstaglandina(""); setGnrhId(""); setDoseGnrh(""); setAnimaisLidos([]); setMedicamentos([]);
    setMsg("D0 registrado.");
    setTimeout(() => { submetendoRef.current = false; }, 0);
  };

  const historico = manejos.filter((m) => m.tipo === "implantacao").slice(0, 6);
  const nomeLote = (id) => lotes.find((l) => l.id === id)?.nome || "—";
  const nomeInsumo = (id) => insumos.find((i) => i.id === id)?.produtoComercial || "—";

  const [editandoId, setEditandoId] = useState(null);
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState(null);
  const [editNumeroAnimais, setEditNumeroAnimais] = useState("");
  const [editCategoria, setEditCategoria] = useState(CATEGORIAS_LOTE[0]);
  const [editOrdem, setEditOrdem] = useState(ORDENS_IATF[0]);
  const iniciarEdicaoHistorico = (m) => {
    setEditandoId(m.id); setEditNumeroAnimais(String(m.numeroAnimais ?? "")); setEditCategoria(m.categoria || CATEGORIAS_LOTE[0]); setEditOrdem(m.ordem || ORDENS_IATF[0]);
  };
  const cancelarEdicaoHistorico = () => setEditandoId(null);
  const salvarEdicaoHistorico = () => {
    atualizarManejo(editandoId, { numeroAnimais: numBR(editNumeroAnimais), categoria: editCategoria, ordem: editOrdem });
    setEditandoId(null);
  };

  const semProdutos = implantesTodos.length === 0 || benzoatosTodos.length === 0 || prostaglandinasTodas.length === 0;
  const bloqueado = !fazendaAtiva ? "fazenda" : !safraAtiva ? "safra" : semProdutos ? "produto" : retiros.length === 0 ? "retiro" : null;

  /* ---------- Ressinc: confirma as sugestões vindas do Diagnóstico (animais Vazia) ---------- */

  const [sugestaoAbertaId, setSugestaoAbertaId] = useState(null);
  const sugestaoAberta = sugestoesRessinc.find((s) => s.id === sugestaoAbertaId) || null;
  const loteDaSugestao = sugestaoAberta ? lotes.find((l) => l.id === sugestaoAberta.loteId) : null;

  const [localEstoqueR, setLocalEstoqueR] = useState("fazenda");
  const implantesR = implantesTodos.filter((i) => i.local === localEstoqueR);
  const benzoatosR = benzoatosTodos.filter((i) => i.local === localEstoqueR);
  const prostaglandinasR = prostaglandinasTodas.filter((i) => i.local === localEstoqueR);

  const [ressincSelecionados, setRessincSelecionados] = useState([]);
  const toggleSelecao = (b) => setRessincSelecionados((sel) => sel.includes(b) ? sel.filter((x) => x !== b) : [...sel, b]);

  const [categoriaR, setCategoriaR] = useState(CATEGORIAS_LOTE[0]);
  const [ordemR, setOrdemR] = useState(ORDENS_IATF[0]);
  const [dataManejoR, setDataManejoR] = useState(todayISO());
  const [tipoManejoR, setTipoManejoR] = useState(TIPOS_MANEJO_IMPLANTACAO[0]);
  const [protocoloR, setProtocoloR] = useState(PROTOCOLOS_IMPLANTACAO[0]);
  const [implanteIdR, setImplanteIdR] = useState("");
  const [benzoatoIdR, setBenzoatoIdR] = useState("");
  const [doseBenzoatoR, setDoseBenzoatoR] = useState("");
  const [prostaglandinaIdR, setProstaglandinaIdR] = useState("");
  const [doseProstaglandinaR, setDoseProstaglandinaR] = useState("");
  const [medicamentosR, setMedicamentosR] = useState([]);
  const [msgR, setMsgR] = useState("");
  const limparMsgRSeSucesso = () => { if (msgR.includes("registrad")) setMsgR(""); };

  // ao abrir uma sugestão, pré-preenche com os dados dela e do lote
  React.useEffect(() => {
    if (sugestaoAberta && loteDaSugestao) {
      setRessincSelecionados(sugestaoAberta.brincos);
      setCategoriaR(loteDaSugestao.categoria || CATEGORIAS_LOTE[0]);
      setOrdemR(proximaOrdem(loteDaSugestao.ordem));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestaoAbertaId]);

  React.useEffect(() => {
    if (!implantesR.some((p) => p.id === implanteIdR)) setImplanteIdR(implantesR[0]?.id || "");
    if (!benzoatosR.some((p) => p.id === benzoatoIdR)) setBenzoatoIdR(benzoatosR[0]?.id || "");
    if (!prostaglandinasR.some((p) => p.id === prostaglandinaIdR)) setProstaglandinaIdR(prostaglandinasR[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEstoqueR, implantesR.map((p) => p.id).join(","), benzoatosR.map((p) => p.id).join(","), prostaglandinasR.map((p) => p.id).join(",")]);

  const semProdutosRessinc = implantesTodos.length === 0 || benzoatosTodos.length === 0 || prostaglandinasTodas.length === 0;

  // cada manejo (D0/Ressinc, Retirada, Inseminação, Diagnóstico) só pode ocorrer uma vez por lote+ordem
  const jaRegistradoNestaOrdemR = !!loteDaSugestao && manejos.some((m) => (m.tipo === "implantacao" || m.tipo === "ressinc") && m.loteId === loteDaSugestao.id && m.ordem === ordemR);

  const canSaveRessinc = !!sugestaoAberta && !jaRegistradoNestaOrdemR && ressincSelecionados.length > 0 && categoriaR !== "" && ordemR !== "" &&
    implanteIdR !== "" && benzoatoIdR !== "" && String(doseBenzoatoR).trim() !== "" && numBR(doseBenzoatoR) > 0 &&
    prostaglandinaIdR !== "" && String(doseProstaglandinaR).trim() !== "" && numBR(doseProstaglandinaR) > 0;

  const salvarRessinc = () => {
    if (!sugestaoAberta || !loteDaSugestao) return;
    if (jaRegistradoNestaOrdemR) { setMsgR(`Já existe um D0/Ressinc registrado para este lote na ${ordemR}.`); return; }
    if (!canSaveRessinc) { setMsgR("Selecione ao menos um animal vazio e preencha os produtos com suas doses."); return; }
    const nAnimais = ressincSelecionados.length;
    const dB = numBR(doseBenzoatoR);
    const dP = numBR(doseProstaglandinaR);
    const implanteItem = implantesR.find((i) => i.id === implanteIdR);
    const benzoatoItem = benzoatosR.find((i) => i.id === benzoatoIdR);
    const pgfItem = prostaglandinasR.find((i) => i.id === prostaglandinaIdR);

    atualizarLote(loteDaSugestao.id, { ordem: ordemR });

    const contexto = {
      loteNome: loteDaSugestao.nome || "", categoria: categoriaR, ordem: ordemR, numeroAnimais: nAnimais, mesParicao: loteDaSugestao.mesParicao || null, tipoManejo: tipoManejoR, protocolo: protocoloR,
      implante: implanteItem?.produtoComercial || "", benzoato: benzoatoItem?.produtoComercial || "", doseBenzoato: dB,
      prostaglandina: pgfItem?.produtoComercial || "", doseProstaglandina: dP,
    };

    const manejoId = registrarManejo({
      tipo: "ressinc", loteId: loteDaSugestao.id, loteNome: loteDaSugestao.nome || "", retiroId: loteDaSugestao.retiroId || null,
      categoria: categoriaR, ordem: ordemR, numeroAnimais: nAnimais, mesParicao: loteDaSugestao.mesParicao || null, tipoManejo: tipoManejoR, protocolo: protocoloR, medicamentos: medicamentosR, localEstoque: localEstoqueR,
      implanteId: implanteIdR, benzoatoId: benzoatoIdR, doseBenzoato: dB, prostaglandinaId: prostaglandinaIdR, doseProstaglandina: dP, data: dataManejoR,
      animaisLidos: ressincSelecionados,
      detalhes: ressincSelecionados.map((b) => ({ brinco: b, ...contexto })),
    });

    registrarSaidaEstoque(implanteIdR, nAnimais, manejoId, "ressinc");
    registrarSaidaEstoque(benzoatoIdR, dB * nAnimais, manejoId, "ressinc");
    registrarSaidaEstoque(prostaglandinaIdR, dP * nAnimais, manejoId, "ressinc");
    medicamentosR.forEach((m) => registrarSaidaEstoque(m.medicamentoId, m.dose, manejoId, "ressinc"));

    removerSugestaoRessinc(sugestaoAberta.id);
    setDoseBenzoatoR(""); setDoseProstaglandinaR(""); setDataManejoR(todayISO()); setMedicamentosR([]); setMsgR("");
    setSugestaoAbertaId(null);
  };

  const historicoRessinc = manejos.filter((m) => m.tipo === "ressinc").slice(0, 6);

  const [editandoRessincId, setEditandoRessincId] = useState(null);
  const [editRessincNumeroAnimais, setEditRessincNumeroAnimais] = useState("");
  const [editRessincCategoria, setEditRessincCategoria] = useState(CATEGORIAS_LOTE[0]);
  const [editRessincOrdem, setEditRessincOrdem] = useState(ORDENS_IATF[0]);
  const iniciarEdicaoRessinc = (m) => {
    setEditandoRessincId(m.id); setEditRessincNumeroAnimais(String(m.numeroAnimais ?? "")); setEditRessincCategoria(m.categoria || CATEGORIAS_LOTE[0]); setEditRessincOrdem(m.ordem || ORDENS_IATF[0]);
  };
  const cancelarEdicaoRessinc = () => setEditandoRessincId(null);
  const salvarEdicaoRessinc = () => {
    atualizarManejo(editandoRessincId, { numeroAnimais: numBR(editRessincNumeroAnimais), categoria: editRessincCategoria, ordem: editRessincOrdem });
    setEditandoRessincId(null);
  };

  return (
    <div>
      <SectionTitle icon={ImplantIcon} title="D0" subtitle="O lote é criado aqui com os dados completos." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para registrar manejos." />
      ) : !safraAtiva ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos. Todo manejo e lote precisa pertencer a uma safra." />
      ) : (
        <>
          <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2, marginBottom: 20, width: "fit-content" }}>
            <button onClick={() => setAbaInterna("d0")}
              style={{
                padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: abaInterna === "d0" ? "#166336" : "transparent", color: abaInterna === "d0" ? "#FFFFFF" : "#6B685E",
              }}>D0</button>
            <button onClick={() => setAbaInterna("ressinc")}
              style={{
                padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                display: "inline-flex", alignItems: "center", gap: 6,
                background: abaInterna === "ressinc" ? "#166336" : "transparent", color: abaInterna === "ressinc" ? "#FFFFFF" : "#6B685E",
              }}>
              Ressinc
              {sugestoesRessinc.length > 0 && (
                <span style={{ background: "#166336", color: "#FFFFFF", borderRadius: 20, fontSize: 10.5, fontWeight: 700, padding: "1.5px 6px" }}>{sugestoesRessinc.length}</span>
              )}
            </button>
          </div>

          {abaInterna === "d0" && (
            bloqueado === "produto" ? (
              <EmptyState text="Cadastre ao menos um produto comercial de Progesterona, Benzoato e Prostaglandina (Estoque > Entrada > Hormônios) antes de registrar o D0." />
            ) : bloqueado === "retiro" ? (
              <EmptyState text="Esta fazenda ainda não tem retiros cadastrados. Adicione um retiro no cadastro de Fazenda antes de criar um lote por aqui." />
            ) : (
              <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Local de estoque</div>
            <SeletorLocalEstoque local={localEstoque} setLocal={setLocalEstoque} />
            {(implantes.length === 0 || benzoatos.length === 0 || prostaglandinas.length === 0) && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>Faltam produtos cadastrados neste local de estoque (implante, benzoato ou prostaglandina).</p>
            )}
            {nomeDuplicado && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>
                Já existe um lote com este nome com D0 já registrado. Use um nome diferente, ou registre um Ressinc a partir do Diagnóstico para dar sequência ao mesmo lote.
              </p>
            )}
            {loteDaInducaoSemD0 && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>
                Já existe um lote "{loteDaInducaoSemD0.nome}" registrado na Indução, ainda sem D0. Este registro vai completar os dados desse mesmo lote.
              </p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
              <Field label="Data"><input style={inputStyle} type="date" value={dataManejo} onChange={(e) => { limparMsgSeSucesso(); setDataManejo(e.target.value); }} /></Field>
              <Field label="Protocolo padrão (opcional)">
                <input style={inputStyle} list="protocolos-padrao-d0" value={protocoloPadraoNome}
                  onChange={(e) => { limparMsgSeSucesso(); aplicarProtocoloPadrao(e.target.value); }}
                  placeholder="Nome do protocolo — novo ou já cadastrado" />
                <datalist id="protocolos-padrao-d0">
                  {protocolosPadraoD0.map((p) => <option key={p.id} value={p.nome} />)}
                </datalist>
              </Field>
              <Field label="Lote (nome)"><input style={inputStyle} value={novoNome} onChange={(e) => { limparMsgSeSucesso(); setNovoNome(e.target.value); }} placeholder="Ex: Lote 01" /></Field>
              <Field label="Retiro">
                <select style={inputStyle} value={novoRetiroId} onChange={(e) => { limparMsgSeSucesso(); setNovoRetiroId(e.target.value); }}>
                  <option value="">Selecione um retiro</option>
                  {retiros.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </Field>
              <Field label="Categoria">
                <select style={inputStyle} value={categoria} onChange={(e) => { limparMsgSeSucesso(); setCategoria(e.target.value); }}>
                  {CATEGORIAS_LOTE.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Ordem">
                <select style={inputStyle} value={ordem} onChange={(e) => { limparMsgSeSucesso(); setOrdem(e.target.value); }}>
                  {ORDENS_IATF.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Nº de animais"><input style={inputStyle} type="number" min="1" value={numeroAnimais} onChange={(e) => { limparMsgSeSucesso(); setNumeroAnimais(e.target.value); }} placeholder="0" /></Field>
              <Field label="Mês de parição (opcional)">
                <select style={inputStyle} value={mesParicao} onChange={(e) => { limparMsgSeSucesso(); setMesParicao(e.target.value); }}>
                  <option value="">— não se aplica —</option>
                  {NOMES_MES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Número de manejos">
                <select style={inputStyle} value={tipoManejo} onChange={(e) => {
                  limparMsgSeSucesso();
                  const novo = e.target.value;
                  setTipoManejo(novo);
                  if (!protocolosPara(novo).includes(protocolo)) setProtocolo(protocolosPara(novo)[0]);
                }}>
                  {TIPOS_MANEJO_IMPLANTACAO.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Duração do protocolo">
                <select style={inputStyle} value={protocolo} onChange={(e) => { limparMsgSeSucesso(); setProtocolo(e.target.value); }}>
                  {protocolosPara(tipoManejo).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Implante">
                <select style={inputStyle} value={implanteId} onChange={(e) => { limparMsgSeSucesso(); setImplanteId(e.target.value); }}>
                  {implantes.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                </select>
              </Field>
              <CampoProdutoDose
                labelProduto="Benzoato"
                produto={
                  <select style={inputStyle} value={benzoatoId} onChange={(e) => { limparMsgSeSucesso(); setBenzoatoId(e.target.value); }}>
                    {benzoatos.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseBenzoato} onChange={(e) => { limparMsgSeSucesso(); setDoseBenzoato(e.target.value); }} placeholder="0" />}
              />
              <CampoProdutoDose
                labelProduto="Prostaglandina"
                produto={
                  <select style={inputStyle} value={prostaglandinaId} onChange={(e) => { limparMsgSeSucesso(); setProstaglandinaId(e.target.value); }}>
                    {prostaglandinas.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseProstaglandina} onChange={(e) => { limparMsgSeSucesso(); setDoseProstaglandina(e.target.value); }} placeholder="0" />}
              />
              <CampoProdutoDose
                labelProduto="GnRH (opcional)"
                produto={
                  <select style={inputStyle} value={gnrhId} onChange={(e) => { limparMsgSeSucesso(); setGnrhId(e.target.value); }}>
                    <option value="">— não usar —</option>
                    {gnrh.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseGnrh} onChange={(e) => { limparMsgSeSucesso(); setDoseGnrh(e.target.value); }} placeholder="0" />}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 14px", cursor: "pointer" }} onClick={() => setComLeitura((v) => !v)}>
              {comLeitura ? <CheckCircle2 size={18} color="#166336" /> : <Circle size={18} color="#B0AA98" />}
              <span style={{ fontSize: 13, color: "#4A473E" }}>Registrar leitura individual dos animais (opcional)</span>
            </div>

            {comLeitura && (
              <div style={{ marginBottom: 14, background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr auto auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
                  <Field label="Identificação"><input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR ou digitar" value={brinco}
                    onChange={(e) => setBrinco(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adicionarAnimal()} /></Field>
                  <Field label="ECC">
                    <select style={inputStyle} value={ecc} onChange={(e) => setEcc(e.target.value)}>
                      {OPCOES_ECC.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Peso (opcional)"><input style={inputStyle} type="number" step="any" value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="kg" /></Field>
                  <BtnPrimary onClick={adicionarAnimal} style={{ marginBottom: 14 }}>Registrar animal</BtnPrimary>
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
                {animaisLidos.length === 0 ? (
                  <span style={{ fontSize: 12, color: "#9B9686" }}>Nenhum animal lido ainda.</span>
                ) : (
                  <table>
                    <thead><tr><th>Animal</th><th>ECC</th><th>Peso</th><th>Lote (já atribuído)</th><th></th></tr></thead>
                    <tbody>
                      {animaisLidos.map((a) => (
                        <tr key={a.brinco}>
                          <td><EarTag size="sm">{a.brinco}</EarTag></td>
                          <td>{a.ecc}</td>
                          <td>{a.peso ? `${a.peso} kg` : "—"}</td>
                          <td>{lotes.find((l) => (l.animais || []).includes(a.brinco))?.nome || "—"}</td>
                          <td><button onClick={() => removerAnimal(a.brinco)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <CampoMedicamentos insumos={insumos} local={localEstoque} selecionados={medicamentos} setSelecionados={setMedicamentos} />

            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginBottom: 10 }}>{msg}</p>}
            <BtnPrimary disabled={!canSave} onClick={salvar}><Plus size={15} /> Registrar D0</BtnPrimary>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>D0 registrados</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum registro ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Categoria</th>
                    <th>Ordem</th>
                    <th>Nº animais</th>
                    <th>Parição</th>
                    <th>Número de manejos</th>
                    <th>Protocolo</th>
                    <th>Implante</th>
                    <th>Benzoato</th>
                    <th>Prostaglandina</th>
                    <th>GnRH</th>
                    <th>Medicamentos</th>
                    <th>Local</th>
                    <th>Data</th>
                    <th>Leitura individual</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 700 }}>{nomeLote(m.loteId)}</td>
                      {editandoId === m.id ? (
                        <>
                          <td>
                            <select style={inputStyle} value={editCategoria} onChange={(e) => setEditCategoria(e.target.value)}>
                              {CATEGORIAS_LOTE.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td>
                            <select style={inputStyle} value={editOrdem} onChange={(e) => setEditOrdem(e.target.value)}>
                              {ORDENS_IATF.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                          <td><input style={inputStyle} type="number" min="1" value={editNumeroAnimais} onChange={(e) => setEditNumeroAnimais(e.target.value)} /></td>
                        </>
                      ) : (
                        <>
                          <td>{m.categoria}</td>
                          <td>{m.ordem || "—"}</td>
                          <td>{m.numeroAnimais}</td>
                        </>
                      )}
                      <td>{m.mesParicao || "—"}</td>
                      <td>{m.tipoManejo || "—"}</td>
                      <td>{m.protocolo || "—"}</td>
                      <td>{nomeInsumo(m.implanteId)}</td>
                      <td>{nomeInsumo(m.benzoatoId)} ({m.doseBenzoato} mL)</td>
                      <td>{nomeInsumo(m.prostaglandinaId)} ({m.doseProstaglandina} mL)</td>
                      <td>{m.gnrhId ? `${nomeInsumo(m.gnrhId)} (${m.doseGnrh} mL)` : "—"}</td>
                      <td>{resumoMedicamentos(m.medicamentos, insumos)}</td>
                      <td>{m.localEstoque === "externo" ? "Externo" : "Fazenda"}</td>
                      <td>{fmtDate(m.data)}</td>
                      <td>{m.animaisLidos.length > 0 ? `${m.animaisLidos.length} animais` : "—"}</td>
                      <td>
                        {confirmandoExclusaoId === m.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                            <button onClick={() => { removerManejo(m.id); setConfirmandoExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : editandoId === m.id ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={salvarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                            <button onClick={cancelarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => iniciarEdicaoHistorico(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4A473E" }}><Pencil size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
              </>
            )
          )}

          {abaInterna === "ressinc" && (
            <>
              {!sugestaoAberta ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Sugestões de Ressinc aguardando confirmação</div>
                  {sugestoesRessinc.length === 0 ? (
                    <EmptyState text="Nenhuma sugestão de Ressinc no momento. Elas aparecem aqui automaticamente quando um Diagnóstico é finalizado com animais marcados como Vazia." />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                      {sugestoesRessinc.map((s) => {
                        const lote = lotes.find((l) => l.id === s.loteId);
                        return (
                          <div key={s.id} style={{ ...cardStyle, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div>
                              <strong style={{ fontSize: 13.5 }}>{lote?.nome || "—"}</strong>
                              <div style={{ fontSize: 12, color: "#6B685E", marginTop: 3 }}>
                                {lote?.nome || "—"} - {proximaOrdem(lote?.ordem)} · {s.brincos.length} animal(is) vazio(s) · Diagnóstico de {fmtDate(s.data)}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                              <BtnPrimary onClick={() => setSugestaoAbertaId(s.id)}>Confirmar</BtnPrimary>
                              <BtnGhost danger onClick={() => descartarSugestaoRessinc(s.id)}>Descartar</BtnGhost>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ ...cardStyle, marginBottom: 24, border: "1.5px solid #E3B8A0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ImplantIcon size={16} color="#166336" />
                      <span style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "#232520" }}>Ressinc — {loteDaSugestao?.nome}</span>
                    </div>
                    <BtnGhost onClick={() => setSugestaoAbertaId(null)}>← Voltar à lista</BtnGhost>
                  </div>
                  <p style={{ fontSize: 12.5, color: "#6B685E", margin: "0 0 14px" }}>
                    Registra um novo D0 para os animais diagnosticados como Vazia. Desmarque abaixo quem não deve entrar no Ressinc.
                  </p>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {sugestaoAberta.brincos.map((b) => {
                      const selecionado = ressincSelecionados.includes(b);
                      return (
                        <button key={b} onClick={() => toggleSelecao(b)}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                            borderRadius: 20, padding: "4px 10px", fontSize: 12.5,
                            background: selecionado ? "#EEEEEE" : "#EEEEEE", opacity: selecionado ? 1 : 0.55,
                          }}>
                          {selecionado ? <CheckCircle2 size={13} color="#166336" /> : <Circle size={13} color="#9B9686" />}
                          <EarTag size="sm">{b}</EarTag>
                        </button>
                      );
                    })}
                  </div>

                  {semProdutosRessinc ? (
                    <EmptyState text="Cadastre ao menos um produto comercial de Progesterona, Benzoato e Prostaglandina (Estoque > Entrada > Hormônios) para registrar o Ressinc." />
                  ) : (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Local de estoque</div>
                      <SeletorLocalEstoque local={localEstoqueR} setLocal={setLocalEstoqueR} />
                      {(implantesR.length === 0 || benzoatosR.length === 0 || prostaglandinasR.length === 0) && (
                        <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>Faltam produtos cadastrados neste local de estoque (implante, benzoato ou prostaglandina).</p>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
                        <Field label="Categoria">
                          <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={categoriaR} readOnly />
                        </Field>
                        <Field label="Ordem">
                          <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={ordemR} readOnly />
                        </Field>
                        <Field label="Número de manejos">
                          <select style={inputStyle} value={tipoManejoR} onChange={(e) => {
                            limparMsgRSeSucesso();
                            const novo = e.target.value;
                            setTipoManejoR(novo);
                            if (!protocolosPara(novo).includes(protocoloR)) setProtocoloR(protocolosPara(novo)[0]);
                          }}>
                            {TIPOS_MANEJO_IMPLANTACAO.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </Field>
                        <Field label="Duração do protocolo">
                          <select style={inputStyle} value={protocoloR} onChange={(e) => { limparMsgRSeSucesso(); setProtocoloR(e.target.value); }}>
                            {protocolosPara(tipoManejoR).map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </Field>
                        <Field label="Data"><input style={inputStyle} type="date" value={dataManejoR} onChange={(e) => { limparMsgRSeSucesso(); setDataManejoR(e.target.value); }} /></Field>
                        <Field label="Implante">
                          <select style={inputStyle} value={implanteIdR} onChange={(e) => { limparMsgRSeSucesso(); setImplanteIdR(e.target.value); }}>
                            {implantesR.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                          </select>
                        </Field>
                        <CampoProdutoDose
                          labelProduto="Benzoato"
                          produto={
                            <select style={inputStyle} value={benzoatoIdR} onChange={(e) => { limparMsgRSeSucesso(); setBenzoatoIdR(e.target.value); }}>
                              {benzoatosR.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                            </select>
                          }
                          labelDose="Dose (mL)"
                          dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseBenzoatoR} onChange={(e) => { limparMsgRSeSucesso(); setDoseBenzoatoR(e.target.value); }} placeholder="0" />}
                        />
                        <CampoProdutoDose
                          labelProduto="Prostaglandina"
                          produto={
                            <select style={inputStyle} value={prostaglandinaIdR} onChange={(e) => { limparMsgRSeSucesso(); setProstaglandinaIdR(e.target.value); }}>
                              {prostaglandinasR.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                            </select>
                          }
                          labelDose="Dose (mL)"
                          dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseProstaglandinaR} onChange={(e) => { limparMsgRSeSucesso(); setDoseProstaglandinaR(e.target.value); }} placeholder="0" />}
                        />
                      </div>

                      <CampoMedicamentos insumos={insumos} local={localEstoqueR} selecionados={medicamentosR} setSelecionados={setMedicamentosR} />

                      {jaRegistradoNestaOrdemR && (
                        <p style={{ fontSize: 12.5, color: "#A32D2D", marginTop: 12 }}>
                          Já existe um D0/Ressinc registrado para este lote na {ordemR}. Não é possível registrar de novo para a mesma ordem.
                        </p>
                      )}
                      {msgR && <p style={{ fontSize: 12.5, color: msgR.includes("registrad") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msgR}</p>}
                      <BtnPrimary disabled={!canSaveRessinc} onClick={salvarRessinc} style={{ marginTop: msgR ? 0 : 12 }}>
                        <Plus size={15} /> Registrar Ressinc ({ressincSelecionados.length})
                      </BtnPrimary>
                    </>
                  )}
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Ressincs registrados</div>
              {historicoRessinc.length === 0 ? (
                <EmptyState text="Nenhum Ressinc registrado ainda." />
              ) : (
                <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Lote</th>
                        <th>Categoria</th>
                        <th>Ordem</th>
                        <th>Parição</th>
                        <th>Animais</th>
                        <th>Implante</th>
                        <th>Benzoato</th>
                        <th>Prostaglandina</th>
                        <th>Medicamentos</th>
                        <th>Local</th>
                        <th>Data</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicoRessinc.map((m) => (
                        <tr key={m.id}>
                          <td style={{ fontWeight: 700 }}>{nomeLote(m.loteId)}</td>
                          {editandoRessincId === m.id ? (
                            <>
                              <td>
                                <select style={inputStyle} value={editRessincCategoria} onChange={(e) => setEditRessincCategoria(e.target.value)}>
                                  {CATEGORIAS_LOTE.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </td>
                              <td>
                                <select style={inputStyle} value={editRessincOrdem} onChange={(e) => setEditRessincOrdem(e.target.value)}>
                                  {ORDENS_IATF.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>{m.categoria}</td>
                              <td>{m.ordem || "—"}</td>
                            </>
                          )}
                          <td>{m.mesParicao || "—"}</td>
                          {editandoRessincId === m.id ? (
                            <td><input style={inputStyle} type="number" min="1" value={editRessincNumeroAnimais} onChange={(e) => setEditRessincNumeroAnimais(e.target.value)} /></td>
                          ) : (
                            <td>{m.numeroAnimais}</td>
                          )}
                          <td>{nomeInsumo(m.implanteId)}</td>
                          <td>{nomeInsumo(m.benzoatoId)} ({m.doseBenzoato} mL)</td>
                          <td>{nomeInsumo(m.prostaglandinaId)} ({m.doseProstaglandina} mL)</td>
                          <td>{resumoMedicamentos(m.medicamentos, insumos)}</td>
                          <td>{m.localEstoque === "externo" ? "Externo" : "Fazenda"}</td>
                          <td>{fmtDate(m.data)}</td>
                          <td>
                            {confirmandoExclusaoId === m.id ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                                <button onClick={() => { removerManejo(m.id); setConfirmandoExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                                <button onClick={() => setConfirmandoExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                              </div>
                            ) : editandoRessincId === m.id ? (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={salvarEdicaoRessinc} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                                <button onClick={cancelarEdicaoRessinc} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => iniciarEdicaoRessinc(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4A473E" }}><Pencil size={14} /></button>
                                <button onClick={() => setConfirmandoExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   RETIRADA — Prostaglandina + Cipionato + ECG/HCG, sobre um
   lote já existente.
========================================================= */

function AbaRetirada({ fazendaAtiva, safraAtiva, lotes, insumos, registrarManejo, registrarSaidaEstoque, manejos, atualizarManejo, removerManejo, protocolosPadraoDaFazenda, addProtocoloPadraoSeNovo }) {
  const [localEstoque, setLocalEstoque] = useState("fazenda");
  const prostaglandinasTodas = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "Prostaglandina");
  const cipionatosTodos = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "Cipionato");
  const ecgHcgTodos = insumos.filter((i) => i.categoria === "Hormônio" && (i.hormonio === "ECG" || i.hormonio === "HCG"));
  const prostaglandinas = prostaglandinasTodas.filter((i) => i.local === localEstoque);
  const cipionatos = cipionatosTodos.filter((i) => i.local === localEstoque);
  const ecgHcg = ecgHcgTodos.filter((i) => i.local === localEstoque);

  // só entram lotes que já tiveram D0 (ou Ressinc) registrado para a ordem ATUAL do lote e que ainda
  // não tiveram Retirada registrada nessa mesma ordem. Depois que a Retirada é feita, o lote some
  // desta lista — e só volta a aparecer se um Ressinc for registrado, avançando para a próxima ordem.
  const lotesComD0 = lotes.filter((l) =>
    manejos.some((m) => (m.tipo === "implantacao" || m.tipo === "ressinc") && m.loteId === l.id && m.ordem === l.ordem) &&
    !manejos.some((m) => m.tipo === "retirada" && m.loteId === l.id && m.ordem === l.ordem)
  );

  const [loteId, setLoteId] = useState(lotesComD0[0]?.id || "");
  const [numeroAnimais, setNumeroAnimais] = useState("");
  const [perdasImplante, setPerdasImplante] = useState("");
  const [dataManejo, setDataManejo] = useState(todayISO());
  const [horarioInicial, setHorarioInicial] = useState("");
  const [horarioFinal, setHorarioFinal] = useState("");
  const [prostaglandinaId, setProstaglandinaId] = useState(prostaglandinas[0]?.id || "");
  const [doseProstaglandina, setDoseProstaglandina] = useState("");
  const [cipionatoId, setCipionatoId] = useState(cipionatos[0]?.id || "");
  const [doseCipionato, setDoseCipionato] = useState("");
  const [ecgHcgId, setEcgHcgId] = useState(ecgHcg[0]?.id || "");
  const [doseEcgHcg, setDoseEcgHcg] = useState("");

  // "Protocolo padrão": mesma lógica do D0 — na primeira vez que um nome novo é usado aqui, ao
  // registrar a Retirada o app salva os hormônios/doses como um modelo; nas próximas, selecionar
  // o mesmo nome preenche tudo de novo (continua editável depois).
  const [protocoloPadraoNome, setProtocoloPadraoNome] = useState("");
  const protocolosPadraoRetirada = protocolosPadraoDaFazenda ? protocolosPadraoDaFazenda("retirada") : [];
  const aplicarProtocoloPadrao = (nome) => {
    setProtocoloPadraoNome(nome);
    const modelo = protocolosPadraoRetirada.find((p) => p.nome.trim().toLowerCase() === nome.trim().toLowerCase());
    if (!modelo) return;
    if (modelo.prostaglandinaId && prostaglandinas.some((i) => i.id === modelo.prostaglandinaId)) setProstaglandinaId(modelo.prostaglandinaId);
    if (modelo.doseProstaglandina != null) setDoseProstaglandina(String(modelo.doseProstaglandina));
    if (modelo.cipionatoId && cipionatos.some((i) => i.id === modelo.cipionatoId)) setCipionatoId(modelo.cipionatoId);
    if (modelo.doseCipionato != null) setDoseCipionato(String(modelo.doseCipionato));
    if (modelo.ecgHcgId && ecgHcg.some((i) => i.id === modelo.ecgHcgId)) setEcgHcgId(modelo.ecgHcgId);
    if (modelo.doseEcgHcg != null) setDoseEcgHcg(String(modelo.doseEcgHcg));
  };

  const [comLeitura, setComLeitura] = useState(false);
  const [animaisLidos, setAnimaisLidos] = useState([]);
  useAvisarSaidaComPendencia(animaisLidos.length > 0);
  const [brinco, setBrinco] = useState("");
  const brincoInputRef = React.useRef(null);
  const [ecc, setEcc] = useState(OPCOES_ECC[1]);
  const [peso, setPeso] = useState("");
  const [medicamentos, setMedicamentos] = useState([]);

  const loteAtual = lotes.find((l) => l.id === loteId);

  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  React.useEffect(() => {
    if (!prostaglandinas.some((p) => p.id === prostaglandinaId)) setProstaglandinaId(prostaglandinas[0]?.id || "");
    if (!cipionatos.some((p) => p.id === cipionatoId)) setCipionatoId(cipionatos[0]?.id || "");
    if (!ecgHcg.some((p) => p.id === ecgHcgId)) setEcgHcgId(ecgHcg[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEstoque, prostaglandinas.map((p) => p.id).join(","), cipionatos.map((p) => p.id).join(","), ecgHcg.map((p) => p.id).join(",")]);

  // mantém o lote selecionado válido: se a lista de lotes com D0 mudar (ex.: um D0 novo é
  // registrado em outra aba enquanto esta já estava montada), garante que o valor exista nas opções
  React.useEffect(() => {
    if (!lotesComD0.some((l) => l.id === loteId)) setLoteId(lotesComD0[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotesComD0.map((l) => l.id).join(",")]);

  const adicionarAnimal = () => {
    if (!brinco.trim()) { setMsg("Leia o brinco do animal."); return; }
    if (animaisLidos.some((a) => a.brinco === brinco.trim())) { setMsg("Este animal já foi lido."); return; }
    setAnimaisLidos((a) => [...a, { brinco: brinco.trim(), ecc, peso: peso.trim() || null }]);
    setBrinco(""); setPeso(""); setMsg("");
  };
  const removerAnimal = (b) => setAnimaisLidos((a) => a.filter((x) => x.brinco !== b));

  // cada manejo (D0, Retirada, Inseminação, Diagnóstico) só pode ocorrer uma vez por lote+ordem
  const jaRegistradoNestaOrdem = !!loteAtual && manejos.some((m) => m.tipo === "retirada" && m.loteId === loteId && m.ordem === loteAtual.ordem);

  // o nº de animais da retirada não pode superar o nº de animais do D0 (ou Ressinc) mais recente
  // do lote nesta mesma ordem — mas o usuário pode confirmar mesmo assim
  const buscarD0MaisRecente = (idLote, ordem) => {
    const registros = manejos.filter((m) => (m.tipo === "implantacao" || m.tipo === "ressinc") && m.loteId === idLote && m.ordem === ordem);
    if (registros.length === 0) return null;
    return registros.reduce((mais, atual) => (atual.data > mais.data ? atual : mais));
  };
  const d0MaisRecente = loteAtual ? buscarD0MaisRecente(loteId, loteAtual.ordem) : null;
  const excedeQuantidade = !!d0MaisRecente && d0MaisRecente.numeroAnimais != null &&
    String(numeroAnimais).trim() !== "" && numBR(numeroAnimais) > d0MaisRecente.numeroAnimais;

  // ao trocar de lote, preenche automaticamente com o nº de animais do D0/Ressinc mais recente
  // daquele lote — mas continua editável normalmente depois disso.
  React.useEffect(() => {
    if (d0MaisRecente?.numeroAnimais != null) setNumeroAnimais(String(d0MaisRecente.numeroAnimais));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteId]);

  const canSaveBase = !jaRegistradoNestaOrdem && loteId !== "" && String(numeroAnimais).trim() !== "" && numBR(numeroAnimais) > 0 &&
    prostaglandinaId !== "" && String(doseProstaglandina).trim() !== "" && numBR(doseProstaglandina) > 0 &&
    cipionatoId !== "" && String(doseCipionato).trim() !== "" && numBR(doseCipionato) > 0 &&
    ecgHcgId !== "" && String(doseEcgHcg).trim() !== "" && numBR(doseEcgHcg) > 0;

  const salvar = (forcarExcedente = false) => {
    if (jaRegistradoNestaOrdem) { setMsg(`Já existe uma Retirada registrada para este lote na ${loteAtual.ordem}.`); return; }
    if (!canSaveBase) { setMsg("Preencha o lote, o nº de animais e os três produtos com suas doses."); return; }
    if (excedeQuantidade && !forcarExcedente) {
      setMsg(`O nº de animais informado (${numBR(numeroAnimais)}) é maior que o registrado no D0 mais recente deste lote na ${loteAtual.ordem} (${d0MaisRecente.numeroAnimais}). Confirme abaixo se deseja registrar mesmo assim.`);
      return;
    }
    const dPGF = numBR(doseProstaglandina);
    const dCip = numBR(doseCipionato);
    const dEH = numBR(doseEcgHcg);
    const pgfItem = prostaglandinas.find((i) => i.id === prostaglandinaId);
    const cipItem = cipionatos.find((i) => i.id === cipionatoId);
    const ehItem = ecgHcg.find((i) => i.id === ecgHcgId);
    const loteNome = loteAtual?.nome || "";
    const retiroIdLote = loteAtual?.retiroId || null;

    const contexto = {
      loteNome, ordem: loteAtual?.ordem || null, numeroAnimais: numBR(numeroAnimais), prostaglandina: pgfItem?.produtoComercial || "", doseProstaglandina: dPGF,
      cipionato: cipItem?.produtoComercial || "", doseCipionato: dCip,
      ecgHcg: ehItem?.produtoComercial || "", doseEcgHcg: dEH,
    };

    const manejoId = registrarManejo({
      tipo: "retirada", loteId, loteNome, retiroId: retiroIdLote, ordem: loteAtual?.ordem || null, numeroAnimais: numBR(numeroAnimais), medicamentos, localEstoque,
      prostaglandinaId, doseProstaglandina: dPGF, cipionatoId, doseCipionato: dCip, ecgHcgId, doseEcgHcg: dEH, data: dataManejo,
      perdasImplante: String(perdasImplante).trim() !== "" ? numBR(perdasImplante) : null,
      horarioInicial: horarioInicial || null, horarioFinal: horarioFinal || null,
      animaisLidos: comLeitura ? animaisLidos.map((a) => a.brinco) : [],
      detalhes: comLeitura ? animaisLidos.map((a) => ({ ...a, ...contexto })) : [],
    });

    registrarSaidaEstoque(prostaglandinaId, dPGF, manejoId, "retirada");
    registrarSaidaEstoque(cipionatoId, dCip, manejoId, "retirada");
    registrarSaidaEstoque(ecgHcgId, dEH, manejoId, "retirada");
    medicamentos.forEach((m) => registrarSaidaEstoque(m.medicamentoId, m.dose, manejoId, "retirada"));

    if (addProtocoloPadraoSeNovo) {
      addProtocoloPadraoSeNovo("retirada", protocoloPadraoNome, {
        prostaglandinaId, doseProstaglandina: dPGF, cipionatoId, doseCipionato: dCip, ecgHcgId, doseEcgHcg: dEH,
      });
    }

    setNumeroAnimais(""); setPerdasImplante(""); setDataManejo(todayISO()); setHorarioInicial(""); setHorarioFinal(""); setProtocoloPadraoNome(""); setDoseProstaglandina(""); setDoseCipionato(""); setDoseEcgHcg(""); setAnimaisLidos([]); setMedicamentos([]); setMsg("Retirada registrada.");
  };

  const historico = manejos.filter((m) => m.tipo === "retirada").slice(0, 6);
  const nomeLote = (id) => lotes.find((l) => l.id === id)?.nome || "—";
  const nomeInsumo = (id) => insumos.find((i) => i.id === id)?.produtoComercial || "—";

  const [editandoId, setEditandoId] = useState(null);
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState(null);
  const [editNumeroAnimais, setEditNumeroAnimais] = useState("");
  const iniciarEdicaoHistorico = (m) => { setEditandoId(m.id); setEditNumeroAnimais(String(m.numeroAnimais ?? "")); };
  const cancelarEdicaoHistorico = () => setEditandoId(null);
  const salvarEdicaoHistorico = () => {
    atualizarManejo(editandoId, { numeroAnimais: numBR(editNumeroAnimais) });
    setEditandoId(null);
  };

  const semProdutos = prostaglandinasTodas.length === 0 || cipionatosTodos.length === 0 || ecgHcgTodos.length === 0;
  const bloqueado = !fazendaAtiva ? "fazenda" : !safraAtiva ? "safra" : lotesComD0.length === 0 ? "lote" : semProdutos ? "produto" : null;

  return (
    <div>
      <SectionTitle icon={Syringe} title="Retirada" subtitle="Informe o lote e os produtos utilizados na retirada." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {bloqueado === "fazenda" ? (
        <EmptyState text="Selecione uma fazenda ativa para registrar manejos." />
      ) : bloqueado === "safra" ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos. Todo manejo e lote precisa pertencer a uma safra." />
      ) : (
        <>
          {bloqueado === "lote" ? (
            <EmptyState text="Nenhum lote disponível para retirada no momento. Um lote aparece aqui após o D0 (ou Ressinc) da sua ordem atual, e some daqui assim que a retirada dessa ordem é registrada." />
          ) : bloqueado === "produto" ? (
            <EmptyState text="Cadastre ao menos um produto comercial de Prostaglandina, Cipionato e ECG/HCG (Estoque > Entrada > Hormônios) antes de registrar a retirada." />
          ) : (          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Local de estoque</div>
            <SeletorLocalEstoque local={localEstoque} setLocal={setLocalEstoque} />
            {(prostaglandinas.length === 0 || cipionatos.length === 0 || ecgHcg.length === 0) && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>Faltam produtos cadastrados neste local de estoque (prostaglandina, cipionato ou ECG/HCG).</p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
              <Field label="Lote">
                <select style={inputStyle} value={loteId} onChange={(e) => { limparMsgSeSucesso(); setLoteId(e.target.value); }}>
                  {lotesComD0.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.categoria ? ` — ${l.categoria}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Ordem">
                <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={loteAtual?.ordem || "—"} readOnly />
              </Field>
              <Field label="Nº de animais"><input style={inputStyle} type="number" min="1" value={numeroAnimais} onChange={(e) => { limparMsgSeSucesso(); setNumeroAnimais(e.target.value); }} placeholder="0" /></Field>
              <Field label="Protocolo padrão (opcional)">
                <input style={inputStyle} list="protocolos-padrao-retirada" value={protocoloPadraoNome}
                  onChange={(e) => { limparMsgSeSucesso(); aplicarProtocoloPadrao(e.target.value); }}
                  placeholder="Nome do protocolo — novo ou já cadastrado" />
                <datalist id="protocolos-padrao-retirada">
                  {protocolosPadraoRetirada.map((p) => <option key={p.id} value={p.nome} />)}
                </datalist>
              </Field>
              <Field label="Perdas de implante (opcional)"><input style={inputStyle} type="number" min="0" value={perdasImplante} onChange={(e) => { limparMsgSeSucesso(); setPerdasImplante(e.target.value); }} placeholder="0" /></Field>
              <Field label="Data"><input style={inputStyle} type="date" value={dataManejo} onChange={(e) => { limparMsgSeSucesso(); setDataManejo(e.target.value); }} /></Field>
              <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Horário inicial"><input style={inputStyle} type="time" value={horarioInicial} onChange={(e) => { limparMsgSeSucesso(); setHorarioInicial(e.target.value); }} /></Field>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Horário final"><input style={inputStyle} type="time" value={horarioFinal} onChange={(e) => { limparMsgSeSucesso(); setHorarioFinal(e.target.value); }} /></Field>
                </div>
              </div>
              <CampoProdutoDose
                labelProduto="Prostaglandina"
                produto={
                  <select style={inputStyle} value={prostaglandinaId} onChange={(e) => { limparMsgSeSucesso(); setProstaglandinaId(e.target.value); }}>
                    {prostaglandinas.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseProstaglandina} onChange={(e) => { limparMsgSeSucesso(); setDoseProstaglandina(e.target.value); }} placeholder="0" />}
              />
              <CampoProdutoDose
                labelProduto="Cipionato"
                produto={
                  <select style={inputStyle} value={cipionatoId} onChange={(e) => { limparMsgSeSucesso(); setCipionatoId(e.target.value); }}>
                    {cipionatos.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseCipionato} onChange={(e) => { limparMsgSeSucesso(); setDoseCipionato(e.target.value); }} placeholder="0" />}
              />
              <CampoProdutoDose
                labelProduto="ECG/HCG"
                produto={
                  <select style={inputStyle} value={ecgHcgId} onChange={(e) => { limparMsgSeSucesso(); setEcgHcgId(e.target.value); }}>
                    {ecgHcg.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseEcgHcg} onChange={(e) => { limparMsgSeSucesso(); setDoseEcgHcg(e.target.value); }} placeholder="0" />}
              />
            </div>

            {jaRegistradoNestaOrdem && (
              <p style={{ fontSize: 12.5, color: "#A32D2D", marginBottom: 12 }}>
                Já existe uma Retirada registrada para este lote na {loteAtual.ordem}. Não é possível registrar de novo para a mesma ordem.
              </p>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 14px", cursor: "pointer" }} onClick={() => setComLeitura((v) => !v)}>
              {comLeitura ? <CheckCircle2 size={18} color="#166336" /> : <Circle size={18} color="#B0AA98" />}
              <span style={{ fontSize: 13, color: "#4A473E" }}>Registrar leitura individual dos animais (opcional)</span>
            </div>

            {comLeitura && (
              <div style={{ marginBottom: 14, background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr auto auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
                  <Field label="Identificação"><input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR ou digitar" value={brinco}
                    onChange={(e) => setBrinco(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adicionarAnimal()} /></Field>
                  <Field label="ECC">
                    <select style={inputStyle} value={ecc} onChange={(e) => setEcc(e.target.value)}>
                      {OPCOES_ECC.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Peso (opcional)"><input style={inputStyle} type="number" step="any" value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="kg" /></Field>
                  <BtnPrimary onClick={adicionarAnimal} style={{ marginBottom: 14 }}>Registrar animal</BtnPrimary>
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
                {animaisLidos.length === 0 ? (
                  <span style={{ fontSize: 12, color: "#9B9686" }}>Nenhum animal lido ainda.</span>
                ) : (
                  <table>
                    <thead><tr><th>Animal</th><th>ECC</th><th>Peso</th><th>Lote (já atribuído)</th><th></th></tr></thead>
                    <tbody>
                      {animaisLidos.map((a) => (
                        <tr key={a.brinco}>
                          <td><EarTag size="sm">{a.brinco}</EarTag></td>
                          <td>{a.ecc}</td>
                          <td>{a.peso ? `${a.peso} kg` : "—"}</td>
                          <td>{lotes.find((l) => (l.animais || []).includes(a.brinco))?.nome || "—"}</td>
                          <td><button onClick={() => removerAnimal(a.brinco)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <CampoMedicamentos insumos={insumos} local={localEstoque} selecionados={medicamentos} setSelecionados={setMedicamentos} />

            {excedeQuantidade && (
              <p style={{ fontSize: 12.5, color: "#166336", marginTop: 12 }}>
                ⚠ O nº de animais informado ({numBR(numeroAnimais)}) é maior que o registrado no D0 mais recente deste lote na {loteAtual.ordem} ({d0MaisRecente.numeroAnimais}).
              </p>
            )}
            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msg}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: msg || excedeQuantidade ? 0 : 12 }}>
              <BtnPrimary disabled={!canSaveBase} onClick={() => salvar(false)}><Plus size={15} /> Registrar retirada</BtnPrimary>
              {excedeQuantidade && canSaveBase && (
                <BtnPrimary onClick={() => salvar(true)}>Registrar mesmo assim</BtnPrimary>
              )}
            </div>
          </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Retiradas registradas</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum registro ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Ordem</th>
                    <th>Nº animais</th>
                    <th>Prostaglandina</th>
                    <th>Cipionato</th>
                    <th>ECG/HCG</th>
                    <th>Medicamentos</th>
                    <th>Local</th>
                    <th>Data</th>
                    <th>Leitura individual</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 700 }}>{nomeLote(m.loteId)}</td>
                      <td>{m.ordem || "—"}</td>
                      {editandoId === m.id ? (
                        <td><input style={inputStyle} type="number" min="1" value={editNumeroAnimais} onChange={(e) => setEditNumeroAnimais(e.target.value)} /></td>
                      ) : (
                        <td>{m.numeroAnimais ?? "—"}</td>
                      )}
                      <td>{nomeInsumo(m.prostaglandinaId)} ({m.doseProstaglandina} mL)</td>
                      <td>{nomeInsumo(m.cipionatoId)} ({m.doseCipionato} mL)</td>
                      <td>{nomeInsumo(m.ecgHcgId)} ({m.doseEcgHcg} mL)</td>
                      <td>{resumoMedicamentos(m.medicamentos, insumos)}</td>
                      <td>{m.localEstoque === "externo" ? "Externo" : "Fazenda"}</td>
                      <td>{fmtDate(m.data)}</td>
                      <td>{m.animaisLidos.length > 0 ? `${m.animaisLidos.length} animais` : "—"}</td>
                      <td>
                        {confirmandoExclusaoId === m.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                            <button onClick={() => { removerManejo(m.id); setConfirmandoExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : editandoId === m.id ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={salvarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                            <button onClick={cancelarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => iniciarEdicaoHistorico(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4A473E" }}><Pencil size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   INSEMINAÇÃO — leitura obrigatória, touro por animal
========================================================= */

function AbaInseminacao({ fazendaAtiva, safraAtiva, lotes, retiros, insumos, registrarManejo, registrarSaidaEstoque, manejos, addAnimalAoLote, atribuirManejosRetroativos, atribuirManejosRetroativosPorOrdem, garantirLoteDesconhecidos, atualizarManejo, removerManejo, rascunhos, salvarRascunho, limparRascunho, currentUser }) {
  const [localEstoque, setLocalEstoque] = useState("fazenda");
  const semensTodos = insumos.filter((i) => i.categoria === "Sêmen");
  const semens = semensTodos.filter((i) => i.local === localEstoque);
  const touros = [...new Set(semens.map((s) => s.touro))];
  const gnrhTodos = insumos.filter((i) => i.categoria === "Hormônio" && i.hormonio === "GnRH");
  const gnrh = gnrhTodos.filter((i) => i.local === localEstoque);
  // só entram lotes que já tiveram Retirada registrada para a ordem ATUAL do lote e que ainda não
  // tiveram Inseminação registrada nessa mesma ordem. Depois que a Inseminação é feita, o lote some
  // desta lista — e só volta a aparecer se uma Retirada for registrada na próxima ordem.
  const lotesComRetirada = lotes.filter((l) =>
    manejos.some((m) => m.tipo === "retirada" && m.loteId === l.id && m.ordem === l.ordem) &&
    !manejos.some((m) => m.tipo === "inseminacao" && m.loteId === l.id && m.ordem === l.ordem)
  );
  const [lotesSelecionados, setLotesSelecionados] = useState(lotesComRetirada[0] ? [lotesComRetirada[0].id] : []);
  const [msgLote, setMsgLote] = useState("");
  const [dataManejo, setDataManejo] = useState(todayISO());
  const [touro, setTouro] = useState(touros[0] || "");
  const [semenId, setSemenId] = useState("");
  const [inseminador, setInseminador] = useState(currentUser?.nome || "");
  // sugestões de "Inseminador" já usados antes — tirado do próprio histórico de manejos de
  // Inseminação (nada de cadastro à parte: cada nome novo digitado já vira sugestão a partir
  // da próxima leitura, porque fica gravado no manejo).
  const inseminadoresConhecidos = [...new Set(manejos.filter((m) => m.tipo === "inseminacao" && m.inseminador).map((m) => m.inseminador))];
  // "Raça da matriz": por animal (a fêmea), não por sessão como Touro/Partida. Se o animal já
  // teve uma raça atribuída antes (em qualquer Inseminação anterior), ela é reaproveitada
  // automaticamente ao ler o brinco; senão, fica livre para digitar e atribuir pela 1ª vez.
  // O cadastro de sugestões (datalist) também vem do próprio histórico, sem tela separada.
  const [racaMatriz, setRacaMatriz] = useState("");
  const racasConhecidas = [...new Set(
    manejos.filter((m) => m.tipo === "inseminacao").flatMap((m) => (m.detalhes || []).map((d) => d.racaMatriz).filter(Boolean))
  )];
  const buscarRacaConhecida = (b) => {
    const comRaca = manejos
      .filter((m) => m.tipo === "inseminacao")
      .flatMap((m) => (m.detalhes || []).map((d) => ({ ...d, data: m.data })))
      .filter((d) => d.brinco === b && d.racaMatriz);
    if (comRaca.length === 0) return null;
    return comRaca.reduce((mais, atual) => (atual.data > mais.data ? atual : mais)).racaMatriz;
  };
  const [brinco, setBrinco] = useState("");
  const [ecc, setEcc] = useState("");
  const [peso, setPeso] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [gnrhId, setGnrhId] = useState("");
  const [doseGnrh, setDoseGnrh] = useState("");
  const brincoInputRef = React.useRef(null);
  const eccInputRef = React.useRef(null);
  const pesoInputRef = React.useRef(null);
  const observacoesInputRef = React.useRef(null);
  const [registros, setRegistros] = useState([]); // {brinco, semenId, peso, ecc, observacoes, gnrhId, doseGnrh}
  useAvisarSaidaComPendencia(registros.length > 0);
  const [medicamentos, setMedicamentos] = useState([]);
  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  const chaveRascunho = lotesSelecionados.length > 0 ? `inseminacao_${lotesSelecionados.slice().sort().join("-")}` : null;
  React.useEffect(() => {
    if (chaveRascunho && registros.length === 0 && rascunhos[chaveRascunho]) {
      setRegistros(rascunhos[chaveRascunho].registros || []);
      setMedicamentos(rascunhos[chaveRascunho].medicamentos || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveRascunho]);
  const salvarProgresso = () => {
    if (!chaveRascunho || registros.length === 0) { setMsg("Leia ao menos um animal antes de salvar."); return; }
    salvarRascunho(chaveRascunho, { registros, medicamentos });
    setMsg("Progresso salvo. Você pode continuar depois.");
  };

  const lotesSelecionadosObjs = lotes.filter((l) => lotesSelecionados.includes(l.id));
  const ordemComum = lotesSelecionadosObjs[0]?.ordem || null;
  const loteAtual = lotesSelecionadosObjs.length === 1 ? lotesSelecionadosObjs[0] : null;
  const nomeRetiro = (id) => retiros.find((r) => r.id === id)?.nome || "—";

  // seleção múltipla de lotes: todos precisam estar na mesma Ordem
  const toggleLote = (id) => {
    if (lotesSelecionados.includes(id)) {
      setLotesSelecionados((a) => a.filter((x) => x !== id));
      setMsgLote("");
      return;
    }
    const lote = lotesComRetirada.find((l) => l.id === id);
    if (!lote) return;
    if (ordemComum && lote.ordem !== ordemComum) {
      setMsgLote(`Os lotes selecionados devem estar todos na mesma Ordem. "${lote.nome}" está na ${lote.ordem}, diferente da ${ordemComum} já selecionada.`);
      return;
    }
    if (ordemComum === ORDENS_IATF[0] && lotesSelecionados.length >= 1) {
      setMsgLote("Na leitura da 1º IATF, selecione apenas um lote por vez, já que é nela que os animais são atribuídos ao lote.");
      return;
    }
    setLotesSelecionados((a) => [...a, id]);
    setMsgLote("");
  };

  React.useEffect(() => {
    setLotesSelecionados((a) => a.filter((id) => lotesComRetirada.some((l) => l.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotesComRetirada.map((l) => l.id).join(",")]);

  React.useEffect(() => {
    if (gnrhId && !gnrh.some((p) => p.id === gnrhId)) setGnrhId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEstoque, gnrh.map((p) => p.id).join(",")]);

  const partidasDoTouro = semens.filter((s) => s.touro === touro);
  React.useEffect(() => {
    if (!partidasDoTouro.some((s) => s.id === semenId)) setSemenId(partidasDoTouro[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touro, semens.map((s) => s.id).join(",")]);
  React.useEffect(() => {
    if (!touros.includes(touro)) setTouro(touros[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localEstoque, touros.join(",")]);

  const loteDoAnimal = (brinco) => lotes.find((l) => (l.animais || []).includes(brinco));
  const buscarDiagnosticoPrenha = (b) => manejos.find((m) => m.tipo === "diagnostico" && (m.detalhes || []).some((d) => d.brinco === b && d.resultado === "Prenha"));
  const buscarInseminacaoNestaOrdem = (b, ordem) => manejos.find((m) => m.tipo === "inseminacao" && m.ordem === ordem && (m.animaisLidos || []).includes(b));

  const [pendente, setPendente] = useState(null); // { brinco, avisos: [], loteConflito: bool }
  const [avisoImediato, setAvisoImediato] = useState(null); // avisos mostrados assim que o animal é lido, antes de pedir o registro

  // conferência que roda assim que o brinco é lido (Enter no campo Identificação), antes de qualquer
  // outro campo ser preenchido: já avisa se o animal tem Diagnóstico de Prenha ou se pertence a outro lote.
  const conferirAoLer = () => {
    const b = brinco.trim();
    if (!b) return;
    const avisos = [];
    const diagPrenha = buscarDiagnosticoPrenha(b);
    if (diagPrenha) avisos.push(`Este animal já tem um Diagnóstico registrado como Prenha em ${fmtDate(diagPrenha.data)}.`);
    const loteDoBicho = loteDoAnimal(b);
    if (loteDoBicho && !lotesSelecionados.includes(loteDoBicho.id)) {
      const nomesSelecionados = lotesSelecionadosObjs.map((l) => l.nome).join(", ") || "—";
      avisos.push(`Este animal já pertence ao lote "${loteDoBicho.nome}", diferente do(s) lote(s) selecionado(s) (${nomesSelecionados}).`);
    }
    setAvisoImediato(avisos.length > 0 ? { brinco: b, avisos } : null);
    // raça da matriz: reaproveita a já atribuída antes; se não houver, deixa livre para digitar
    setRacaMatriz(buscarRacaConhecida(b) || "");
  };

  const limparCamposLeitura = () => { setBrinco(""); setEcc(""); setPeso(""); setObservacoes(""); setGnrhId(""); setDoseGnrh(""); setRacaMatriz(""); setMsg(""); setAvisoImediato(null); brincoInputRef.current?.focus(); };

  const adicionar = () => {
    const b = brinco.trim();
    if (!b) { setMsg("Leia o brinco do animal."); return; }
    if (!semenId) { setMsg("Selecione o touro e a partida utilizados."); return; }
    if (ecc.trim() !== "" && !OPCOES_ECC.includes(ecc.trim())) { setMsg("ECC inválido. Escolha um valor da lista."); return; }
    if (registros.some((r) => r.brinco === b)) { setMsg("Este animal já foi lido."); return; }
    if (lotesSelecionados.length === 0) { setMsg("Selecione ao menos um lote."); return; }

    const avisos = [];
    let loteConflito = false;

    const diagPrenha = buscarDiagnosticoPrenha(b);
    if (diagPrenha) {
      avisos.push(`Este animal já tem um Diagnóstico registrado como Prenha em ${fmtDate(diagPrenha.data)}.`);
    }

    const loteDoBicho = loteDoAnimal(b);
    const pertenceASelecionados = loteDoBicho && lotesSelecionados.includes(loteDoBicho.id);
    if (loteDoBicho && !pertenceASelecionados) {
      const nomesSelecionados = lotesSelecionadosObjs.map((l) => l.nome).join(", ") || "—";
      avisos.push(`Este animal já pertence ao lote "${loteDoBicho.nome}", diferente do(s) lote(s) selecionado(s) (${nomesSelecionados}).`);
      loteConflito = true;
    } else if (!loteDoBicho && !eh1aIATF) {
      avisos.push(`Este animal ainda não pertence a nenhum lote conhecido.`);
      loteConflito = true;
    }

    const loteResolvidoId = pertenceASelecionados ? loteDoBicho.id : (eh1aIATF ? lotesSelecionados[0] : null);

    const insemNestaOrdem = ordemComum ? buscarInseminacaoNestaOrdem(b, ordemComum) : null;
    if (insemNestaOrdem) {
      avisos.push(`Este animal já tem uma Inseminação registrada na ${ordemComum} (em ${fmtDate(insemNestaOrdem.data)}).`);
    }

    const dados = {
      brinco: b, semenId, ecc: ecc.trim() || null, peso: peso.trim() || null, observacoes: observacoes.trim() || null,
      gnrhId: gnrhId || null, doseGnrh: doseGnrh.trim() !== "" ? numBR(doseGnrh) : null,
      racaMatriz: racaMatriz.trim() || null,
      horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      loteId: loteResolvidoId,
    };

    if (avisos.length > 0) { setPendente({ ...dados, avisos, loteConflito }); setMsg(""); return; }

    setRegistros((a) => [...a, dados]);
    limparCamposLeitura();
  };

  const confirmarPendente = () => {
    if (!pendente) return;
    const { avisos, loteConflito, ...dados } = pendente;
    setRegistros((a) => [...a, dados]);
    setPendente(null); limparCamposLeitura();
  };
  const confirmarComoDesconhecido = () => {
    if (!pendente) return;
    const { avisos, loteConflito, ...dados } = pendente;
    const idDesconhecidos = garantirLoteDesconhecidos();
    addAnimalAoLote(idDesconhecidos, pendente.brinco);
    setRegistros((a) => [...a, { ...dados, loteId: idDesconhecidos, notaAtribuicao: "Atribuído ao lote de desconhecidos" }]);
    setPendente(null); limparCamposLeitura();
  };
  const confirmarComoLoteAtual = () => {
    if (!pendente || lotesSelecionados.length !== 1) return;
    const { avisos, loteConflito, ...dados } = pendente;
    const alvoId = lotesSelecionados[0];
    addAnimalAoLote(alvoId, pendente.brinco);
    atribuirManejosRetroativosPorOrdem(alvoId, [pendente.brinco], ordemComum);
    setRegistros((a) => [...a, { ...dados, loteId: alvoId, notaAtribuicao: "Inserido por dedução" }]);
    setPendente(null); limparCamposLeitura();
  };
  const cancelarPendente = () => setPendente(null);

  const remover = (brincoRem) => setRegistros((a) => a.filter((r) => r.brinco !== brincoRem));

  // cada manejo (D0, Retirada, Inseminação, Diagnóstico) só pode ocorrer uma vez por lote+ordem
  const lotesJaRegistrados = lotesSelecionadosObjs.filter((l) => manejos.some((m) => m.tipo === "inseminacao" && m.loteId === l.id && m.ordem === l.ordem));
  const jaRegistradoNestaOrdem = lotesJaRegistrados.length > 0;
  const eh1aIATF = ordemComum === ORDENS_IATF[0];

  const finalizar = () => {
    if (jaRegistradoNestaOrdem) { setMsg(`Já existe uma Inseminação registrada na ${ordemComum} para: ${lotesJaRegistrados.map((l) => l.nome).join(", ")}.`); return; }
    if (registros.length === 0) { setMsg("Leia ao menos um animal antes de finalizar."); return; }
    if (registros.some((r) => !r.loteId)) { setMsg("Há animais sem um lote definido nesta leitura. Revise antes de finalizar."); return; }

    // um manejo de Inseminação por lote selecionado (ou lote de desconhecidos), cada um só com os
    // animais que pertencem a ele — estoque de sêmen/GnRH é descontado por animal, então cada manejo
    // desconta exatamente a parte que lhe cabe; medicamentos (nível de sessão) só são descontados uma vez.
    const idsComRegistro = [...new Set(registros.map((r) => r.loteId))];
    const manejoIds = [];
    idsComRegistro.forEach((idLote) => {
      const lote = lotes.find((l) => l.id === idLote);
      const registrosDoLote = registros.filter((r) => r.loteId === idLote);
      if (!lote || registrosDoLote.length === 0) return;
      const manejoId = registrarManejo({
        tipo: "inseminacao", loteId: lote.id, loteNome: lote.nome, retiroId: lote.retiroId || null, categoria: lote.categoria || null, ordem: lote.ordem || ordemComum,
        medicamentos, localEstoque, animaisLidos: registrosDoLote.map((r) => r.brinco), detalhes: registrosDoLote, data: dataManejo, inseminador: inseminador.trim() || currentUser?.nome || null,
      });
      manejoIds.push(manejoId);
      const porSemen = {};
      registrosDoLote.forEach((r) => { porSemen[r.semenId] = (porSemen[r.semenId] || 0) + 1; });
      Object.entries(porSemen).forEach(([sid, qtd]) => registrarSaidaEstoque(sid, qtd, manejoId, "inseminacao"));
      const porGnrh = {};
      registrosDoLote.forEach((r) => { if (r.gnrhId && r.doseGnrh) porGnrh[r.gnrhId] = (porGnrh[r.gnrhId] || 0) + r.doseGnrh; });
      Object.entries(porGnrh).forEach(([gid, dose]) => registrarSaidaEstoque(gid, dose, manejoId, "inseminacao"));
    });
    if (manejoIds.length > 0) medicamentos.forEach((m) => registrarSaidaEstoque(m.medicamentoId, m.dose, manejoIds[0], "inseminacao"));

    // só a leitura da Inseminação da 1º IATF de fato atribui os animais ao lote — e, junto,
    // repassa a esses animais os manejos de lote (Indução, D0, Retirada) já feitos antes deles
    // serem identificados individualmente, para permitir análises futuras por animal.
    if (eh1aIATF && lotesSelecionados.length === 1) {
      const alvoId = lotesSelecionados[0];
      const brincosLidos = registros.filter((r) => r.loteId === alvoId).map((r) => r.brinco);
      brincosLidos.forEach((b) => addAnimalAoLote(alvoId, b));
      atribuirManejosRetroativos(alvoId, brincosLidos);
    }
    setRegistros([]); setMedicamentos([]); setDataManejo(todayISO()); setInseminador(currentUser?.nome || ""); setMsg("Inseminação registrada.");
    if (chaveRascunho) limparRascunho(chaveRascunho);
  };

  const historico = manejos.filter((m) => m.tipo === "inseminacao").slice(0, 6);
  const nomeLote = (id) => lotes.find((l) => l.id === id)?.nome || "—";
  const nomeInsumo = (id) => insumos.find((i) => i.id === id)?.produtoComercial || "—";
  const nomeSemen = (id) => {
    const s = insumos.find((i) => i.id === id);
    return s ? `${s.touro} — ${s.raca}${s.partida ? ` (partida ${fmtDate(s.partida)})` : ""}` : "—";
  };

  const [editandoId, setEditandoId] = useState(null);
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState(null);
  const [editLocalEstoque, setEditLocalEstoque] = useState("fazenda");
  const iniciarEdicaoHistorico = (m) => { setEditandoId(m.id); setEditLocalEstoque(m.localEstoque || "fazenda"); };
  const cancelarEdicaoHistorico = () => setEditandoId(null);
  const salvarEdicaoHistorico = () => {
    atualizarManejo(editandoId, { localEstoque: editLocalEstoque });
    setEditandoId(null);
  };

  return (
    <div>
      <SectionTitle icon={SpermIcon} title="Inseminação" subtitle="Leitura individual obrigatória. Informe o touro/sêmen usado em cada animal." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para registrar inseminações." />
      ) : !safraAtiva ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos. Todo manejo e lote precisa pertencer a uma safra." />
      ) : (
        <>
          {lotesComRetirada.length === 0 || semensTodos.length === 0 ? (
            <EmptyState text="Nenhum lote disponível para inseminação no momento (ou falta sêmen cadastrado). Um lote aparece aqui após a Retirada da sua ordem atual, e some daqui assim que a inseminação dessa ordem é registrada." />
          ) : (
            <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Lote(s) — selecione um ou mais, desde que na mesma Ordem</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {lotesComRetirada.map((l) => {
                const selecionado = lotesSelecionados.includes(l.id);
                return (
                  <button key={l.id} onClick={() => toggleLote(l.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                      borderRadius: 20, padding: "6px 12px", fontSize: 12.5,
                      background: selecionado ? "#E6EFE5" : "#EEEEEE", color: selecionado ? "#2A4531" : "#6B685E", fontWeight: selecionado ? 600 : 400,
                    }}>
                    {selecionado ? <CheckCircle2 size={13} /> : <Circle size={13} color="#9B9686" />}
                    {l.nome} <span style={{ opacity: 0.7 }}>· {l.ordem || "—"}</span>
                  </button>
                );
              })}
            </div>
            {msgLote && <p style={{ fontSize: 12.5, color: "#A32D2D", margin: "0 0 10px" }}>⚠ {msgLote}</p>}
            {lotesSelecionados.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
                <Field label="Ordem (comum aos lotes selecionados)">
                  <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={ordemComum || "—"} readOnly />
                </Field>
                <Field label="Data"><input style={inputStyle} type="date" value={dataManejo} onChange={(e) => setDataManejo(e.target.value)} /></Field>
                <Field label="Retiro / Categoria por lote">
                  <div style={{ fontSize: 12.5, color: "#4A473E", paddingTop: 8 }}>
                    {lotesSelecionadosObjs.map((l) => `${l.nome}: ${nomeRetiro(l.retiroId)} — ${l.categoria || "—"}`).join(" · ")}
                  </div>
                </Field>
              </div>
            )}
            <p style={{ fontSize: 11.5, color: "#9B9686", margin: "6px 0 0" }}>Retiro, categoria e ordem vêm automaticamente dos dados já cadastrados para cada lote no D0.</p>
            {jaRegistradoNestaOrdem && (
              <p style={{ fontSize: 12.5, color: "#A32D2D", margin: "10px 0 0" }}>
                Já existe uma Inseminação registrada na {ordemComum} para: {lotesJaRegistrados.map((l) => l.nome).join(", ")}. Não é possível registrar de novo para a mesma ordem.
              </p>
            )}
          </div>

          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Local de estoque</div>
            <SeletorLocalEstoque local={localEstoque} setLocal={setLocalEstoque} />
            {semens.length === 0 && (
              <p style={{ fontSize: 12, color: "#166336", marginTop: -8, marginBottom: 14 }}>Nenhum sêmen cadastrado neste local de estoque.</p>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 12 }}>Leitura dos animais (obrigatória)</div>
            <p style={{ fontSize: 11.5, color: "#9B9686", margin: "-4px 0 12px" }}>
              {eh1aIATF
                ? "Esta é a leitura da 1º IATF: os animais lidos aqui passam a compor oficialmente este lote."
                : "Este lote já foi composto na leitura da 1º IATF. Os animais lidos abaixo devem ser os mesmos já atribuídos a ele."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, alignItems: "end" }}>
              <Field label="Identificação">
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR e Enter" value={brinco}
                    onChange={(e) => { limparMsgSeSucesso(); if (avisoImediato) setAvisoImediato(null); setBrinco(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (brinco.trim()) { conferirAoLer(); eccInputRef.current?.focus(); } } }} />
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
              </Field>
              <Field label="Raça da matriz (opcional)">
                <input style={inputStyle} list="racas-conhecidas" value={racaMatriz} onChange={(e) => { limparMsgSeSucesso(); setRacaMatriz(e.target.value); }} placeholder="Ex: Nelore" />
                <datalist id="racas-conhecidas">
                  {racasConhecidas.map((r) => <option key={r} value={r} />)}
                </datalist>
              </Field>
              <Field label="Touro">
                <select style={inputStyle} value={touro} onChange={(e) => setTouro(e.target.value)}>
                  {touros.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Partida">
                <select style={inputStyle} value={semenId} onChange={(e) => setSemenId(e.target.value)}>
                  {partidasDoTouro.map((s) => <option key={s.id} value={s.id}>{fmtDate(s.partida)} (estoque: {s.estoque} doses)</option>)}
                </select>
              </Field>
              <Field label="Inseminador">
                <input style={inputStyle} list="inseminadores-conhecidos" value={inseminador} onChange={(e) => setInseminador(e.target.value)} placeholder="Nome de quem está inseminando" />
                <datalist id="inseminadores-conhecidos">
                  {inseminadoresConhecidos.map((nome) => <option key={nome} value={nome} />)}
                </datalist>
              </Field>
              <Field label="ECC">
                <input ref={eccInputRef} style={inputStyle} value={ecc} onChange={(e) => setEcc(e.target.value)} placeholder="Digite um valor da lista" list="ecc-opcoes"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); pesoInputRef.current?.focus(); } }} />
                <datalist id="ecc-opcoes">
                  {OPCOES_ECC.map((o) => <option key={o} value={o} />)}
                </datalist>
              </Field>
              <Field label="Peso (opcional)"><input ref={pesoInputRef} style={inputStyle} value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="kg"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); observacoesInputRef.current?.focus(); } }} /></Field>
              <Field label="Observações (opcional)"><input ref={observacoesInputRef} style={inputStyle} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Livre"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} /></Field>
              <CampoProdutoDose
                labelProduto="GnRH (opcional)"
                produto={
                  <select style={inputStyle} value={gnrhId} onChange={(e) => setGnrhId(e.target.value)}>
                    <option value="">— não usar —</option>
                    {gnrh.map((p) => <option key={p.id} value={p.id}>{p.produtoComercial}</option>)}
                  </select>
                }
                labelDose="Dose (mL)"
                dose={<input className="campo-dose" style={inputStyle} type="number" step="any" value={doseGnrh} onChange={(e) => setDoseGnrh(e.target.value)} placeholder="0" />}
              />
              <BtnPrimary onClick={adicionar} style={{ marginBottom: 14 }}>Registrar animal</BtnPrimary>
            </div>

            {avisoImediato && (
              <div style={{ marginBottom: 14, background: "#FBF3E4", border: "1.5px solid #E3B8A0", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <EarTag size="sm">{avisoImediato.brinco}</EarTag>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8A3E15" }}>Atenção a este animal</span>
                </div>
                {avisoImediato.avisos.map((a, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: "#8A3E15", margin: "4px 0" }}>⚠ {a}</p>
                ))}
                <p style={{ fontSize: 11.5, color: "#9B9686", margin: "6px 0 0" }}>Você ainda pode continuar preenchendo os demais campos normalmente; a confirmação final aparecerá ao registrar o animal.</p>
              </div>
            )}

            {pendente && (
              <div style={{ marginBottom: 14, background: "#FBF3E4", border: "1.5px solid #E3B8A0", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <EarTag size="sm">{pendente.brinco}</EarTag>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8A3E15" }}>Confirme antes de registrar este animal</span>
                </div>
                {pendente.avisos.map((a, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: "#8A3E15", margin: "4px 0" }}>⚠ {a}</p>
                ))}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {pendente.loteConflito ? (
                    <>
                      <BtnPrimary onClick={confirmarComoDesconhecido}>Registrar e atribuir ao lote de desconhecidos</BtnPrimary>
                      {lotesSelecionados.length === 1 && (
                        <BtnPrimary onClick={confirmarComoLoteAtual}>Registrar e atribuir ao lote atual</BtnPrimary>
                      )}
                    </>
                  ) : (
                    <BtnPrimary onClick={confirmarPendente}>Registrar mesmo assim</BtnPrimary>
                  )}
                  <BtnGhost onClick={cancelarPendente}>Cancelar</BtnGhost>
                </div>
              </div>
            )}

            <CampoMedicamentos insumos={insumos} local={localEstoque} selecionados={medicamentos} setSelecionados={setMedicamentos} />

            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msg}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: msg ? 0 : 12 }}>
              <BtnGhost onClick={salvarProgresso}><Save size={14} /> Salvar</BtnGhost>
              <BtnPrimary disabled={jaRegistradoNestaOrdem} onClick={finalizar}>Finalizar inseminação ({registros.length})</BtnPrimary>
            </div>

            {registros.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Animais lidos nesta sessão ({registros.length})</div>
                <table>
                  <thead><tr><th>Animal</th><th>Lote</th><th>Horário</th><th>Sêmen / touro</th><th>ECC</th><th>Peso</th><th>Observações</th><th>GnRH</th><th>Nota</th><th></th></tr></thead>
                  <tbody>
                    {registros.map((r) => (
                      <tr key={r.brinco}>
                        <td><EarTag size="sm">{r.brinco}</EarTag></td>
                        <td style={{ fontWeight: 700 }}>{lotes.find((l) => l.id === r.loteId)?.nome || "—"}</td>
                        <td>{r.horario || "—"}</td>
                        <td>{nomeSemen(r.semenId)}</td>
                        <td>{r.ecc || "—"}</td>
                        <td>{r.peso ? `${r.peso} kg` : "—"}</td>
                        <td>{r.observacoes || "—"}</td>
                        <td>{r.gnrhId ? `${nomeInsumo(r.gnrhId)} (${r.doseGnrh} mL)` : "—"}</td>
                        <td>{r.notaAtribuicao || "—"}</td>
                        <td><button onClick={() => remover(r.brinco)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Inseminações registradas</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum registro ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Categoria</th>
                    <th>Ordem</th>
                    <th>Animais inseminados</th>
                    <th>Medicamentos</th>
                    <th>Local</th>
                    <th>Data</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 700 }}>{nomeLote(m.loteId)}</td>
                      <td>{m.categoria || "—"}</td>
                      <td>{m.ordem || "—"}</td>
                      <td>{m.animaisLidos.length}</td>
                      <td>{resumoMedicamentos(m.medicamentos, insumos)}</td>
                      {editandoId === m.id ? (
                        <td>
                          <SeletorLocalEstoque local={editLocalEstoque} setLocal={setEditLocalEstoque} style={{ marginBottom: 0 }} />
                        </td>
                      ) : (
                        <td>{m.localEstoque === "externo" ? "Externo" : "Fazenda"}</td>
                      )}
                      <td>{fmtDate(m.data)}</td>
                      <td>
                        {confirmandoExclusaoId === m.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                            <button onClick={() => { removerManejo(m.id); setConfirmandoExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : editandoId === m.id ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={salvarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                            <button onClick={cancelarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => iniciarEdicaoHistorico(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4A473E" }}><Pencil size={14} /></button>
                            <button onClick={() => setConfirmandoExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   DIAGNÓSTICO — leitura obrigatória, prenha/vazia
========================================================= */

function AbaDiagnosticoInseminacao({ fazendaAtiva, safraAtiva, lotes, insumos, registrarManejo, registrarSaidaEstoque, manejos, atualizarLote, addAnimalAoLote, atribuirManejosRetroativos, garantirLoteDesconhecidos, criarSugestaoRessinc, criarSugestaoRepasse, atualizarManejo, removerManejo, rascunhos, salvarRascunho, limparRascunho }) {
  const [localEstoque, setLocalEstoque] = useState("fazenda");

  // só entram lotes que já tiveram Inseminação registrada para a ordem ATUAL do lote e que ainda
  // não tiveram Diagnóstico registrado nessa mesma ordem.
  const lotesComInseminacao = lotes.filter((l) =>
    manejos.some((m) => m.tipo === "inseminacao" && m.loteId === l.id && m.ordem === l.ordem) &&
    !manejos.some((m) => m.tipo === "diagnostico" && m.loteId === l.id && m.ordem === l.ordem)
  );

  const [lotesSelecionados, setLotesSelecionados] = useState(lotesComInseminacao[0] ? [lotesComInseminacao[0].id] : []);
  const [msgLote, setMsgLote] = useState("");
  const [dataManejo, setDataManejo] = useState(todayISO());
  const [destinoVazias, setDestinoVazias] = useState("Ressinc"); // "Ressinc" | "Repasse" | "Descarte"
  const [brinco, setBrinco] = useState("");
  const [resultadoInput, setResultadoInput] = useState("");
  const [resultado, setResultado] = useState("");
  const resolverResultado = (txt) => {
    const t = txt.trim().toUpperCase();
    if (t.startsWith("P")) return "Prenha";
    if (t.startsWith("V")) return "Vazia";
    return "";
  };
  const brincoInputRef = React.useRef(null);
  const resultadoInputRef = React.useRef(null);
  const [registros, setRegistros] = useState([]);
  useAvisarSaidaComPendencia(registros.length > 0);
  const [medicamentos, setMedicamentos] = useState([]);
  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  const chaveRascunho = lotesSelecionados.length > 0 ? `diagnostico_${lotesSelecionados.slice().sort().join("-")}` : null;
  React.useEffect(() => {
    if (chaveRascunho && registros.length === 0 && rascunhos[chaveRascunho]) {
      setRegistros(rascunhos[chaveRascunho].registros || []);
      setMedicamentos(rascunhos[chaveRascunho].medicamentos || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveRascunho]);
  const salvarProgresso = () => {
    if (!chaveRascunho || registros.length === 0) { setMsg("Leia ao menos um animal antes de salvar."); return; }
    salvarRascunho(chaveRascunho, { registros, medicamentos });
    setMsg("Progresso salvo. Você pode continuar depois.");
  };

  const lotesSelecionadosObjs = lotes.filter((l) => lotesSelecionados.includes(l.id));
  const ordemComum = lotesSelecionadosObjs[0]?.ordem || null;

  const toggleLote = (id) => {
    if (lotesSelecionados.includes(id)) {
      setLotesSelecionados((a) => a.filter((x) => x !== id));
      setMsgLote("");
      return;
    }
    const lote = lotesComInseminacao.find((l) => l.id === id);
    if (!lote) return;
    if (ordemComum && lote.ordem !== ordemComum) {
      setMsgLote(`Os lotes selecionados devem estar todos na mesma Ordem. "${lote.nome}" está na ${lote.ordem}, diferente da ${ordemComum} já selecionada.`);
      return;
    }
    setLotesSelecionados((a) => [...a, id]);
    setMsgLote("");
  };

  React.useEffect(() => {
    setLotesSelecionados((a) => a.filter((id) => lotesComInseminacao.some((l) => l.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotesComInseminacao.map((l) => l.id).join(",")]);

  const loteAtual = lotesSelecionadosObjs.length === 1 ? lotesSelecionadosObjs[0] : null;

  const buscarUltimaInseminacao = (b) => {
    const insems = manejos.filter((m) => m.tipo === "inseminacao" && (m.animaisLidos || []).includes(b));
    if (insems.length === 0) return null;
    return insems.reduce((mais, atual) => (atual.data > mais.data ? atual : mais));
  };
  const diasEntre = (dataA, dataB) => Math.round((parseISODate(dataB) - parseISODate(dataA)) / 86400000);
  const buscarDiagnosticoAnterior = (b, ordem) => {
    const diags = manejos.filter((m) => m.tipo === "diagnostico" && m.ordem === ordem && (m.animaisLidos || []).includes(b));
    if (diags.length === 0) return null;
    return diags.reduce((mais, atual) => (atual.data > mais.data ? atual : mais));
  };
  // checa TODO o histórico do animal (Diagnóstico de Inseminação e de Repasse) por um
  // resultado de Prenha já registrado antes — independente de ordem ou do tipo de diagnóstico.
  const buscarPrenhezAnterior = (b) => {
    const diags = manejos.filter((m) => (m.tipo === "diagnostico" || m.tipo === "diagnostico_repasse") && (m.detalhes || []).some((d) => d.brinco === b && d.resultado === "Prenha"));
    if (diags.length === 0) return null;
    return diags.reduce((mais, atual) => (atual.data > mais.data ? atual : mais));
  };

  const [pendente, setPendente] = useState(null); // { brinco, avisos: [], semInseminacao: bool }

  // calcula todos os avisos possíveis para um brinco — usada tanto para o aviso imediato
  // (assim que o brinco é lido) quanto para a confirmação final ao registrar.
  const calcularAvisos = (b) => {
    const avisos = [];
    let semInseminacao = false;
    let loteConflito = false;
    const loteDoBicho = lotes.find((l) => (l.animais || []).includes(b));
    const pertenceASelecionados = loteDoBicho && lotesSelecionados.includes(loteDoBicho.id);
    if (loteDoBicho && !pertenceASelecionados) {
      const nomesSelecionados = lotesSelecionadosObjs.map((l) => l.nome).join(", ") || "—";
      avisos.push(`Este animal está alocado no lote "${loteDoBicho.nome}", diferente do(s) lote(s) selecionado(s) aqui (${nomesSelecionados}).`);
      loteConflito = true;
    }
    const loteResolvidoId = pertenceASelecionados ? loteDoBicho.id : (lotesSelecionados.length === 1 ? lotesSelecionados[0] : null);
    const ultimaInsem = buscarUltimaInseminacao(b);
    if (!ultimaInsem) {
      avisos.push("Não foi encontrada nenhuma Inseminação registrada para este animal.");
      semInseminacao = true;
    } else {
      const dias = diasEntre(ultimaInsem.data, todayISO());
      if (dias < 26) {
        avisos.push(`Só se passaram ${dias} dia(s) desde a última Inseminação deste animal (${fmtDate(ultimaInsem.data)}). O recomendado é aguardar ao menos 26 dias.`);
      }
    }
    const diagAnterior = buscarDiagnosticoAnterior(b, ordemComum);
    if (diagAnterior) {
      avisos.push(`Este animal já tem um Diagnóstico registrado nesta ${ordemComum || "ordem"} em ${fmtDate(diagAnterior.data)}.`);
    }
    const prenhezAnterior = buscarPrenhezAnterior(b);
    if (prenhezAnterior) {
      avisos.push(`Este animal já tem um registro de Prenha em ${fmtDate(prenhezAnterior.data)}.`);
    }
    return { avisos, semInseminacao, loteConflito, loteResolvidoId };
  };

  // aviso imediato assim que o brinco é lido — antes mesmo do Resultado ser preenchido
  const [avisoImediato, setAvisoImediato] = useState(null);
  const conferirAoLer = () => {
    const b = brinco.trim();
    if (!b) return;
    const { avisos } = calcularAvisos(b);
    setAvisoImediato(avisos.length > 0 ? { brinco: b, avisos } : null);
  };

  const adicionar = () => {
    const b = brinco.trim();
    if (!b) { setMsg("Leia o brinco do animal."); return; }
    if (registros.some((r) => r.brinco === b)) { setMsg("Este animal já foi lido."); return; }
    if (!resultado) { setMsg("Digite P (Prenha) ou V (Vazia) no campo Resultado."); resultadoInputRef.current?.focus(); return; }

    const { avisos, semInseminacao, loteConflito, loteResolvidoId } = calcularAvisos(b);

    if (avisos.length > 0) { setPendente({ brinco: b, avisos, semInseminacao, loteConflito, loteResolvidoId }); setMsg(""); return; }

    setRegistros((a) => [...a, { brinco: b, resultado, loteId: loteResolvidoId }]);
    setBrinco(""); setResultadoInput(""); setResultado(""); setAvisoImediato(null); setMsg("");
    brincoInputRef.current?.focus();
  };

  const confirmarPendente = () => {
    if (!pendente) return;
    setRegistros((a) => [...a, { brinco: pendente.brinco, resultado, loteId: pendente.loteResolvidoId }]);
    setPendente(null); setBrinco(""); setResultadoInput(""); setResultado(""); setAvisoImediato(null); setMsg("");
    brincoInputRef.current?.focus();
  };
  const confirmarComoDesconhecido = () => {
    if (!pendente) return;
    const idDesconhecidos = garantirLoteDesconhecidos();
    addAnimalAoLote(idDesconhecidos, pendente.brinco);
    setRegistros((a) => [...a, { brinco: pendente.brinco, resultado, loteId: idDesconhecidos, observacao: "Atribuído ao lote de desconhecidos" }]);
    setPendente(null); setBrinco(""); setResultadoInput(""); setResultado(""); setMsg("");
    brincoInputRef.current?.focus();
  };
  const confirmarComoLoteAtual = () => {
    if (!pendente || lotesSelecionados.length !== 1) return;
    const alvoId = lotesSelecionados[0];
    addAnimalAoLote(alvoId, pendente.brinco);
    atribuirManejosRetroativos(alvoId, [pendente.brinco]);
    setRegistros((a) => [...a, { brinco: pendente.brinco, resultado, loteId: alvoId, observacao: "Inserido por dedução" }]);
    setPendente(null); setBrinco(""); setResultadoInput(""); setResultado(""); setMsg("");
    brincoInputRef.current?.focus();
  };
  const cancelarPendente = () => setPendente(null);

  const remover = (b) => setRegistros((a) => a.filter((r) => r.brinco !== b));

  // cada manejo (D0, Retirada, Inseminação, Diagnóstico) só pode ocorrer uma vez por lote+ordem
  const lotesJaRegistrados = lotesSelecionadosObjs.filter((l) => manejos.some((m) => m.tipo === "diagnostico" && m.loteId === l.id && m.ordem === l.ordem));
  const jaRegistradoNestaOrdem = lotesJaRegistrados.length > 0;

  const finalizar = () => {
    if (jaRegistradoNestaOrdem) { setMsg(`Já existe um Diagnóstico registrado na ${ordemComum} para: ${lotesJaRegistrados.map((l) => l.nome).join(", ")}.`); return; }
    if (registros.length === 0) { setMsg("Leia ao menos um animal antes de finalizar."); return; }
    if (registros.some((r) => !r.loteId)) { setMsg("Há animais sem um lote definido nesta leitura. Revise antes de finalizar."); return; }

    const idsComRegistro = [...new Set(registros.map((r) => r.loteId))];
    const manejoIds = [];
    idsComRegistro.forEach((idLote) => {
      const lote = lotes.find((l) => l.id === idLote);
      const registrosDoLote = registros.filter((r) => r.loteId === idLote);
      if (!lote || registrosDoLote.length === 0) return;
      const manejoId = registrarManejo({ tipo: "diagnostico", loteId: lote.id, ordem: lote.ordem || ordemComum, medicamentos, localEstoque, animaisLidos: registrosDoLote.map((r) => r.brinco), detalhes: registrosDoLote, data: dataManejo, destinoVazias });
      manejoIds.push(manejoId);
      // animais Vazia geram uma sugestão de Ressinc OU de Repasse (nunca as duas), conforme o
      // "Destino para vazias" escolhido — "Descarte" não gera nenhuma sugestão.
      const vaziaBrincos = registrosDoLote.filter((r) => r.resultado === "Vazia").map((r) => r.brinco);
      if (vaziaBrincos.length > 0) {
        if (destinoVazias === "Ressinc") criarSugestaoRessinc(lote.id, vaziaBrincos, manejoId);
        else if (destinoVazias === "Repasse") criarSugestaoRepasse(lote.id, vaziaBrincos, manejoId);
      }
    });
    if (manejoIds.length > 0) medicamentos.forEach((m) => registrarSaidaEstoque(m.medicamentoId, m.dose, manejoIds[0], "diagnostico"));

    setRegistros([]); setMedicamentos([]); setDataManejo(todayISO()); setMsg("Diagnóstico registrado.");
    if (chaveRascunho) limparRascunho(chaveRascunho);
  };

  const historico = manejos.filter((m) => m.tipo === "diagnostico").slice(0, 6);
  const nomeLote = (id) => lotes.find((l) => l.id === id)?.nome || "—";

  const [editandoId, setEditandoId] = useState(null);
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState(null);
  const [editLocalEstoque, setEditLocalEstoque] = useState("fazenda");
  const iniciarEdicaoHistorico = (m) => { setEditandoId(m.id); setEditLocalEstoque(m.localEstoque || "fazenda"); };
  const cancelarEdicaoHistorico = () => setEditandoId(null);
  const salvarEdicaoHistorico = () => {
    atualizarManejo(editandoId, { localEstoque: editLocalEstoque });
    setEditandoId(null);
  };


  return (
    <div>
      {!fazendaAtiva ? <EmptyState text="Selecione uma fazenda ativa para registrar diagnósticos." /> : !safraAtiva ? <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos. Todo manejo e lote precisa pertencer a uma safra." /> : lotesComInseminacao.length === 0 ? <EmptyState text="Nenhum lote disponível para diagnóstico no momento. Um lote aparece aqui após a Inseminação da sua ordem atual, e some daqui assim que o diagnóstico dessa ordem é registrado." /> : (
        <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Lote(s) — selecione um ou mais, desde que na mesma Ordem</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {lotesComInseminacao.map((l) => {
                const selecionado = lotesSelecionados.includes(l.id);
                return (
                  <button key={l.id} onClick={() => toggleLote(l.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                      borderRadius: 20, padding: "6px 12px", fontSize: 12.5,
                      background: selecionado ? "#E6EFE5" : "#EEEEEE", color: selecionado ? "#2A4531" : "#6B685E", fontWeight: selecionado ? 600 : 400,
                    }}>
                    {selecionado ? <CheckCircle2 size={13} /> : <Circle size={13} color="#9B9686" />}
                    {l.nome} <span style={{ opacity: 0.7 }}>— {l.categoria} · {l.ordem || "—"}</span>
                  </button>
                );
              })}
            </div>
            {msgLote && <p style={{ fontSize: 12.5, color: "#A32D2D", margin: "0 0 10px" }}>⚠ {msgLote}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, alignItems: "end" }}>
              <Field label="Ordem (comum aos lotes selecionados)">
                <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={ordemComum || "—"} readOnly />
              </Field>
              <Field label="Data"><input style={inputStyle} type="date" value={dataManejo} onChange={(e) => { limparMsgSeSucesso(); setDataManejo(e.target.value); }} /></Field>
              <Field label="Destino para vazias">
                <select style={inputStyle} value={destinoVazias} onChange={(e) => { limparMsgSeSucesso(); setDestinoVazias(e.target.value); }}>
                  <option value="Ressinc">Ressinc</option>
                  <option value="Repasse">Repasse</option>
                  <option value="Descarte">Descarte</option>
                </select>
              </Field>
              <Field label="Leitura do animal (obrigatória)">
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR e Enter" value={brinco}
                    onChange={(e) => { limparMsgSeSucesso(); if (avisoImediato) setAvisoImediato(null); setBrinco(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (brinco.trim()) { conferirAoLer(); resultadoInputRef.current?.focus(); } } }} />
                  <BtnPrimary onClick={() => { if (brinco.trim()) conferirAoLer(); resultadoInputRef.current?.focus(); }}><ScanLine size={15} /></BtnPrimary>
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
              </Field>
              <Field label="Resultado">
                <input ref={resultadoInputRef} style={inputStyle} placeholder="P (Prenha) ou V (Vazia)" value={resultadoInput}
                  onChange={(e) => { limparMsgSeSucesso(); const v = e.target.value; setResultadoInput(v); setResultado(resolverResultado(v)); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
              </Field>
            </div>
            {avisoImediato && (
              <div style={{ marginTop: 14, background: "#FBF3E4", border: "1.5px solid #E3B8A0", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <EarTag size="sm">{avisoImediato.brinco}</EarTag>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8A3E15" }}>Atenção a este animal</span>
                </div>
                {avisoImediato.avisos.map((a, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: "#8A3E15", margin: "4px 0" }}>⚠ {a}</p>
                ))}
                <p style={{ fontSize: 11.5, color: "#9B9686", margin: "6px 0 0" }}>Preencha o Resultado normalmente — a confirmação final aparecerá ao registrar.</p>
              </div>
            )}
            {jaRegistradoNestaOrdem && (
              <p style={{ fontSize: 12.5, color: "#A32D2D", margin: "10px 0 0" }}>
                Já existe um Diagnóstico registrado na {ordemComum} para: {lotesJaRegistrados.map((l) => l.nome).join(", ")}. Não é possível registrar de novo para a mesma ordem.
              </p>
            )}

            {pendente && (
              <div style={{ marginTop: 14, background: "#FBF3E4", border: "1.5px solid #E3B8A0", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <EarTag size="sm">{pendente.brinco}</EarTag>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8A3E15" }}>Confirme antes de registrar este animal</span>
                </div>
                {pendente.avisos.map((a, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: "#8A3E15", margin: "4px 0" }}>⚠ {a}</p>
                ))}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {pendente.semInseminacao ? (
                    <>
                      <BtnPrimary onClick={confirmarComoDesconhecido}>Registrar e atribuir ao lote de desconhecidos</BtnPrimary>
                      {lotesSelecionados.length === 1 && (
                        <BtnPrimary onClick={confirmarComoLoteAtual}>Registrar e atribuir ao lote atual</BtnPrimary>
                      )}
                    </>
                  ) : (
                    <BtnPrimary onClick={confirmarPendente}>Registrar mesmo assim</BtnPrimary>
                  )}
                  <BtnGhost onClick={cancelarPendente}>Cancelar</BtnGhost>
                </div>
              </div>
            )}

            {registros.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Animais lidos nesta sessão</div>
                <table>
                  <thead><tr><th>Animal</th><th>Resultado</th><th>Lote</th><th>Observação</th><th></th></tr></thead>
                  <tbody>
                    {registros.map((r) => (
                      <tr key={r.brinco}>
                        <td><EarTag size="sm">{r.brinco}</EarTag></td>
                        <td style={{ color: r.resultado === "Prenha" ? "#166336" : "#166336", fontWeight: 600 }}>
                          {r.resultado}{r.resultado === "Vazia" && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#166336" }}>· gera sugestão de Ressinc</span>}
                        </td>
                        <td style={{ fontWeight: 700 }}>{lotes.find((l) => l.id === r.loteId)?.nome || "—"}</td>
                        <td>{r.observacao || "—"}</td>
                        <td><button onClick={() => remover(r.brinco)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8, marginTop: 6 }}>Local de estoque (medicamentos)</div>
            <SeletorLocalEstoque local={localEstoque} setLocal={setLocalEstoque} />
            <CampoMedicamentos insumos={insumos} local={localEstoque} selecionados={medicamentos} setSelecionados={setMedicamentos} />

            {jaRegistradoNestaOrdem && (
              <p style={{ fontSize: 12.5, color: "#A32D2D", marginTop: 12 }}>
                Já existe um Diagnóstico registrado para este lote na {loteAtual.ordem}. Não é possível registrar de novo para a mesma ordem.
              </p>
            )}
            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msg}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: msg ? 0 : 12 }}>
              <BtnGhost onClick={salvarProgresso}><Save size={14} /> Salvar</BtnGhost>
              <BtnPrimary disabled={jaRegistradoNestaOrdem} onClick={finalizar}>Finalizar diagnóstico ({registros.length})</BtnPrimary>
            </div>
          </div>


          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Diagnósticos registrados</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum registro ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto", marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Ordem</th>
                    <th>Prenhas</th>
                    <th>Avaliadas</th>
                    <th>Medicamentos</th>
                    <th>Local</th>
                    <th>Data</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((m) => {
                    const prenhas = m.detalhes.filter((d) => d.resultado === "Prenha").length;
                    return (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 700 }}>{nomeLote(m.loteId)}</td>
                        <td>{m.ordem || "—"}</td>
                        <td>{prenhas}</td>
                        <td>{m.detalhes.length}</td>
                        <td>{resumoMedicamentos(m.medicamentos, insumos)}</td>
                        {editandoId === m.id ? (
                          <td>
                            <SeletorLocalEstoque local={editLocalEstoque} setLocal={setEditLocalEstoque} style={{ marginBottom: 0 }} />
                          </td>
                        ) : (
                          <td>{m.localEstoque === "externo" ? "Externo" : "Fazenda"}</td>
                        )}
                        <td>{fmtDate(m.data)}</td>
                        <td>
                          {confirmandoExclusaoId === m.id ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                              <button onClick={() => { removerManejo(m.id); setConfirmandoExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                              <button onClick={() => setConfirmandoExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                            </div>
                          ) : editandoId === m.id ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={salvarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                              <button onClick={cancelarEdicaoHistorico} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => iniciarEdicaoHistorico(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4A473E" }}><Pencil size={14} /></button>
                              <button onClick={() => setConfirmandoExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   DIAGNÓSTICO DE REPASSE — mesma ideia do Diagnóstico de Inseminação, mas
   simplificado: Identificação, Resultado (P/V) e Tempo de gestação informado,
   para os animais que passaram pelo manejo de Repasse.
========================================================= */

function AbaDiagnosticoRepasse({ fazendaAtiva, safraAtiva, lotes, manejos, registrarManejo, atualizarManejo, removerManejo, rascunhos, salvarRascunho, limparRascunho }) {
  // só entram lotes que já tiveram Repasse registrado
  const lotesComRepasse = lotes.filter((l) => manejos.some((m) => m.tipo === "repasse" && m.loteId === l.id));

  const [lotesSelecionados, setLotesSelecionados] = useState(lotesComRepasse[0] ? [lotesComRepasse[0].id] : []);
  React.useEffect(() => {
    setLotesSelecionados((a) => a.filter((id) => lotesComRepasse.some((l) => l.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotesComRepasse.map((l) => l.id).join(",")]);
  const toggleLote = (id) => setLotesSelecionados((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]);

  const [dataManejo, setDataManejo] = useState(todayISO());
  const [brinco, setBrinco] = useState("");
  const brincoInputRef = React.useRef(null);
  const [resultadoInput, setResultadoInput] = useState("");
  const [resultado, setResultado] = useState("");
  const resultadoInputRef = React.useRef(null);
  const [tempoGestacaoInformado, setTempoGestacaoInformado] = useState("");
  const tempoInputRef = React.useRef(null);
  const [registros, setRegistros] = useState([]);
  useAvisarSaidaComPendencia(registros.length > 0);
  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  const chaveRascunho = lotesSelecionados.length > 0 ? `diagnostico_repasse_${lotesSelecionados.slice().sort().join("-")}` : null;
  React.useEffect(() => {
    if (chaveRascunho && registros.length === 0 && rascunhos[chaveRascunho]) {
      setRegistros(rascunhos[chaveRascunho].registros || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveRascunho]);
  const salvarProgresso = () => {
    if (!chaveRascunho || registros.length === 0) { setMsg("Leia ao menos um animal antes de salvar."); return; }
    salvarRascunho(chaveRascunho, { registros });
    setMsg("Progresso salvo. Você pode continuar depois.");
  };

  const resolverResultado = (txt) => {
    const t = txt.trim().toUpperCase();
    if (t.startsWith("P")) return "Prenha";
    if (t.startsWith("V")) return "Vazia";
    return "";
  };

  // checa TODO o histórico do animal (Diagnóstico de Inseminação e de Repasse) por um
  // resultado de Prenha já registrado antes.
  const buscarPrenhezAnterior = (b) => {
    const diags = manejos.filter((m) => (m.tipo === "diagnostico" || m.tipo === "diagnostico_repasse") && (m.detalhes || []).some((d) => d.brinco === b && d.resultado === "Prenha"));
    if (diags.length === 0) return null;
    return diags.reduce((mais, atual) => (atual.data > mais.data ? atual : mais));
  };

  // aviso imediato assim que o brinco é lido — antes mesmo do Resultado ser preenchido
  const [avisoImediato, setAvisoImediato] = useState(null);
  const conferirAoLer = () => {
    const b = brinco.trim();
    if (!b) return;
    const prenhezAnterior = buscarPrenhezAnterior(b);
    setAvisoImediato(prenhezAnterior ? { brinco: b, mensagem: `Este animal já tem um registro de Prenha em ${fmtDate(prenhezAnterior.data)}.` } : null);
  };

  const adicionar = () => {
    const b = brinco.trim();
    if (!b) { setMsg("Leia o brinco do animal."); return; }
    if (!resultado) { setMsg("Informe o resultado (P ou V)."); return; }
    if (lotesSelecionados.length === 0) { setMsg("Selecione ao menos um lote."); return; }
    if (registros.some((r) => r.brinco === b)) { setMsg("Este animal já foi lido."); return; }

    const loteDoBicho = lotes.find((l) => (l.animais || []).includes(b));
    const pertenceASelecionados = loteDoBicho && lotesSelecionados.includes(loteDoBicho.id);
    const loteResolvidoId = pertenceASelecionados ? loteDoBicho.id : lotesSelecionados[0];

    setRegistros((a) => [...a, {
      brinco: b, resultado, tempoGestacaoInformado: tempoGestacaoInformado.trim() !== "" ? numBR(tempoGestacaoInformado) : null,
      loteId: loteResolvidoId,
    }]);
    setBrinco(""); setResultadoInput(""); setResultado(""); setTempoGestacaoInformado(""); setAvisoImediato(null); setMsg("");
    brincoInputRef.current?.focus();
  };

  const remover = (b) => setRegistros((a) => a.filter((r) => r.brinco !== b));

  const finalizar = () => {
    if (registros.length === 0) { setMsg("Leia ao menos um animal antes de finalizar."); return; }
    const idsComRegistro = [...new Set(registros.map((r) => r.loteId))];
    idsComRegistro.forEach((idLote) => {
      const lote = lotes.find((l) => l.id === idLote);
      const registrosDoLote = registros.filter((r) => r.loteId === idLote);
      if (!lote || registrosDoLote.length === 0) return;
      registrarManejo({
        tipo: "diagnostico_repasse", loteId: lote.id, loteNome: lote.nome, retiroId: lote.retiroId || null,
        animaisLidos: registrosDoLote.map((r) => r.brinco), detalhes: registrosDoLote, data: dataManejo,
      });
    });
    setRegistros([]); setDataManejo(todayISO()); setMsg("Diagnóstico de Repasse registrado.");
    if (chaveRascunho) limparRascunho(chaveRascunho);
  };

  const historico = manejos.filter((m) => m.tipo === "diagnostico_repasse").slice(0, 8);

  return (
    <div>
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para registrar diagnósticos." />
      ) : !safraAtiva ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos." />
      ) : lotesComRepasse.length === 0 ? (
        <EmptyState text="Nenhum lote disponível para Diagnóstico de Repasse no momento. Um lote aparece aqui depois de ter um Repasse registrado." />
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Lote(s) — selecione um ou mais</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {lotesComRepasse.map((l) => {
                const selecionado = lotesSelecionados.includes(l.id);
                return (
                  <button key={l.id} onClick={() => toggleLote(l.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                      borderRadius: 20, padding: "6px 12px", fontSize: 12.5,
                      background: selecionado ? "#E6EFE5" : "#EEEEEE", color: selecionado ? "#2A4531" : "#6B685E", fontWeight: selecionado ? 600 : 400,
                    }}>
                    {selecionado ? <CheckCircle2 size={13} /> : <Circle size={13} color="#9B9686" />}
                    {l.nome}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, alignItems: "end" }}>
              <Field label="Identificação (obrigatória)">
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR e Enter" value={brinco}
                    onChange={(e) => { limparMsgSeSucesso(); if (avisoImediato) setAvisoImediato(null); setBrinco(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (brinco.trim()) { conferirAoLer(); resultadoInputRef.current?.focus(); } } }} />
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
              </Field>
              <Field label="Resultado">
                <input ref={resultadoInputRef} style={inputStyle} placeholder="P (Prenha) ou V (Vazia)" value={resultadoInput}
                  onChange={(e) => { limparMsgSeSucesso(); const v = e.target.value; setResultadoInput(v); setResultado(resolverResultado(v)); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tempoInputRef.current?.focus(); } }} />
              </Field>
              <Field label="Tempo de gestação informado">
                <input ref={tempoInputRef} style={inputStyle} type="number" value={tempoGestacaoInformado}
                  onChange={(e) => { limparMsgSeSucesso(); setTempoGestacaoInformado(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} placeholder="dias (opcional)" />
              </Field>
              <Field label="Data"><input style={inputStyle} type="date" value={dataManejo} onChange={(e) => { limparMsgSeSucesso(); setDataManejo(e.target.value); }} /></Field>
            </div>
            {avisoImediato && (
              <div style={{ marginTop: 14, background: "#FBF3E4", border: "1.5px solid #E3B8A0", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <EarTag size="sm">{avisoImediato.brinco}</EarTag>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8A3E15" }}>Atenção a este animal</span>
                </div>
                <p style={{ fontSize: 12.5, color: "#8A3E15", margin: "4px 0" }}>⚠ {avisoImediato.mensagem}</p>
                <p style={{ fontSize: 11.5, color: "#9B9686", margin: "6px 0 0" }}>Você ainda pode continuar preenchendo os demais campos normalmente.</p>
              </div>
            )}
            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") || msg.includes("salvo") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msg}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: msg ? 0 : 12 }}>
              <BtnGhost onClick={salvarProgresso}><Save size={14} /> Salvar</BtnGhost>
              <BtnPrimary onClick={finalizar}>Finalizar Diagnóstico de Repasse ({registros.length})</BtnPrimary>
            </div>
          </div>

          {registros.length > 0 && (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto", marginBottom: 24 }}>
              <table>
                <thead><tr><th>Animal</th><th>Lote</th><th>Resultado</th><th>Tempo de gestação informado</th><th></th></tr></thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.brinco}>
                      <td><EarTag size="sm">{r.brinco}</EarTag></td>
                      <td style={{ fontWeight: 700 }}>{lotes.find((l) => l.id === r.loteId)?.nome || "—"}</td>
                      <td style={{ color: r.resultado === "Prenha" ? "#166336" : "#166336", fontWeight: 600 }}>{r.resultado}</td>
                      <td>{r.tempoGestacaoInformado != null ? `${r.tempoGestacaoInformado} dia(s)` : "—"}</td>
                      <td><button onClick={() => remover(r.brinco)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Diagnósticos de Repasse registrados</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum Diagnóstico de Repasse registrado ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead><tr><th>Lote</th><th>Prenhas</th><th>Avaliadas</th><th>Data</th></tr></thead>
                <tbody>
                  {historico.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 700 }}>{m.loteNome}</td>
                      <td>{(m.detalhes || []).filter((d) => d.resultado === "Prenha").length}</td>
                      <td>{(m.detalhes || []).length}</td>
                      <td>{fmtDate(m.data)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   DIAGNÓSTICO — envoltório com duas abas internas: "Diagnóstico de
   Inseminação" (o diagnóstico normal, ligado às ordens de IATF) e
   "Diagnóstico de Repasse" (para os animais que passaram pelo Repasse).
========================================================= */

function AbaDiagnostico(props) {
  const [abaInterna, setAbaInterna] = useState("inseminacao"); // "inseminacao" | "repasse"
  return (
    <div>
      <SectionTitle icon={UltrasoundIcon} title="Diagnóstico" subtitle="Escolha se o diagnóstico é da Inseminação ou do Repasse." />
      <FazendaAtivaBanner fazendaAtiva={props.fazendaAtiva} />
      <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2, marginBottom: 20, width: "fit-content" }}>
        <button onClick={() => setAbaInterna("inseminacao")}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: abaInterna === "inseminacao" ? "#166336" : "transparent", color: abaInterna === "inseminacao" ? "#FFFFFF" : "#6B685E",
          }}>Diagnóstico de Inseminação</button>
        <button onClick={() => setAbaInterna("repasse")}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: abaInterna === "repasse" ? "#166336" : "transparent", color: abaInterna === "repasse" ? "#FFFFFF" : "#6B685E",
          }}>Diagnóstico de Repasse</button>
      </div>
      <div style={{ display: abaInterna === "inseminacao" ? "block" : "none" }}>
        <AbaDiagnosticoInseminacao {...props} />
      </div>
      <div style={{ display: abaInterna === "repasse" ? "block" : "none" }}>
        <AbaDiagnosticoRepasse {...props} />
      </div>
    </div>
  );
}

/* =========================================================
   REPASSE — por enquanto, só o registro básico (lote, categoria, retiro e
   nº de animais em repasse). A lógica de quais lotes entram em repasse será
   definida depois.
========================================================= */

function AbaRepasse({ fazendaAtiva, safraAtiva, lotes, retiros, registrarManejo, manejos, atualizarManejo, removerManejo, sugestoesRepasse, descartarSugestaoRepasse, removerSugestaoRepasse }) {
  const [loteId, setLoteId] = useState(lotes[0]?.id || "");
  const [numeroAnimais, setNumeroAnimais] = useState("");
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataFim, setDataFim] = useState(todayISO());
  const [sugestaoConfirmandoId, setSugestaoConfirmandoId] = useState(null);
  const [msg, setMsg] = useState("");
  const limparMsgSeSucesso = () => { if (msg.includes("registrad")) setMsg(""); };

  const loteAtual = lotes.find((l) => l.id === loteId);
  const nomeRetiro = (id) => retiros.find((r) => r.id === id)?.nome || "—";

  React.useEffect(() => {
    if (!lotes.some((l) => l.id === loteId)) setLoteId(lotes[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotes.map((l) => l.id).join(",")]);

  const confirmarSugestao = (s) => {
    setLoteId(s.loteId);
    setNumeroAnimais(String(s.brincos.length));
    setSugestaoConfirmandoId(s.id);
    setMsg("");
  };
  const cancelarConfirmacao = () => { setSugestaoConfirmandoId(null); setNumeroAnimais(""); };

  const canSave = loteId !== "" && String(numeroAnimais).trim() !== "" && numBR(numeroAnimais) > 0
    && dataInicio !== "" && dataFim !== "" && dataFim >= dataInicio;

  const salvar = () => {
    if (!canSave) { setMsg("Confira as datas — o Fim não pode ser antes do Início."); return; }
    registrarManejo({
      tipo: "repasse", loteId, loteNome: loteAtual?.nome || "", categoria: loteAtual?.categoria || null,
      retiroId: loteAtual?.retiroId || null, numeroAnimais: numBR(numeroAnimais), data: dataInicio,
      dataInicio, dataFim,
    });
    if (sugestaoConfirmandoId) removerSugestaoRepasse(sugestaoConfirmandoId);
    setSugestaoConfirmandoId(null);
    setNumeroAnimais(""); setDataInicio(todayISO()); setDataFim(todayISO());
    setMsg("Repasse registrado. Um pré-agendamento de Diagnóstico - repasse foi criado 30 dias após o Fim do período.");
  };

  const historico = manejos.filter((m) => m.tipo === "repasse").slice(0, 8);

  const [editandoId, setEditandoId] = useState(null);
  const [editNumeroAnimais, setEditNumeroAnimais] = useState("");
  const iniciarEdicao = (m) => { setEditandoId(m.id); setEditNumeroAnimais(String(m.numeroAnimais ?? "")); };
  const salvarEdicao = () => { atualizarManejo(editandoId, { numeroAnimais: numBR(editNumeroAnimais) }); setEditandoId(null); };
  const [confirmarExclusaoId, setConfirmarExclusaoId] = useState(null);

  return (
    <div>
      <SectionTitle icon={RefreshCw} title="Repasse" subtitle="Registre o lote e a quantidade de animais que vão para repasse." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para registrar repasse." />
      ) : !safraAtiva ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) antes de registrar manejos." />
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Sugestões de Repasse aguardando confirmação</div>
          {(sugestoesRepasse || []).length === 0 ? (
            <EmptyState text='Nenhuma sugestão de Repasse no momento. Elas aparecem aqui automaticamente quando um Diagnóstico é finalizado com "Destino para vazias" = Repasse.' />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
              {sugestoesRepasse.map((s) => {
                const lote = lotes.find((l) => l.id === s.loteId);
                return (
                  <div key={s.id} style={{ ...cardStyle, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <strong style={{ fontSize: 13.5 }}>{lote?.nome || "—"}</strong>
                      <div style={{ fontSize: 12, color: "#6B685E", marginTop: 3 }}>
                        {s.brincos.length} animal(is) vazio(s) · Diagnóstico de {fmtDate(s.data)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <BtnPrimary onClick={() => confirmarSugestao(s)}>Confirmar</BtnPrimary>
                      <BtnGhost danger onClick={() => descartarSugestaoRepasse(s.id)}>Descartar</BtnGhost>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {lotes.length === 0 ? (
            <EmptyState text="Nenhum lote cadastrado ainda." />
          ) : (
          <div style={{ ...cardStyle, marginBottom: 24, border: sugestaoConfirmandoId ? "1.5px solid #E3B8A0" : cardStyle.border }}>
            {sugestaoConfirmandoId && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12.5, color: "#8A3E15", fontWeight: 600 }}>Confirmando sugestão de Repasse — ajuste as datas e o nº de animais se necessário</span>
                <BtnGhost onClick={cancelarConfirmacao}>Cancelar</BtnGhost>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
              <Field label="Lote">
                <select style={inputStyle} value={loteId} onChange={(e) => { limparMsgSeSucesso(); setLoteId(e.target.value); }} disabled={!!sugestaoConfirmandoId}>
                  {lotes.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </Field>
              <Field label="Categoria">
                <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={loteAtual?.categoria || "—"} readOnly />
              </Field>
              <Field label="Retiro">
                <input style={{ ...inputStyle, background: "#F0F0F0", color: "#6B685E" }} value={loteAtual?.retiroId ? nomeRetiro(loteAtual.retiroId) : "—"} readOnly />
              </Field>
              <Field label="Nº de animais em repasse"><input style={inputStyle} type="number" min="1" value={numeroAnimais} onChange={(e) => { limparMsgSeSucesso(); setNumeroAnimais(e.target.value); }} placeholder="0" /></Field>
              <Field label="Início"><input style={inputStyle} type="date" value={dataInicio} onChange={(e) => { limparMsgSeSucesso(); setDataInicio(e.target.value); }} /></Field>
              <Field label="Fim"><input style={inputStyle} type="date" value={dataFim} onChange={(e) => { limparMsgSeSucesso(); setDataFim(e.target.value); }} /></Field>
            </div>
            <p style={{ fontSize: 11.5, color: "#9B9686", margin: "6px 0 0" }}>Ao registrar, um pré-agendamento de "Diagnóstico - repasse" é criado automaticamente na Agenda, 30 dias após o Fim do período.</p>
            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msg}</p>}
            <BtnPrimary disabled={!canSave} onClick={salvar} style={{ marginTop: msg ? 0 : 12 }}><Plus size={15} /> Registrar Repasse</BtnPrimary>
          </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Repasses registrados</div>
          {historico.length === 0 ? (
            <EmptyState text="Nenhum repasse registrado ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead><tr><th>Lote</th><th>Categoria</th><th>Retiro</th><th>Nº animais</th><th>Início</th><th>Fim</th><th></th></tr></thead>
                <tbody>
                  {historico.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 700 }}>{m.loteNome}</td>
                      <td>{m.categoria || "—"}</td>
                      <td>{m.retiroId ? nomeRetiro(m.retiroId) : "—"}</td>
                      <td>
                        {editandoId === m.id ? (
                          <input style={{ ...inputStyle, width: 80 }} type="number" min="1" value={editNumeroAnimais} onChange={(e) => setEditNumeroAnimais(e.target.value)} />
                        ) : (m.numeroAnimais ?? "—")}
                      </td>
                      <td>{fmtDate(m.dataInicio || m.data)}</td>
                      <td>{m.dataFim ? fmtDate(m.dataFim) : "—"}</td>
                      <td style={{ display: "flex", gap: 6 }}>
                        {editandoId === m.id ? (
                          <>
                            <button onClick={salvarEdicao} style={{ background: "none", border: "none", cursor: "pointer", color: "#166336" }}><Check size={14} /></button>
                            <button onClick={() => setEditandoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </>
                        ) : confirmarExclusaoId === m.id ? (
                          <>
                            <span style={{ fontSize: 11, color: "#A32D2D" }}>Excluir?</span>
                            <button onClick={() => { removerManejo(m.id); setConfirmarExclusaoId(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Check size={14} /></button>
                            <button onClick={() => setConfirmarExclusaoId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => iniciarEdicao(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B685E" }}><Pencil size={13} /></button>
                            <button onClick={() => setConfirmarExclusaoId(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={13} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   DIAGNÓSTICO FINAL — consulta por animal: lê a identificação e mostra
   automaticamente o histórico das 3 possíveis ordens de IATF (não registra
   nenhum manejo novo, só consolida o que já está no sistema).
========================================================= */

function AbaDiagnosticoFinal({ fazendaAtiva, safraAtiva, lotes, retiros, insumos, manejos, rascunhos, salvarRascunho, limparRascunho }) {
  const [brinco, setBrinco] = useState("");
  const [dgFinalInput, setDgFinalInput] = useState("");
  const [tempoInformadoInput, setTempoInformadoInput] = useState("");
  const [consultaAtual, setConsultaAtual] = useState(null); // dados auto-preenchidos do animal recém-lido
  const [registros, setRegistros] = useState([]);
  useAvisarSaidaComPendencia(registros.length > 0);
  const [msg, setMsg] = useState("");
  const brincoInputRef = React.useRef(null);
  const dgFinalInputRef = React.useRef(null);
  const tempoInformadoInputRef = React.useRef(null);

  const chaveRascunho = "diagnostico_final";
  React.useEffect(() => {
    if (registros.length === 0 && rascunhos[chaveRascunho]) {
      setRegistros(rascunhos[chaveRascunho].registros || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const salvarProgresso = () => {
    if (registros.length === 0) { setMsg("Registre ao menos um animal antes de salvar."); return; }
    salvarRascunho(chaveRascunho, { registros });
    setMsg("Progresso salvo. Você pode continuar depois.");
  };
  const limparTudo = () => { setRegistros([]); limparRascunho(chaveRascunho); setMsg(""); };

  const nomeRetiro = (id) => retiros.find((r) => r.id === id)?.nome || "—";
  const buscarManejoLoteOrdem = (tipos, loteId, ordem) => manejos.find((m) => tipos.includes(m.tipo) && m.loteId === loteId && m.ordem === ordem);
  const resolverDG = (txt) => {
    const t = txt.trim().toUpperCase();
    if (t.startsWith("P")) return "Prenha";
    if (t.startsWith("V")) return "Vazia";
    return "";
  };
  const diasEntre = (dataA, dataB) => Math.round((parseISODate(dataB) - parseISODate(dataA)) / 86400000);

  const limparCampos = () => {
    setBrinco(""); setDgFinalInput(""); setTempoInformadoInput(""); setConsultaAtual(null); setMsg("");
    brincoInputRef.current?.focus();
  };

  // Enter no campo Identificação: busca e preenche automaticamente a caixa com os dados do animal
  const lerAnimal = () => {
    const b = brinco.trim();
    if (!b) { setMsg("Leia o brinco do animal."); return; }
    if (registros.some((r) => r.brinco === b)) { setMsg("Este animal já foi registrado nesta sessão."); return; }

    const lote = lotes.find((l) => (l.animais || []).includes(b));
    if (!lote) { setMsg("Animal não encontrado em nenhum lote."); return; }

    const porOrdem = ORDENS_IATF.map((ordem) => {
      const insem = buscarManejoLoteOrdem(["inseminacao"], lote.id, ordem);
      const diag = buscarManejoLoteOrdem(["diagnostico"], lote.id, ordem);
      const detalheInsem = insem?.detalhes?.find((d) => d.brinco === b) || null;
      const detalheDiag = diag?.detalhes?.find((d) => d.brinco === b) || null;
      const semenInsumo = detalheInsem ? insumos.find((i) => i.id === detalheInsem.semenId) : null;
      return {
        data: detalheInsem && insem ? fmtDate(insem.data) : "—",
        dataISO: detalheInsem && insem ? insem.data : null,
        dg: detalheDiag?.resultado || "—",
        touro: semenInsumo?.touro || null,
      };
    });

    // a prenhez "de origem" é a primeira ordem em que o animal já foi diagnosticado como Prenha
    const ordemPrenha = porOrdem.find((o) => o.dg === "Prenha") || null;
    const hoje = todayISO();
    const tempoCalculado = ordemPrenha?.dataISO ? diasEntre(ordemPrenha.dataISO, hoje) : null;
    const touroDaPrenhez = ordemPrenha?.touro || null;

    setConsultaAtual({
      brinco: b, categoria: lote.categoria || "—", loteNome: lote.nome, retiroNome: nomeRetiro(lote.retiroId), porOrdem,
      tempoCalculado, touroDaPrenhez,
    });
    setMsg("");
    dgFinalInputRef.current?.focus();
  };

  // último Enter (no campo Tempo de gestação informado): consolida a linha na tabela
  const registrar = () => {
    if (!consultaAtual) { setMsg("Leia um animal antes de registrar."); return; }
    const dgFinal = resolverDG(dgFinalInput);
    const tempoInformadoNum = tempoInformadoInput.trim() !== "" ? numBR(tempoInformadoInput) : null;
    const tempoEfetivo = tempoInformadoNum != null && !Number.isNaN(tempoInformadoNum) ? tempoInformadoNum : consultaAtual.tempoCalculado;
    let origem = "—";
    if (consultaAtual.tempoCalculado != null && tempoEfetivo != null) {
      if (tempoEfetivo === consultaAtual.tempoCalculado) origem = "Inseminação";
      else if (consultaAtual.tempoCalculado < tempoEfetivo) origem = "Repasse";
    }
    setRegistros((a) => [...a, {
      ...consultaAtual, dgFinal: dgFinal || "—", tempoInformado: tempoInformadoNum, tempoEfetivo, origem,
    }]);
    limparCampos();
  };

  const remover = (b) => setRegistros((a) => a.filter((r) => r.brinco !== b));

  return (
    <div>
      <SectionTitle icon={Search} title="Diagnóstico Final" subtitle="Leia a identificação do animal para ver automaticamente seu histórico completo de IATF." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para consultar animais." />
      ) : !safraAtiva ? (
        <EmptyState text="Selecione uma safra ativa (menu lateral) para consultar animais." />
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, alignItems: "end" }}>
              <Field label="Identificação">
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={brincoInputRef} style={inputStyle} placeholder="Ler brinco / QR e Enter" value={brinco}
                    onChange={(e) => { if (msg) setMsg(""); setBrinco(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lerAnimal(); } }} />
                  <BtnPrimary onClick={lerAnimal}>Registrar animal</BtnPrimary>
                  <BotaoCameraLeitura onLido={(texto) => { setBrinco(texto); brincoInputRef.current?.focus(); }} />
                </div>
              </Field>
              <Field label="DG Final">
                <input ref={dgFinalInputRef} style={inputStyle} value={dgFinalInput} placeholder="P ou V" disabled={!consultaAtual}
                  onChange={(e) => setDgFinalInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tempoInformadoInputRef.current?.focus(); } }} />
              </Field>
              <Field label="Tempo de gestação informado">
                <input ref={tempoInformadoInputRef} style={inputStyle} type="number" value={tempoInformadoInput} disabled={!consultaAtual}
                  placeholder={consultaAtual?.tempoCalculado != null ? String(consultaAtual.tempoCalculado) : "—"}
                  onChange={(e) => setTempoInformadoInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); registrar(); } }} />
              </Field>
            </div>

            {consultaAtual && (
              <div style={{ marginTop: 16, background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <EarTag size="sm">{consultaAtual.brinco}</EarTag>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4A473E" }}>Dados encontrados — confira e complete DG Final / Tempo informado, depois Enter para registrar</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, fontSize: 12.5, color: "#4A473E" }}>
                  <div><strong>Categoria:</strong> {consultaAtual.categoria}</div>
                  <div><strong>Lote:</strong> {consultaAtual.loteNome}</div>
                  <div><strong>Retiro:</strong> {consultaAtual.retiroNome}</div>
                  {consultaAtual.porOrdem.map((o, i) => (
                    <React.Fragment key={i}>
                      <div><strong>Data {ORDENS_IATF[i]}:</strong> {o.data}</div>
                      <div><strong>DG {ORDENS_IATF[i]}:</strong> <span style={{ color: o.dg === "Prenha" ? "#166336" : o.dg === "Vazia" ? "#166336" : "#6B685E", fontWeight: o.dg !== "—" ? 600 : 400 }}>{o.dg}</span></div>
                    </React.Fragment>
                  ))}
                  <div><strong>Tempo de gestação calculado:</strong> {consultaAtual.tempoCalculado != null ? `${consultaAtual.tempoCalculado} dia(s)` : "—"}</div>
                  <div><strong>Touro da prenhez:</strong> {consultaAtual.touroDaPrenhez || "—"}</div>
                </div>
              </div>
            )}

            {msg && <p style={{ fontSize: 12.5, color: msg.includes("salvo") ? "#166336" : "#A32D2D", marginTop: 10 }}>{msg}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {consultaAtual && <BtnPrimary onClick={registrar}>Registrar</BtnPrimary>}
              <BtnGhost onClick={salvarProgresso}><Save size={14} /> Salvar</BtnGhost>
              {registros.length > 0 && <BtnGhost danger onClick={limparTudo}>Limpar consulta</BtnGhost>}
            </div>
          </div>

          {registros.length === 0 ? (
            <EmptyState text="Nenhum animal registrado nesta sessão ainda." />
          ) : (
            <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Identificação</th>
                    <th>Categoria</th>
                    <th>Lote</th>
                    <th>Retiro</th>
                    <th>Data 1º IATF</th>
                    <th>DG 1º IATF</th>
                    <th>Data 2º IATF</th>
                    <th>DG 2º IATF</th>
                    <th>Data 3º IATF</th>
                    <th>DG 3º IATF</th>
                    <th>DG Final</th>
                    <th>Tempo de gestação calculado</th>
                    <th>Touro da prenhez</th>
                    <th>Tempo de gestação informado</th>
                    <th>Origem da prenhez</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.brinco}>
                      <td><EarTag size="sm">{r.brinco}</EarTag></td>
                      <td>{r.categoria}</td>
                      <td style={{ fontWeight: 700 }}>{r.loteNome}</td>
                      <td>{r.retiroNome}</td>
                      {r.porOrdem.map((o, i) => (
                        <React.Fragment key={i}>
                          <td>{o.data}</td>
                          <td style={{ color: o.dg === "Prenha" ? "#166336" : o.dg === "Vazia" ? "#166336" : "#6B685E", fontWeight: o.dg !== "—" ? 600 : 400 }}>{o.dg}</td>
                        </React.Fragment>
                      ))}
                      <td style={{ color: r.dgFinal === "Prenha" ? "#166336" : r.dgFinal === "Vazia" ? "#166336" : "#6B685E", fontWeight: r.dgFinal !== "—" ? 600 : 400 }}>{r.dgFinal}</td>
                      <td>{r.tempoCalculado != null ? `${r.tempoCalculado} dia(s)` : "—"}</td>
                      <td>{r.touroDaPrenhez || "—"}</td>
                      <td>{r.tempoInformado != null ? `${r.tempoInformado} dia(s)` : "—"}</td>
                      <td style={{ fontWeight: r.origem !== "—" ? 600 : 400, color: r.origem === "Repasse" ? "#166336" : r.origem === "Inseminação" ? "#166336" : "#6B685E" }}>{r.origem}</td>
                      <td><button onClick={() => remover(r.brinco)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* =========================================================
   ESTOQUE
========================================================= */

const CATEGORIA_LABEL_TO_INTERNA = { "Hormônios": "Hormônio", "Sêmen": "Sêmen", "Medicamentos": "Medicamento", "Utensílios": "Utensílio" };

function AbaEstoqueEntrada({ fazendaAtiva, currentUser, insumos, movimentos, registrarEntradaEstoque, removerEntradaEstoque }) {
  const [categoriaTab, setCategoriaTab] = useState(CATEGORIAS_ESTOQUE[0]);
  const categoriaInterna = CATEGORIA_LABEL_TO_INTERNA[categoriaTab];
  const [localEstoque, setLocalEstoque] = useState("fazenda");

  const empty = {
    produtoComercial: "", hormonio: HORMONIOS[0], tamanhoEmbalagem: "", unidadeEmbalagem: UNIDADES_EMBALAGEM[0],
    touro: "", raca: "", partida: "", unidade: "", quantidade: "",
    motilidadeInicial: "", vigorInicial: "", motilidadeFinal: "", vigorFinal: "",
  };
  const [form, setForm] = useState(empty);
  const [data, setData] = useState(todayISO());
  const [valorUnitario, setValorUnitario] = useState("");
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState("");

  const set = (k) => (e) => { if (msg.includes("registrad")) setMsg(""); setForm((f) => ({ ...f, [k]: e.target.value })); };

  React.useEffect(() => { setForm(empty); setValorUnitario(""); setMsg(""); }, [categoriaTab, localEstoque]);

  const canSave = (() => {
    const qtdOk = String(form.quantidade).trim() !== "" && numBR(form.quantidade) > 0;
    if (!qtdOk) return false;
    if (categoriaInterna === "Hormônio") return form.produtoComercial.trim() !== "" && form.hormonio !== "" && String(form.tamanhoEmbalagem).trim() !== "" && numBR(form.tamanhoEmbalagem) > 0;
    if (categoriaInterna === "Sêmen") return form.touro.trim() !== "" && form.raca.trim() !== "" && form.partida.trim() !== "";
    if (categoriaInterna === "Medicamento") return form.produtoComercial.trim() !== "" && form.tipoMedicamento !== "" && String(form.tamanhoEmbalagem).trim() !== "" && numBR(form.tamanhoEmbalagem) > 0;
    if (categoriaInterna === "Utensílio") return form.produtoComercial.trim() !== "" && form.unidade.trim() !== "";
    return false;
  })();

  const salvar = () => {
    if (!canSave) return;
    const qtd = numBR(form.quantidade);
    let camposItem = {};
    if (categoriaInterna === "Hormônio") {
      camposItem = { produtoComercial: form.produtoComercial, hormonio: form.hormonio, tamanhoEmbalagem: numBR(form.tamanhoEmbalagem), unidadeEmbalagem: form.unidadeEmbalagem };
    } else if (categoriaInterna === "Sêmen") {
      camposItem = {
        touro: form.touro, raca: form.raca, partida: form.partida,
        motilidadeInicial: form.motilidadeInicial.trim() !== "" ? numBR(form.motilidadeInicial) : null,
        vigorInicial: form.vigorInicial !== "" ? Number(form.vigorInicial) : null,
        motilidadeFinal: form.motilidadeFinal.trim() !== "" ? numBR(form.motilidadeFinal) : null,
        vigorFinal: form.vigorFinal !== "" ? Number(form.vigorFinal) : null,
      };
    } else if (categoriaInterna === "Medicamento") {
      camposItem = { produtoComercial: form.produtoComercial, tipoMedicamento: form.tipoMedicamento || TIPOS_MEDICAMENTO[0], tamanhoEmbalagem: numBR(form.tamanhoEmbalagem), unidadeEmbalagem: form.unidadeEmbalagem };
    } else if (categoriaInterna === "Utensílio") {
      camposItem = { produtoComercial: form.produtoComercial, unidade: form.unidade };
    }
    const valor = valorUnitario.trim() !== "" ? numBR(valorUnitario) : null;
    registrarEntradaEstoque(categoriaInterna, camposItem, qtd, data, obs, valor, localEstoque);
    setForm(empty); setValorUnitario(""); setObs(""); setMsg("Entrada registrada.");
  };

  const itensCategoria = insumos.filter((i) => i.categoria === categoriaInterna && i.local === localEstoque);
  const entradas = movimentos.filter((m) => m.tipo === "entrada" && itensCategoria.some((i) => i.id === m.insumoId)).slice(0, 8);

  const nomeItem = (i) => {
    if (i.categoria === "Sêmen") return `${i.touro} — ${i.raca}`;
    return i.produtoComercial;
  };
  const nomeInsumo = (id) => {
    const i = insumos.find((x) => x.id === id);
    return i ? nomeItem(i) : "—";
  };

  return (
    <div>
      <SectionTitle icon={ArrowDownToLine} title="Entrada de estoque" subtitle="Cada entrada cadastra o item automaticamente (se for novo) e já registra a quantidade recebida." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para lançar entradas." />
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Local de estoque</div>
          <SeletorLocalEstoque local={localEstoque} setLocal={setLocalEstoque} />
          <p style={{ fontSize: 11.5, color: "#9B9686", margin: "-8px 0 18px" }}>
            {localEstoque === "fazenda"
              ? "Vinculado à fazenda ativa — pode ser usado por qualquer inseminador autorizado nela."
              : `Vinculado a você (${currentUser?.nome || "usuário"}) — pode ser usado em qualquer fazenda que você acessar.`}
          </p>

          <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2, marginBottom: 18, width: "fit-content" }}>
            {CATEGORIAS_ESTOQUE.map((c) => (
              <button key={c} onClick={() => setCategoriaTab(c)}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  background: categoriaTab === c ? "#166336" : "transparent",
                  color: categoriaTab === c ? "#FFFFFF" : "#6B685E",
                }}>{c}</button>
            ))}
          </div>

          <div style={{ ...cardStyle, marginBottom: 24 }}>
            {categoriaInterna === "Hormônio" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, alignItems: "start" }}>
                <Field label="Produto comercial"><input style={inputStyle} value={form.produtoComercial} onChange={set("produtoComercial")} placeholder="Ex: Sincrogest" /></Field>
                <Field label="Hormônio">
                  <select style={inputStyle} value={form.hormonio} onChange={set("hormonio")}>
                    {HORMONIOS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
                <Field label="Tamanho da embalagem">
                  <div style={{ display: "flex", gap: 8 }}>
                    <input style={inputStyle} type="number" min="0" step="any" value={form.tamanhoEmbalagem} onChange={set("tamanhoEmbalagem")} placeholder="0" />
                    <select style={{ ...inputStyle, width: 90, flexShrink: 0 }} value={form.unidadeEmbalagem} onChange={set("unidadeEmbalagem")}>
                      {UNIDADES_EMBALAGEM.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </Field>
                <Field label="Quantidade"><input style={inputStyle} type="number" min="1" value={form.quantidade} onChange={set("quantidade")} placeholder="0" /></Field>
                <Field label="Valor unitário (R$)"><input style={inputStyle} type="number" min="0" step="any" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} placeholder="0,00" /></Field>
                <Field label="Data"><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
                <Field label="Observação (opcional)"><input style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota fiscal, lote..." /></Field>
              </div>
            )}

            {categoriaInterna === "Sêmen" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, alignItems: "start" }}>
                <Field label="Touro"><input style={inputStyle} value={form.touro} onChange={set("touro")} placeholder="Ex: Touro Zeus FIV" /></Field>
                <Field label="Raça"><input style={inputStyle} value={form.raca} onChange={set("raca")} placeholder="Ex: Nelore" /></Field>
                <Field label="Partida"><input style={inputStyle} type="date" value={form.partida} onChange={set("partida")} /></Field>
                <Field label="Quantidade de doses"><input style={inputStyle} type="number" min="1" value={form.quantidade} onChange={set("quantidade")} placeholder="0" /></Field>
                <Field label="Valor unitário (R$)"><input style={inputStyle} type="number" min="0" step="any" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} placeholder="0,00" /></Field>
                <Field label="Data"><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
                <Field label="Motilidade inicial (%) (opcional)"><input style={inputStyle} type="number" min="0" max="100" value={form.motilidadeInicial} onChange={set("motilidadeInicial")} placeholder="0 a 100" /></Field>
                <Field label="Vigor inicial (opcional)">
                  <select style={inputStyle} value={form.vigorInicial} onChange={set("vigorInicial")}>
                    <option value="">— não informado —</option>
                    {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Motilidade final (%) (opcional)"><input style={inputStyle} type="number" min="0" max="100" value={form.motilidadeFinal} onChange={set("motilidadeFinal")} placeholder="0 a 100" /></Field>
                <Field label="Vigor final (opcional)">
                  <select style={inputStyle} value={form.vigorFinal} onChange={set("vigorFinal")}>
                    <option value="">— não informado —</option>
                    {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Observação (opcional)"><input style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota fiscal, central de IA..." /></Field>
              </div>
            )}

            {categoriaInterna === "Medicamento" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, alignItems: "start" }}>
                <Field label="Produto comercial"><input style={inputStyle} value={form.produtoComercial} onChange={set("produtoComercial")} placeholder="Ex: Ivermectina 1%" /></Field>
                <Field label="Tipo">
                  <select style={inputStyle} value={form.tipoMedicamento || TIPOS_MEDICAMENTO[0]} onChange={set("tipoMedicamento")}>
                    {TIPOS_MEDICAMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Tamanho da embalagem">
                  <div style={{ display: "flex", gap: 8 }}>
                    <input style={inputStyle} type="number" min="0" step="any" value={form.tamanhoEmbalagem} onChange={set("tamanhoEmbalagem")} placeholder="0" />
                    <select style={{ ...inputStyle, width: 90, flexShrink: 0 }} value={form.unidadeEmbalagem} onChange={set("unidadeEmbalagem")}>
                      {UNIDADES_EMBALAGEM.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </Field>
                <Field label="Quantidade"><input style={inputStyle} type="number" min="1" value={form.quantidade} onChange={set("quantidade")} placeholder="0" /></Field>
                <Field label="Valor unitário (R$)"><input style={inputStyle} type="number" min="0" step="any" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} placeholder="0,00" /></Field>
                <Field label="Data"><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
                <Field label="Observação (opcional)"><input style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota fiscal, lote..." /></Field>
              </div>
            )}

            {categoriaInterna === "Utensílio" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, alignItems: "start" }}>
                <Field label="Produto comercial"><input style={inputStyle} value={form.produtoComercial} onChange={set("produtoComercial")} placeholder="Ex: Luva de palpação" /></Field>
                <Field label="Unidade"><input style={inputStyle} value={form.unidade} onChange={set("unidade")} placeholder="Ex: caixa, par, un" /></Field>
                <Field label="Quantidade"><input style={inputStyle} type="number" min="1" value={form.quantidade} onChange={set("quantidade")} placeholder="0" /></Field>
                <Field label="Valor unitário (R$)"><input style={inputStyle} type="number" min="0" step="any" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} placeholder="0,00" /></Field>
                <Field label="Data"><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
                <Field label="Observação (opcional)"><input style={inputStyle} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Nota fiscal, fornecedor..." /></Field>
              </div>
            )}

            {msg && <p style={{ fontSize: 12.5, color: msg.includes("registrad") ? "#166336" : "#A32D2D", marginTop: 12 }}>{msg}</p>}
            <BtnPrimary disabled={!canSave} onClick={salvar} style={{ marginTop: 12 }}>
              <Plus size={15} /> Registrar entrada
            </BtnPrimary>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Últimas entradas — {categoriaTab}</div>
          {entradas.length === 0 ? <EmptyState text="Nenhuma entrada registrada ainda nesta categoria." /> : (
            <table>
              <thead><tr><th>Item</th><th>Qtd.</th><th>Valor unitário</th><th>Valor total</th><th>Data</th><th></th></tr></thead>
              <tbody>
                {entradas.map((m) => (
                  <tr key={m.id}>
                    <td>{nomeInsumo(m.insumoId)}</td>
                    <td>{m.quantidade}</td>
                    <td>{m.valorUnitario != null ? `R$ ${m.valorUnitario.toFixed(2)}` : "—"}</td>
                    <td>{m.valorUnitario != null ? `R$ ${(m.valorUnitario * m.quantidade).toFixed(2)}` : "—"}</td>
                    <td>{fmtDate(m.data)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button onClick={() => removerEntradaEstoque(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}>
                        <Trash2 size={13} /> Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function AbaEstoqueSaida({ fazendaAtiva, insumos, movimentos, manejos }) {
  const [localTab, setLocalTab] = useState("fazenda");
  const saidas = movimentos.filter((m) => m.tipo === "saida" && m.local === localTab);
  const nomeInsumo = (id) => {
    const i = insumos.find((x) => x.id === id);
    if (!i) return "—";
    return i.categoria === "Sêmen" ? `${i.touro} — ${i.raca}` : i.produtoComercial;
  };
  const categoriaDoInsumo = (id) => insumos.find((x) => x.id === id)?.categoria;

  const grupos = [
    { categoria: "Hormônio", titulo: "Hormônios" },
    { categoria: "Sêmen", titulo: "Sêmen" },
    { categoria: "Medicamento", titulo: "Medicamentos" },
    { categoria: "Utensílio", titulo: "Utensílios" },
  ];

  return (
    <div>
      <SectionTitle icon={ArrowUpFromLine} title="Saída de estoque" subtitle="Gerada automaticamente a partir dos manejos registrados desta fazenda." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />

      <SeletorLocalEstoque local={localTab} setLocal={setLocalTab} />

      {grupos.map(({ categoria, titulo }) => {
        const itens = saidas.filter((m) => categoriaDoInsumo(m.insumoId) === categoria);
        return (
          <div key={categoria} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>{titulo}</div>
            {itens.length === 0 ? (
              <EmptyState text={`Nenhuma saída de ${titulo.toLowerCase()} registrada ainda — ela ocorre automaticamente ao registrar um manejo.`} />
            ) : (
              <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Insumo</th><th>Qtd.</th><th>Origem (manejo)</th><th>Data</th></tr></thead>
                  <tbody>
                    {itens.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 700 }}>{nomeInsumo(m.insumoId)}</td>
                        <td>{m.quantidade}</td>
                        <td style={{ textTransform: "capitalize" }}>{m.tipoManejo}</td>
                        <td>{fmtDate(m.data)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AbaEstoqueSaldo({ fazendaAtiva, insumos }) {
  const fmtMoeda = (v) => v == null ? "—" : `R$ ${v.toFixed(2).replace(".", ",")}`;

  const [localTab, setLocalTab] = useState("fazenda");
  const insumosDoLocal = insumos.filter((i) => i.local === localTab);

  const grupos = [
    { categoria: "Hormônio", titulo: "Hormônios" },
    { categoria: "Sêmen", titulo: "Sêmen" },
    { categoria: "Medicamento", titulo: "Medicamentos" },
    { categoria: "Utensílio", titulo: "Utensílios" },
  ];

  const valorTotalGeral = insumosDoLocal.reduce((s, i) => s + (i.valorUnitario != null ? i.estoque * i.valorUnitario : 0), 0);

  return (
    <div>
      <SectionTitle icon={Package} title="Saldo de estoque" subtitle="Quantidade e valor atuais de cada item, por categoria." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />

      <SeletorLocalEstoque local={localTab} setLocal={setLocalTab} />

      <div style={{ ...cardStyle, marginBottom: 24, display: "inline-block" }}>
        <div style={{ fontSize: 11, color: "#9B9686", textTransform: "uppercase", fontWeight: 700 }}>Valor total em estoque ({localTab === "externo" ? "Externo" : "Fazenda"})</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, color: "#232520", marginTop: 4 }}>{fmtMoeda(valorTotalGeral)}</div>
      </div>

      {grupos.map(({ categoria, titulo }) => {
        const itens = insumosDoLocal.filter((i) => i.categoria === categoria);
        const valorTotalGrupo = itens.reduce((s, i) => s + (i.valorUnitario != null ? i.estoque * i.valorUnitario : 0), 0);
        return (
          <div key={categoria} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase" }}>{titulo}</div>
              {itens.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#166336" }}>Total: {fmtMoeda(valorTotalGrupo)}</div>}
            </div>
            {itens.length === 0 ? (
              <EmptyState text={`Nenhum item de ${titulo.toLowerCase()} cadastrado.`} />
            ) : categoria === "Sêmen" ? (
              <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Touro</th><th>Raça</th><th>Partida</th><th>Estoque (doses)</th><th>Valor unitário</th><th>Valor total</th></tr></thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.id}>
                        <td style={{ fontWeight: 700 }}>{i.touro}</td>
                        <td>{i.raca}</td>
                        <td>{i.partida ? fmtDate(i.partida) : "—"}</td>
                        <td>{i.estoque}</td>
                        <td>{fmtMoeda(i.valorUnitario)}</td>
                        <td>{fmtMoeda(i.valorUnitario != null ? i.estoque * i.valorUnitario : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : categoria === "Utensílio" ? (
              <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Produto</th><th>Unidade</th><th>Estoque</th><th>Valor unitário</th><th>Valor total</th></tr></thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.id}>
                        <td style={{ fontWeight: 700 }}>{i.produtoComercial}</td>
                        <td>{i.unidade || "—"}</td>
                        <td>{i.estoque}</td>
                        <td>{fmtMoeda(i.valorUnitario)}</td>
                        <td>{fmtMoeda(i.valorUnitario != null ? i.estoque * i.valorUnitario : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>{categoria === "Hormônio" ? "Hormônio" : "Tipo"}</th>
                      <th>Estoque</th>
                      <th>Unidade</th>
                      <th>Valor unitário</th>
                      <th>Valor total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.id}>
                        <td style={{ fontWeight: 700 }}>{i.produtoComercial}</td>
                        <td>{categoria === "Hormônio" ? i.hormonio : i.tipoMedicamento}</td>
                        <td>{i.estoque}</td>
                        <td>{i.unidadeEmbalagem || "—"}</td>
                        <td>{fmtMoeda(i.valorUnitario)}</td>
                        <td>{fmtMoeda(i.valorUnitario != null ? i.estoque * i.valorUnitario : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================
   AGENDA
========================================================= */

const TIPOS_AGENDAMENTO = ["Indução", "D0", "Retirada", "PGF 5", "Inseminação", "Diagnóstico", "Diagnóstico - repasse", "Outro"];
const TIPO_AGENDAMENTO_PARA_MANEJO = {
  "Indução": "inducao", "D0": "implantacao", "Retirada": "retirada",
  "Inseminação": "inseminacao", "Diagnóstico": "diagnostico",
};
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NOMES_MES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISODate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
const isSameDay = (a, b) => ymd(a) === ymd(b);

const CORES_TIPO = {
  "Indução": "#3B7D4F", "D0": "#C98F2B", "Retirada": "#8A5A1F", "PGF 5": "#B25D8C",
  "Inseminação": "#4A6FA5", "Diagnóstico": "#7A5C9E", "Diagnóstico - repasse": "#166336", "Outro": "#6B685E",
};

function AbaAgenda({ fazendaAtiva, fazendas, lotes, retiros, agendamentos, addAgendamento, confirmarAgendamento, descartarAgendamento, removerAgendamento, atualizarAgendamento }) {
  // versão compacta do calendário só no celular — no computador, nada muda
  const [isMobileCalendario, setIsMobileCalendario] = useState(typeof window !== "undefined" ? window.innerWidth < 860 : false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const aoMudar = (e) => setIsMobileCalendario(e.matches);
    mq.addEventListener ? mq.addEventListener("change", aoMudar) : mq.addListener(aoMudar);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", aoMudar) : mq.removeListener(aoMudar));
  }, []);

  const empty = { retiroId: "", loteNome: "", tipo: TIPOS_AGENDAMENTO[0], data: todayISO(), ordem: "", numeroAnimais: "", tipoManejo: TIPOS_MANEJO_IMPLANTACAO[0], protocolo: PROTOCOLOS_IMPLANTACAO[0] };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [viewMode, setViewMode] = useState("mes"); // mes | semana | dia
  const [cursor, setCursor] = useState(new Date());
  const [selecionado, setSelecionado] = useState(ymd(new Date()));
  const [msg, setMsg] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const setEdit = (k) => (e) => setEditForm((f) => ({ ...f, [k]: e.target.value }));

  // visualização: quais fazendas (dentre as que o usuário pode acessar) aparecem na agenda agora
  const [fazendasSelecionadas, setFazendasSelecionadas] = useState(fazendaAtiva ? [fazendaAtiva.id] : []);
  React.useEffect(() => {
    if (fazendaAtiva && !fazendasSelecionadas.includes(fazendaAtiva.id)) {
      setFazendasSelecionadas((sel) => [...sel, fazendaAtiva.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fazendaAtiva?.id]);
  const toggleFazendaSelecionada = (id) => setFazendasSelecionadas((sel) => sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const nomeFazenda = (id) => fazendas.find((f) => f.id === id)?.nome || "—";

  const agendamentosFiltrados = useMemo(
    () => agendamentos.filter((a) => fazendasSelecionadas.includes(a.fazendaId)),
    [agendamentos, fazendasSelecionadas]
  );

  const pendentes = agendamentosFiltrados.filter((a) => a.status === "pendente").sort((a, b) => a.data.localeCompare(b.data));
  const visiveis = agendamentosFiltrados.filter((a) => a.status === "pendente" || a.status === "confirmado");

  // duplicidade: mais de um agendamento do mesmo manejo, para o mesmo lote, na mesma ordem
  const gruposDuplicados = useMemo(() => {
    const grupos = {};
    visiveis.forEach((a) => {
      if (!a.loteNome || !a.ordem) return;
      const chave = `${a.fazendaId}|${a.loteNome.trim().toLowerCase()}|${a.ordem}|${a.tipo}`;
      (grupos[chave] = grupos[chave] || []).push(a);
    });
    return Object.values(grupos).filter((g) => g.length > 1);
  }, [visiveis]);

  const manterEDescartarOutros = (grupo, idParaManter) => {
    grupo.forEach((a) => { if (a.id !== idParaManter) removerAgendamento(a.id); });
  };

  const nomeRetiro = (id) => retiros.find((r) => r.id === id)?.nome || "—";

  const canSave = form.retiroId !== "" && form.loteNome.trim() !== "" && form.tipo !== "" && form.ordem !== "" && form.data !== "";

  const salvar = () => {
    if (!canSave) { setMsg("Preencha retiro, lote, manejo, ordem e data."); return; }
    const titulo = `${form.tipo} — ${form.loteNome.trim()}`;
    addAgendamento({ ...form, loteNome: form.loteNome.trim(), titulo, numeroAnimais: String(form.numeroAnimais).trim() !== "" ? numBR(form.numeroAnimais) : null });
    setSelecionado(form.data);
    setForm(empty);
    setMsg("");
  };

  const iniciarEdicao = (a) => {
    setEditingId(a.id);
    setEditForm({
      retiroId: a.retiroId || "", loteNome: a.loteNome || "", tipo: a.tipo, data: a.data,
      tipoManejo: a.tipoManejo || TIPOS_MANEJO_IMPLANTACAO[0], protocolo: a.protocolo || PROTOCOLOS_IMPLANTACAO[0],
    });
  };
  const cancelarEdicao = () => { setEditingId(null); setEditForm(null); };
  const salvarEdicao = () => {
    if (!editForm.retiroId || !editForm.loteNome.trim() || !editForm.tipo || !editForm.data) return;
    const titulo = `${editForm.tipo} — ${editForm.loteNome.trim()}`;
    atualizarAgendamento(editingId, { ...editForm, loteNome: editForm.loteNome.trim(), titulo });
    setEditingId(null); setEditForm(null);
  };

  const porDia = useMemo(() => {
    const map = {};
    visiveis.forEach((a) => { (map[a.data] = map[a.data] || []).push(a); });
    return map;
  }, [visiveis]);

  const irPara = (dir) => {
    if (viewMode === "mes") setCursor((c) => addMonths(c, dir));
    else if (viewMode === "semana") setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => addDays(c, dir));
  };
  const irParaHoje = () => { const h = new Date(); setCursor(h); setSelecionado(ymd(h)); };

  const rotuloPeriodo = () => {
    if (viewMode === "mes") return `${NOMES_MES[cursor.getMonth()]} de ${cursor.getFullYear()}`;
    if (viewMode === "semana") {
      const inicio = addDays(cursor, -cursor.getDay());
      const fim = addDays(inicio, 6);
      const mesmoMes = inicio.getMonth() === fim.getMonth();
      return mesmoMes
        ? `${inicio.getDate()} – ${fim.getDate()} de ${NOMES_MES[inicio.getMonth()]} de ${inicio.getFullYear()}`
        : `${inicio.getDate()} de ${NOMES_MES[inicio.getMonth()]} – ${fim.getDate()} de ${NOMES_MES[fim.getMonth()]} de ${fim.getFullYear()}`;
    }
    return `${cursor.getDate()} de ${NOMES_MES[cursor.getMonth()]} de ${cursor.getFullYear()}`;
  };

  const gridMes = useMemo(() => {
    const primeiro = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const inicioGrid = addDays(primeiro, -primeiro.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(inicioGrid, i));
  }, [cursor]);

  const diasSemana = useMemo(() => {
    const inicio = addDays(cursor, -cursor.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  }, [cursor]);

  const StatusBadge = ({ status }) => {
    const cfg = {
      pendente: { bg: "#EEEEEE", color: "#8A3E15", label: "Aguardando confirmação" },
      confirmado: { bg: "#E6EFE5", color: "#2A4531", label: "Confirmado" },
    }[status] || { bg: "#EEEEEE", color: "#6B685E", label: status };
    return <span style={{ fontSize: 10.5, fontWeight: 700, background: cfg.bg, color: cfg.color, borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap" }}>{cfg.label}</span>;
  };

  const loteDoAgendamento = (a) => a.loteNome ? lotes.find((l) => l.nome === a.loteNome && (!a.retiroId || l.retiroId === a.retiroId)) : null;

  const ItemAgendamento = ({ a }) => {
    if (editingId === a.id && editForm) {
      return (
        <div style={{ ...cardStyle, padding: "12px 14px", border: "1.5px solid #166336" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: editForm.tipo === "D0" ? 10 : 0 }}>
            <Field label="Retiro">
              <select style={inputStyle} value={editForm.retiroId} onChange={setEdit("retiroId")}>
                <option value="">Selecione um retiro</option>
                {retiros.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
            </Field>
            <Field label="Lote"><input style={inputStyle} value={editForm.loteNome} onChange={setEdit("loteNome")} placeholder="Nome do lote" /></Field>
            <Field label="Manejo">
              <select style={inputStyle} value={editForm.tipo} onChange={setEdit("tipo")}>
                {TIPOS_AGENDAMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Data (sugestão de nova data)"><input style={inputStyle} type="date" value={editForm.data} onChange={setEdit("data")} /></Field>
          </div>
          {editForm.tipo === "D0" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <Field label="Número de manejos">
                <select style={inputStyle} value={editForm.tipoManejo} onChange={(e) => {
                  const novo = e.target.value;
                  setEditForm((f) => ({ ...f, tipoManejo: novo, protocolo: protocolosPara(novo).includes(f.protocolo) ? f.protocolo : protocolosPara(novo)[0] }));
                }}>
                  {TIPOS_MANEJO_IMPLANTACAO.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Protocolo">
                <select style={inputStyle} value={editForm.protocolo} onChange={setEdit("protocolo")}>
                  {protocolosPara(editForm.tipoManejo).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <BtnPrimary onClick={salvarEdicao}><Save size={14} /> Salvar</BtnPrimary>
            <BtnGhost onClick={cancelarEdicao}>Cancelar</BtnGhost>
          </div>
        </div>
      );
    }

    return (
      <div style={{ ...cardStyle, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: CORES_TIPO[a.tipo] || "#6B685E", flexShrink: 0 }} />
            <strong style={{ fontSize: 13.5 }}>{a.titulo}</strong>
            <StatusBadge status={a.status} />
          </div>
          <div style={{ fontSize: 12, color: "#6B685E", marginTop: 3 }}>
            {a.tipo}{a.loteNome ? ` · ${a.loteNome}` : ""}{a.retiroId ? ` · ${nomeRetiro(a.retiroId)}` : ""} · {fmtDate(a.data)}
            {fazendasSelecionadas.length > 1 && ` · ${nomeFazenda(a.fazendaId)}`}
          </div>
          {(() => {
            const lote = loteDoAgendamento(a);
            const ordem = a.ordem || lote?.ordem;
            const categoria = lote?.categoria;
            const numeroAnimais = a.numeroAnimais ?? lote?.numeroAnimais;
            if (!lote && !ordem && numeroAnimais == null) return null;
            return (
              <div style={{ fontSize: 11.5, color: "#9B9686", marginTop: 3 }}>
                {categoria ? `Categoria: ${categoria}` : ""}
                {numeroAnimais != null ? `${categoria ? " · " : ""}Nº animais: ${numeroAnimais}` : ""}
                {ordem ? `${categoria || numeroAnimais != null ? " · " : ""}Ordem: ${ordem}` : ""}
              </div>
            );
          })()}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <BtnGhost onClick={() => iniciarEdicao(a)}><Pencil size={13} /></BtnGhost>
          {a.status === "pendente" ? (
            <>
              <BtnGhost onClick={() => confirmarAgendamento(a.id)}><Check size={13} /></BtnGhost>
              <BtnGhost danger onClick={() => descartarAgendamento(a.id)}><XCircle size={13} /></BtnGhost>
            </>
          ) : (
            <button onClick={() => removerAgendamento(a.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A32D2D" }}><Trash2 size={14} /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <SectionTitle icon={Calendar} title="Agenda" subtitle="Adicione agendamentos manualmente ou confirme os pré-agendamentos sugeridos automaticamente a partir dos manejos." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? <EmptyState text="Selecione uma fazenda ativa para ver a agenda." /> : (
        <>
          {fazendas.length > 1 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Fazendas exibidas na agenda</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {fazendas.map((f) => {
                  const selecionada = fazendasSelecionadas.includes(f.id);
                  return (
                    <button key={f.id} onClick={() => toggleFazendaSelecionada(f.id)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                        borderRadius: 20, padding: "5px 12px", fontSize: 12.5,
                        background: selecionada ? "#E6EFE5" : "#EEEEEE", color: selecionada ? "#2A4531" : "#6B685E",
                      }}>
                      {selecionada ? <CheckCircle2 size={13} /> : <Circle size={13} />} {f.nome}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 11.5, color: "#9B9686", margin: "6px 0 0" }}>
                {fazendasSelecionadas.length > 1 ? "Mostrando a programação conjunta das fazendas marcadas." : "Marque mais de uma fazenda para ver a programação conjunta."}
              </p>
            </div>
          )}

          {gruposDuplicados.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#A32D2D", textTransform: "uppercase", marginBottom: 8 }}>
                <XCircle size={13} /> Agendamentos duplicados
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {gruposDuplicados.map((grupo, i) => (
                  <div key={i} style={{ ...cardStyle, border: "1.5px solid #E39C9C", padding: "12px 14px" }}>
                    <p style={{ fontSize: 12.5, color: "#8A3E15", margin: "0 0 10px" }}>
                      Existem {grupo.length} agendamentos de <strong>{grupo[0].tipo}</strong> para o lote <strong>{grupo[0].loteNome}</strong> na <strong>{grupo[0].ordem}</strong>. Escolha qual deve permanecer na agenda:
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {grupo.map((a) => (
                        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFFFFF", border: "1px solid #E5DFCC", borderRadius: 8, padding: "8px 10px" }}>
                          <span style={{ fontSize: 12.5, color: "#4A473E" }}>{fmtDate(a.data)} · {a.status === "pendente" ? "Aguardando confirmação" : "Confirmado"}</span>
                          <BtnPrimary onClick={() => manterEDescartarOutros(grupo, a.id)}>Manter este</BtnPrimary>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>
              <Bell size={13} /> Pré-agendamentos aguardando confirmação
            </div>
            {pendentes.length === 0 ? (
              <EmptyState text="Nenhum pré-agendamento automático no momento. Assim que as regras por tipo de manejo forem definidas, eles aparecerão aqui para confirmação." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendentes.map((a) => <ItemAgendamento key={a.id} a={a} />)}
              </div>
            )}
          </div>

          <div style={{ ...cardStyle, marginBottom: 26 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 12 }}>Adicionar agendamento</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, alignItems: "end" }}>
              <Field label="Retiro">
                <select style={inputStyle} value={form.retiroId} onChange={set("retiroId")}>
                  <option value="">Selecione um retiro</option>
                  {retiros.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </Field>
              <Field label="Lote">
                <input style={inputStyle} value={form.loteNome} onChange={set("loteNome")} placeholder="Nome do lote" list="lotes-existentes" />
                <datalist id="lotes-existentes">
                  {lotes.map((l) => <option key={l.id} value={l.nome} />)}
                </datalist>
              </Field>
              <Field label="Manejo">
                <select style={inputStyle} value={form.tipo} onChange={set("tipo")}>
                  {TIPOS_AGENDAMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Ordem">
                <select style={inputStyle} value={form.ordem} onChange={set("ordem")}>
                  <option value="">Selecione a ordem</option>
                  {ORDENS_IATF.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Data"><input style={inputStyle} type="date" value={form.data} onChange={set("data")} /></Field>
              <Field label="Nº de animais (opcional)"><input style={inputStyle} type="number" min="0" value={form.numeroAnimais} onChange={set("numeroAnimais")} placeholder="0" /></Field>
              {form.tipo === "D0" && (
                <>
                  <Field label="Número de manejos">
                    <select style={inputStyle} value={form.tipoManejo} onChange={(e) => {
                      const novo = e.target.value;
                      setForm((f) => ({ ...f, tipoManejo: novo, protocolo: protocolosPara(novo).includes(f.protocolo) ? f.protocolo : protocolosPara(novo)[0] }));
                    }}>
                      {TIPOS_MANEJO_IMPLANTACAO.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Protocolo">
                    <select style={inputStyle} value={form.protocolo} onChange={set("protocolo")}>
                      {protocolosPara(form.tipoManejo).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </Field>
                </>
              )}
              <BtnPrimary disabled={!canSave} onClick={salvar}>
                <Plus size={15} /> Adicionar
              </BtnPrimary>
            </div>
            {msg && <p style={{ fontSize: 12.5, color: "#A32D2D", marginTop: 10 }}>{msg}</p>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
            {TIPOS_AGENDAMENTO.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6B685E" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: CORES_TIPO[t] }} /> {t}
              </span>
            ))}
          </div>

          <div>
            {/* barra de controle: navegação + seletor de período */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => irPara(-1)} style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid #D6D6D6", background: "#FFF", cursor: "pointer", color: "#4A473E" }}>‹</button>
                <button onClick={() => irPara(1)} style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid #D6D6D6", background: "#FFF", cursor: "pointer", color: "#4A473E" }}>›</button>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16.5, fontWeight: 600, color: "#232520", marginLeft: 4, textTransform: "capitalize" }}>{rotuloPeriodo()}</div>
                <BtnGhost onClick={irParaHoje} style={{ marginLeft: 6 }}><CalendarClock size={13} /> Hoje</BtnGhost>
              </div>

              <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2 }}>
                {[["mes", "Mês"], ["semana", "Semana"]].map(([key, label]) => (
                  <button key={key} onClick={() => setViewMode(key)}
                    style={{
                      padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                      fontSize: 12.5, fontWeight: 600,
                      background: viewMode === key ? "#166336" : "transparent",
                      color: viewMode === key ? "#FFFFFF" : "#6B685E",
                    }}>{label}</button>
                ))}
              </div>
            </div>

            {/* VISÃO MÊS */}
            {viewMode === "mes" && (
              <div style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                  {DIAS_SEMANA.map((d) => (
                    <div key={d} style={{ fontSize: isMobileCalendario ? 9.5 : 10.5, fontWeight: 700, color: "#9B9686", textTransform: "uppercase", textAlign: "center", padding: isMobileCalendario ? "6px 0" : "8px 0", borderBottom: "1px solid #E5DFCC" }}>{isMobileCalendario ? d.slice(0, 1) : d}</div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                  {gridMes.map((d, i) => {
                    const iso = ymd(d);
                    const itens = porDia[iso] || [];
                    const foraDoMes = d.getMonth() !== cursor.getMonth();
                    const hoje = isSameDay(d, new Date());
                    const ativo = iso === selecionado;

                    if (isMobileCalendario) {
                      // celular: todo dia é um quadrado do mesmo tamanho (padronizado); o número
                      // fica pequeno no canto superior direito, e os agendamentos aparecem como
                      // retângulos coloridos com o nome do lote — sempre no máximo 2 linhas, com
                      // "+N" se sobrar mais, para o quadrado nunca crescer nem desalinhar a grade.
                      const visiveis = itens.slice(0, 2);
                      const restantes = itens.length - visiveis.length;
                      return (
                        <button key={i} onClick={() => setSelecionado(iso)}
                          style={{
                            position: "relative", aspectRatio: "1 / 1", overflow: "hidden",
                            display: "flex", flexDirection: "column", justifyContent: "flex-end",
                            gap: 2, padding: "3px 3px 3px", border: "none",
                            borderRight: (i + 1) % 7 !== 0 ? "1px solid #F0F0F0" : "none",
                            borderBottom: "1px solid #F0F0F0",
                            background: ativo ? "#FFFFFF" : "#FFF", cursor: "pointer",
                            opacity: foraDoMes ? 0.4 : 1,
                          }}>
                          <span style={{
                            position: "absolute", top: 2, right: 3,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            minWidth: 15, height: 15, borderRadius: "50%", fontSize: 9.5, fontWeight: 700,
                            background: hoje ? "#166336" : "transparent", color: hoje ? "#FFFFFF" : "#9B9686",
                          }}>{d.getDate()}</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 14 }}>
                            {visiveis.map((a) => {
                              const n = a.numeroAnimais ?? loteDoAgendamento(a)?.numeroAnimais;
                              return (
                                <span key={a.id} style={{
                                  fontSize: 8.5, fontWeight: 700, color: "#FFF", background: CORES_TIPO[a.tipo] || "#6B685E",
                                  borderRadius: 3, padding: "2px 3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                  opacity: a.status === "pendente" ? 0.6 : 1, lineHeight: 1.2,
                                }}>{a.loteNome || a.titulo}{n != null ? ` · ${n}` : ""}</span>
                              );
                            })}
                            {restantes > 0 && <span style={{ fontSize: 8, color: "#9B9686", textAlign: "center" }}>+{restantes}</span>}
                          </div>
                        </button>
                      );
                    }

                    return (
                      <button key={i} onClick={() => setSelecionado(iso)}
                        style={{
                          minHeight: 74, textAlign: "left", padding: "6px 6px", border: "none",
                          borderRight: (i + 1) % 7 !== 0 ? "1px solid #F0F0F0" : "none",
                          borderBottom: "1px solid #F0F0F0",
                          background: ativo ? "#FFFFFF" : "#FFF", cursor: "pointer",
                          opacity: foraDoMes ? 0.4 : 1,
                        }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 20, height: 20, borderRadius: "50%", fontSize: 11.5, fontWeight: 700,
                          background: hoje ? "#166336" : "transparent", color: hoje ? "#FFFFFF" : "#4A473E",
                        }}>{d.getDate()}</span>
                        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                          {itens.slice(0, 2).map((a) => {
                            const n = a.numeroAnimais ?? loteDoAgendamento(a)?.numeroAnimais;
                            return (
                              <span key={a.id} style={{
                                fontSize: 10, fontWeight: 600, color: "#FFF", background: CORES_TIPO[a.tipo] || "#6B685E",
                                borderRadius: 4, padding: "1.5px 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                opacity: a.status === "pendente" ? 0.6 : 1,
                              }}>{a.titulo}{n != null ? ` · ${n}` : ""}</span>
                            );
                          })}
                          {itens.length > 2 && <span style={{ fontSize: 10, color: "#9B9686" }}>+{itens.length - 2} mais</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* VISÃO SEMANA */}
            {viewMode === "semana" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
                {diasSemana.map((d) => {
                  const iso = ymd(d);
                  const itens = porDia[iso] || [];
                  const hoje = isSameDay(d, new Date());
                  return (
                    <div key={iso} onClick={() => setSelecionado(iso)}
                      style={{ ...cardStyle, padding: "10px", cursor: "pointer", minHeight: 140, border: iso === selecionado ? "1.5px solid #166336" : cardStyle.border }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9B9686", textTransform: "uppercase" }}>{DIAS_SEMANA[d.getDay()]}</div>
                      <div style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%",
                        fontSize: 12, fontWeight: 700, background: hoje ? "#166336" : "transparent", color: hoje ? "#FFFFFF" : "#232520", marginTop: 2,
                      }}>{d.getDate()}</div>
                      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                        {itens.map((a) => {
                          const n = a.numeroAnimais ?? loteDoAgendamento(a)?.numeroAnimais;
                          return (
                            <span key={a.id} style={{
                              fontSize: 10.5, fontWeight: 600, color: "#FFF", background: CORES_TIPO[a.tipo] || "#6B685E",
                              borderRadius: 4, padding: "2px 5px", opacity: a.status === "pendente" ? 0.6 : 1,
                            }}>{a.titulo}{n != null ? ` · ${n}` : ""}</span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* detalhe do dia selecionado */}
            {(
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>
                  {parseISODate(selecionado).getDate()} de {NOMES_MES[parseISODate(selecionado).getMonth()]}
                </div>
                {(porDia[selecionado] || []).length === 0 ? (
                  <EmptyState text="Nenhum agendamento neste dia." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(porDia[selecionado] || []).map((a) => <ItemAgendamento key={a.id} a={a} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   USUÁRIOS
========================================================= */


const PERFIS_USUARIO = ["Administrador", "Supervisor", "Inseminador"];

function AbaUsuarios({ users, fazendas, addUsuario, toggleAutorizacaoFazenda }) {
  const empty = { nome: "", login: "", email: "", senha: "", perfil: "Inseminador" };
  const [form, setForm] = useState(empty);
  const [usuarioAberto, setUsuarioAberto] = useState(null);
  const [msg, setMsg] = useState("");
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); if (msg) setMsg(""); };

  const canSave = form.nome.trim() !== "" && form.login.trim() !== ""
    && (!supabaseConfigurado || (form.email.trim() !== "" && form.senha.length >= 6));

  const salvar = async () => {
    if (!canSave) return;
    setSalvando(true);
    const r = await addUsuario(form);
    setSalvando(false);
    if (!r.ok) { setMsg(r.erro); return; }
    setForm(empty);
    setMsg(r.precisaConfirmarEmail
      ? "Usuário criado. Ele precisa confirmar o e-mail antes do primeiro login (verifique a caixa de entrada)."
      : "Usuário criado com sucesso.");
  };

  const corPerfil = (perfil) => ({
    Administrador: { bg: "#E4D6EE", color: "#5A2A8A" },
    Supervisor: { bg: "#EFEFEF", color: "#8A5A1F" },
    Inseminador: { bg: "#E6EFE5", color: "#2A4531" },
  }[perfil] || { bg: "#EEEEEE", color: "#6B685E" });

  return (
    <div>
      <SectionTitle icon={Users} title="Usuários" subtitle="Administrador: relatórios, cadastro de fazendas e de usuários (vê todas as fazendas). Supervisor e Inseminador: acesso restrito às fazendas autorizadas pelo Administrador." />

      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 12 }}>Adicionar usuário</div>
        {!supabaseConfigurado && (
          <p style={{ fontSize: 12, color: "#166336", background: "#FBF3E4", border: "1px solid #E3B8A0", borderRadius: 8, padding: 10, margin: "0 0 14px" }}>
            ⚠ Supabase não configurado — este usuário será só local, sem senha real (modo de teste).
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
          <Field label="Nome"><input style={inputStyle} value={form.nome} onChange={set("nome")} placeholder="Nome completo" /></Field>
          <Field label="Login"><input style={inputStyle} value={form.login} onChange={set("login")} placeholder="usuario.login" /></Field>
          {supabaseConfigurado && (
            <>
              <Field label="E-mail (login de acesso)"><input type="email" style={inputStyle} value={form.email} onChange={set("email")} placeholder="pessoa@fazenda.com" /></Field>
              <Field label="Senha inicial"><input type="password" style={inputStyle} value={form.senha} onChange={set("senha")} placeholder="Mínimo 6 caracteres" /></Field>
            </>
          )}
          <Field label="Perfil">
            <select style={inputStyle} value={form.perfil} onChange={set("perfil")}>
              {PERFIS_USUARIO.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        {msg && <p style={{ fontSize: 12.5, color: msg.includes("sucesso") || msg.includes("criado") ? "#166336" : "#A32D2D", margin: "10px 0 0" }}>{msg}</p>}
        <BtnPrimary disabled={!canSave || salvando} onClick={salvar} style={{ marginTop: 12 }}><Plus size={15} /> {salvando ? "Salvando…" : "Salvar usuário"}</BtnPrimary>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 10 }}>Usuários cadastrados</div>
      <div className="rola-horizontal" style={{ background: "#FFF", border: "1px solid #E5DFCC", borderRadius: 12, overflowX: "auto" }}>
        <table>
          <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Fazendas autorizadas</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => {
              const cor = corPerfil(u.perfil);
              const aberto = usuarioAberto === u.id;
              const autorizadas = u.fazendasAutorizadas || [];
              const temAutorizacao = true; // todo perfil, inclusive Administrador, agora tem seu grupo próprio de fazendas
              return (
                <React.Fragment key={u.id}>
                  <tr onClick={() => temAutorizacao && setUsuarioAberto(aberto ? null : u.id)} style={{ cursor: temAutorizacao ? "pointer" : "default" }}>
                    <td>{u.nome}</td>
                    <td>{u.login}</td>
                    <td><span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: cor.bg, color: cor.color }}>{u.perfil}</span></td>
                    <td>{temAutorizacao ? `${autorizadas.length} fazenda(s)` : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {temAutorizacao && <ChevronRight size={15} color="#9B9686" style={{ transform: aberto ? "rotate(90deg)" : "none" }} />}
                    </td>
                  </tr>
                  {aberto && temAutorizacao && (
                    <tr>
                      <td colSpan={5} style={{ background: "#FFFFFF", padding: "14px 16px" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B685E", textTransform: "uppercase", marginBottom: 8 }}>Fazendas que {u.nome} pode acessar</div>
                        {fazendas.length === 0 ? <EmptyState text="Nenhuma fazenda cadastrada ainda." /> : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {fazendas.map((f) => {
                              const autorizada = autorizadas.includes(f.id);
                              return (
                                <button key={f.id} onClick={() => toggleAutorizacaoFazenda(u.id, f.id)}
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                                    borderRadius: 20, padding: "5px 12px", fontSize: 12.5,
                                    background: autorizada ? "#E6EFE5" : "#EEEEEE", color: autorizada ? "#2A4531" : "#6B685E",
                                  }}>
                                  {autorizada ? <CheckCircle2 size={13} /> : <Circle size={13} />} {f.nome}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================================================
   RELATÓRIOS
========================================================= */

// junta, por animal, a Inseminação com o Diagnóstico que veio depois dela (mesmo brinco,
// mesma ordem) — é esse cruzamento que permite quebrar a Taxa de Concepção por categoria,
// retiro, ECC, inseminador, data e touro, já que esses dados vivem na Inseminação, não no
// Diagnóstico. Animais do lote "Desconhecidos" são sempre ignorados. Um animal inseminado
// mas ainda sem diagnóstico correspondente também fica de fora (resultado ainda não existe).
function construirRegistrosConcepcao(manejos, lotes, insumos) {
  const idsDesconhecidos = new Set(lotes.filter((l) => l.nome === "Desconhecidos").map((l) => l.id));
  const inseminacoes = manejos.filter((m) => m.tipo === "inseminacao" && !idsDesconhecidos.has(m.loteId));
  const diagnosticos = manejos.filter((m) => m.tipo === "diagnostico" && !idsDesconhecidos.has(m.loteId));

  const nomeTouro = (semenId, touroInformado) => {
    if (semenId) { const insumo = insumos.find((i) => i.id === semenId); if (insumo?.touro) return insumo.touro; }
    return touroInformado || null;
  };

  const registros = [];
  inseminacoes.forEach((insem) => {
    (insem.detalhes || []).forEach((detIns) => {
      const candidatas = diagnosticos.filter((d) =>
        d.ordem === insem.ordem && d.data >= insem.data && (d.detalhes || []).some((x) => x.brinco === detIns.brinco)
      );
      if (candidatas.length === 0) return;
      const diag = candidatas.reduce((mais, atual) => (atual.data < mais.data ? atual : mais)); // o diagnóstico mais próximo depois da inseminação
      const detDiag = (diag.detalhes || []).find((x) => x.brinco === detIns.brinco);
      if (!detDiag?.resultado) return;
      registros.push({
        brinco: detIns.brinco, prenha: detDiag.resultado === "Prenha", ordem: insem.ordem,
        categoria: insem.categoria || null, retiroId: insem.retiroId || null,
        ecc: detIns.ecc || null, inseminador: insem.inseminador || null,
        dataInseminacao: insem.data, touro: nomeTouro(detIns.semenId, detIns.touroInformado),
      });
    });
  });
  return registros;
}

// agrupa os registros por uma dimensão (categoria, retiro, ECC, ...) e calcula a taxa de
// cada grupo — registros sem essa dimensão preenchida ficam de fora (não viram um grupo
// "vazio" no gráfico).
function agruparConcepcao(registros, chaveFn) {
  const grupos = new Map();
  registros.forEach((r) => {
    const chave = chaveFn(r);
    if (chave == null || chave === "") return;
    if (!grupos.has(chave)) grupos.set(chave, { n: 0, prenhas: 0 });
    const g = grupos.get(chave);
    g.n += 1;
    if (r.prenha) g.prenhas += 1;
  });
  return [...grupos.entries()].map(([label, v]) => ({ label, n: v.n, taxa: Math.round((v.prenhas / v.n) * 1000) / 10 }));
}

function AbaRelatorios({ fazendaAtiva, lotes, retiros, insumos, manejos, movimentos, perfil }) {
  const [visaoData, setVisaoData] = useState("dia"); // "dia" | "mes"
  const nomeRetiro = (id) => retiros.find((r) => r.id === id)?.nome || null;

  const registros = useMemo(() => construirRegistrosConcepcao(manejos, lotes, insumos), [manejos, lotes, insumos]);

  const geral = agruparConcepcao(registros, () => "Geral");
  const porOrdem = ORDENS_IATF.map((o) => agruparConcepcao(registros.filter((r) => r.ordem === o), () => o)[0]).filter(Boolean);
  const porCategoria = agruparConcepcao(registros, (r) => r.categoria);
  const porRetiro = agruparConcepcao(registros, (r) => nomeRetiro(r.retiroId));
  const porEcc = OPCOES_ECC.map((e) => agruparConcepcao(registros.filter((r) => r.ecc === e), () => e)[0]).filter(Boolean);
  const porInseminador = agruparConcepcao(registros, (r) => r.inseminador);
  const porData = agruparConcepcao(registros, (r) => visaoData === "mes" ? r.dataInseminacao?.slice(0, 7) : r.dataInseminacao)
    .sort((a, b) => (a.label < b.label ? -1 : 1))
    .map((d) => ({ ...d, label: visaoData === "mes" ? fmtMes(d.label) : fmtDate(d.label) }));
  const porTouro = agruparConcepcao(registros, (r) => r.touro);

  return (
    <div>
      <SectionTitle icon={ClipboardList} title="Relatórios" subtitle={perfil === "Supervisor" ? "Acesso de leitura." : "Visão geral da operação em gráficos."} />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para ver os relatórios." />
      ) : registros.length === 0 ? (
        <EmptyState text="Ainda não há Inseminações com Diagnóstico correspondente para calcular a taxa de concepção. Os gráficos aparecem aqui assim que houver dados (animais do lote Desconhecidos não entram na conta)." />
      ) : (
        <>
          <div className="grid-relatorios-3" style={{ display: "grid", gap: 16, marginBottom: 4 }}>
            <GraficoColunas titulo="Concepção geral" descricao="Percentual de Prenhas sobre o total de animais com Inseminação e Diagnóstico cruzados." dados={geral} compacto />
            <GraficoColunas titulo="Concepção por ordem" descricao="Taxa de concepção em cada ordem de IATF." dados={porOrdem} compacto />
            <GraficoColunas titulo="Concepção por categoria" descricao="Taxa de concepção por categoria do lote no momento da Inseminação." dados={porCategoria} compacto />
            <GraficoColunas titulo="Concepção por retiro" descricao="Taxa de concepção por retiro." dados={porRetiro} compacto />
            <GraficoColunas titulo="Concepção por ECC na Inseminação" descricao="Taxa de concepção conforme o Escore de Condição Corporal registrado na Inseminação." dados={porEcc} compacto />
            <GraficoColunas titulo="Concepção por Inseminador" descricao="Taxa de concepção por quem realizou a Inseminação." dados={porInseminador} compacto />
          </div>

          <div style={{ ...cardStyle, marginBottom: 20, marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#232520" }}>Concepção por data de inseminação</div>
              <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2 }}>
                {[["dia", "Por dia"], ["mes", "Por mês"]].map(([key, label]) => (
                  <button key={key} onClick={() => setVisaoData(key)}
                    style={{
                      padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                      background: visaoData === key ? "#166336" : "transparent", color: visaoData === key ? "#FFFFFF" : "#6B685E",
                    }}>{label}</button>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 12, color: "#9B9686", margin: "0 0 20px" }}>Taxa de concepção agrupada pela data em que a Inseminação foi feita.</p>
            <LinhaConcepcao dados={porData} />
          </div>

          <GraficoColunas titulo="Concepção por Touro" descricao="Taxa de concepção por touro/partida usada na Inseminação, do maior para o menor." dados={porTouro} ordenarPorTaxaDesc />

          <p style={{ fontSize: 11, color: "#9B9686" }}>Animais do lote "Desconhecidos" não entram em nenhum desses gráficos. "n" é o total de animais considerados em cada estatística.</p>
        </>
      )}
    </div>
  );
}

// barras de um gráfico de coluna — recebe [{ label, n, taxa }]. Usada tanto direto
// (GraficoColunas) quanto dentro de um card com cabeçalho customizado (data de inseminação).
function BarrasConcepcao({ dados, ordenarPorTaxaDesc, compacto }) {
  const lista = ordenarPorTaxaDesc ? [...dados].sort((a, b) => b.taxa - a.taxa) : dados;
  if (lista.length === 0) return <p style={{ fontSize: 12, color: "#9B9686" }}>Sem dados suficientes ainda.</p>;
  const maiorTaxa = Math.max(...lista.map((d) => d.taxa || 0), 10);
  const alturaMax = compacto ? 90 : 140;
  return (
    <div className="rola-horizontal" style={{ display: "flex", alignItems: "flex-end", gap: compacto ? 10 : 16, height: compacto ? 140 : 200, paddingTop: 10, overflowX: "auto" }}>
      {lista.map((d, i) => (
        <div key={`${d.label}-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: compacto ? 48 : 64, flexShrink: 0 }}>
          <div style={{ fontSize: compacto ? 12 : 13, fontWeight: 700, color: "#232520", marginBottom: 6 }}>{d.taxa}%</div>
          <div style={{ width: compacto ? 32 : 44, height: `${Math.max((d.taxa / maiorTaxa) * alturaMax, 4)}px`, background: "#166336", borderRadius: "4px 4px 0 0" }} />
          <div style={{ fontSize: compacto ? 10.5 : 11.5, color: "#6B685E", marginTop: 8, textAlign: "center", maxWidth: compacto ? 64 : 84, wordBreak: "break-word" }}>{d.label}</div>
          <div style={{ fontSize: compacto ? 9.5 : 10.5, color: "#B0AA98" }}>n={d.n}</div>
        </div>
      ))}
    </div>
  );
}

function GraficoColunas({ titulo, descricao, dados, ordenarPorTaxaDesc, compacto }) {
  return (
    <div style={{ ...cardStyle, marginBottom: compacto ? 0 : 20 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: compacto ? 15 : 17, fontWeight: 600, color: "#232520", marginBottom: 4 }}>{titulo}</div>
      <p style={{ fontSize: compacto ? 11.5 : 12, color: "#9B9686", margin: "0 0 16px" }}>{descricao}</p>
      <BarrasConcepcao dados={dados} ordenarPorTaxaDesc={ordenarPorTaxaDesc} compacto={compacto} />
    </div>
  );
}

// gráfico de LINHA (SVG simples, sem biblioteca) para a Concepção por data de inseminação —
// um ponto por data/mês, ligados por uma linha, com a taxa acima do ponto e "n" abaixo do eixo.
function LinhaConcepcao({ dados }) {
  if (dados.length === 0) return <p style={{ fontSize: 12, color: "#9B9686" }}>Sem dados suficientes ainda.</p>;
  const alturaUtil = 130;
  const margemTopo = 24;
  const alturaTotal = alturaUtil + margemTopo + 40;
  const largura = Math.max(dados.length * 70, 260);
  const maiorTaxa = Math.max(...dados.map((d) => d.taxa || 0), 10);
  const passoX = dados.length > 1 ? largura / (dados.length - 1) : 0;
  const pontos = dados.map((d, i) => ({
    ...d,
    x: dados.length === 1 ? largura / 2 : i * passoX,
    y: margemTopo + (alturaUtil - (d.taxa / maiorTaxa) * alturaUtil),
  }));
  const linha = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="rola-horizontal" style={{ overflowX: "auto" }}>
      <svg width={largura + 20} height={alturaTotal} viewBox={`-10 0 ${largura + 20} ${alturaTotal}`}>
        <path d={linha} fill="none" stroke="#166336" strokeWidth="2" />
        {pontos.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={p.x} cy={p.y} r="4" fill="#166336" />
            <text x={p.x} y={p.y - 10} fontSize="11.5" fontWeight="700" fill="#232520" textAnchor="middle">{p.taxa}%</text>
            <text x={p.x} y={margemTopo + alturaUtil + 18} fontSize="10.5" fill="#6B685E" textAnchor="middle">{p.label}</text>
            <text x={p.x} y={margemTopo + alturaUtil + 32} fontSize="10" fill="#B0AA98" textAnchor="middle">n={p.n}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* =========================================================
   BENCHMARKING — compara a fazenda ativa com outras fazendas, em dois
   escopos possíveis (filtro, não misturado no mesmo gráfico): "Meu Grupo"
   (as fazendas do próprio Administrador) ou "Geral do Sistema" (todas as
   fazendas, de todos os grupos). Cada gráfico mostra: Sua Fazenda, Média
   Geral do escopo, Média das 25% melhores e Média das 25% piores — todas
   calculadas como "média das médias por fazenda" (cada fazenda pesa igual,
   não pelo volume de leituras). A parte "Geral do Sistema" vem de uma
   função no Supabase que só devolve esses 4 números agregados, nunca dado
   de outra fazenda — ver supabase/schema.sql, seção BENCHMARKING.
========================================================= */

// calcula, a partir de uma lista de manejos, a taxa de prenhez de CADA
// fazenda (prenhas/avaliadas daquela fazenda) — usado tanto para achar a
// taxa "Sua Fazenda" quanto para montar a "média das médias" do grupo.
function taxasDePrenhezPorFazenda(listaManejos) {
  const porFazenda = {};
  listaManejos.filter((m) => m.tipo === "diagnostico").forEach((m) => {
    if (!porFazenda[m.fazendaId]) porFazenda[m.fazendaId] = { prenhas: 0, avaliadas: 0 };
    (m.detalhes || []).forEach((d) => {
      porFazenda[m.fazendaId].avaliadas += 1;
      if (d.resultado === "Prenha") porFazenda[m.fazendaId].prenhas += 1;
    });
  });
  return Object.entries(porFazenda)
    .filter(([, v]) => v.avaliadas > 0)
    .map(([fazendaId, v]) => ({ fazendaId, taxa: Math.round((v.prenhas / v.avaliadas) * 1000) / 10 }));
}

// "média das médias": tira a média simples entre as taxas já calculadas por
// fazenda (ex.: (42% + 35% + 54%) / 3) — nunca soma os animais de todas as
// fazendas numa conta só — e separa as 25% melhores / 25% piores fazendas.
function calcularEstatisticasBenchmark(taxas) {
  if (taxas.length === 0) return { mediaGeral: null, mediaTop25: null, mediaBottom25: null, numFazendas: 0 };
  const ordenadas = [...taxas].sort((a, b) => a - b);
  const n = ordenadas.length;
  const media = (arr) => Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;
  const tamanhoQuartil = Math.max(1, Math.round(n * 0.25));
  return {
    mediaGeral: media(ordenadas),
    mediaBottom25: media(ordenadas.slice(0, tamanhoQuartil)),
    mediaTop25: media(ordenadas.slice(n - tamanhoQuartil)),
    numFazendas: n,
  };
}

// gráfico de barras reutilizável: Sua Fazenda / Média Geral / 25% Melhores / 25% Piores.
// Pensado para receber mais indicadores nas próximas etapas — é só chamar de novo
// com outro título/valores.
function GraficoBenchmark({ titulo, descricao, suaFazenda, stats, carregando, aviso }) {
  const barras = [
    { label: "Sua Fazenda", valor: suaFazenda, cor: "#159FDB" },
    { label: "Média Geral", valor: stats?.mediaGeral ?? null, cor: "#1F5C7A" },
    { label: "25% Melhores", valor: stats?.mediaTop25 ?? null, cor: "#166336" },
    { label: "25% Piores", valor: stats?.mediaBottom25 ?? null, cor: "#C0392B" },
  ];
  const maiorValor = Math.max(...barras.map((b) => b.valor || 0), 10);

  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#232520", marginBottom: 4 }}>{titulo}</div>
      <p style={{ fontSize: 12, color: "#9B9686", margin: "0 0 20px" }}>{descricao}</p>

      {carregando ? (
        <p style={{ fontSize: 12, color: "#9B9686" }}>Carregando…</p>
      ) : aviso ? (
        <p style={{ fontSize: 12, color: "#166336", background: "#FBF3E4", border: "1px solid #E3B8A0", borderRadius: 8, padding: 10 }}>⚠ {aviso}</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 20, height: 220, paddingTop: 10 }}>
            {barras.map((b) => (
              <div key={b.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                {b.valor != null && <div style={{ fontSize: 13, fontWeight: 700, color: "#232520", marginBottom: 6 }}>{b.valor}%</div>}
                <div style={{
                  width: "100%", maxWidth: 70,
                  height: b.valor != null ? `${Math.max((b.valor / maiorValor) * 170, 4)}px` : "4px",
                  background: b.valor != null ? b.cor : "#E5DFCC",
                  borderRadius: "4px 4px 0 0",
                }} />
                <div style={{ fontSize: 12, color: "#6B685E", marginTop: 8, textAlign: "center" }}>{b.label}</div>
                {b.label === "Sua Fazenda" && b.valor == null && <div style={{ fontSize: 10.5, color: "#B0AA98" }}>sem diagnósticos</div>}
              </div>
            ))}
          </div>
          {stats && (
            <p style={{ fontSize: 11, color: "#B0AA98", marginTop: 14 }}>
              Calculado a partir de {stats.numFazendas} fazenda(s) com diagnóstico registrado (a fazenda selecionada entra na conta se já tiver diagnóstico).
            </p>
          )}
        </>
      )}
    </div>
  );
}

function AbaBenchmarking({ fazendaAtiva, fazendaAtivaId, manejosDoGrupo, safraAtiva, safras }) {
  const [escopo, setEscopo] = useState("grupo"); // "grupo" | "sistema"
  const [sistema, setSistema] = useState(null);
  const [carregandoSistema, setCarregandoSistema] = useState(false);
  const [erroSistema, setErroSistema] = useState("");

  // recarrega "Geral do Sistema" sempre que trocar de escopo OU de safra ativa —
  // o filtro de safra precisa refletir no servidor também, não só no cálculo local.
  React.useEffect(() => {
    if (escopo !== "sistema" || !supabaseConfigurado) return;
    setSistema(null); setErroSistema(""); setCarregandoSistema(true);
    buscarBenchmarkTaxaPrenhezSistema(safraAtiva?.nome || null).then((r) => {
      if (r.ok) setSistema(r); else setErroSistema(r.motivo);
      setCarregandoSistema(false);
    });
  }, [escopo, safraAtiva?.nome]); // eslint-disable-line react-hooks/exhaustive-deps

  // filtra pela safra ativa comparando pelo NOME da safra (ex.: "2024/2025") — cada
  // fazenda tem seus próprios ids de safra, mas o nome é o que permite comparar a
  // "mesma safra" entre fazendas diferentes do grupo. Sem safra ativa selecionada,
  // usa o histórico completo (sem filtro).
  const manejosDaSafra = useMemo(() => {
    if (!safraAtiva) return manejosDoGrupo;
    const idsDaMesmaSafra = new Set(safras.filter((s) => s.nome === safraAtiva.nome).map((s) => s.id));
    return manejosDoGrupo.filter((m) => idsDaMesmaSafra.has(m.safraId));
  }, [manejosDoGrupo, safras, safraAtiva]);

  const taxasGrupo = useMemo(() => taxasDePrenhezPorFazenda(manejosDaSafra), [manejosDaSafra]);
  const statsGrupo = useMemo(() => calcularEstatisticasBenchmark(taxasGrupo.map((f) => f.taxa)), [taxasGrupo]);
  const suaFazenda = taxasGrupo.find((f) => f.fazendaId === fazendaAtivaId)?.taxa ?? null;

  const statsAtual = escopo === "grupo" ? statsGrupo : sistema;
  const avisoSistema = escopo === "sistema" && !supabaseConfigurado
    ? 'A comparação "Geral do Sistema" precisa do Supabase configurado — ela olha fazendas de outros grupos, calculada no servidor sem expor nenhum dado bruto de ninguém, só as médias.'
    : escopo === "sistema" && erroSistema
    ? `Não foi possível carregar a comparação geral: ${erroSistema}`
    : null;

  return (
    <div>
      <SectionTitle icon={TrendingUp} title="Benchmarking" subtitle="Compare a fazenda ativa com outras fazendas — escolha o grupo de comparação abaixo." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para comparar." />
      ) : (
        <>
          <div style={{ display: "flex", background: "#EEEEEE", borderRadius: 8, padding: 3, gap: 2, marginBottom: 20, width: "fit-content" }}>
            {[["grupo", "Meu Grupo"], ["sistema", "Geral do Sistema"]].map(([key, label]) => (
              <button key={key} onClick={() => setEscopo(key)}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: escopo === key ? "#166336" : "transparent", color: escopo === key ? "#FFFFFF" : "#6B685E",
                }}>{label}</button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: "#9B9686", marginTop: -12, marginBottom: 18 }}>
            {safraAtiva ? `Mostrando dados da safra ${safraAtiva.nome}.` : "Nenhuma safra ativa selecionada — mostrando todo o histórico."}
          </p>

          <GraficoBenchmark
            titulo="Taxa de prenhez geral (%)"
            descricao={`Percentual de diagnósticos com resultado Prenha, comparado com ${escopo === "grupo" ? "as fazendas do seu grupo" : "todas as fazendas do sistema"}.`}
            suaFazenda={suaFazenda}
            stats={statsAtual}
            carregando={escopo === "sistema" && carregandoSistema}
            aviso={avisoSistema}
          />

          <p style={{ fontSize: 11, color: "#9B9686" }}>Mais indicadores de benchmarking serão adicionados aqui nas próximas etapas.</p>
        </>
      )}
    </div>
  );
}

/* =========================================================
   EXPORTAÇÕES — planilhas Excel por Animal e por Lote,
   respeitando os filtros de Fazenda ativa e Safra ativa.
========================================================= */

function AbaExportacoes({ fazendaAtiva, safraAtiva, lotes, retiros, insumos, manejos }) {
  const nomeRetiro = (id) => retiros.find((r) => r.id === id)?.nome || "—";
  const nomeInsumo = (id) => insumos.find((i) => i.id === id)?.produtoComercial || "—";

  const buscarUltimo = (tipo, filtro) => {
    const registros = manejos.filter((m) => m.tipo === tipo && filtro(m));
    if (registros.length === 0) return null;
    return registros.reduce((mais, atual) => (atual.data > mais.data ? atual : mais));
  };
  const buscarManejoLoteOrdem = (tipos, loteId, ordem) => manejos.find((m) => tipos.includes(m.tipo) && m.loteId === loteId && m.ordem === ordem);
  const paraData = (iso) => iso ? parseISODate(iso) : "—";

  const baixarPlanilha = (nomeAba, ws, nomeArquivo) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nomeAba);
    XLSX.writeFile(wb, nomeArquivo);
  };

  const sufixoArquivo = () => {
    const faz = (fazendaAtiva?.nome || "fazenda").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const saf = (safraAtiva?.nome || "safra").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `${faz}_${saf}_${todayISO()}`;
  };

  // Um bloco de 19 colunas para cada Ordem (1º/2º/3º IATF), com todos os dados dos manejos
  // (D0, Retirada, Inseminação, Diagnóstico) daquele lote naquela ordem específica.
  const SUBCOLUNAS_ORDEM = [
    "Data do D0", "Data da Inseminação", "Data do Diagnóstico", "Número de manejos", "Protocolo",
    "Implante no D0", "Benzoato no D0", "Prostaglandina no D0", "Medicamentos no D0",
    "Prostaglandina na Retirada", "Cipionato na Retirada", "ECG/HCG na Retirada",
    "Touro", "Partida", "ECC", "Peso", "Observações", "Medicamentos na Inseminação", "Diagnóstico",
  ];
  const COLUNAS_FIXAS = ["Identificação", "Categoria", "Lote", "Mês de parição"];

  const dadosDoBloco = (lote, brinco, ordem) => {
    const d0 = buscarManejoLoteOrdem(["implantacao", "ressinc"], lote.id, ordem);
    const retirada = buscarManejoLoteOrdem(["retirada"], lote.id, ordem);
    const insem = buscarManejoLoteOrdem(["inseminacao"], lote.id, ordem);
    const diag = buscarManejoLoteOrdem(["diagnostico"], lote.id, ordem);
    const detalheInsem = insem?.detalhes?.find((d) => d.brinco === brinco) || null;
    const detalheDiag = diag?.detalhes?.find((d) => d.brinco === brinco) || null;
    const semenInsumo = detalheInsem ? insumos.find((i) => i.id === detalheInsem.semenId) : null;

    return [
      d0 ? paraData(d0.data) : "—",
      detalheInsem && insem ? paraData(insem.data) : "—",
      detalheDiag && diag ? paraData(diag.data) : "—",
      d0?.tipoManejo || "—",
      d0?.protocolo || "—",
      d0 ? nomeInsumo(d0.implanteId) : "—",
      d0 ? `${nomeInsumo(d0.benzoatoId)} (${d0.doseBenzoato} mL)` : "—",
      d0 ? `${nomeInsumo(d0.prostaglandinaId)} (${d0.doseProstaglandina} mL)` : "—",
      d0 ? resumoMedicamentos(d0.medicamentos, insumos) : "—",
      retirada ? `${nomeInsumo(retirada.prostaglandinaId)} (${retirada.doseProstaglandina} mL)` : "—",
      retirada ? `${nomeInsumo(retirada.cipionatoId)} (${retirada.doseCipionato} mL)` : "—",
      retirada ? `${nomeInsumo(retirada.ecgHcgId)} (${retirada.doseEcgHcg} mL)` : "—",
      semenInsumo?.touro || "—",
      semenInsumo?.partida ? paraData(semenInsumo.partida) : "—",
      detalheInsem?.ecc || "—",
      detalheInsem?.peso || "—",
      detalheInsem?.observacoes || "—",
      insem ? resumoMedicamentos(insem.medicamentos, insumos) : "—",
      detalheDiag?.resultado || "—",
    ];
  };

  const exportarPorAnimal = () => {
    const largura = SUBCOLUNAS_ORDEM.length; // 19
    const totalColunas = COLUNAS_FIXAS.length + largura * ORDENS_IATF.length; // 4 + 57 = 61

    const linha1 = new Array(totalColunas).fill("");
    const linha2 = new Array(totalColunas).fill("");
    COLUNAS_FIXAS.forEach((c, i) => { linha1[i] = c; });
    ORDENS_IATF.forEach((ordem, g) => {
      const inicio = COLUNAS_FIXAS.length + g * largura;
      linha1[inicio] = ordem;
      SUBCOLUNAS_ORDEM.forEach((c, i) => { linha2[inicio + i] = c; });
    });

    const linhasDados = [];
    lotes.forEach((lote) => {
      (lote.animais || []).forEach((brinco) => {
        const linha = [brinco, lote.categoria || "—", lote.nome, lote.mesParicao || "—"];
        ORDENS_IATF.forEach((ordem) => { linha.push(...dadosDoBloco(lote, brinco, ordem)); });
        linhasDados.push(linha);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet([linha1, linha2, ...linhasDados]);

    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
    ];
    ORDENS_IATF.forEach((_, g) => {
      const inicio = COLUNAS_FIXAS.length + g * largura;
      merges.push({ s: { r: 0, c: inicio }, e: { r: 0, c: inicio + largura - 1 } });
    });
    ws["!merges"] = merges;
    ws["!cols"] = new Array(totalColunas).fill({ wch: 16 });

    baixarPlanilha("Animais", ws, `visaorepro_animais_${sufixoArquivo()}.xlsx`);
  };

  const exportarPorLote = () => {
    const linhas = lotes.map((lote) => {
      const d0 = buscarUltimo("implantacao", (m) => m.loteId === lote.id) || buscarUltimo("ressinc", (m) => m.loteId === lote.id);
      const retirada = buscarUltimo("retirada", (m) => m.loteId === lote.id);
      const insem = buscarUltimo("inseminacao", (m) => m.loteId === lote.id);
      const diag = buscarUltimo("diagnostico", (m) => m.loteId === lote.id);
      const prenhas = diag ? diag.detalhes.filter((d) => d.resultado === "Prenha").length : null;
      const avaliadas = diag ? diag.detalhes.length : null;
      const taxaPrenhez = prenhas != null && avaliadas > 0 ? `${Math.round((prenhas / avaliadas) * 100)}%` : "";

      return {
        "Lote": lote.nome,
        "Retiro": nomeRetiro(lote.retiroId),
        "Categoria": lote.categoria || "",
        "Nº de animais": lote.animais?.length ?? (lote.numeroAnimais ?? ""),
        "Ordem atual": lote.ordem || "",
        "Mês de parição": lote.mesParicao || "",
        "Data do D0 mais recente": d0 ? fmtDate(d0.data) : "",
        "Número de manejos (D0)": d0?.tipoManejo || "",
        "Protocolo (D0)": d0?.protocolo || "",
        "Data da Retirada mais recente": retirada ? fmtDate(retirada.data) : "",
        "Data da Inseminação mais recente": insem ? fmtDate(insem.data) : "",
        "Data do Diagnóstico mais recente": diag ? fmtDate(diag.data) : "",
        "Prenhas": prenhas ?? "",
        "Avaliadas": avaliadas ?? "",
        "Taxa de prenhez": taxaPrenhez,
      };
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    baixarPlanilha("Lotes", ws, `visaorepro_lotes_${sufixoArquivo()}.xlsx`);
  };

  const totalAnimais = lotes.reduce((s, l) => s + (l.animais?.length || 0), 0);

  return (
    <div>
      <SectionTitle icon={FileDown} title="Exportações" subtitle="Gere planilhas Excel com a fazenda e a safra selecionadas no menu lateral." />
      <FazendaAtivaBanner fazendaAtiva={fazendaAtiva} />
      {!fazendaAtiva ? (
        <EmptyState text="Selecione uma fazenda ativa para exportar planilhas." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#232520", marginBottom: 6 }}>Exportação por Animal</div>
            <p style={{ fontSize: 12.5, color: "#6B685E", margin: "0 0 14px" }}>
              Uma planilha com um animal por linha ({totalAnimais} animal(is) na fazenda/safra atual): identificação, categoria, lote e mês de parição, seguidos de um bloco completo de dados (D0, Retirada, Inseminação e Diagnóstico) para cada ordem de IATF (1º, 2º e 3º) em que o animal passou.
            </p>
            <BtnPrimary onClick={exportarPorAnimal} disabled={totalAnimais === 0}><FileDown size={15} /> Exportar por Animal (.xlsx)</BtnPrimary>
          </div>
          <div style={cardStyle}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#232520", marginBottom: 6 }}>Exportação por Lote</div>
            <p style={{ fontSize: 12.5, color: "#6B685E", margin: "0 0 14px" }}>
              Uma planilha com um lote por linha ({lotes.length} lote(s) na fazenda/safra atual), cada informação numa coluna: retiro, categoria, ordem, datas dos manejos e taxa de prenhez.
            </p>
            <BtnPrimary onClick={exportarPorLote} disabled={lotes.length === 0}><FileDown size={15} /> Exportar por Lote (.xlsx)</BtnPrimary>
          </div>
        </div>
      )}
    </div>
  );
}
