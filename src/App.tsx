import { LocalityDistribution } from "./LocalityDistribution";
import { buildLocalities, distributionValid, localityKey } from "./localities";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  ClipboardList,
  MapPinned,
  Users,
  ChartNoAxesCombined,
  ShieldCheck,
  SlidersHorizontal,
  Menu,
  Search,
  Bell,
  ChevronDown,
  ArrowUpRight,
  Wifi,
  WifiOff,
  CloudUpload,
  MapPin,
  Route,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Plus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  PhoneCall,
  Building2,
  Database,
  Settings,
  UserRoundCheck,
  Map,
  Maximize2,
  Layers3,
  Pencil,
  GripVertical,
  Copy,
  Ban,
  Trash2,
  Lock,
  Printer,
  FileSpreadsheet,
  BarChart3,
  FileText,
  LogOut,
} from "lucide-react";
import streetsRaw from "../dados_entrada/ruas_bonito_geocodificadas.csv?raw";
import streetCoordinates from "./data/streetCoordinates.json";
import { supabase } from "./lib/supabase";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Polyline,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";
import "./territory-form.css";
import "./candidate-form.css";
import "./question-editor.css";

const nav = [
  ["Visão geral", LayoutDashboard],
  ["Pesquisas", ClipboardList],
  ["Banco de perguntas", FileText],
  ["Território & cotas", MapPinned],
  ["Mapa de cobertura", Map],
  ["Equipe & rotas", Users],
  ["Relatórios", ChartNoAxesCombined],
  ["Permissões", UserRoundCheck],
] as const;

function Stat({
  label,
  value,
  note,
  tone = "dark",
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <article className={"stat " + tone}>
      <div className="statTop">
        <span>{label}</span>
        <ArrowUpRight size={18} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Ring({ value }: { value: number }) {
  return (
    <div
      className="ring"
      style={{
        background: `conic-gradient(#c79a35 ${value * 3.6}deg,#eceef1 0)`,
      }}
    >
      <div>
        {value}
        <small>%</small>
      </div>
    </div>
  );
}
function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i],
      next = input[i + 1];
    if (c === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] || "").trim()])),
  );
}
const localityRows = parseCsv(streetsRaw).map((r, i) => ({
    id: i + 1,
    name: r["LOGRADOURO/NOME"],
    cep: r.CEP,
    district: r["DISTRITO/POVOADO"],
    neighborhood: r.BAIRRO,
    development: r.LOTEAMENTO,
    latitude: r.LATITUDE ? Number(r.LATITUDE) : null,
    longitude: r.LONGITUDE ? Number(r.LONGITUDE) : null,
  }));
const streets = localityRows.filter((x) => x.name);
const localityOptions = buildLocalities(localityRows);
const titleCase = (value: string) =>
  value.toLocaleLowerCase("pt-BR").replace(/(^|\s)\S/g, (letter) =>
    letter.toLocaleUpperCase("pt-BR"),
  );
const formatDateBR = (value?: string) => {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
};
const districtLabel = (district: string) => {
  if (district === "BONITO") return "Sede de Bonito";
  if (district === "ALTO BONITO") return "Distrito de Alto Bonito";
  if (district === "BENTIVI") return "Distrito de Bentivi";
  return `Povoado de ${titleCase(district)}`;
};
const sameLocality = (a: string, b: string) =>
  (a || "").trim().toLocaleUpperCase("pt-BR") ===
  (b || "").trim().toLocaleUpperCase("pt-BR");
// Calculado uma única vez ao carregar o app — "hoje" não muda durante a
// sessão, então recalcular a formatação (Intl) a cada render do Dashboard
// era trabalho redundante.
const todayLabel = new Date()
  .toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })
  .toUpperCase();
const slugifyLogin = (name: string) =>
  name
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(".") || "agente";
const generateAgentPassword = () =>
  Math.random().toString(36).slice(-6);
const defaultCargos = [
  "Presidente",
  "Governador",
  "Senador",
  "Deputado Federal",
  "Deputado Estadual",
  "Prefeito",
  "Vice-prefeito",
  "Vereador",
  "Pré-candidato",
  "Pré-candidata",
  "Secretário",
  "Secretária",
  "Coordenador",
  "Coordenadora",
];
const downloadCsv = (
  filename: string,
  headers: string[],
  rows: (string | number)[][],
) => {
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
const areaMacro = (area: string) => localityOptions.find((option) => option.key === area)?.section || "Zona Rural";

export function App() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("pulso-nav") === "1",
  );
  const [mobile, setMobile] = useState(false);
  const [page, setPage] = useState("Visão geral");
  const [agentMode, setAgentMode] = useState(false);
  const [entryChoice, setEntryChoice] = useState<"admin" | "agent" | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("pulso-supabase-admin-token") || "");
  const [adminLogin, setAdminLogin] = useState({ username: "", password: "" });
  useEffect(() => {
    localStorage.setItem("pulso-nav", collapsed ? "1" : "0");
  }, [collapsed]);
  useEffect(() => {
    const a = () => setOnline(true),
      b = () => setOnline(false);
    addEventListener("online", a);
    addEventListener("offline", b);
    navigator.serviceWorker
      ?.getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
    caches
      ?.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pulso-"))
            .map((key) => caches.delete(key)),
        ),
      );
    return () => {
      removeEventListener("online", a);
      removeEventListener("offline", b);
    };
  }, []);
  const act = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2500);
  };
  const loginAdmin = async () => {
    const { data, error } = await supabase.rpc("pulso_admin_login", { p_username: adminLogin.username, p_password: adminLogin.password });
    if (error || !data?.token) return act("Usuário ou senha inválidos");
    localStorage.setItem("pulso-supabase-admin-token", data.token);
    setAdminToken(data.token);
  };
  const logoutAdmin = () => {
    localStorage.removeItem("pulso-supabase-admin-token");
    setAdminToken("");
  };
  if (agentMode)
    return (
      <AgentApp back={() => setAgentMode(false)} online={online} act={act} />
    );
  if (!adminToken && entryChoice === "agent")
    return (
      <AgentApp back={() => setEntryChoice(null)} online={online} act={act} />
    );
  if (!adminToken && entryChoice !== "admin")
    return (
      <div className="adminLogin">
        <div className="adminLoginCard">
          <div className="mark">P</div>
          <p className="eyebrow">ACESSO</p>
          <h1>Como você quer entrar?</h1>
          <p>Escolha o tipo de acesso ao Pulso.</p>
          <div className="entryChoice">
            <button className="startBtn" onClick={() => setEntryChoice("admin")}>
              <ShieldCheck /> Acesso do administrador
            </button>
            <button
              className="startBtnOutline"
              onClick={() => setEntryChoice("agent")}
            >
              <UserRoundCheck /> Acesso do agente da pesquisa
            </button>
          </div>
        </div>
      </div>
    );
  if (!adminToken) return <div className="adminLogin"><div className="adminLoginCard"><div className="mark">P</div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>Entrar no Pulso</h1><label>Usuário<input value={adminLogin.username} onChange={e=>setAdminLogin({...adminLogin,username:e.target.value})}/></label><label>Senha<input type="password" value={adminLogin.password} onChange={e=>setAdminLogin({...adminLogin,password:e.target.value})}/></label><button className="primary" onClick={loginAdmin}>Entrar</button><button className="secondary" onClick={()=>setEntryChoice(null)}>← Voltar</button>{toast&&<div className="toast">{toast}</div>}</div></div>;
  return (
    <div className="app">
      <aside
        className={
          (collapsed ? "collapsed " : "") + (mobile ? "mobileOpen" : "")
        }
      >
        <div className="brand">
          <div className="mark">P</div>
          <div className="brandText">
            <b>PULSO</b>
            <span>inteligência de campo</span>
          </div>
          <button
            className="icon collapse"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <nav>
          {nav.map(([n, I]) => (
            <button
              key={n}
              className={page === n ? "active" : ""}
              onClick={() => {
                setPage(n);
                setMobile(false);
              }}
            >
              <I />
              <span>{n}</span>
            </button>
          ))}
        </nav>
        <div className="sideFoot">
          <button onClick={() => setAgentMode(true)}>
            <PhoneCall />
            <span>App do agente</span>
          </button>
          <button>
            <Settings />
            <span>Configurações</span>
          </button>
          <div className="profile">
            <div>JC</div>
            <span>
              <b>Josielton Cavalcante</b>
              <small>Administrador geral</small>
            </span>
          </div>
          <button className="logoutBtn" onClick={logoutAdmin}>
            <LogOut />
            <span>Sair</span>
          </button>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <main>
        <header>
          <button className="menuBtn" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <div className="city">
            <small>MUNICÍPIO ATIVO</small>
            <button>
              Bonito, Pernambuco <ChevronDown size={15} />
            </button>
          </div>
          <div className="headActions">
            <label>
              <Search />
              <input placeholder="Buscar no sistema..." />
            </label>
            <button className="icon">
              <Bell />
            </button>
            <button className="fieldApp" onClick={() => setAgentMode(true)}>
              <PhoneCall /> App do agente
            </button>
          </div>
        </header>
        {page === "Visão geral" ? (
          <Dashboard online={online} act={act} adminToken={adminToken} />
        ) : (
          <Module page={page} act={act} adminToken={adminToken} />
        )}
      </main>
      {toast && (
        <div className="toast">
          <CheckCircle2 />
          {toast}
        </div>
      )}
    </div>
  );
}

function Dashboard({
  online,
  act,
  adminToken,
}: {
  online: boolean;
  act: (x: string) => void;
  adminToken: string;
}) {
  const [dashboardResearches, setDashboardResearches] = useState<Research[] | null>(null);
  useEffect(() => {
    supabase.rpc("pulso_admin_get_state", { p_token: adminToken }).then(({ data }) => {
      setDashboardResearches(Array.isArray(data?.researches) ? data.researches : []);
    });
  }, [adminToken]);

  if (dashboardResearches && dashboardResearches.length === 0) {
    return (
      <div className="content">
        <div className="welcome">
          <div><p className="eyebrow">PAINEL INICIAL</p><h1>Bom dia, Josielton.</h1><p>Nenhuma pesquisa cadastrada no momento.</p></div>
          <div className="actions"><button className="primary" onClick={() => act("Abra a aba Pesquisas para criar uma nova rodada")}><Plus /> Nova rodada</button></div>
        </div>
        <section className="activeRound"><div><span className="live"><i /> SEM PESQUISA ATIVA</span><h2>Nenhuma pesquisa cadastrada</h2><p>Crie uma nova rodada para iniciar a coleta.</p></div></section>
        <div className="stats">
          <Stat label="Entrevistas concluídas" value="0" note="Nenhuma resposta registrada" />
          <Stat label="Agentes em campo" value="0" note="Nenhum agente ativo" tone="gold" />
          <Stat label="Pendentes de envio" value="0" note="Nenhum envio pendente" tone="light" />
          <Stat label="Alertas de auditoria" value="0" note="Nenhum alerta" tone="warn" />
        </div>
        <section className="panel progressPanel"><div className="panelTitle"><div><span className="kicker">PROGRESSO GERAL</span><h3>Cobertura por localidade</h3></div></div><div className="progressBody"><Ring value={0} /><p>Nenhuma cota configurada.</p></div></section>
      </div>
    );
  }
  // Só considera uma pesquisa "Ativa" de verdade — cair para a primeira do
  // array (independente do status) fazia o dashboard destacar em posição de
  // maior evidência os números de uma pesquisa já cancelada/finalizada.
  const activeResearch =
    dashboardResearches?.find((r) => r.status === "Ativa") || null;
  const dashCompleted =
    activeResearch?.interviews?.length ?? activeResearch?.responses ?? 0;
  const dashTarget = activeResearch?.target || 0;
  const dashPct = dashTarget
    ? Math.round((dashCompleted / dashTarget) * 100)
    : 0;
  const dashAgents = activeResearch?.agents || [];
  const dashActiveAgents = dashAgents.filter((a) => !a.blocked);
  const dashInterviews = activeResearch?.interviews || [];
  const dashQuotas = Object.entries(activeResearch?.quotas || {});
  // Contagem por localidade em uma única passada (O(quotas + entrevistas)),
  // em vez de re-filtrar dashInterviews inteira para cada localidade —
  // O(quotas × entrevistas) do código anterior.
  const normalizeLocality = (v: string) => (v || "").trim().toLocaleUpperCase("pt-BR");
  const areaByNormalized: Record<string, string> = {};
  for (const [area] of dashQuotas) areaByNormalized[normalizeLocality(area)] = area;
  const dashDoneByLocality: Record<string, number> = {};
  for (const iv of dashInterviews) {
    const area = areaByNormalized[normalizeLocality(iv.locality)];
    if (area) dashDoneByLocality[area] = (dashDoneByLocality[area] || 0) + 1;
  }

  return (
    <div className="content">
      <div className="welcome">
        <div>
          <p className="eyebrow">{todayLabel}</p>
          <h1>Bom dia, Josielton.</h1>
          <p>Acompanhe a operação da pesquisa em tempo real.</p>
        </div>
        <div className="actions">
          <button
            className="secondary"
            onClick={() => act("Relatório preparado para exportação")}
          >
            <Download /> Exportar parcial
          </button>
          <button
            className="primary"
            onClick={() => act("Abra a aba Pesquisas para criar uma nova rodada")}
          >
            <Plus /> Nova rodada
          </button>
        </div>
      </div>
      {activeResearch && (
        <section className="activeRound">
          <div>
            <span className="live">
              <i />{" "}
              {activeResearch.status === "Ativa"
                ? "COLETA EM ANDAMENTO"
                : activeResearch.status.toUpperCase()}
            </span>
            <h2>
              {activeResearch.title} · {activeResearch.number}
            </h2>
            <p>
              {activeResearch.city || "—"} ·{" "}
              {activeResearch.start ? formatDateBR(activeResearch.start) : "—"}{" "}
              — {activeResearch.end ? formatDateBR(activeResearch.end) : "—"}
            </p>
          </div>
        </section>
      )}
      <div className="stats">
        <Stat
          label="Entrevistas concluídas"
          value={String(dashCompleted)}
          note={
            dashTarget
              ? `de ${dashTarget} previstas · ${dashPct}%`
              : "Amostra ainda não definida"
          }
        />
        <Stat
          label="Agentes em campo"
          value={String(dashActiveAgents.length)}
          note={
            dashAgents.length
              ? `de ${dashAgents.length} agentes cadastrados`
              : "Nenhum agente cadastrado"
          }
          tone="gold"
        />
        <Stat
          label="Localidades cobertas"
          value={String(dashQuotas.length)}
          note={
            dashQuotas.length
              ? "com cota definida"
              : "Nenhuma localidade configurada"
          }
          tone="light"
        />
        <Stat
          label="Perguntas no questionário"
          value={String(activeResearch?.questions?.length || 0)}
          note="cadastradas nesta pesquisa"
          tone="warn"
        />
      </div>
      <div className="grid2">
        <section className="panel progressPanel">
          <div className="panelTitle">
            <div>
              <span className="kicker">PROGRESSO GERAL</span>
              <h3>Cobertura por localidade</h3>
            </div>
          </div>
          <div className="progressBody">
            <Ring value={dashPct} />
            {dashQuotas.length ? (
              <div className="bars">
                {dashQuotas.map(([area, quota]) => {
                  const done = dashDoneByLocality[area] || 0;
                  return (
                    <div className="bar" key={area}>
                      <div>
                        <span>{area}</span>
                        <b>
                          {done} <small>/ {quota}</small>
                        </b>
                      </div>
                      <i>
                        <em
                          style={{
                            width: `${quota ? Math.min(100, (done / Number(quota)) * 100) : 0}%`,
                          }}
                        />
                      </i>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>Nenhuma cota configurada.</p>
            )}
          </div>
        </section>
        <section className="panel mapPanel">
          <div className="panelTitle">
            <div>
              <span className="kicker">OPERAÇÃO</span>
              <h3>Situação dos agentes</h3>
            </div>
            <span className={"connection " + (online ? "" : "off")}>
              {online ? <Wifi /> : <WifiOff />}
              {online ? "Online" : "Offline"}
            </span>
          </div>
          {dashAgents.length ? (
            <div className="table">
              {dashAgents.map((a) => (
                <div className="tr" key={a.id}>
                  <span className="person">
                    <i>
                      {a.name
                        .split(" ")
                        .map((x) => x[0])
                        .join("")
                        .slice(0, 2)}
                    </i>
                    <b>{a.name}</b>
                  </span>
                  <strong>{a.completed || 0} entrevistas</strong>
                  <span className={"badge " + (a.blocked ? "gray" : "green")}>
                    {a.blocked ? "Bloqueado" : "Ativo"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="agentHint">Nenhum agente cadastrado ainda.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Module({ page, act, adminToken }: { page: string; act: (x: string) => void; adminToken: string }) {
  if (page === "Pesquisas") return <Researches act={act} adminToken={adminToken} />;
  if (page === "Banco de perguntas") return <QuestionBank adminToken={adminToken} act={act} />;
  if (page === "Território & cotas") return <Territory act={act} adminToken={adminToken} />;
  if (page === "Mapa de cobertura") return <CoverageMap />;
  const Icon = nav.find((x) => x[0] === page)?.[1] || Building2;
  const cards: Record<string, string[]> = {
    "Equipe & rotas": [
      "10 entrevistadores",
      "Gerador de rotas",
      "Mapa operacional",
      "Códigos de acesso",
    ],
    Auditoria: [
      "Check-ins fora do raio",
      "Callback telefônico",
      "Entrevistas rápidas",
      "Trilha de alterações",
    ],
    Relatórios: [
      "Tabela por localidade",
      "Gráficos",
      "Comparar rodadas",
      "Trajeto e cobertura",
      "Check-ins em PDF",
      "Respostas abertas",
    ],
    Simulações: [
      "Histórico eleitoral",
      "Cenário conservador",
      "Cenário realista",
      "Cenário otimista",
      "Cenário show",
    ],
    Cadastros: [
      "Institutos",
      "Contratantes",
      "Municípios",
      "Cargos e classificações",
    ],
    Permissões: [
      "Administradores",
      "Gerentes",
      "Clientes",
      "Acesso a dados sensíveis",
    ],
  };
  return (
    <div className="content module">
      <div className="moduleHero">
        <div className="bigIcon">
          <Icon />
        </div>
        <div>
          <p className="eyebrow">GESTÃO DA PESQUISA</p>
          <h1>{page}</h1>
          <p>
            Estrutura preparada para configuração e conexão com dados reais.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => act("Novo registro criado como rascunho")}
        >
          <Plus /> Novo registro
        </button>
      </div>
      <div className="moduleGrid">
        {(cards[page] || []).map((x, i) => (
          <article className="moduleCard" key={x}>
            <span>0{i + 1}</span>
            <h3>{x}</h3>
            <p>
              {i % 2
                ? "Configure regras, vínculos e parâmetros operacionais."
                : "Acompanhe indicadores e gerencie os registros deste módulo."}
            </p>
            <button
              onClick={() => act(`${x}: módulo disponível para configuração`)}
            >
              Abrir módulo <ArrowUpRight />
            </button>
          </article>
        ))}
      </div>
      <div className="emptyImport">
        <CloudUpload />
        <div>
          <h3>Pronto para receber os dados oficiais</h3>
          <p>
            Quando os arquivos forem adicionados, o importador validará
            coordenadas e associações sem preencher lacunas automaticamente.
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => act("Validador de importação aberto")}
        >
          Validar arquivo
        </button>
      </div>
    </div>
  );
}

function Territory({ act, adminToken }: { act: (message: string) => void; adminToken: string }) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("Todos");
  const [territoryStreets, setTerritoryStreets] = useState(streets);
  const [localities, setLocalities] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [registerType, setRegisterType] = useState<"logradouro" | "localidade">("logradouro");
  const [streetDraft, setStreetDraft] = useState({ name: "", cep: "", district: "", neighborhood: "", development: "", latitude: "", longitude: "" });
  const [localityDraft, setLocalityDraft] = useState({ name: "", type: "Bairro" });
  useEffect(() => {
    supabase.from("pulso_ruas").select("id,nome,cep,distrito,bairro,loteamento,latitude,longitude").order("id").then(({ data }) => {
      if (data) setTerritoryStreets(data.map((row) => ({ id: Number(row.id), name: row.nome, cep: row.cep || "", district: row.distrito || "", neighborhood: row.bairro || "", development: row.loteamento || "", latitude: row.latitude, longitude: row.longitude })));
    });
    supabase.from("pulso_localidades").select("id,nome,tipo").order("nome").then(({ data }) => {
      if (data) setLocalities(data.map((row) => ({ id: Number(row.id), name: row.nome, type: row.tipo })));
    });
  }, []);
  const addTerritory = async () => {
    if (registerType === "logradouro") {
      if (!streetDraft.name.trim()) return act("Informe o nome do logradouro");
      const { data, error } = await supabase.rpc("pulso_admin_add_street", {
        p_token: adminToken, p_nome: streetDraft.name, p_cep: streetDraft.cep,
        p_distrito: streetDraft.district, p_bairro: streetDraft.neighborhood,
        p_loteamento: streetDraft.development,
        p_latitude: streetDraft.latitude ? Number(streetDraft.latitude) : null,
        p_longitude: streetDraft.longitude ? Number(streetDraft.longitude) : null,
      });
      if (error || !data) return act("Não foi possível cadastrar o logradouro. Execute a nova atualização do banco.");
      const row = Array.isArray(data) ? data[0] : data;
      setTerritoryStreets((current) => [...current, { id: Number(row.id), name: row.nome, cep: row.cep || "", district: row.distrito || "", neighborhood: row.bairro || "", development: row.loteamento || "", latitude: row.latitude, longitude: row.longitude }]);
      setStreetDraft({ name: "", cep: "", district: "", neighborhood: "", development: "", latitude: "", longitude: "" });
      act("Logradouro cadastrado");
    } else {
      if (!localityDraft.name.trim()) return act("Informe o nome da localidade");
      const { data, error } = await supabase.rpc("pulso_admin_add_locality", { p_token: adminToken, p_nome: localityDraft.name, p_tipo: localityDraft.type });
      if (error || !data) return act("Não foi possível cadastrar a localidade. Execute a nova atualização do banco.");
      const row = Array.isArray(data) ? data[0] : data;
      setLocalities((current) => [...current, { id: Number(row.id), name: row.nome, type: row.tipo }]);
      setLocalityDraft({ name: "", type: "Bairro" });
      act("Localidade cadastrada");
    }
  };
  const deleteStreet = async (street: (typeof territoryStreets)[number]) => {
    if (!window.confirm(`Excluir o logradouro “${street.name}”? Esta ação não pode ser desfeita.`)) return;
    const { data, error } = await supabase.rpc("pulso_admin_delete_street", { p_token: adminToken, p_id: street.id });
    if (error || !data?.ok) return act("Não foi possível excluir o logradouro. Execute a nova atualização do banco.");
    setTerritoryStreets((current) => current.filter((item) => item.id !== street.id));
    act("Logradouro excluído");
  };
  const areas = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set([...territoryStreets.map((s) => s.neighborhood), ...localities.map((item) => item.name)].filter(Boolean)),
      ).sort(),
    ],
    [territoryStreets, localities],
  );
  const filtered = territoryStreets.filter(
    (s) =>
      (area === "Todos" || s.neighborhood === area) &&
      `${s.name} ${s.cep} ${s.neighborhood} ${s.district} ${s.latitude ?? ""} ${s.longitude ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")),
  );
  return (
    <div className="content territory">
      <div className="moduleHero">
        <div className="bigIcon">
          <MapPinned />
        </div>
        <div>
          <p className="eyebrow">BASE TERRITORIAL OFICIAL</p>
          <h1>Ruas de Bonito</h1>
          <p>Logradouros atuais importados da planilha publicada.</p>
        </div>
        <div className="territoryCount">
          <b>{territoryStreets.length}</b>
          <span>logradouros</span>
        </div>
      </div>
      <div className="territoryStats">
        <article>
          <MapPin />
          <span>
            <b>{territoryStreets.length}</b> nomes atuais
          </span>
        </article>
        <article>
          <Building2 />
          <span>
            <b>{areas.length - 1}</b> bairros
          </span>
        </article>
        <article>
          <Map />
          <span>
            <b>{new Set(territoryStreets.map((s) => s.district).filter(Boolean)).size}</b>{" "}
            distritos/povoados
          </span>
        </article>
        <article>
          <ShieldCheck />
          <span>
            <b>0</b> nomes antigos importados
          </span>
        </article>
      </div>
      <section className="panel territoryRegister">
        <div className="sectionTitle"><div><h3>Adicionar ao território</h3><p>Cadastre um novo logradouro ou uma localidade de Bonito.</p></div></div>
        <div className="territoryType"><button className={registerType === "logradouro" ? "primary" : "secondary"} onClick={() => setRegisterType("logradouro")}>Logradouro</button><button className={registerType === "localidade" ? "primary" : "secondary"} onClick={() => setRegisterType("localidade")}>Localidade</button></div>
        {registerType === "logradouro" ? <div className="territoryRegisterGrid">
          <label>Nome do logradouro<input value={streetDraft.name} onChange={(e) => setStreetDraft({ ...streetDraft, name: e.target.value })} placeholder="Ex.: Rua Nova" /></label>
          <label>CEP<input value={streetDraft.cep} onChange={(e) => setStreetDraft({ ...streetDraft, cep: e.target.value })} placeholder="00000-000" /></label>
          <label>Bairro<input value={streetDraft.neighborhood} onChange={(e) => setStreetDraft({ ...streetDraft, neighborhood: e.target.value })} /></label>
          <label>Distrito / povoado<input value={streetDraft.district} onChange={(e) => setStreetDraft({ ...streetDraft, district: e.target.value })} /></label>
          <label>Loteamento<input value={streetDraft.development} onChange={(e) => setStreetDraft({ ...streetDraft, development: e.target.value })} /></label>
          <label>Latitude<input type="number" step="any" value={streetDraft.latitude} onChange={(e) => setStreetDraft({ ...streetDraft, latitude: e.target.value })} /></label>
          <label>Longitude<input type="number" step="any" value={streetDraft.longitude} onChange={(e) => setStreetDraft({ ...streetDraft, longitude: e.target.value })} /></label>
        </div> : <div className="territoryRegisterGrid localityFields">
          <label>Nome da localidade<input value={localityDraft.name} onChange={(e) => setLocalityDraft({ ...localityDraft, name: e.target.value })} placeholder="Ex.: Novo bairro" /></label>
          <label>Tipo<select value={localityDraft.type} onChange={(e) => setLocalityDraft({ ...localityDraft, type: e.target.value })}><option>Bairro</option><option>Distrito</option><option>Povoado</option><option>Zona rural</option><option>Outra</option></select></label>
        </div>}
        <button className="primary territorySave" onClick={addTerritory}><Plus /> Salvar cadastro</button>
      </section>
      <section className="panel streetPanel">
        <div className="streetTools">
          <label>
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar rua, CEP ou bairro..."
            />
          </label>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            {areas.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <span>{filtered.length} resultados</span>
        </div>
        <div className="streetTable">
          <div className="streetRow streetHead">
            <span>LOGRADOURO ATUAL</span>
            <span>BAIRRO</span>
            <span>DISTRITO / POVOADO</span>
            <span>CEP</span>
            <span>LATITUDE</span>
            <span>LONGITUDE</span>
            <span>AÇÕES</span>
          </div>
          {filtered.slice(0, 30).map((s) => (
            <div className="streetRow" key={s.id}>
              <span>
                <MapPin />
                <b>{s.name}</b>
                {s.development && <small>{s.development}</small>}
              </span>
              <span>{s.neighborhood || "Não informado"}</span>
              <span>{s.district || "Não informado"}</span>
              <span>{s.cep || "Não informado"}</span>
              <span>{s.latitude?.toFixed(7) || "Não disponível"}</span>
              <span>{s.longitude?.toFixed(7) || "Não disponível"}</span>
              <span><button className="streetDelete" onClick={() => void deleteStreet(s)} title="Excluir logradouro"><Trash2 /></button></span>
            </div>
          ))}
        </div>
        {filtered.length > 30 && (
          <div className="tableNote">
            Exibindo os primeiros 30 de {filtered.length} resultados. Use a
            busca ou o filtro para localizar uma rua.
          </div>
        )}
      </section>
      <div className="disclaimer good">
        <CheckCircle2 />
        <div>
          <b>Importação concluída</b>
          <p>
            A coluna “NOMES ANTIGOS” foi ignorada. Nenhum nome histórico aparece
            nesta base.
          </p>
        </div>
      </div>
    </div>
  );
}

type Interview = {
  id: string;
  agentId: string;
  agentName: string;
  locality: string;
  answers: Record<string, string | string[]>;
  submittedAt: string;
};
type Research = {
  id: number;
  number: string;
  title: string;
  type: string;
  status: "Ativa" | "Finalizada" | "Cancelada";
  start: string;
  end: string;
  responses: number;
  questions: string[];
  variables?: Record<string, Record<string, string>>;
  client?: string;
  city?: string;
  target?: number;
  questionTarget?: number;
  quotas?: Record<string, number>;
  areaWeights?: Record<string, number>;
  neighborhoodGroups?: Array<{ name: string; areas: string[]; macro: string }>;
  candidates?: Array<{ id: string; office: string; name: string; supporter: string }>;
  agents?: Array<{
    id: string;
    name: string;
    phone: string;
    areas: string[];
    login?: string;
    password?: string;
    blocked?: boolean;
    completed?: number;
    updatedAt?: string;
    visitedStreets?: number[];
  }>;
  interviews?: Interview[];
};
type Question = {
  id: string;
  block: string;
  text: string;
  type: string;
  vars: string[];
  options?: string[];
  eliminatory?: boolean;
  identification?: boolean;
  city?: string;
  mandatory?: boolean;
};
const closedQuestionTypes = ["Escolha única", "Múltipla escolha", "Escala"];
const variableLabels: Record<string, string> = {
  candidato: "Nome do candidato ou pré-candidato",
  apoiador: "Nome do apoiador ou liderança",
  palavra_chave: "Palavra-chave ou expressão",
};
const resolveQuestion = (
  text: string,
  values: Record<string, string> = {},
) =>
  Object.entries(values).reduce(
    (result, [key, value]) =>
      result
        .split(`{{${key}}}`)
        .join(value || `[${variableLabels[key] || key}]`),
    text,
  );

function QuestionBank({ adminToken, act }: { adminToken: string; act: (x: string) => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [researches, setResearches] = useState<Research[]>([]);
  const [draft, setDraft] = useState({ text: "", block: "Geral", type: "Texto aberto", options: ["", ""], eliminatory: false, city: "", mandatory: false });
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [blockFilter, setBlockFilter] = useState("Todos");
  const [cityFilter, setCityFilter] = useState("Todas");
  useEffect(() => { supabase.rpc("pulso_admin_get_state", { p_token: adminToken }).then(({data})=>{ setQuestions(data?.questions || []); setResearches(data?.researches || []); }); }, [adminToken]);
  const persist = async (next: Question[]) => {
    const { error } = await supabase.rpc("pulso_admin_sync_state", { p_token: adminToken, p_researches: researches, p_questions: next });
    if (error) return act("Não foi possível salvar a pergunta");
    setQuestions(next); act("Banco de perguntas atualizado");
  };
  const add = () => {
    const options = closedQuestionTypes.includes(draft.type) ? draft.options.map(x=>x.trim()).filter(Boolean) : undefined;
    if (!draft.text.trim()) return act("Digite o texto da pergunta");
    if (closedQuestionTypes.includes(draft.type) && (!options || options.length < 2)) return act("Informe pelo menos duas opções");
    const question: Question = { id: `Q${Date.now()}`, block: draft.block, text: draft.text.trim(), type: draft.type, vars: [], options, eliminatory: draft.eliminatory, city: draft.city.trim() || undefined, mandatory: draft.mandatory };
    void persist([...questions, question]); setDraft({ text:"", block:"Geral", type:"Texto aberto", options:["",""], eliminatory:false, city: draft.city, mandatory:false });
  };
  const saveEdit = () => {
    if (!editingQuestion) return;
    if (!editingQuestion.text.trim()) return act("O texto da pergunta não pode ficar vazio");
    const options = closedQuestionTypes.includes(editingQuestion.type)
      ? (editingQuestion.options || []).map((o) => o.trim()).filter(Boolean)
      : undefined;
    if (closedQuestionTypes.includes(editingQuestion.type) && (!options || options.length < 2)) return act("Informe pelo menos duas opções");
    void persist(questions.map((q) => (q.id === editingQuestion.id ? { ...editingQuestion, options } : q)));
    setEditingQuestion(null);
  };
  const removeQuestion = (q: Question) => {
    if (!window.confirm(`Excluir a pergunta "${q.text}" do banco?`)) return;
    void persist(questions.filter((x) => x.id !== q.id));
    if (editingQuestion?.id === q.id) setEditingQuestion(null);
  };
  const duplicateQuestion = (q: Question) => {
    const copy: Question = { ...q, id: `Q${Date.now()}`, text: `${q.text} (cópia)` };
    void persist([...questions, copy]);
  };
  const blockOptions = Array.from(new Set(questions.map((q) => q.block))).sort(
    (a, b) => a.localeCompare(b, "pt-BR"),
  );
  const cityOptions = Array.from(
    new Set(questions.map((q) => q.city).filter(Boolean) as string[]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filteredQuestions = questions.filter(
    (q) =>
      (blockFilter === "Todos" || q.block === blockFilter) &&
      (cityFilter === "Todas" || q.city === cityFilter),
  );
  return (
    <div className="content questionBankPage">
      <div className="moduleHero">
        <div className="bigIcon"><FileText /></div>
        <div>
          <p className="eyebrow">QUESTIONÁRIO</p>
          <h1>Banco de perguntas</h1>
          <p>Cadastre as perguntas que poderão ser utilizadas nas pesquisas.</p>
        </div>
        <div className="territoryCount"><b>{questions.length}</b><span>perguntas</span></div>
      </div>
      <section className="panel questionRegister">
        <h3>Nova pergunta</h3>
        <label>
          Texto da pergunta
          <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Digite a pergunta..." />
        </label>
        <div className="questionRegisterGrid">
          <label>
            Bloco
            <select value={draft.block} onChange={(e) => setDraft({ ...draft, block: e.target.value })}>
              <option>Geral</option>
              <option>Triagem</option>
              <option>Percepção</option>
              <option>Gestão</option>
              <option>Eleitoral</option>
              <option>Perfil</option>
              <option>Validação</option>
            </select>
          </label>
          <label>
            Tipo de resposta
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              <option>Texto aberto</option>
              <option>Escolha única</option>
              <option>Múltipla escolha</option>
              <option>Escala</option>
              <option>Número</option>
              <option>Telefone</option><option>Endereço</option>
            </select>
          </label>
          <label>
            Cidade
            <input
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              placeholder="Ex.: Bonito/PE"
            />
          </label>
          <label className="checkLabel">
            <input type="checkbox" checked={draft.eliminatory} onChange={(e) => setDraft({ ...draft, eliminatory: e.target.checked })} />
            Pergunta eliminatória
          </label>
          <label className="checkLabel">
            <input type="checkbox" checked={draft.mandatory} onChange={(e) => setDraft({ ...draft, mandatory: e.target.checked })} />
            Pergunta obrigatória (entra em todas as pesquisas)
          </label>
        </div>
        {closedQuestionTypes.includes(draft.type) && (
          <div className="optionRegister">
            <b>Opções de resposta</b>
            {draft.options.map((option, index) => (
              <div key={index}>
                <input
                  value={option}
                  onChange={(e) => {
                    const options = [...draft.options];
                    options[index] = e.target.value;
                    setDraft({ ...draft, options });
                  }}
                  placeholder={`Opção ${index + 1}`}
                />
                {draft.options.length > 2 && (
                  <button onClick={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}>×</button>
                )}
              </div>
            ))}
            <button className="secondary" onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}>
              <Plus /> Adicionar opção
            </button>
          </div>
        )}
        <button className="primary" onClick={add}>
          <CheckCircle2 /> Salvar pergunta
        </button>
      </section>
      <section className="panel questionList">
        <div className="questionListHead">
          <h3>Perguntas cadastradas</h3>
          {!!questions.length && (
            <div className="questionFilters">
              <label className="blockFilter">
                Filtrar por bloco
                <select
                  value={blockFilter}
                  onChange={(e) => setBlockFilter(e.target.value)}
                >
                  <option>Todos</option>
                  {blockOptions.map((block) => (
                    <option key={block}>{block}</option>
                  ))}
                </select>
              </label>
              <label className="blockFilter">
                Filtrar por cidade
                <select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                >
                  <option>Todas</option>
                  {cityOptions.map((city) => (
                    <option key={city}>{city}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        {!questions.length ? (
          <p className="agentHint">Nenhuma pergunta cadastrada.</p>
        ) : !filteredQuestions.length ? (
          <p className="agentHint">Nenhuma pergunta neste bloco.</p>
        ) : (
          filteredQuestions.map((q) => (
            <Fragment key={q.id}>
              <article>
                <div>
                  <b>{q.text}</b>
                  <span>
                    {q.block} · {q.type}
                    {q.city ? ` · ${q.city}` : ""}
                    {q.eliminatory ? " · Eliminatória" : ""}
                    {q.identification ? " · Identificação" : ""}
                    {q.mandatory ? " · Obrigatória" : ""}
                  </span>
                  {q.options?.length ? <small>{q.options.join(" • ")}</small> : null}
                </div>
                <div className="questionListActions">
                  <button className="icon" title="Editar pergunta" onClick={() => setEditingQuestion({ ...q })}>
                    <Pencil />
                  </button>
                  <button className="icon" title="Duplicar pergunta" onClick={() => duplicateQuestion(q)}>
                    <Copy />
                  </button>
                  <button className="icon" title="Excluir pergunta" onClick={() => removeQuestion(q)}>
                    <Trash2 />
                  </button>
                </div>
              </article>
              {editingQuestion?.id === q.id && (
                <div className="questionEditor">
                  <div>
                    <span>
                      <small>EDITANDO {editingQuestion.id}</small>
                      <b>Alterar pergunta do banco</b>
                    </span>
                    <button onClick={() => setEditingQuestion(null)}>×</button>
                  </div>
                  <label>
                    Texto da pergunta
                    <textarea
                      value={editingQuestion.text}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, text: e.target.value })}
                    />
                  </label>
                  <div className="questionEditFields">
                    <label>
                      Bloco
                      <select
                        value={editingQuestion.block}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, block: e.target.value })}
                      >
                        <option>Geral</option>
                        <option>Triagem</option>
                        <option>Percepção</option>
                        <option>Gestão</option>
                        <option>Eleitoral</option>
                        <option>Perfil</option>
                        <option>Validação</option>
                      </select>
                    </label>
                    <label>
                      Tipo de resposta
                      <select
                        value={editingQuestion.type}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, type: e.target.value })}
                      >
                        <option>Texto aberto</option>
                        <option>Escolha única</option>
                        <option>Múltipla escolha</option>
                        <option>Escala</option>
                        <option>Número</option>
                        <option>Telefone</option><option>Endereço</option>
                      </select>
                    </label>
                    <label>
                      Cidade
                      <input
                        value={editingQuestion.city || ""}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, city: e.target.value })}
                        placeholder="Ex.: Bonito/PE"
                      />
                    </label>
                  </div>
                  <label className="checkLabel">
                    <input
                      type="checkbox"
                      checked={!!editingQuestion.eliminatory}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, eliminatory: e.target.checked })}
                    />
                    Pergunta eliminatória
                  </label>
                  <label className="checkLabel">
                    <input
                      type="checkbox"
                      checked={!!editingQuestion.mandatory}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, mandatory: e.target.checked })}
                    />
                    Pergunta obrigatória (entra em todas as pesquisas)
                  </label>
                  {closedQuestionTypes.includes(editingQuestion.type) && (
                    <div className="optionsEditor">
                      <span>
                        Opções de resposta
                        <small>Usadas pelo agente no Pulso Campo e nas tabelas do relatório de resultado.</small>
                      </span>
                      {(editingQuestion.options || []).map((option, i) => (
                        <div className="optionRow" key={i}>
                          <input
                            value={option}
                            onChange={(e) => {
                              const options = [...(editingQuestion.options || [])];
                              options[i] = e.target.value;
                              setEditingQuestion({ ...editingQuestion, options });
                            }}
                            placeholder={`Opção ${i + 1}`}
                          />
                          <button
                            onClick={() =>
                              setEditingQuestion({
                                ...editingQuestion,
                                options: (editingQuestion.options || []).filter((_, x) => x !== i),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        className="secondary"
                        onClick={() =>
                          setEditingQuestion({
                            ...editingQuestion,
                            options: [...(editingQuestion.options || []), ""],
                          })
                        }
                      >
                        <Plus /> Adicionar opção
                      </button>
                    </div>
                  )}
                  <div className="questionEditActions">
                    <button className="secondary" onClick={() => setEditingQuestion(null)}>
                      Cancelar
                    </button>
                    <button className="primary" onClick={saveEdit}>
                      <CheckCircle2 /> Salvar alterações
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          ))
        )}
      </section>
    </div>
  );
}

function Researches({ act, adminToken }: { act: (x: string) => void; adminToken: string }) {
  const [items, setItems] = useState<Research[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [cargos, setCargos] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("pulso-cargos") || "null") || defaultCargos;
    } catch {
      return defaultCargos;
    }
  });
  const [newCargo, setNewCargo] = useState("");
  const [questionEdit, setQuestionEdit] = useState<Question | null>(null);
  const [draggedQuestion, setDraggedQuestion] = useState<string | null>(null);
  const [draggedResearch, setDraggedResearch] = useState<number | null>(null);
  const [status, setStatus] = useState("Todas");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Research | null>(null);
  const [modalTab, setModalTab] = useState<
    | "config"
    | "questionario"
    | "agentes"
    | "acessos"
    | "acompanhamento"
    | "relatorio"
  >("questionario");
  const [reportView, setReportView] = useState<
    "planilha" | "graficos" | "resultado"
  >("planilha");
  const [reportSheet, setReportSheet] = useState<
    "cotas" | "agentes" | "questionario"
  >("cotas");
  const [letterhead, setLetterhead] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pulso-letterhead") || "null") || {
          name: "",
          cnpj: "",
          address: "",
          phones: "",
          email: "",
        }
      );
    } catch {
      return { name: "", cnpj: "", address: "", phones: "", email: "" };
    }
  });
  const [trackFilterAreas, setTrackFilterAreas] = useState<string[]>([]);
  const [reportChartQuestionIds, setReportChartQuestionIds] = useState<
    string[]
  >([]);
  const [reportChartDimension, setReportChartDimension] = useState<
    "localidade" | "candidato"
  >("localidade");

  const [printRequest, setPrintRequest] = useState<
    { view: "campo"; id: number } | null
  >(null);
  useEffect(() => {
    if (!printRequest) return;
    window.print();
  }, [printRequest]);
  const [draggedEditingQuestion, setDraggedEditingQuestion] = useState<
    string | null
  >(null);
  const [agentDraft, setAgentDraft] = useState({
    name: "",
    phone: "",
    areas: [] as string[],
    areasText: "",
  });
  const [expandedDistricts, setExpandedDistricts] = useState<string[]>([]);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [mapAgentId, setMapAgentId] = useState<string | null>(null);
  const [form, setForm] = useState({
    number: "",
    title: "",
    client: "",
    city: "Bonito/PE",
    type: "Mista",
    start: "",
    end: "",
    target: 0,
    questionTarget: 1,
    quotas: {} as Record<string, number>,
    neighborhoodGroups: [] as Array<{ name: string; areas: string[]; macro: string }>,
    candidates: [] as Array<{ id: string; office: string; name: string; supporter: string }>,
    selected: [] as string[],
    variables: {} as Record<string, Record<string, string>>,
  });
  const [newQ, setNewQ] = useState({
    text: "",
    block: "Geral",
    type: "Escolha única",
  });
  const [questionCityFilter, setQuestionCityFilter] = useState("Todas");

  const [candidateDraft, setCandidateDraft] = useState({ office: "", name: "", supporter: "" });
  const openCreateResearch = () => {
    const year = new Date().getFullYear();
    const highestNumber = items.reduce((highest, item) => {
      const match = /^(\d+)\/(\d{4})$/.exec(item.number.trim());
      return match && Number(match[2]) === year
        ? Math.max(highest, Number(match[1]))
        : highest;
    }, 0);
    const nextNumber = `${String(highestNumber + 1).padStart(3, "0")}/${year}`;
    const mandatoryIds = questions.filter((q) => q.mandatory).map((q) => q.id);
    setForm((current) => ({
      ...current,
      number: nextNumber,
      selected: mandatoryIds,
      // O limite nunca pode nascer menor que a quantidade de perguntas
      // obrigatórias já pré-selecionadas, senão toggle() trava a inclusão
      // de qualquer outra pergunta antes mesmo do admin ajustar o limite.
      questionTarget: Math.max(current.questionTarget || 1, mandatoryIds.length || 1),
    }));
    if (!mandatoryIds.length) {
      // Nenhuma pergunta obrigatória cadastrada: diferente da versão antiga
      // (que sempre incluía uma pergunta de triagem fixa), esta pesquisa vai
      // nascer sem nenhuma pergunta selecionada até o admin escolher manualmente.
      act("Nenhuma pergunta obrigatória cadastrada — selecione as perguntas do questionário manualmente");
    }
    setCreating(true);
  };
  useEffect(() => {
    supabase.rpc("pulso_admin_get_state", { p_token: adminToken }).then(({data})=>{
      const nextResearches = Array.isArray(data?.researches) ? data.researches : [];
      const nextQuestions = Array.isArray(data?.questions) ? data.questions : [];
      setItems(nextResearches);
      setQuestions(nextQuestions);
      localStorage.setItem("pulso-research", JSON.stringify(nextResearches));
      localStorage.setItem("pulso-question-bank", JSON.stringify(nextQuestions));
    });
  }, [adminToken]);
  const syncState = (nextItems: Research[], nextQuestions = questions) => supabase.rpc("pulso_admin_sync_state", { p_token: adminToken, p_researches: nextItems, p_questions: nextQuestions });
  const save = async (next: Research[]) => {
    setItems(next);
    localStorage.setItem("pulso-research", JSON.stringify(next));
    const { error } = await syncState(next);
    if (error) act("Não foi possível salvar — verifique sua conexão e tente novamente");
  };
  const saveQuestions = async (next: Question[]) => {
    setQuestions(next);
    localStorage.setItem("pulso-question-bank", JSON.stringify(next));
    const { error } = await syncState(items, next);
    if (error) act("Não foi possível salvar — verifique sua conexão e tente novamente");
  };
  const saveCargos = (next: string[]) => {
    setCargos(next);
    localStorage.setItem("pulso-cargos", JSON.stringify(next));
  };
  const addCargo = (name: string) => {
    if (cargos.includes(name)) {
      act("Este cargo já existe na lista");
      return;
    }
    saveCargos([...cargos, name]);
    act("Cargo adicionado");
  };
  const removeCargo = (name: string) => {
    saveCargos(cargos.filter((cargo) => cargo !== name));
  };
  useEffect(() => {
    const finished = items.map((item) =>
      item.status === "Ativa" && item.target && item.responses >= item.target
        ? { ...item, status: "Finalizada" as const }
        : item,
    );
    if (finished.some((item, i) => item.status !== items[i].status)) {
      save(finished);
    }
  }, [items]);
  const moveResearch = (fromId: number, toId: number) => {
    if (fromId === toId) return;
    const next = [...items];
    const fromIndex = next.findIndex((item) => item.id === fromId);
    const toIndex = next.findIndex((item) => item.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    save(next);
  };
  const duplicateResearch = (id: number) => {
    const source = items.find((item) => item.id === id);
    if (!source) return;
    const copy: Research = {
      ...source,
      id: Date.now(),
      number: `${source.number} (cópia)`,
      status: "Ativa",
      responses: 0,
      start: "Não informado",
      end: "Não informado",
      agents: [],
    };
    save([copy, ...items]);
    act("Pesquisa duplicada com o mesmo questionário");
  };
  const cancelResearch = (id: number) => {
    save(
      items.map((item) =>
        item.id === id ? { ...item, status: "Cancelada" as const } : item,
      ),
    );
    act("Pesquisa cancelada");
  };
  const deleteResearch = (id: number) => {
    if (
      !window.confirm(
        "Excluir esta pesquisa? Esta ação não pode ser desfeita.",
      )
    )
      return;
    save(items.filter((item) => item.id !== id));
    if (editing?.id === id) setEditing(null);
    act("Pesquisa excluída");
  };
  const updateEditing = (patch: Partial<Research>) => {
    if (!editing) return;
    const updated = { ...editing, ...patch };
    if (distributionValid(updated.target || 0, updated.quotas || {})) {
      save(items.map((item) => (item.id === editing.id ? updated : item)));
    }
    setEditing(updated);
  };
  const closeEditing = () => {
    if (editing && !distributionValid(editing.target || 0, editing.quotas || {})) {
      setModalTab("config");
      act("Ajuste as entrevistas por bairro: a soma deve ser exatamente igual ao total de pessoas a entrevistar.");
      return;
    }
    setEditing(null);
  };
  const editingLocalityOptions = [
    ...localityOptions.filter((option) => !(editing?.neighborhoodGroups || []).some((group) => group.areas.includes(option.key))),
    ...(editing?.neighborhoodGroups || []).map((group) => ({
      key: `Grupo: ${group.name}`, label: `Grupo: ${group.name}`,
      section: areaMacro(group.areas[0] || ""),
    })),
  ];
  const moveEditingQuestion = (fromId: string, toId: string) => {
    if (!editing || fromId === toId) return;
    const order = [...editing.questions];
    const fromIndex = order.indexOf(fromId);
    const toIndex = order.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    order.splice(fromIndex, 1);
    order.splice(toIndex, 0, fromId);
    updateEditing({ questions: order });
  };
  const shiftEditingQuestion = (id: string, direction: -1 | 1) => {
    if (!editing) return;
    const index = editing.questions.indexOf(id);
    const target = editing.questions[index + direction];
    if (target) moveEditingQuestion(id, target);
  };
  const editingEntityMacro = (entity: string) => {
    const group = editing?.neighborhoodGroups?.find(
      (item) => `Grupo: ${item.name}` === entity,
    );
    return group?.macro || areaMacro(entity);
  };
  const resolveAgentAreas = (areas: string[]) =>
    areas.flatMap((area) => {
      const group = editing?.neighborhoodGroups?.find(
        (item) => `Grupo: ${item.name}` === area,
      );
      return group ? group.areas : [area];
    });
  const editingQuotaAreas = editing ? Object.keys(editing.quotas || {}) : [];
  const editingDistricts = Array.from(
    new Set(editingQuotaAreas.map(editingEntityMacro)),
  );
  const agentCountByArea = (area: string) =>
    (editing?.agents || []).filter(
      (agent) => agent.id !== editingAgentId && agent.areas.includes(area),
    ).length;
  const agentQuotaFor = (areas: string[]) =>
    areas.reduce((sum, area) => {
      const total = Number(editing?.quotas?.[area] || 0);
      const coveringCount =
        (editing?.agents || []).filter((a) => a.areas.includes(area))
          .length || 1;
      return sum + Math.ceil(total / coveringCount);
    }, 0);
  // Prévia para o agente do formulário (novo ou em edição): usa
  // agentCountByArea, que já exclui o próprio editingAgentId, e soma +1 para
  // representar o agente do rascunho — diferente de agentQuotaFor acima
  // (usado para agentes já existentes na lista, que já se contam sozinhos).
  const agentDraftQuotaFor = (areas: string[]) =>
    areas.reduce((sum, area) => {
      const total = Number(editing?.quotas?.[area] || 0);
      const coveringCount = agentCountByArea(area) + 1;
      return sum + Math.ceil(total / coveringCount);
    }, 0);
  const agentDraftQuota = agentDraftQuotaFor(agentDraft.areas);
  const trackAreaOptions = Array.from(
    new Set((editing?.agents || []).flatMap((agent) => agent.areas)),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const toggleTrackFilterArea = (area: string) =>
    setTrackFilterAreas((current) =>
      current.includes(area)
        ? current.filter((a) => a !== area)
        : [...current, area],
    );
  const trackedAgents = (editing?.agents || []).filter(
    (agent) =>
      !trackFilterAreas.length ||
      agent.areas.some((area) => trackFilterAreas.includes(area)),
  );
  const toggleAgentArea = (area: string) =>
    setAgentDraft((current) => ({
      ...current,
      areas: current.areas.includes(area)
        ? current.areas.filter((a) => a !== area)
        : [...current.areas, area],
    }));
  const toggleDistrictExpand = (district: string) =>
    setExpandedDistricts((current) =>
      current.includes(district)
        ? current.filter((d) => d !== district)
        : [...current, district],
    );
  const resetAgentDraft = () => {
    setEditingAgentId(null);
    setAgentDraft({ name: "", phone: "", areas: [], areasText: "" });
  };
  const startEditAgent = (agent: {
    id: string;
    name: string;
    phone: string;
    areas: string[];
  }) => {
    setEditingAgentId(agent.id);
    setAgentDraft({
      name: agent.name,
      phone: agent.phone,
      areas: agent.areas,
      areasText: agent.areas.join(", "),
    });
    setExpandedDistricts(
      Array.from(new Set(agent.areas.map(editingEntityMacro))),
    );
  };
  const saveAgent = () => {
    if (!editing) return;
    const hasQuotas = !!editingQuotaAreas.length;
    const areas = hasQuotas
      ? agentDraft.areas
      : agentDraft.areasText
          .split(",")
          .map((area) => area.trim())
          .filter(Boolean);
    if (!agentDraft.name.trim() || !areas.length) {
      act("Informe o nome do agente e ao menos uma localidade");
      return;
    }
    if (editingAgentId) {
      updateEditing({
        agents: (editing.agents || []).map((agent) =>
          agent.id === editingAgentId
            ? { ...agent, name: agentDraft.name, phone: agentDraft.phone, areas }
            : agent,
        ),
      });
      act("Agente atualizado");
    } else {
      const agent = {
        id: String(Date.now()),
        name: agentDraft.name,
        phone: agentDraft.phone,
        areas,
      };
      updateEditing({ agents: [...(editing.agents || []), agent] });
      act("Agente cadastrado e direcionado às localidades selecionadas");
    }
    resetAgentDraft();
  };
  const removeAgent = (id: string) => {
    if (!editing) return;
    updateEditing({
      agents: (editing.agents || []).filter((agent) => agent.id !== id),
    });
    if (editingAgentId === id) resetAgentDraft();
  };
  const generateResearchAccess = () => {
    if (!editing) return;
    if (!(editing.agents || []).length) {
      act("Cadastre pelo menos um agente antes de gerar os acessos");
      return;
    }
    const takenLogins = new Set(
      (editing.agents || []).map((agent) => agent.login).filter(Boolean),
    );
    const nextAgents = (editing.agents || []).map((agent) => {
      if (agent.login) return agent;
      const base = slugifyLogin(agent.name);
      let login = base;
      let suffix = 1;
      while (takenLogins.has(login)) {
        login = `${base}${suffix}`;
        suffix++;
      }
      takenLogins.add(login);
      return {
        ...agent,
        login,
        password: generateAgentPassword(),
        blocked: false,
      };
    });
    updateEditing({ agents: nextAgents });
    setModalTab("acessos");
    act("Acessos gerados para os agentes desta pesquisa");
  };
  const resetAgentPassword = (id: string) => {
    if (!editing) return;
    updateEditing({
      agents: (editing.agents || []).map((agent) =>
        agent.id === id
          ? { ...agent, password: generateAgentPassword() }
          : agent,
      ),
    });
    act("Senha redefinida");
  };
  const toggleAgentBlocked = (id: string) => {
    if (!editing) return;
    updateEditing({
      agents: (editing.agents || []).map((agent) =>
        agent.id === id ? { ...agent, blocked: !agent.blocked } : agent,
      ),
    });
  };
  const updateAgentProgress = (id: string, completed: number) => {
    if (!editing) return;
    updateEditing({
      agents: (editing.agents || []).map((agent) =>
        agent.id === id
          ? {
              ...agent,
              completed: Math.max(0, Math.round(completed) || 0),
              updatedAt: new Date().toLocaleString("pt-BR"),
            }
          : agent,
      ),
    });
  };
  const toggleAgentStreetVisited = (agentId: string, streetId: number) => {
    if (!editing) return;
    updateEditing({
      agents: (editing.agents || []).map((agent) => {
        if (agent.id !== agentId) return agent;
        const visited = new Set(agent.visitedStreets || []);
        if (visited.has(streetId)) visited.delete(streetId);
        else visited.add(streetId);
        return { ...agent, visitedStreets: Array.from(visited) };
      }),
    });
  };
  const filtered = items.filter(
    (x) =>
      (status === "Todas" || x.status === status) &&
      `${x.number} ${x.title} ${x.type}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const reorderable = status === "Todas" && !query.trim();
  const selectedAreas = Object.keys(form.quotas);
  const addCandidate = () => {
    if (!candidateDraft.office.trim() || !candidateDraft.name.trim()) {
      act("Informe o cargo e o nome do candidato ou pré-candidato");
      return;
    }
    setForm((current) => ({
      ...current,
      candidates: [
        ...current.candidates,
        { ...candidateDraft, id: String(Date.now()) },
      ],
    }));
    setCandidateDraft({ office: "", name: "", supporter: "" });
    act("Nome adicionado à pesquisa");
  };
  const toggle = (id: string) =>
    setForm((f) => {
      if (f.selected.includes(id)) {
        if (questions.find((q) => q.id === id)?.mandatory) {
          act("Esta pergunta é obrigatória e não pode ser removida");
          return f;
        }
        return { ...f, selected: f.selected.filter((x) => x !== id) };
      }
      if (f.questionTarget > 0 && f.selected.length >= f.questionTarget) {
        const mandatoryCount = questions.filter((q) => q.mandatory).length;
        act(
          f.selected.length <= mandatoryCount
            ? `O limite de ${f.questionTarget} perguntas já está preenchido pelas perguntas obrigatórias — aumente o limite para adicionar mais`
            : `O limite definido é de ${f.questionTarget} perguntas`,
        );
        return f;
      }
      return { ...f, selected: [...f.selected, id] };
    });
  const moveQuestion = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setForm((current) => {
      const selected = [...current.selected];
      const fromIndex = selected.indexOf(fromId);
      const toIndex = selected.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return current;
      selected.splice(fromIndex, 1);
      selected.splice(toIndex, 0, fromId);
      return { ...current, selected };
    });
  };
  const shiftQuestion = (id: string, direction: -1 | 1) => {
    const index = form.selected.indexOf(id);
    const target = form.selected[index + direction];
    if (target) moveQuestion(id, target);
  };
  const addQuestion = () => {
    if (!newQ.text.trim()) return;
    const vars = ["candidato", "apoiador", "palavra_chave"].filter((name) =>
      newQ.text.includes(`{{${name}}}`),
    );
    const q = {
      ...newQ,
      id: `Q${String(questions.length + 1).padStart(2, "0")}_NOVA_${Date.now().toString().slice(-4)}`,
      vars,
    };
    saveQuestions([...questions, q]);
    const canSelect =
      form.questionTarget <= 0 || form.selected.length < form.questionTarget;
    if (canSelect) {
      setForm((f) => ({ ...f, selected: [...f.selected, q.id] }));
    }
    setNewQ({ text: "", block: "Geral", type: "Escolha única" });
    act(
      canSelect
        ? "Nova pergunta adicionada e selecionada"
        : "Pergunta adicionada ao banco; o limite da pesquisa já foi atingido",
    );
  };
  const updateQuestion = () => {
    if (!questionEdit?.text.trim()) {
      act("O texto da pergunta não pode ficar vazio");
      return;
    }
    const vars = ["candidato", "apoiador", "palavra_chave"].filter((name) =>
      questionEdit.text.includes(`{{${name}}}`),
    );
    const options = closedQuestionTypes.includes(questionEdit.type)
      ? (questionEdit.options || []).map((o) => o.trim()).filter(Boolean)
      : undefined;
    saveQuestions(
      questions.map((question) =>
        question.id === questionEdit.id
          ? { ...questionEdit, vars, options }
          : question,
      ),
    );
    setQuestionEdit(null);
    act("Pergunta atualizada no banco");
  };
  const create = () => {
    if (!form.number.trim() || !form.title.trim() || !form.client.trim()) {
      act("Preencha número, nome e cliente da pesquisa");
      return;
    }
    if (form.target <= 0 || !selectedAreas.length) {
      act("Informe a amostra e selecione pelo menos uma localidade");
      return;
    }
    if (!distributionValid(form.target, form.quotas)) {
      act("A soma das entrevistas por bairro deve ser exatamente igual ao total de pessoas a entrevistar");
      return;
    }
    if (form.questionTarget <= 0) {
      act("Informe a quantidade de perguntas da pesquisa");
      return;
    }
    if (form.selected.length !== form.questionTarget) {
      act(`Selecione exatamente ${form.questionTarget} perguntas`);
      return;
    }
    const missing = questions.some(
      (q) =>
        form.selected.includes(q.id) &&
        q.vars.some((variable) => !form.variables[q.id]?.[variable]?.trim()),
    );
    if (missing) {
      act("Preencha os dados solicitados nas perguntas selecionadas");
      return;
    }
    save([
      {
        id: Date.now(),
        number: form.number,
        title: form.title,
        type: form.type,
        status: "Ativa",
        start: form.start || "Não informado",
        end: form.end || "Não informado",
        responses: 0,
        questions: form.selected,
        variables: form.variables,
        client: form.client,
        city: form.city,
        target: form.target,
        questionTarget: form.questionTarget,
        quotas: form.quotas,
        neighborhoodGroups: form.neighborhoodGroups,
        candidates: form.candidates,
      },
      ...items,
    ]);
    setCreating(false);
    setForm({
      number: "",
      title: "",
      client: "",
      city: "Bonito/PE",
      type: "Mista",
      start: "",
      end: "",
      target: 0,
      questionTarget: Math.max(1, questions.filter((q) => q.mandatory).length),
      quotas: {},
      neighborhoodGroups: [],
      candidates: [],
      selected: questions.filter((q) => q.mandatory).map((q) => q.id),
      variables: {},
    });
    act("Pesquisa criada com sucesso");
  };
  const questionnaireLocked = !!editing && editing.responses > 0;
  const reportQuotaRows: (string | number)[][] = editing
    ? Object.entries(editing.quotas || {}).map(([area, quota]) => [
        area,
        editingEntityMacro(area),
        quota,
      ])
    : [];
  const reportAgentRows: (string | number)[][] = editing
    ? (editing.agents || []).map((agent) => {
        const quota = agentQuotaFor(agent.areas);
        const completed = agent.completed || 0;
        const pct = quota ? Math.round((completed / quota) * 100) : 0;
        const agentStatus = agent.blocked
          ? "Bloqueado"
          : !completed
            ? "Não iniciado"
            : quota && completed >= quota
              ? "Concluído"
              : "Em andamento";
        return [
          agent.name,
          agent.phone || "—",
          agent.areas.join("; "),
          quota,
          completed,
          `${pct}%`,
          agentStatus,
        ];
      })
    : [];
  const reportQuestionRows: (string | number)[][] = editing
    ? editing.questions.map((id, i) => {
        const q = questions.find((x) => x.id === id);
        return [
          i + 1,
          q?.block || "—",
          q?.type || "—",
          q
            ? resolveQuestion(q.text, editing.variables?.[id])
            : "Pergunta personalizada",
        ];
      })
    : [];
  const reportAgentStatusCounts: [string, number][] = [
    "Não iniciado",
    "Em andamento",
    "Concluído",
    "Bloqueado",
  ].map((label) => [
    label,
    reportAgentRows.filter((row) => row[6] === label).length,
  ]);
  const saveLetterhead = (next: typeof letterhead) => {
    setLetterhead(next);
    localStorage.setItem("pulso-letterhead", JSON.stringify(next));
  };
  const reportResultadoQuestions = (() => {
    if (!editing) return [];
    const interviews = editing.interviews || [];
    const closedQuestions = editing.questions
      .map((id) => questions.find((q) => q.id === id))
      .filter(
        (q): q is Question =>
          !!q &&
          !q.eliminatory &&
          closedQuestionTypes.includes(q.type) &&
          !!(q.options || []).length,
      );
    const computeRow = (rowInterviews: typeof interviews, q: Question) => {
      const withAnswer = rowInterviews.filter(
        (iv) => iv.answers[q.id] !== undefined,
      );
      const total = withAnswer.length;
      const values = (q.options || []).map((option) => {
        if (!total) return 0;
        const count = withAnswer.filter((iv) => {
          const answer = iv.answers[q.id];
          return Array.isArray(answer)
            ? answer.includes(option)
            : answer === option;
        }).length;
        return Math.round((count / total) * 1000) / 10;
      });
      return { total, values };
    };
    return closedQuestions.map((q) => ({
      question: q,
      rows: editingQuotaAreas.map((area) => ({
        area,
        ...computeRow(
          interviews.filter((iv) => sameLocality(iv.locality, area)),
          q,
        ),
      })),
      totalRow: computeRow(interviews, q),
    }));
  })();
  const questionEditPanel = questionEdit && (
    <div className="questionEditor">
      <div>
        <span>
          <small>EDITANDO {questionEdit.id}</small>
          <b>Alterar pergunta do banco</b>
        </span>
        <button onClick={() => setQuestionEdit(null)}>×</button>
      </div>
      <label>
        Texto da pergunta
        <textarea
          value={questionEdit.text}
          onChange={(e) =>
            setQuestionEdit({
              ...questionEdit,
              text: e.target.value,
            })
          }
        />
      </label>
      <div className="questionEditFields">
        <label>
          Bloco
          <select
            value={questionEdit.block}
            onChange={(e) =>
              setQuestionEdit({
                ...questionEdit,
                block: e.target.value,
              })
            }
          >
            <option>Geral</option><option>Triagem</option>
            <option>Percepção</option><option>Gestão</option>
            <option>Eleitoral</option><option>Perfil</option>
            <option>Validação</option>
          </select>
        </label>
        <label>
          Tipo de resposta
          <select
            value={questionEdit.type}
            onChange={(e) =>
              setQuestionEdit({
                ...questionEdit,
                type: e.target.value,
              })
            }
          >
            <option>Escolha única</option>
            <option>Múltipla escolha</option>
            <option>Texto aberto</option><option>Escala</option>
            <option>Número</option><option>Telefone</option><option>Endereço</option>
          </select>
        </label>
      </div>
      {closedQuestionTypes.includes(questionEdit.type) && (
        <div className="optionsEditor">
          <span>
            Opções de resposta
            <small>
              Usadas pelo agente no Pulso Campo e nas tabelas do relatório
              de resultado.
            </small>
          </span>
          {(questionEdit.options || []).map((option, i) => (
            <div className="optionRow" key={i}>
              <input
                value={option}
                onChange={(e) => {
                  const options = [...(questionEdit.options || [])];
                  options[i] = e.target.value;
                  setQuestionEdit({ ...questionEdit, options });
                }}
                placeholder={`Opção ${i + 1}`}
              />
              <button
                onClick={() =>
                  setQuestionEdit({
                    ...questionEdit,
                    options: (questionEdit.options || []).filter(
                      (_, index) => index !== i,
                    ),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              setQuestionEdit({
                ...questionEdit,
                options: [...(questionEdit.options || []), ""],
              })
            }
          >
            <Plus /> Adicionar opção
          </button>
        </div>
      )}
      <p>
        Você também pode usar os marcadores
        <code>&#123;&#123;candidato&#125;&#125;</code>,
        <code>&#123;&#123;apoiador&#125;&#125;</code> e
        <code>&#123;&#123;palavra_chave&#125;&#125;</code>.
      </p>
      <div className="questionEditActions">
        <button className="secondary" onClick={() => setQuestionEdit(null)}>
          Cancelar
        </button>
        <button className="primary" onClick={updateQuestion}>
          <CheckCircle2 /> Salvar alterações
        </button>
      </div>
    </div>
  );
  return (
    <div className="content researches">
      <div className="researchHeader">
        <div>
          <p className="eyebrow">GESTÃO DE COLETAS</p>
          <h1>Pesquisas</h1>
          <p>
            Consulte o histórico, acompanhe o status e monte novos
            questionários.
          </p>
        </div>
        <button className="primary" onClick={openCreateResearch}>
          <Plus /> Criar nova pesquisa
        </button>
      </div>
      <div className="researchSummary">
        <span>
          <b>{items.length}</b> pesquisas
        </span>
        <span>
          <i className="dot activeDot" />
          <b>{items.filter((x) => x.status === "Ativa").length}</b> ativas
        </span>
        <span>
          <i className="dot doneDot" />
          <b>{items.filter((x) => x.status === "Finalizada").length}</b>{" "}
          finalizadas
        </span>
        <span>
          <i className="dot cancelDot" />
          <b>{items.filter((x) => x.status === "Cancelada").length}</b>{" "}
          canceladas
        </span>
      </div>
      <section className="panel researchPanel">
        <div className="researchTools">
          <label>
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por número, nome ou tipo..."
            />
          </label>
          <div className="filterPills">
            {["Todas", "Ativa", "Finalizada", "Cancelada"].map((x) => (
              <button
                key={x}
                className={status === x ? "selected" : ""}
                onClick={() => setStatus(x)}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        {reorderable && filtered.length > 1 && (
          <p className="dragHint">
            <GripVertical /> Arraste as pesquisas pelo ícone para reordenar a lista.
          </p>
        )}
        <div className="researchList">
          {filtered.map((x) => (
            <article
              key={x.id}
              draggable={reorderable}
              className={draggedResearch === x.id ? "dragging" : ""}
              onDragStart={() => reorderable && setDraggedResearch(x.id)}
              onDragEnd={() => setDraggedResearch(null)}
              onDragOver={(event) => reorderable && event.preventDefault()}
              onDrop={() => {
                if (reorderable && draggedResearch !== null) moveResearch(draggedResearch, x.id);
                setDraggedResearch(null);
              }}
            >
              <div className="researchIdentity">
                {reorderable && <GripVertical className="dragHandle" />}
                <div className="researchIcon">
                  <ClipboardList />
                </div>
                <span>
                  <small>PESQUISA {x.number}</small>
                  <b>{x.title}</b>
                  <em>{x.type} · Bonito/PE</em>
                </span>
              </div>
              <span className={"statusTag " + x.status.toLowerCase()}>
                {x.status}
              </span>
              <span className="researchDate">
                <small>PERÍODO</small>
                <b>
                  {formatDateBR(x.start)} — {formatDateBR(x.end)}
                </b>
              </span>
              <span className="researchResponses">
                <small>ENTREVISTAS</small>
                <b>
                  {x.responses}
                  {x.target ? ` / ${x.target}` : ""}
                </b>
              </span>
              <span className="researchQuestions">
                <small>PERGUNTAS</small>
                <b>{x.questions.length}</b>
              </span>
              <div className="researchRowActions">
                <button
                  className="rowIconBtn"
                  title="Duplicar pesquisa"
                  onClick={() => duplicateResearch(x.id)}
                >
                  <Copy />
                </button>
                {x.status === "Ativa" && (
                  <button
                    className="rowIconBtn"
                    title="Cancelar pesquisa"
                    onClick={() => cancelResearch(x.id)}
                  >
                    <Ban />
                  </button>
                )}
                <button
                  className="rowIconBtn rowIconBtnDanger"
                  title="Excluir pesquisa"
                  onClick={() => deleteResearch(x.id)}
                >
                  <Trash2 />
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing(x);
                    setModalTab("questionario");
                    setExpandedDistricts([]);
                    resetAgentDraft();
                  }}
                >
                  Gerenciar pesquisa
                </button>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <div className="noResults">
              <Search />
              <b>Nenhuma pesquisa encontrada</b>
              <span>Ajuste a busca ou selecione outro status.</span>
            </div>
          )}
        </div>
      </section>
      <div className="demoNote">
        As pesquisas iniciais são registros demonstrativos. Novas pesquisas
        ficam salvas neste dispositivo até a conexão com o banco de dados.
      </div>
      {creating && (
        <div className="modalShade" onMouseDown={() => setCreating(false)}>
          <div
            className="researchModal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <div>
                <small>NOVA PESQUISA</small>
                <h2>Configuração e questionário</h2>
              </div>
              <button onClick={() => setCreating(false)}>×</button>
            </div>
            <div className="modalBody">
              <section className="formSection">
                <h3>1. Dados da pesquisa</h3>
                <div className="formGrid">
                  <label>
                    Número da pesquisa
                    <input
                      value={form.number}
                      onChange={(e) =>
                        setForm({ ...form, number: e.target.value })
                      }
                      placeholder="Ex.: 005/2026"
                    />
                  </label>
                  <label>
                    Nome da pesquisa
                    <input
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                      placeholder="Ex.: Avaliação da gestão"
                    />
                  </label>
                  <label>
                    Cliente / contratante
                    <input
                      value={form.client}
                      onChange={(e) =>
                        setForm({ ...form, client: e.target.value })
                      }
                      placeholder="Nome ou razão social do cliente"
                    />
                  </label>
                  <label>
                    Município
                    <select
                      value={form.city}
                      onChange={(e) =>
                        setForm({ ...form, city: e.target.value })
                      }
                    >
                      <option>Bonito/PE</option>
                    </select>
                    <small className="fieldHint">
                      Carregado da base territorial cadastrada
                    </small>
                  </label>
                  <label>
                    Tipo
                    <select
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value })
                      }
                    >
                      <option>Eleitoral</option>
                      <option>Perfil de gestão</option>
                      <option>Mista</option>
                    </select>
                  </label>
                  <label>
                    Início
                    <input
                      value={form.start}
                      onChange={(e) =>
                        setForm({ ...form, start: e.target.value })
                      }
                      placeholder="Ex.: 05/01/2026"
                    />
                  </label>
                  <label>
                    Fim previsto
                    <input
                      value={form.end}
                      onChange={(e) =>
                        setForm({ ...form, end: e.target.value })
                      }
                      placeholder="Ex.: 10/01/2026"
                    />
                  </label>
                  <label>
                    Total de pessoas a entrevistar
                    <input
                      type="number"
                      min="1"
                      value={form.target || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          target: Math.max(0, Math.floor(Number(e.target.value))),
                        })
                      }
                      placeholder="Ex.: 350"
                    />
                  </label>
                  <label>
                    Quantidade de perguntas
                    <input
                      type="number"
                      min="1"
                      value={form.questionTarget || ""}
                      onChange={(e) => {
                        const questionTarget = Math.max(
                          0,
                          Number(e.target.value),
                        );
                        setForm({
                          ...form,
                          questionTarget,
                          selected: form.selected.slice(0, questionTarget),
                        });
                      }}
                      placeholder="Ex.: 25"
                    />
                  </label>
                </div>
              </section>
              <LocalityDistribution target={form.target} quotas={form.quotas} options={localityOptions}
                onChange={(quotas) => setForm((current) => ({ ...current, quotas }))} />
              <section className="formSection">
                <div className="sectionTitle">
                  <div>
                    <h3>4. Perguntas do banco</h3>
                    <p>Marque as perguntas que farão parte do questionário.</p>
                  </div>
                  <b>
                    {form.selected.length} de {form.questionTarget || 0} selecionadas
                  </b>
                </div>
                {(() => {
                  const questionCityOptions = Array.from(
                    new Set(questions.map((q) => q.city).filter(Boolean) as string[]),
                  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
                  return !!questionCityOptions.length && (
                    <label className="blockFilter questionCityFilter">
                      Filtrar por cidade
                      <select
                        value={questionCityFilter}
                        onChange={(e) => setQuestionCityFilter(e.target.value)}
                      >
                        <option>Todas</option>
                        {questionCityOptions.map((city) => (
                          <option key={city}>{city}</option>
                        ))}
                      </select>
                    </label>
                  );
                })()}
                <div className="questionBank">
                  {questions
                    .filter(
                      (q) =>
                        q.mandatory ||
                        questionCityFilter === "Todas" ||
                        q.city === questionCityFilter,
                    )
                    .map((q) => (
                    <label
                      key={q.id}
                      className={form.selected.includes(q.id) ? "picked" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={form.selected.includes(q.id)}
                        disabled={!!q.mandatory}
                        onChange={() => toggle(q.id)}
                      />
                      <span>
                        <small>
                          {q.id} · {q.block}
                          {q.city ? ` · ${q.city}` : ""}
                          {q.mandatory ? " · Obrigatória" : ""}
                        </small>
                        <b>{q.text}</b>
                        <em>{q.type}</em>
                      </span>
                      <button
                        className="editQuestion"
                        title="Editar pergunta"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setQuestionEdit({ ...q });
                        }}
                      >
                        <Pencil /> Editar
                      </button>
                    </label>
                  ))}
                </div>
                {!!form.selected.length && (
                  <div className="questionOrder">
                    <div className="questionOrderIntro">
                      <GripVertical />
                      <span>
                        <b>Ordem do questionário</b>
                        <small>Arraste as perguntas para definir a ordem da entrevista.</small>
                      </span>
                    </div>
                    {form.selected.map((id, index) => {
                      const question = questions.find((item) => item.id === id);
                      if (!question) return null;
                      return (
                        <article
                          key={id}
                          draggable
                          className={draggedQuestion === id ? "dragging" : ""}
                          onDragStart={() => setDraggedQuestion(id)}
                          onDragEnd={() => setDraggedQuestion(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (draggedQuestion) moveQuestion(draggedQuestion, id);
                            setDraggedQuestion(null);
                          }}
                        >
                          <GripVertical className="dragHandle" />
                          <strong>{index + 1}</strong>
                          <span>
                            <small>{question.block} · {question.type}</small>
                            <b>{question.text}</b>
                          </span>
                          <div className="orderButtons">
                            <button disabled={index === 0} onClick={() => shiftQuestion(id, -1)} title="Mover para cima">↑</button>
                            <button disabled={index === form.selected.length - 1} onClick={() => shiftQuestion(id, 1)} title="Mover para baixo">↓</button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                {questionEditPanel}
                {questions.some(
                  (q) => form.selected.includes(q.id) && q.vars.length > 0,
                ) && (
                  <div className="variableConfig">
                    <div className="variableIntro">
                      <SlidersHorizontal />
                      <span>
                        <b>Personalize as perguntas selecionadas</b>
                        <small>
                          Preencha os dados exigidos por cada pergunta.
                        </small>
                      </span>
                    </div>
                    {questions
                      .filter(
                        (q) =>
                          form.selected.includes(q.id) && q.vars.length > 0,
                      )
                      .map((q) => (
                        <article key={q.id}>
                          <div>
                            <small>{q.id}</small>
                            <b>{q.text}</b>
                          </div>
                          <div className="variableFields">
                            {q.vars.map((variable) => (
                              <label key={variable}>
                                {variableLabels[variable] || variable}
                                {variable === "candidato" ||
                                variable === "apoiador" ? (
                                  <select
                                    value={
                                      form.variables[q.id]?.[variable] || ""
                                    }
                                    onChange={(e) =>
                                      setForm((current) => ({
                                        ...current,
                                        variables: {
                                          ...current.variables,
                                          [q.id]: {
                                            ...current.variables[q.id],
                                            [variable]: e.target.value,
                                          },
                                        },
                                      }))
                                    }
                                  >
                                    <option value="">
                                      {variable === "candidato"
                                        ? "Selecione um nome cadastrado"
                                        : "Selecione um apoiador cadastrado"}
                                    </option>
                                    {(variable === "candidato"
                                      ? form.candidates
                                      : form.candidates.filter(
                                          (candidate) => candidate.supporter,
                                        )
                                    ).map((candidate) => (
                                      <option
                                        key={`${variable}-${candidate.id}`}
                                        value={
                                          variable === "candidato"
                                            ? candidate.name
                                            : candidate.supporter
                                        }
                                      >
                                        {variable === "candidato"
                                          ? `${candidate.office} — ${candidate.name}`
                                          : `${candidate.supporter} — apoio a ${candidate.name}`}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    value={
                                      form.variables[q.id]?.[variable] || ""
                                    }
                                    onChange={(e) =>
                                      setForm((current) => ({
                                        ...current,
                                        variables: {
                                          ...current.variables,
                                          [q.id]: {
                                            ...current.variables[q.id],
                                            [variable]: e.target.value,
                                          },
                                        },
                                      }))
                                    }
                                    placeholder={
                                      "Digite " +
                                      (variableLabels[variable] || variable).toLowerCase()
                                    }
                                  />
                                )}
                              </label>
                            ))}
                          </div>
                          <p>
                            <strong>Prévia:</strong>{" "}
                            {resolveQuestion(q.text, form.variables[q.id])}
                          </p>
                        </article>
                      ))}
                  </div>
                )}
              </section>
            </div>
            <div className="modalFoot">
              <button className="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </button>
              <button className="primary" onClick={create}>
                <CheckCircle2 /> Criar pesquisa
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <div className="modalShade" onMouseDown={closeEditing}>
          <div
            className="questionView"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <div>
                <small>PESQUISA {editing.number}</small>
                <h2>{editing.title}</h2>
              </div>
              <button onClick={() => setEditing(null)}>×</button>
            </div>
            <div className="modalTabs">
              <button
                className={modalTab === "config" ? "selected" : ""}
                onClick={() => setModalTab("config")}
              >
                <Settings /> Configurações
              </button>
              <button
                className={modalTab === "questionario" ? "selected" : ""}
                onClick={() => setModalTab("questionario")}
              >
                <ClipboardList /> Questionário
              </button>
              <button
                className={modalTab === "agentes" ? "selected" : ""}
                onClick={() => setModalTab("agentes")}
              >
                <Users /> Lançar agente
              </button>
              <button
                className={modalTab === "acessos" ? "selected" : ""}
                onClick={() => setModalTab("acessos")}
              >
                <UserRoundCheck /> Acessos
              </button>
              <button
                className={modalTab === "acompanhamento" ? "selected" : ""}
                onClick={() => setModalTab("acompanhamento")}
              >
                <ChartNoAxesCombined /> Acompanhamento
              </button>
              <button
                className={modalTab === "relatorio" ? "selected" : ""}
                onClick={() => setModalTab("relatorio")}
              >
                <BarChart3 /> Relatório
              </button>
            </div>
            {modalTab === "config" ? (
              <div className="modalBody">
                <section className="formSection">
                  <h3>1. Dados da pesquisa</h3>
                  <div className="formGrid">
                    <label>
                      Número da pesquisa
                      <input
                        value={editing.number}
                        onChange={(e) =>
                          updateEditing({ number: e.target.value })
                        }
                        placeholder="Ex.: 005/2026"
                      />
                    </label>
                    <label>
                      Nome da pesquisa
                      <input
                        value={editing.title}
                        onChange={(e) =>
                          updateEditing({ title: e.target.value })
                        }
                        placeholder="Ex.: Avaliação da gestão"
                      />
                    </label>
                    <label>
                      Cliente / contratante
                      <input
                        value={editing.client || ""}
                        onChange={(e) =>
                          updateEditing({ client: e.target.value })
                        }
                        placeholder="Nome ou razão social do cliente"
                      />
                    </label>
                    <label>
                      Município
                      <select
                        value={editing.city || "Bonito/PE"}
                        onChange={(e) =>
                          updateEditing({ city: e.target.value })
                        }
                      >
                        <option>Bonito/PE</option>
                      </select>
                      <small className="fieldHint">
                        Carregado da base territorial cadastrada
                      </small>
                    </label>
                    <label>
                      Tipo
                      <select
                        value={editing.type}
                        onChange={(e) =>
                          updateEditing({ type: e.target.value })
                        }
                      >
                        <option>Eleitoral</option>
                        <option>Perfil de gestão</option>
                        <option>Mista</option>
                      </select>
                    </label>
                    <label>
                      Início
                      <input
                        value={
                          editing.start ? formatDateBR(editing.start) : ""
                        }
                        onChange={(e) =>
                          updateEditing({ start: e.target.value })
                        }
                        placeholder="Ex.: 05/01/2026"
                      />
                    </label>
                    <label>
                      Fim
                      <input
                        value={editing.end ? formatDateBR(editing.end) : ""}
                        onChange={(e) =>
                          updateEditing({ end: e.target.value })
                        }
                        placeholder="Ex.: 10/01/2026"
                      />
                    </label>
                    <label>
                      Total de pessoas a entrevistar
                      <input
                        type="number"
                        min="0"
                        value={editing.target || ""}
                        onChange={(e) =>
                          updateEditing({
                            target: Math.max(0, Math.floor(Number(e.target.value))),
                          })
                        }
                        placeholder="Ex.: 350"
                      />
                    </label>
                    <label>
                      Quantidade de perguntas
                      <input
                        type="number"
                        min="0"
                        value={editing.questionTarget || 0}
                        onChange={(e) =>
                          updateEditing({
                            questionTarget: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </section>
                <LocalityDistribution target={editing.target || 0} quotas={editing.quotas || {}} options={editingLocalityOptions}
                  onChange={(quotas) => updateEditing({ quotas })} />
                {!distributionValid(editing.target || 0, editing.quotas || {}) && (
                  <div className="distributionPending">
                    <p>As alterações ficam pendentes até a soma das entrevistas fechar com o total informado.</p>
                    <button className="secondary" onClick={() => setEditing(null)}>Descartar alterações pendentes e fechar</button>
                  </div>
                )}


              </div>
            ) : modalTab === "questionario" ? (
              <>
                <div className="sectionTitle">
                  <div>
                    <h3>Questionário</h3>
                    <p>
                      Organize a ordem das perguntas e revise o conteúdo do
                      questionário.
                    </p>
                  </div>
                  <div className="printButtonGroup">
                    <button
                      className="secondary"
                      onClick={() =>
                        setPrintRequest({ view: "campo", id: Date.now() })
                      }
                    >
                      <Printer /> Imprimir questionário de campo
                    </button>
                  </div>
                </div>
                {printRequest?.view === "campo" &&
                  createPortal(
                  <div className="reportPrintArea fieldQuestionnairePrint">
                    <div className="fieldPrintHeader">
                      <div className="fieldPrintHeaderRow">
                        <span>
                          MUNICÍPIO: {(editing.city || "").split("/")[0] || "—"}
                          {" - "}
                          {(editing.city || "").split("/")[1] || "—"}
                        </span>
                        <span>
                          Período:{" "}
                          {editing.start ? formatDateBR(editing.start) : "—"} a{" "}
                          {editing.end ? formatDateBR(editing.end) : "—"}
                        </span>
                      </div>
                      <div className="fieldPrintHeaderRow">
                        <span>PESQUISA Nº {editing.number}</span>
                        <span>Localidade: ________________________</span>
                      </div>
                    </div>
                    <p className="fieldGreeting">
                      Bom dia/ Boa tarde. Meu nome é ________, sou do
                      Instituto {letterhead.name || "________"} e estou
                      realizando uma pesquisa na sua cidade. Gostaria de
                      esclarecer que o(a) Sr.(a) não assumirá nenhum
                      compromisso ao responder este questionário.
                    </p>
                    {editing.questions
                      .map((id) => questions.find((x) => x.id === id))
                      .filter((q): q is Question => !!q?.eliminatory)
                      .map((q) => (
                        <div key={q.id} className="fieldEliminatoryBlock">
                          <b>PERGUNTA ELIMINATÓRIA</b>
                          <p>{resolveQuestion(q.text, editing.variables?.[q.id])}</p>
                          {!!q.options?.length && (
                            <ul className="fieldOptionList">
                              {q.options.map((option, i) => (
                                <li key={option}>
                                  [ ] {i + 1}) {option}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    <div className="fieldQuestionList">
                      {editing.questions
                        .map((id) => questions.find((x) => x.id === id))
                        .filter(
                          (q): q is Question =>
                            !!q && !q.eliminatory && !q.identification,
                        )
                        .map((q, index) => (
                          <div key={q.id} className="fieldQuestionBlock">
                            <p className="fieldQuestionText">
                              {index + 1}.{" "}
                              {resolveQuestion(q.text, editing.variables?.[q.id])}
                            </p>
                            {q.options?.length ? (
                              <ul className="fieldOptionList">
                                {q.options.map((option, i) => (
                                  <li key={option}>
                                    [ ] {i + 1}) {option}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="fieldOpenAnswer">
                                Resposta: ______________________________________
                              </p>
                            )}
                            <div className="fieldDivider">----------</div>
                          </div>
                        ))}
                    </div>
                    <div className="fieldIdBlock">
                      <p>Nome do Entrevistado: ______________________________________</p>
                      <p>Endereço: Rua ____________________________ Nº ________</p>
                      <p>
                        A P&S pede aos entrevistados um número de telefone,
                        para confirmar se foi feita a pesquisa. Qual o número
                        que o Sr.(a) dá para a P&S? (caso o entrevistado se
                        recuse, não insistir)
                      </p>
                      <p className="fieldIdRow">
                        <span>Telefone: ________________</span>
                        <span>Entrevistador(a): ________________</span>
                      </p>
                    </div>
                  </div>,
                  document.body,
                )}
              <div className="questionViewList">
                {questionnaireLocked && (
                  <p className="agentHint questionLockNotice">
                    <Lock /> Esta pesquisa já recebeu respostas — o
                    questionário fica travado para edição e reordenação a
                    partir daqui. Os agentes ainda podem ser alterados na aba
                    "Lançar agente".
                  </p>
                )}
                {editing.questions.map((id, i) => {
                  const q = questions.find((x) => x.id === id);
                  return (
                    <Fragment key={id}>
                    <div
                      draggable={!questionnaireLocked}
                      className={
                        draggedEditingQuestion === id ? "dragging" : ""
                      }
                      onDragStart={() =>
                        !questionnaireLocked &&
                        setDraggedEditingQuestion(id)
                      }
                      onDragEnd={() => setDraggedEditingQuestion(null)}
                      onDragOver={(event) =>
                        !questionnaireLocked && event.preventDefault()
                      }
                      onDrop={() => {
                        if (!questionnaireLocked && draggedEditingQuestion)
                          moveEditingQuestion(draggedEditingQuestion, id);
                        setDraggedEditingQuestion(null);
                      }}
                    >
                      {!questionnaireLocked && (
                        <GripVertical className="dragHandle" />
                      )}
                      <i>{i + 1}</i>
                      <span>
                        <small>{q?.block || "Pergunta cadastrada"}</small>
                        <b>
                          {q
                            ? resolveQuestion(q.text, editing.variables?.[id])
                            : "Pergunta personalizada"}
                        </b>
                      </span>
                      {!questionnaireLocked && (
                        <div className="orderButtons">
                          <button
                            disabled={i === 0}
                            onClick={() => shiftEditingQuestion(id, -1)}
                            title="Mover para cima"
                          >
                            ↑
                          </button>
                          <button
                            disabled={i === editing.questions.length - 1}
                            onClick={() => shiftEditingQuestion(id, 1)}
                            title="Mover para baixo"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                      {q && !questionnaireLocked && (
                        <button
                          className="questionRowEdit"
                          title="Editar pergunta"
                          onClick={() => setQuestionEdit({ ...q })}
                        >
                          <Pencil /> Editar
                        </button>
                      )}
                    </div>
                    {!questionnaireLocked &&
                      questionEdit?.id === id &&
                      questionEditPanel}
                    </Fragment>
                  );
                })}
              </div>
              </>
            ) : modalTab === "agentes" ? (
              <div className="agentLaunch">
                <div className="sectionTitle">
                  <div>
                    <h3>Agentes de campo</h3>
                    <p>
                      Cadastre quem vai aplicar esta pesquisa e direcione
                      cada agente para uma localidade.
                    </p>
                  </div>
                  <b>{(editing.agents || []).length} cadastrados</b>
                </div>
                <div className="agentFields">
                  <label>
                    Nome do agente
                    <input
                      value={agentDraft.name}
                      onChange={(e) =>
                        setAgentDraft({ ...agentDraft, name: e.target.value })
                      }
                      placeholder="Nome completo"
                    />
                  </label>
                  <label>
                    Telefone
                    <input
                      value={agentDraft.phone}
                      onChange={(e) =>
                        setAgentDraft({
                          ...agentDraft,
                          phone: e.target.value,
                        })
                      }
                      placeholder="(00) 00000-0000"
                    />
                  </label>
                </div>
                {editingQuotaAreas.length ? (
                  <>
                    <div className="sectionTitle agentAreaTitle">
                      <div>
                        <h3>Distrito/Povoado e localidades</h3>
                        <p>
                          Abra um distrito para marcar as localidades deste
                          agente. Mais de um agente pode cobrir a mesma
                          localidade.
                        </p>
                      </div>
                      <b>
                        {agentDraft.areas.length} selecionadas ·{" "}
                        {agentDraftQuota} entrevistas
                      </b>
                    </div>
                    <div className="agentAreaCascade">
                      {editingDistricts.map((district) => {
                        const areasInDistrict = editingQuotaAreas.filter(
                          (area) => editingEntityMacro(area) === district,
                        );
                        const expanded =
                          expandedDistricts.includes(district);
                        const pickedCount = areasInDistrict.filter((area) =>
                          agentDraft.areas.includes(area),
                        ).length;
                        return (
                          <div
                            key={district}
                            className={
                              "cascadeGroup" + (expanded ? " expanded" : "")
                            }
                          >
                            <button
                              className="cascadeHead"
                              onClick={() => toggleDistrictExpand(district)}
                            >
                              <ChevronDown className="cascadeChevron" />
                              <span>{district}</span>
                              <small>
                                {pickedCount}/{areasInDistrict.length}
                              </small>
                            </button>
                            {expanded && (
                              <div className="questionBank cascadeBody">
                                {areasInDistrict.map((area) => {
                                  const coveredBy = agentCountByArea(area);
                                  return (
                                    <label
                                      key={area}
                                      className={
                                        agentDraft.areas.includes(area)
                                          ? "picked"
                                          : ""
                                      }
                                    >
                                      <input
                                        type="checkbox"
                                        checked={agentDraft.areas.includes(
                                          area,
                                        )}
                                        onChange={() => toggleAgentArea(area)}
                                      />
                                      <span>{area}</span>
                                      {coveredBy > 0 && (
                                        <small className="areaAgentCount">
                                          {coveredBy} agente
                                          {coveredBy === 1 ? "" : "s"}
                                        </small>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="agentManualAreas">
                      Localidades (separe por vírgula)
                      <input
                        value={agentDraft.areasText}
                        onChange={(e) =>
                          setAgentDraft({
                            ...agentDraft,
                            areasText: e.target.value,
                          })
                        }
                        placeholder="Ex.: Centro, Matriz, Boa Vista"
                      />
                    </label>
                    <p className="agentHint">
                      Esta pesquisa não tem localidades com cotas definidas —
                      digite as localidades manualmente.
                    </p>
                  </>
                )}
                {editingQuotaAreas.length > 0 && agentDraft.areas.length > 0 && (
                  <div className="agentQuotaPreview">
                    <UserRoundCheck />
                    <span>
                      Este agente vai cobrir{" "}
                      <b>
                        {agentDraft.areas.length} localidade
                        {agentDraft.areas.length === 1 ? "" : "s"}
                      </b>{" "}
                      e entrevistar aproximadamente{" "}
                      <b>{agentDraftQuota} pessoas</b>.
                    </span>
                  </div>
                )}
                <div className="agentSubmitRow">
                  {editingAgentId && (
                    <button className="secondary" onClick={resetAgentDraft}>
                      Cancelar edição
                    </button>
                  )}
                  <button className="primary" onClick={saveAgent}>
                    <Plus />{" "}
                    {editingAgentId ? "Salvar agente" : "Cadastrar agente"}
                  </button>
                </div>
                {!!(editing.agents || []).length && (
                  <div className="candidateList">
                    {(editing.agents || []).map((agent) => (
                      <article key={agent.id} className="agentCard">
                        <div className="agentCardTop">
                          <span>
                            <b>{agent.name}</b>
                            <em>{agent.phone || "Sem telefone informado"}</em>
                          </span>
                          <div className="agentCardActions">
                            <button
                              className="agentEdit"
                              title="Editar agente"
                              onClick={() => startEditAgent(agent)}
                            >
                              <Pencil />
                            </button>
                            <button onClick={() => removeAgent(agent.id)}>
                              ×
                            </button>
                          </div>
                        </div>
                        {!!agent.areas.length && (
                          <div className="agentCardAreas">
                            {agent.areas.map((area) => (
                              <span key={area} className="agentAreaChip">
                                {area}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="agentCardFoot">
                          <span>
                            <b>{agent.areas.length}</b> localidade
                            {agent.areas.length === 1 ? "" : "s"}
                          </span>
                          {editingQuotaAreas.length > 0 && (
                            <span>
                              <b>{agentQuotaFor(agent.areas)}</b> entrevistas
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {!!(editing.agents || []).length && (
                  <div className="agentGenerateRow">
                    <button
                      className="primary"
                      onClick={generateResearchAccess}
                    >
                      <ShieldCheck /> Gerar acessos
                    </button>
                  </div>
                )}
              </div>
            ) : modalTab === "acessos" ? (
              <div className="agentLaunch">
                <div className="sectionTitle">
                  <div>
                    <h3>Acessos dos agentes</h3>
                    <p>
                      Login e senha de cada agente para entrar no Pulso
                      Campo. Redefina a senha ou bloqueie o acesso quando
                      necessário.
                    </p>
                    <p className="agentHint">
                      Por segurança, a senha só fica visível na hora em que é
                      gerada — ao recarregar a página ela some daqui (o login
                      continua funcionando normalmente). Clique em "Redefinir
                      senha" quando precisar ver uma senha válida de novo.
                    </p>
                  </div>
                  <b>
                    {(editing.agents || []).filter((agent) => agent.login)
                      .length}{" "}
                    com acesso
                  </b>
                </div>
                {!!(editing.agents || []).length && (
                  <div className="agentGenerateRow">
                    <button
                      className="primary"
                      onClick={generateResearchAccess}
                    >
                      <ShieldCheck /> Gerar acessos
                    </button>
                  </div>
                )}
                {!(editing.agents || []).length ? (
                  <p className="agentHint">
                    Cadastre agentes na aba "Lançar agente" primeiro.
                  </p>
                ) : !(editing.agents || []).some((agent) => agent.login) ? (
                  <p className="agentHint">
                    Confira os dados dos agentes acima e clique em "Gerar
                    acessos" para criar os acessos.
                  </p>
                ) : (
                  <div className="accessList">
                    {(editing.agents || [])
                      .filter((agent) => agent.login)
                      .map((agent) => (
                        <article
                          key={agent.id}
                          className={agent.blocked ? "blocked" : ""}
                        >
                          <span className="accessIdentity">
                            <b>{agent.name}</b>
                            <em>{agent.areas.join(", ")}</em>
                          </span>
                          <span className="accessCreds">
                            <small>LOGIN</small>
                            <b>{agent.login}</b>
                          </span>
                          <span className="accessCreds">
                            <small>SENHA</small>
                            {agent.password ? (
                              <b>{agent.password}</b>
                            ) : (
                              <em className="accessCredsHidden">
                                Gere uma nova para ver
                              </em>
                            )}
                          </span>
                          <span
                            className={
                              "statusTag " +
                              (agent.blocked ? "cancelada" : "ativa")
                            }
                          >
                            {agent.blocked ? "Bloqueado" : "Ativo"}
                          </span>
                          <div className="accessActions">
                            <button
                              className="secondary"
                              onClick={() => resetAgentPassword(agent.id)}
                            >
                              Redefinir senha
                            </button>
                            <button
                              className={agent.blocked ? "secondary" : "danger"}
                              onClick={() => toggleAgentBlocked(agent.id)}
                            >
                              {agent.blocked ? "Desbloquear" : "Bloquear"}
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                )}
              </div>
            ) : modalTab === "acompanhamento" ? (
              <div className="agentLaunch">
                <div className="sectionTitle">
                  <div>
                    <h3>Acompanhamento dos agentes</h3>
                    <p>
                      Progresso de entrevistas de cada agente nesta
                      pesquisa.
                    </p>
                  </div>
                </div>
                {!!trackAreaOptions.length && (
                  <>
                    <div className="sectionTitle agentAreaTitle">
                      <div>
                        <h3>Filtrar por localidade</h3>
                        <p>
                          Selecione localidades para ver só os agentes que
                          cobrem esses pontos.
                        </p>
                      </div>
                      {!!trackFilterAreas.length && (
                        <button
                          className="secondary"
                          onClick={() => setTrackFilterAreas([])}
                        >
                          Limpar filtro
                        </button>
                      )}
                    </div>
                    <div className="questionBank trackAreaFilter">
                      {trackAreaOptions.map((area) => {
                        const areaQuota = editing.quotas?.[area] || 0;
                        const areaDone = (editing.interviews || []).filter(
                          (iv) => sameLocality(iv.locality, area),
                        ).length;
                        const areaComplete =
                          areaQuota > 0 && areaDone >= areaQuota;
                        return (
                          <label
                            key={area}
                            className={
                              trackFilterAreas.includes(area) ? "picked" : ""
                            }
                          >
                            <input
                              type="checkbox"
                              checked={trackFilterAreas.includes(area)}
                              onChange={() => toggleTrackFilterArea(area)}
                            />
                            <span>{area}</span>
                            {!!areaQuota && (
                              <small
                                className={
                                  "areaAgentCount" +
                                  (areaComplete ? " areaComplete" : "")
                                }
                              >
                                {areaComplete
                                  ? "Concluído"
                                  : `faltam ${areaQuota - areaDone}`}
                              </small>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
                {!(editing.agents || []).length ? (
                  <p className="agentHint">
                    Cadastre agentes na aba "Lançar agente" primeiro.
                  </p>
                ) : !trackedAgents.length ? (
                  <p className="agentHint">
                    Nenhum agente cobre as localidades selecionadas.
                  </p>
                ) : (
                  <div className="progressTrackList">
                    {trackedAgents.map((agent) => {
                      const quota = agentQuotaFor(agent.areas);
                      const completed = agent.completed || 0;
                      const pct = quota
                        ? Math.min(100, Math.round((completed / quota) * 100))
                        : 0;
                      const trackStatus = agent.blocked
                        ? "Bloqueado"
                        : !completed
                          ? "Não iniciado"
                          : quota && completed >= quota
                            ? "Concluído"
                            : "Em andamento";
                      return (
                        <article key={agent.id} className="progressCard">
                          <div className="progressHead">
                            <span>
                              <b>{agent.name}</b>
                              <em>{agent.areas.join(", ")}</em>
                            </span>
                            <span
                              className={
                                "statusTag " +
                                (trackStatus === "Concluído"
                                  ? "ativa"
                                  : trackStatus === "Bloqueado"
                                    ? "cancelada"
                                    : "finalizada")
                              }
                            >
                              {trackStatus}
                            </span>
                          </div>
                          <div className="progressBar">
                            <i style={{ width: `${pct}%` }} />
                          </div>
                          <div className="progressFoot">
                            <label>
                              Entrevistas concluídas
                              <input
                                type="number"
                                min="0"
                                value={completed}
                                onChange={(e) =>
                                  updateAgentProgress(
                                    agent.id,
                                    Number(e.target.value),
                                  )
                                }
                              />
                            </label>
                            <span>
                              de <b>{quota}</b> ({pct}%)
                            </span>
                          </div>
                          {agent.updatedAt && (
                            <small className="progressUpdated">
                              Atualizado em {agent.updatedAt}
                            </small>
                          )}
                          <button
                            className="secondary agentMapToggle"
                            onClick={() =>
                              setMapAgentId(
                                mapAgentId === agent.id ? null : agent.id,
                              )
                            }
                          >
                            <MapPin />{" "}
                            {mapAgentId === agent.id
                              ? "Fechar mapa"
                              : "Ver no mapa"}
                          </button>
                          {mapAgentId === agent.id && (
                            <AgentCoverageMap
                              agent={{
                                areas: resolveAgentAreas(agent.areas),
                                visitedStreets: agent.visitedStreets,
                              }}
                              onToggleStreet={(streetId) =>
                                toggleAgentStreetVisited(agent.id, streetId)
                              }
                            />
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="agentLaunch">
                <div className="sectionTitle">
                  <div>
                    <h3>Relatório da pesquisa</h3>
                    <p>
                      Gere planilhas ou gráficos desta pesquisa para
                      exportar ou imprimir.
                    </p>
                  </div>
                  <button className="secondary" onClick={() => window.print()}>
                    <Printer /> Imprimir
                  </button>
                </div>
                <div className="filterPills reportViewPicker">
                  <button
                    className={reportView === "planilha" ? "selected" : ""}
                    onClick={() => setReportView("planilha")}
                  >
                    <FileSpreadsheet /> Planilha
                  </button>
                  <button
                    className={reportView === "graficos" ? "selected" : ""}
                    onClick={() => setReportView("graficos")}
                  >
                    <BarChart3 /> Gráficos
                  </button>
                  <button
                    className={reportView === "resultado" ? "selected" : ""}
                    onClick={() => setReportView("resultado")}
                  >
                    <FileText /> Resultado da pesquisa
                  </button>
                </div>
                {reportView === "resultado" && (
                  <style>{"@media print { @page { size: landscape; } }"}</style>
                )}
                {reportView === "planilha" ? (
                  <>
                    <div className="filterPills reportSheetPicker">
                      <button
                        className={reportSheet === "cotas" ? "selected" : ""}
                        onClick={() => setReportSheet("cotas")}
                      >
                        Cotas por localidade
                      </button>
                      <button
                        className={
                          reportSheet === "agentes" ? "selected" : ""
                        }
                        onClick={() => setReportSheet("agentes")}
                      >
                        Agentes
                      </button>
                      <button
                        className={
                          reportSheet === "questionario" ? "selected" : ""
                        }
                        onClick={() => setReportSheet("questionario")}
                      >
                        Questionário
                      </button>
                    </div>
                    <div className="reportPrintArea">
                      <div className="reportPrintHead">
                        <b>
                          {editing.number} — {editing.title}
                        </b>
                        <span>
                          {reportSheet === "cotas"
                            ? "Cotas por localidade"
                            : reportSheet === "agentes"
                              ? "Agentes de campo"
                              : "Questionário"}
                        </span>
                      </div>
                      {reportSheet === "cotas" &&
                        (reportQuotaRows.length ? (
                          <table className="reportTable">
                            <thead>
                              <tr>
                                <th>Localidade</th>
                                <th>Macroárea</th>
                                <th>Cota</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reportQuotaRows.map((row, i) => (
                                <tr key={i}>
                                  {row.map((cell, j) => (
                                    <td key={j}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="agentHint">
                            Nenhuma cota definida para esta pesquisa.
                          </p>
                        ))}
                      {reportSheet === "agentes" &&
                        (reportAgentRows.length ? (
                          <table className="reportTable">
                            <thead>
                              <tr>
                                <th>Nome</th>
                                <th>Telefone</th>
                                <th>Localidades</th>
                                <th>Cota</th>
                                <th>Concluídas</th>
                                <th>%</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reportAgentRows.map((row, i) => (
                                <tr key={i}>
                                  {row.map((cell, j) => (
                                    <td key={j}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="agentHint">
                            Nenhum agente cadastrado nesta pesquisa.
                          </p>
                        ))}
                      {reportSheet === "questionario" &&
                        (reportQuestionRows.length ? (
                          <table className="reportTable">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Bloco</th>
                                <th>Tipo</th>
                                <th>Pergunta</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reportQuestionRows.map((row, i) => (
                                <tr key={i}>
                                  {row.map((cell, j) => (
                                    <td key={j}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="agentHint">
                            Nenhuma pergunta nesta pesquisa.
                          </p>
                        ))}
                    </div>
                    <div className="agentSubmitRow">
                      <button
                        className="secondary"
                        onClick={() => {
                          const headers =
                            reportSheet === "cotas"
                              ? ["Localidade", "Macroárea", "Cota"]
                              : reportSheet === "agentes"
                                ? [
                                    "Nome",
                                    "Telefone",
                                    "Localidades",
                                    "Cota",
                                    "Concluídas",
                                    "%",
                                    "Status",
                                  ]
                                : ["#", "Bloco", "Tipo", "Pergunta"];
                          const rows =
                            reportSheet === "cotas"
                              ? reportQuotaRows
                              : reportSheet === "agentes"
                                ? reportAgentRows
                                : reportQuestionRows;
                          downloadCsv(
                            `${editing.number}-${reportSheet}.csv`,
                            headers,
                            rows,
                          );
                        }}
                      >
                        <Download /> Exportar CSV
                      </button>
                    </div>
                  </>
                ) : reportView === "graficos" ? (
                  <>
                    {!!reportResultadoQuestions.length && (
                      <>
                        <div className="sectionTitle agentAreaTitle">
                          <div>
                            <h3>Resultado por pergunta em gráfico</h3>
                            <p>
                              Escolha as perguntas e como agrupar a
                              comparação.
                            </p>
                          </div>
                        </div>
                        <div className="questionBank reportQuestionPicker">
                          {reportResultadoQuestions.map(({ question }) => (
                            <label
                              key={question.id}
                              className={
                                reportChartQuestionIds.includes(question.id)
                                  ? "picked"
                                  : ""
                              }
                            >
                              <input
                                type="checkbox"
                                checked={reportChartQuestionIds.includes(
                                  question.id,
                                )}
                                onChange={() =>
                                  setReportChartQuestionIds((current) =>
                                    current.includes(question.id)
                                      ? current.filter(
                                          (id) => id !== question.id,
                                        )
                                      : [...current, question.id],
                                  )
                                }
                              />
                              <span>
                                <small>{question.block}</small>
                                <b>{question.text}</b>
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="filterPills reportDimensionPicker">
                          <button
                            className={
                              reportChartDimension === "localidade"
                                ? "selected"
                                : ""
                            }
                            onClick={() =>
                              setReportChartDimension("localidade")
                            }
                          >
                            Por localidade
                          </button>
                          <button
                            className={
                              reportChartDimension === "candidato"
                                ? "selected"
                                : ""
                            }
                            onClick={() =>
                              setReportChartDimension("candidato")
                            }
                          >
                            Por candidato / cargo
                          </button>
                        </div>
                      </>
                    )}
                  <div className="reportPrintArea">
                    <div className="reportPrintHead">
                      <b>
                        {editing.number} — {editing.title}
                      </b>
                      <span>Gráficos</span>
                    </div>
                    <div className="reportChartGrid">
                      <article className="reportChartCard">
                        <h4>Progresso geral de entrevistas</h4>
                        <Ring
                          value={
                            editing.target
                              ? Math.min(
                                  100,
                                  Math.round(
                                    (editing.responses / editing.target) *
                                      100,
                                  ),
                                )
                              : 0
                          }
                        />
                        <p>
                          {editing.responses} de {editing.target || 0}{" "}
                          entrevistas
                        </p>
                      </article>
                      <article className="reportChartCard reportChartWide">
                        <h4>Entrevistas por localidade (cota)</h4>
                        {reportQuotaRows.length ? (
                          <div className="reportBarList">
                            {reportQuotaRows.map((row) => {
                              const max = Math.max(
                                ...reportQuotaRows.map((r) => Number(r[2])),
                                1,
                              );
                              return (
                                <div
                                  className="reportBarRow"
                                  key={String(row[0])}
                                >
                                  <span>{row[0]}</span>
                                  <div className="reportBarTrack">
                                    <i
                                      style={{
                                        width: `${(Number(row[2]) / max) * 100}%`,
                                      }}
                                    />
                                  </div>
                                  <b>{row[2]}</b>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="agentHint">Sem cotas definidas.</p>
                        )}
                      </article>
                      <article className="reportChartCard reportChartWide">
                        <h4>Agentes por status</h4>
                        {reportAgentRows.length ? (
                          <div className="reportBarList">
                            {reportAgentStatusCounts.map(([label, count]) => {
                              const max = Math.max(
                                ...reportAgentStatusCounts.map((r) => r[1]),
                                1,
                              );
                              return (
                                <div className="reportBarRow" key={label}>
                                  <span>{label}</span>
                                  <div className="reportBarTrack">
                                    <i
                                      style={{
                                        width: `${(count / max) * 100}%`,
                                      }}
                                    />
                                  </div>
                                  <b>{count}</b>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="agentHint">
                            Nenhum agente cadastrado.
                          </p>
                        )}
                      </article>
                    </div>
                    {!!reportChartQuestionIds.length && (
                      <div className="reportChartGrid reportQuestionCharts">
                        {reportResultadoQuestions
                          .filter(({ question }) =>
                            reportChartQuestionIds.includes(question.id),
                          )
                          .map(({ question, rows, totalRow }) => (
                            <article
                              className="reportChartCard reportChartWide"
                              key={question.id}
                            >
                              <h4>
                                {resolveQuestion(
                                  question.text,
                                  editing.variables?.[question.id],
                                )}
                              </h4>
                              {reportChartDimension === "candidato" ? (
                                totalRow.total ? (
                                  <div className="reportBarList">
                                    {question.options!.map((option, i) => {
                                      const max = Math.max(
                                        ...totalRow.values,
                                        1,
                                      );
                                      return (
                                        <div
                                          className="reportBarRow"
                                          key={option}
                                        >
                                          <span>{option}</span>
                                          <div className="reportBarTrack">
                                            <i
                                              style={{
                                                width: `${(totalRow.values[i] / max) * 100}%`,
                                              }}
                                            />
                                          </div>
                                          <b>
                                            {totalRow.values[i]
                                              .toFixed(1)
                                              .replace(".", ",")}
                                            %
                                          </b>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="agentHint">
                                    Nenhuma entrevista registrada para esta
                                    pergunta.
                                  </p>
                                )
                              ) : rows.some((row) => row.total) ? (
                                <div className="reportLocalityCharts">
                                  {rows
                                    .filter((row) => row.total)
                                    .map((row) => {
                                      const max = Math.max(
                                        ...row.values,
                                        1,
                                      );
                                      return (
                                        <div
                                          className="reportLocalityChartGroup"
                                          key={row.area}
                                        >
                                          <b>{row.area}</b>
                                          <div className="reportBarList">
                                            {question.options!.map(
                                              (option, i) => (
                                                <div
                                                  className="reportBarRow"
                                                  key={option}
                                                >
                                                  <span>{option}</span>
                                                  <div className="reportBarTrack">
                                                    <i
                                                      style={{
                                                        width: `${(row.values[i] / max) * 100}%`,
                                                      }}
                                                    />
                                                  </div>
                                                  <b>
                                                    {row.values[i]
                                                      .toFixed(1)
                                                      .replace(".", ",")}
                                                    %
                                                  </b>
                                                </div>
                                              ),
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              ) : (
                                <p className="agentHint">
                                  Nenhuma entrevista registrada para esta
                                  pergunta.
                                </p>
                              )}
                            </article>
                          ))}
                      </div>
                    )}
                  </div>
                  </>
                ) : (
                  <>
                    <div className="letterheadEditor">
                      <div className="sectionTitle">
                        <div>
                          <h3>Papel timbrado</h3>
                          <p>
                            Preenchido uma vez, usado em todos os
                            relatórios de resultado.
                          </p>
                        </div>
                      </div>
                      <div className="agentFields configFields">
                        <label>
                          Nome do instituto
                          <input
                            value={letterhead.name}
                            onChange={(e) =>
                              saveLetterhead({
                                ...letterhead,
                                name: e.target.value,
                              })
                            }
                            placeholder="Ex.: P&S Pesquisas"
                          />
                        </label>
                        <label>
                          CNPJ
                          <input
                            value={letterhead.cnpj}
                            onChange={(e) =>
                              saveLetterhead({
                                ...letterhead,
                                cnpj: e.target.value,
                              })
                            }
                            placeholder="00.000.000/0000-00"
                          />
                        </label>
                        <label>
                          Telefones
                          <input
                            value={letterhead.phones}
                            onChange={(e) =>
                              saveLetterhead({
                                ...letterhead,
                                phones: e.target.value,
                              })
                            }
                            placeholder="(00) 00000-0000"
                          />
                        </label>
                        <label>
                          E-mail
                          <input
                            value={letterhead.email}
                            onChange={(e) =>
                              saveLetterhead({
                                ...letterhead,
                                email: e.target.value,
                              })
                            }
                            placeholder="contato@instituto.com"
                          />
                        </label>
                      </div>
                      <label className="agentManualAreas">
                        Endereço
                        <input
                          value={letterhead.address}
                          onChange={(e) =>
                            saveLetterhead({
                              ...letterhead,
                              address: e.target.value,
                            })
                          }
                          placeholder="Rua, número - Bairro, Cidade UF, CEP"
                        />
                      </label>
                    </div>
                    {createPortal(
                    <div className="reportPrintArea resultLandscape">
                      <div className="resultCover">
                        <div className="resultLetterhead">
                          <div className="resultLogoBox">
                            {letterhead.name
                              ? letterhead.name.slice(0, 1)
                              : "P"}
                          </div>
                          <div>
                            <b>
                              {letterhead.name || "Instituto de pesquisa"}
                            </b>
                            {letterhead.cnpj && (
                              <small>CNPJ {letterhead.cnpj}</small>
                            )}
                          </div>
                        </div>
                        <div className="resultCoverBody">
                          <p className="eyebrow">
                            PESQUISA DE OPINIÃO PÚBLICA
                          </p>
                          <h1>{editing.title}</h1>
                          <p>LOCAL: {editing.city || "—"}</p>
                          <p>
                            ÉPOCA: {formatDateBR(editing.start)} a{" "}
                            {formatDateBR(editing.end)}
                          </p>
                        </div>
                        {(letterhead.address ||
                          letterhead.phones ||
                          letterhead.email) && (
                          <div className="resultFooter">
                            {letterhead.address && (
                              <span>{letterhead.address}</span>
                            )}
                            {(letterhead.phones || letterhead.email) && (
                              <span>
                                {letterhead.phones}
                                {letterhead.phones && letterhead.email
                                  ? " · "
                                  : ""}
                                {letterhead.email}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {!reportResultadoQuestions.length ? (
                        <p className="agentHint">
                          Nenhuma pergunta de escolha única, múltipla
                          escolha ou escala com opções cadastradas nesta
                          pesquisa. Cadastre as opções de resposta na aba
                          Questionário (editar pergunta) para gerar as
                          tabelas.
                        </p>
                      ) : !(editing.interviews || []).length ? (
                        <p className="agentHint">
                          Nenhuma entrevista registrada ainda. As tabelas
                          aparecem aqui conforme os agentes forem salvando
                          entrevistas pelo Pulso Campo.
                        </p>
                      ) : (
                        reportResultadoQuestions.map(
                          ({ question, rows, totalRow }, index) => (
                            <div className="resultItem" key={question.id}>
                              <div className="resultLetterheadSmall">
                                <div className="resultLogoBox">
                                  {letterhead.name
                                    ? letterhead.name.slice(0, 1)
                                    : "P"}
                                </div>
                                <span>
                                  {letterhead.name || "Instituto de pesquisa"}
                                </span>
                              </div>
                              <p className="resultItemHead">
                                <b>Item {index + 1} -</b>{" "}
                                {resolveQuestion(
                                  question.text,
                                  editing.variables?.[question.id],
                                )}
                              </p>
                              <table className="reportTable resultTable">
                                <thead>
                                  <tr>
                                    <th />
                                    {question.options!.map((option) => (
                                      <th key={option}>{option}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row) => (
                                    <tr key={row.area}>
                                      <td>{row.area}</td>
                                      {row.values.map((value, i) => (
                                        <td key={i}>
                                          {row.total
                                            ? value
                                                .toFixed(1)
                                                .replace(".", ",")
                                            : "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                  <tr className="resultTotalRow">
                                    <td />
                                    {totalRow.values.map((value, i) => (
                                      <td key={i}>
                                        {totalRow.total
                                          ? value
                                              .toFixed(1)
                                              .replace(".", ",")
                                          : "—"}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          ),
                        )
                      )}
                    </div>,
                    document.body,
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCoverageMap({
  agent,
  onToggleStreet,
}: {
  agent: { areas: string[]; visitedStreets?: number[] };
  onToggleStreet: (streetId: number) => void;
}) {
  const streets = useMemo(
    () =>
      streetCoordinates.filter((street) =>
        agent.areas.includes(localityKey(street)) ||
        (street.district === "ESTREITO DO NORTE" && agent.areas.includes("ZONA RURAL")),
      ),
    [agent.areas],
  );
  const visited = new Set(agent.visitedStreets || []);
  const visitedCount = streets.filter((street) =>
    visited.has(street.id),
  ).length;
  const center = useMemo<[number, number]>(() => {
    if (!streets.length) return [-8.4677, -35.7286];
    return [
      streets.reduce((sum, street) => sum + street.lat, 0) / streets.length,
      streets.reduce((sum, street) => sum + street.lng, 0) / streets.length,
    ];
  }, [streets]);
  if (!streets.length) {
    return (
      <p className="agentHint">
        Nenhuma rua georreferenciada encontrada para as localidades deste
        agente.
      </p>
    );
  }
  return (
    <div className="agentMapBlock">
      <div className="agentMapLegend">
        <span>
          <i className="layerDot visitedDot" /> Check-in feito (
          {visitedCount})
        </span>
        <span>
          <i className="layerDot pendingDot" /> Falta passar (
          {streets.length - visitedCount})
        </span>
        <b>
          {visitedCount} de {streets.length} ruas
        </b>
      </div>
      <div className="agentMapShell">
        <MapContainer
          center={center}
          zoom={15}
          className="agentTrackMap"
          zoomControl={true}
        >
          <MapResize />
          <TileLayer
            attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          {streets.map((street) => (
            <CircleMarker
              key={street.id}
              center={[street.lat, street.lng]}
              radius={7}
              pathOptions={{
                color: "#fff",
                fillColor: visited.has(street.id) ? "#45a060" : "#c79a35",
                fillOpacity: 1,
                weight: 2,
              }}
              eventHandlers={{ click: () => onToggleStreet(street.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                <div className="streetTooltip">
                  <small>
                    {visited.has(street.id)
                      ? "CHECK-IN FEITO"
                      : "FALTA PASSAR"}
                  </small>
                  <b>{street.name}</b>
                  <span>
                    Clique para{" "}
                    {visited.has(street.id)
                      ? "desmarcar o check-in"
                      : "marcar check-in"}
                  </span>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <p className="agentMapHint">
        Clique em um ponto do mapa para marcar o check-in daquela rua. Esta
        marcação é feita manualmente pelo administrador ou pelo agente — o
        sistema não rastreia GPS automaticamente.
      </p>
    </div>
  );
}

type AgentMapPoint={id:string;name:string;lat:number;lng:number;area:string;completed:number;target:number;status:string;updatedAt:string};
function MapResize(){const map=useMap();useEffect(()=>{const resize=()=>setTimeout(()=>map.invalidateSize(),100);document.addEventListener('fullscreenchange',resize);return()=>document.removeEventListener('fullscreenchange',resize)},[map]);return null}
function CoverageMap(){const mapRef=useRef<HTMLDivElement>(null);const [query,setQuery]=useState('');const [showStreets,setShowStreets]=useState(true);const [showLines,setShowLines]=useState(false);const agents=useMemo<AgentMapPoint[]>(()=>{try{return JSON.parse(localStorage.getItem('pulso-agent-locations')||'[]')}catch{return[]}},[]);const filteredStreets=streetCoordinates.filter(street=>`${street.name} ${street.neighborhood} ${street.district}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));const center=useMemo<[number,number]>(()=>{const valid=streetCoordinates.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));return [valid.reduce((s,x)=>s+x.lat,0)/valid.length,valid.reduce((s,x)=>s+x.lng,0)/valid.length]},[]);const fullscreen=()=>{if(!document.fullscreenElement)mapRef.current?.requestFullscreen();else document.exitFullscreen()};return <div className="content coveragePage"><div className="coverageHeader"><div><p className="eyebrow">OPERAÇÃO TERRITORIAL</p><h1>Mapa de cobertura</h1><p>Ruas georreferenciadas, agentes em campo e andamento da coleta.</p></div><div className="coverageMetrics"><span><b>{streetCoordinates.length}</b> ruas com coordenadas</span><span><b>{agents.length}</b> agentes com GPS</span></div></div><div className="mapWorkspace"><aside className="mapSide"><label><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar rua ou bairro..."/></label><div className="mapLayerTitle"><Layers3/> Camadas do mapa</div><button className={showStreets?'on':''} onClick={()=>setShowStreets(!showStreets)}><i className="layerDot streetDot"/><span><b>Pontos centrais das ruas</b><small>{filteredStreets.length} visíveis</small></span></button><button className={showLines?'on':''} onClick={()=>setShowLines(!showLines)}><i className="layerDot lineDot"/><span><b>Traçado das ruas</b><small>Geometria importada do KML</small></span></button><button className="on"><i className="layerDot agentDot"/><span><b>Agentes em campo</b><small>{agents.length?`${agents.length} com GPS ativo`:'Aguardando check-ins reais'}</small></span></button><div className="mapStatus"><ShieldCheck/><p><b>Base geográfica vinculada</b><span>633 de 636 ruas receberam latitude e longitude. Três ficaram pendentes para revisão manual.</span></p></div>{!agents.length&&<div className="noAgentGps"><MapPin/><p><b>Nenhum agente com localização ativa</b><span>Os cartões aparecerão ao passar o mouse sobre os pontos após o primeiro check-in GPS.</span></p></div>}</aside><div className="leafletShell" ref={mapRef}><button className="expandMap" onClick={fullscreen}><Maximize2/> Expandir mapa</button><MapContainer center={center} zoom={14} className="coverageLeaflet" zoomControl={true}><MapResize/><TileLayer attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/>{showLines&&filteredStreets.map(street=><Polyline key={`line-${street.id}`} positions={street.line.map(point=>[point[1],point[0]] as [number,number])} pathOptions={{color:'#e3b341',weight:2,opacity:.78}}/>)}{showStreets&&filteredStreets.map(street=><CircleMarker key={street.id} center={[street.lat,street.lng]} radius={3} pathOptions={{color:'#201d17',fillColor:'#e7b746',fillOpacity:.9,weight:1}}><Tooltip direction="top" offset={[0,-4]} opacity={1}><div className="streetTooltip"><small>LOGRADOURO</small><b>{street.name}</b><span>{street.neighborhood||street.district} · {street.cep||'CEP não informado'}</span><em>{street.lat.toFixed(6)}, {street.lng.toFixed(6)}</em></div></Tooltip></CircleMarker>)}{agents.map(agent=><CircleMarker key={agent.id} center={[agent.lat,agent.lng]} radius={9} pathOptions={{color:'#fff',fillColor:'#45a060',fillOpacity:1,weight:3}}><Tooltip direction="top" offset={[0,-8]} opacity={1}><div className="agentTooltip"><div><i>{agent.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</i><span><small>AGENTE EM CAMPO</small><b>{agent.name}</b></span></div><p><span>Localidade <b>{agent.area}</b></span><span>Andamento <b>{agent.completed} de {agent.target}</b></span><span>Status <b>{agent.status}</b></span><span>Atualizado <b>{agent.updatedAt}</b></span></p><progress value={agent.completed} max={agent.target}/></div></Tooltip></CircleMarker>)}</MapContainer><div className="mapAttribution">Imagem de satélite · Esri World Imagery</div></div></div><div className="mapImportNote"><CheckCircle2/><span><b>Coordenadas importadas sem alterar os cadastros existentes.</b> O vínculo utilizou nome + CEP e, quando necessário, somente CEP ou nome atual.</span></div></div>}

const streetNames = Array.from(
  new Set(streetCoordinates.map((s) => s.name).filter(Boolean)),
).sort((a, b) => a.localeCompare(b, "pt-BR"));

function AddressField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = useRef((() => {
    const m = /^Rua: (.*?)(?: - Nº (.*))?$/.exec(value || "");
    const street = m?.[1] || "";
    return { street, number: m?.[2] || "", knownStreet: streetNames.includes(street) };
  })()).current;
  const [query, setQuery] = useState("");
  const [selectedStreet, setSelectedStreet] = useState<string | null>(
    parsed.knownStreet ? parsed.street : null,
  );
  const [notFound, setNotFound] = useState(!!parsed.street && !parsed.knownStreet);
  const [manualStreet, setManualStreet] = useState(
    !parsed.knownStreet ? parsed.street : "",
  );
  const [houseNumber, setHouseNumber] = useState(parsed.number);
  const [open, setOpen] = useState(false);

  const matches =
    query.trim().length >= 2
      ? streetNames
          .filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  useEffect(() => {
    const street = notFound ? manualStreet.trim() : selectedStreet;
    if (street) {
      onChange(`Rua: ${street}${houseNumber.trim() ? ` - Nº ${houseNumber.trim()}` : ""}`);
    } else {
      onChange("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStreet, notFound, manualStreet, houseNumber]);

  return (
    <div className="addressField">
      {!notFound ? (
        <div className="addressAutocomplete">
          <input
            className="agentAnswerInput"
            value={selectedStreet ?? query}
            onChange={(e) => {
              setSelectedStreet(null);
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Digite o nome da rua..."
          />
          {open && (
            <div className="addressSuggestions">
              {matches.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setSelectedStreet(name);
                    setQuery(name);
                    setOpen(false);
                  }}
                >
                  {name}
                </button>
              ))}
              {query.trim().length >= 2 && (
                <button
                  type="button"
                  className="addressNotFoundOption"
                  onClick={() => {
                    setNotFound(true);
                    setOpen(false);
                  }}
                >
                  Rua não encontrada — digitar manualmente
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="addressManual">
          <input
            className="agentAnswerInput"
            value={manualStreet}
            onChange={(e) => setManualStreet(e.target.value)}
            placeholder="Nome da rua"
          />
          <button
            type="button"
            className="linkBtn"
            onClick={() => {
              setNotFound(false);
              setManualStreet("");
              setQuery("");
              setSelectedStreet(null);
            }}
          >
            ← Voltar para a busca
          </button>
        </div>
      )}
      <input
        className="agentAnswerInput"
        value={houseNumber}
        onChange={(e) => setHouseNumber(e.target.value)}
        placeholder="Número da casa"
      />
    </div>
  );
}

function AgentApp({
  back,
  online,
  act,
}: {
  back: () => void;
  online: boolean;
  act: (x: string) => void;
}) {
  const [researches, setResearches] = useState<Research[]>([]);
  const [bank, setBank] = useState<Question[]>([]);
  const [session, setSession] = useState<{
    researchId: number;
    agentId: string;
  } | null>(null);
  const [loginForm, setLoginForm] = useState({ login: "", password: "" });
  const [toast, setToast] = useState("");
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2500);
  };
  const [locality, setLocality] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(
    {},
  );
  const [justFinished, setJustFinished] = useState(false);
  const [interviewStarted, setInterviewStarted] = useState(false);
  // Entrevistas que não conseguiram sincronizar com o Supabase (offline ou
  // servidor fora do ar). Ficam guardadas aqui — e em localStorage, para
  // sobreviver a um fechamento do app — até serem reenviadas com sucesso.
  // Não guardamos login/senha junto (por segurança); o reenvio só acontece
  // enquanto a sessão atual ainda tem as credenciais em memória (voltou a
  // ficar online sem sair do app) ou logo após um novo login do mesmo agente.
  const [pendingInterviews, setPendingInterviews] = useState<
    Array<{ id: string; researchId: number; agentId: string; interview: Interview }>
  >(() => {
    try {
      const raw = localStorage.getItem("pulso-pending-interviews");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const queueInterview = (researchId: number, agentId: string, interview: Interview) => {
    setPendingInterviews((current) => {
      const next = [...current, { id: interview.id, researchId, agentId, interview }];
      localStorage.setItem("pulso-pending-interviews", JSON.stringify(next));
      return next;
    });
  };
  const flushPendingInterviews = async (login: string, password: string, researchId: number, agentId: string) => {
    const mine = pendingInterviews.filter(
      (p) => p.researchId === researchId && p.agentId === agentId,
    );
    if (!mine.length) return;
    let sent = 0;
    for (const item of mine) {
      const { error } = await supabase.rpc("pulso_agent_submit_interview", {
        p_login: login,
        p_password: password,
        p_interview: item.interview,
      });
      if (error) continue;
      sent++;
      setPendingInterviews((current) => {
        const next = current.filter((p) => p.id !== item.id);
        localStorage.setItem("pulso-pending-interviews", JSON.stringify(next));
        return next;
      });
    }
    if (sent) notify(`${sent} entrevista${sent > 1 ? "s" : ""} pendente${sent > 1 ? "s" : ""} enviada${sent > 1 ? "s" : ""} ao servidor`);
  };
  // Assim que a conexão volta (sem precisar sair e logar de novo), tenta
  // reenviar o que ficou pendente usando as credenciais ainda em memória.
  useEffect(() => {
    if (online && session && loginForm.password) {
      flushPendingInterviews(loginForm.login.trim(), loginForm.password, session.researchId, session.agentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const research = researches.find((r) => r.id === session?.researchId);
  const agent = research?.agents?.find((a) => a.id === session?.agentId);

  const persistResearches = (next: Research[]) => {
    setResearches(next);
    localStorage.setItem("pulso-research", JSON.stringify(next));
  };
  const login = async () => {
    const { data, error } = await supabase.rpc("pulso_agent_login", { p_login: loginForm.login.trim(), p_password: loginForm.password });
    if (!error && data?.research) {
      setResearches([data.research]); setBank(data.questions || []);
      const next = { researchId: data.research.id, agentId: data.agent.id };
      setSession(next); localStorage.setItem("pulso-agent-session", JSON.stringify(next));
      notify(`Bem-vindo(a), ${data.agent.name.split(" ")[0]}`);
      flushPendingInterviews(loginForm.login.trim(), loginForm.password, data.research.id, data.agent.id);
      return;
    }
    notify("Login ou senha inválidos");
  };
  const logout = () => {
    setSession(null);
    localStorage.removeItem("pulso-agent-session");
    setLocality("");
    setStepIndex(0);
    setAnswers({});
    setJustFinished(false);
    setInterviewStarted(false);
  };

  const activeQuestions = research
    ? (research.questions
        .map((id) => bank.find((q) => q.id === id))
        .filter(Boolean) as Question[])
    : [];
  const currentQuestion = activeQuestions[stepIndex];
  const quotaForArea = (quotas: Record<string, number> | undefined, area: string) => {
    if (!quotas) return 0;
    const key = Object.keys(quotas).find((k) => sameLocality(k, area));
    return key ? Number(quotas[key] || 0) : 0;
  };
  const agentAreaQuota = (area: string) => {
    const total = quotaForArea(research?.quotas, area);
    const coveringCount =
      (research?.agents || []).filter((a) =>
        a.areas.some((x) => sameLocality(x, area)),
      ).length || 1;
    return Math.ceil(total / coveringCount);
  };
  const quota = agent
    ? agent.areas.reduce((sum, area) => sum + agentAreaQuota(area), 0)
    : 0;
  const completed = agent?.completed || 0;
  const pct = quota ? Math.min(100, Math.round((completed / quota) * 100)) : 0;
  const localityQuota = agentAreaQuota(locality);
  const localityCompleted = (research?.interviews || []).filter(
    (iv) => iv.agentId === agent?.id && sameLocality(iv.locality, locality),
  ).length;
  const localityQuotaReached =
    localityQuota > 0 && localityCompleted >= localityQuota;
  const researchFinished =
    !!research &&
    (research.status !== "Ativa" ||
      ((research.target || 0) > 0 && (research.responses || 0) >= (research.target || 0)));
  const isAnswered = (q: Question) => {
    const value = answers[q.id];
    return Array.isArray(value)
      ? value.length > 0
      : typeof value === "string" && value.trim().length > 0;
  };
  const isCurrentAnswered = currentQuestion
    ? isAnswered(currentQuestion)
    : false;
  const allAnswered = activeQuestions.every(isAnswered);

  const setAnswer = (value: string | string[]) => {
    if (!currentQuestion) return;
    setAnswers((current) => ({ ...current, [currentQuestion.id]: value }));
  };
  const toggleMultiAnswer = (option: string) => {
    if (!currentQuestion) return;
    setAnswers((current) => {
      const existing = (current[currentQuestion.id] as string[]) || [];
      const next = existing.includes(option)
        ? existing.filter((o) => o !== option)
        : [...existing, option];
      return { ...current, [currentQuestion.id]: next };
    });
  };
  const submitInterview = async () => {
    if (!research || !agent) return;
    const interview = {
      id: String(Date.now()),
      agentId: agent.id,
      agentName: agent.name,
      locality,
      answers,
      submittedAt: new Date().toLocaleString("pt-BR"),
    };
    persistResearches(
      researches.map((r) =>
        r.id === research.id
          ? {
              ...r,
              responses: r.responses + 1,
              interviews: [...(r.interviews || []), interview],
              agents: (r.agents || []).map((a) =>
                a.id === agent.id
                  ? {
                      ...a,
                      completed: (a.completed || 0) + 1,
                      updatedAt: interview.submittedAt,
                    }
                  : a,
              ),
            }
          : r,
      ),
    );
    setAnswers({});
    setJustFinished(true);
    setInterviewStarted(false);
    const { error } = await supabase.rpc("pulso_agent_submit_interview", {
      p_login: loginForm.login.trim(),
      p_password: loginForm.password,
      p_interview: interview,
    });
    if (error) {
      // Fica na fila de pendentes (persistida em localStorage) e será
      // reenviada automaticamente quando a conexão voltar ou no próximo
      // login — antes disso, a entrevista ficava só no state local e era
      // perdida de vez assim que o app buscasse o estado do servidor de novo.
      queueInterview(research.id, agent.id, interview);
      notify("Sem conexão com o servidor — a entrevista será reenviada automaticamente");
      return;
    }
    notify("Entrevista salva");
  };

  return (
    <div className="agentApp">
      {toast && (
        <div className="toast">
          <CheckCircle2 />
          {toast}
        </div>
      )}
      <header>
        <div className="agentBrand">
          <div className="mark">P</div>
          <span>
            <b>Pulso Campo</b>
            <small>{research ? research.number : "Sem sessão ativa"}</small>
          </span>
        </div>
        <span className={"connection " + (online ? "" : "off")}>
          {online ? <Wifi /> : <WifiOff />}
          {online ? "Online" : "Offline"}
        </span>
      </header>
      <main>
        <button className="back" onClick={session ? logout : back}>
          ← {session ? "Sair" : "Voltar à administração"}
        </button>
        {!session || !research || !agent ? (
          <>
            <div className="agentHello">
              <p className="eyebrow">ACESSO DO AGENTE</p>
              <h1>Entrar no Pulso Campo</h1>
              <p>Use o login e a senha gerados na aba "Acessos" da pesquisa.</p>
            </div>
            <section className="routeCard agentLoginCard">
              <label>
                Login
                <input
                  value={loginForm.login}
                  onChange={(e) =>
                    setLoginForm({ ...loginForm, login: e.target.value })
                  }
                  placeholder="login do agente"
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) =>
                    setLoginForm({ ...loginForm, password: e.target.value })
                  }
                  placeholder="senha"
                />
              </label>
            </section>
            <button className="startBtn" onClick={login}>
              <UserRoundCheck /> Entrar
            </button>
          </>
        ) : researchFinished ? (
          <div className="agentHello agentFinished">
            <CheckCircle2 className="agentFinishedIcon" />
            <h1>Parabéns, você terminou!</h1>
            <p>
              Você concluiu todas as entrevistas que tinha para esta
              pesquisa. Obrigado pela participação!
            </p>
          </div>
        ) : !locality ? (
          <>
            <div className="agentHello">
              <p className="eyebrow">{research.title}</p>
              <h1>Olá, {agent.name.split(" ")[0]}.</h1>
              <p>Escolha a localidade onde você vai entrevistar agora.</p>
            </div>
            <section className="routeCard agentLocalityCard">
              {agent.areas.map((area) => {
                const areaQuota = agentAreaQuota(area);
                const areaCompleted = (research.interviews || []).filter(
                  (iv) => iv.agentId === agent.id && sameLocality(iv.locality, area),
                ).length;
                const areaDone = areaQuota > 0 && areaCompleted >= areaQuota;
                return (
                  <button
                    key={area}
                    disabled={areaDone}
                    onClick={() => setLocality(area)}
                  >
                    <MapPin /> {area}
                    {!!areaQuota && (
                      <small>
                        {areaDone
                          ? "meta atingida"
                          : `${areaCompleted}/${areaQuota}`}
                      </small>
                    )}
                  </button>
                );
              })}
            </section>
          </>
        ) : justFinished ? (
          <div className="agentHello agentFinished">
            <CheckCircle2 className="agentFinishedIcon" />
            <h1>Entrevista finalizada!</h1>
            <p>As respostas foram salvas com sucesso.</p>
            <button
              className="startBtn"
              onClick={() => {
                setStepIndex(0);
                setJustFinished(false);
              }}
            >
              <UserRoundCheck /> Começar novo questionário
            </button>
          </div>
        ) : !activeQuestions.length ? (
          <div className="agentHello">
            <p className="eyebrow">{locality}</p>
            <h1>Questionário indisponível</h1>
            <p>
              Esta pesquisa ainda não tem perguntas configuradas pela
              coordenação.
            </p>
          </div>
        ) : localityQuotaReached ? (
          <>
            <div className="agentHello">
              <p className="eyebrow">{locality}</p>
              <h1>Meta desta localidade atingida</h1>
              <p>
                Você já completou {localityCompleted} de {localityQuota}{" "}
                entrevistas nesta localidade.
                {agent.areas.length > 1
                  ? " Escolha a próxima localidade:"
                  : ""}
              </p>
            </div>
            {agent.areas.length > 1 ? (
              <section className="routeCard agentLocalityCard">
                {agent.areas.map((area) => {
                  const areaQuota = agentAreaQuota(area);
                  const areaCompleted = (research.interviews || []).filter(
                    (iv) =>
                      iv.agentId === agent.id && sameLocality(iv.locality, area),
                  ).length;
                  const areaDone = areaQuota > 0 && areaCompleted >= areaQuota;
                  return (
                    <button
                      key={area}
                      disabled={areaDone}
                      onClick={() => {
                        setLocality(area);
                        setInterviewStarted(false);
                      }}
                    >
                      <MapPin /> {area}
                      {!!areaQuota && (
                        <small>
                          {areaDone
                            ? "meta atingida"
                            : `${areaCompleted}/${areaQuota}`}
                        </small>
                      )}
                    </button>
                  );
                })}
              </section>
            ) : (
              <p className="agentHint">
                Você concluiu todas as suas localidades atribuídas.
              </p>
            )}
          </>
        ) : !interviewStarted ? (
          <div className="agentHello">
            <p className="eyebrow">
              {locality} · {quota ? `${completed} de ${quota}` : completed}{" "}
              entrevistas
            </p>
            <h1>Olá, {agent.name.split(" ")[0]}.</h1>
            <p>Pronto para começar uma nova entrevista?</p>
            <button
              className="changeLocality"
              onClick={() => { setLocality(""); setInterviewStarted(false); }}
            >
              Trocar localidade
            </button>
            <button
              className="startBtn"
              onClick={() => setInterviewStarted(true)}
            >
              <UserRoundCheck /> Iniciar entrevista
            </button>
          </div>
        ) : (
          <>
            <div className="agentQuestionMeta">
              <span>
                <MapPin /> {locality}
                {quota ? ` · ${completed}/${quota}` : ` · ${completed}`}
              </span>
              <button
                className="changeLocality"
                onClick={() => { setLocality(""); setInterviewStarted(false); }}
              >
                Trocar localidade
              </button>
            </div>
            {!!quota && (
              <div className="agentProgress">
                <i>
                  <em style={{ width: `${pct}%` }} />
                </i>
                <span>{pct}%</span>
              </div>
            )}
            <section className="routeCard">
              <div className="routeHead">
                <span>
                  <ClipboardList />
                  <i>{currentQuestion.block || "PERGUNTA"}</i>
                </span>
                <b>
                  {stepIndex + 1} de {activeQuestions.length}
                </b>
              </div>
              <h2 className="agentQuestionText">
                {resolveQuestion(
                  currentQuestion.text,
                  research.variables?.[currentQuestion.id],
                )}
              </h2>
              {closedQuestionTypes.includes(currentQuestion.type) &&
              (currentQuestion.options || []).length ? (
                <div className="questionBank agentAnswerOptions">
                  {currentQuestion.options!.map((option) => {
                    const picked =
                      currentQuestion.type === "Múltipla escolha"
                        ? (
                            (answers[currentQuestion.id] as string[]) || []
                          ).includes(option)
                        : answers[currentQuestion.id] === option;
                    return (
                      <label key={option} className={picked ? "picked" : ""}>
                        <input
                          type={
                            currentQuestion.type === "Múltipla escolha"
                              ? "checkbox"
                              : "radio"
                          }
                          checked={picked}
                          onChange={() =>
                            currentQuestion.type === "Múltipla escolha"
                              ? toggleMultiAnswer(option)
                              : setAnswer(option)
                          }
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
              ) : currentQuestion.type === "Número" ||
                currentQuestion.type === "Escala" ? (
                <input
                  className="agentAnswerInput"
                  type="number"
                  value={(answers[currentQuestion.id] as string) || ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Digite um número"
                />
              ) : currentQuestion.type === "Telefone" ? (
                <input
                  className="agentAnswerInput"
                  type="tel"
                  value={(answers[currentQuestion.id] as string) || ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              ) : currentQuestion.type === "Endereço" ? (
                <AddressField
                  key={currentQuestion.id}
                  value={(answers[currentQuestion.id] as string) || ""}
                  onChange={setAnswer}
                />
              ) : (
                <textarea
                  className="agentAnswerInput"
                  value={(answers[currentQuestion.id] as string) || ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Resposta do entrevistado"
                />
              )}
            </section>
            <div className="agentStepActions">
              {stepIndex > 0 && (
                <button
                  className="agentPrevBtn"
                  onClick={() => setStepIndex(stepIndex - 1)}
                >
                  Voltar
                </button>
              )}
              {stepIndex < activeQuestions.length - 1 ? (
                <button
                  className="startBtn"
                  disabled={!isCurrentAnswered}
                  onClick={() => setStepIndex(stepIndex + 1)}
                >
                  Próxima pergunta
                </button>
              ) : (
                <button
                  className="startBtn"
                  disabled={!allAnswered}
                  onClick={submitInterview}
                >
                  <CheckCircle2 /> Salvar entrevista
                </button>
              )}
            </div>
            {!isCurrentAnswered && (
              <p className="agentAnswerHint">
                Responda esta pergunta para continuar.
              </p>
            )}
          </>
        )}
        <div className="privacy">
          <ShieldCheck />
          <p>
            Dados de contato são usados exclusivamente para controle de
            qualidade. Nunca para comunicação política.
          </p>
        </div>
      </main>
    </div>
  );
}
