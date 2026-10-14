import { LocalityDistribution } from "./LocalityDistribution";
import { buildLocalities, distributionValid, localityKey, localitySections } from "./localities";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  type LucideIcon,
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
  Plus,
  MoreHorizontal,
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
  RefreshCw,
  KeyRound,
  Unlock,
  Moon,
  Sun,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown,
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

// Estrutura da Plataforma — a navegação deixou de ser um array fixo no
// código e passou a vir da tabela pulso_nav_items (ver migration
// 202610020003_nav_structure.sql). Este mapa só resolve o nome do ícone
// (string salva no banco) pro componente lucide real; o ícone de fallback
// cobre um valor ausente/desconhecido sem quebrar a tela.
type NavKind = "area" | "group" | "page" | "tab";
type NavStatus = "active" | "inactive" | "building";
type NavItem = {
  id: string;
  parentId: string | null;
  kind: NavKind;
  label: string;
  description: string | null;
  icon: string | null;
  route: string | null;
  position: number;
  status: NavStatus;
  createdAt: string;
  updatedAt: string;
};
const NAV_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  ClipboardList,
  FileText,
  MapPinned,
  Map,
  ChartNoAxesCombined,
  UserRoundCheck,
  Layers3,
  Users,
  ShieldCheck,
  SlidersHorizontal,
  Building2,
  Database,
  Settings,
  BarChart3,
  FileSpreadsheet,
  Printer,
  Lock,
  KeyRound,
  Search,
  Bell,
  PhoneCall,
  Download,
  MapPin,
  Route,
  Clock3,
  CheckCircle2,
  Plus,
  MoreHorizontal,
  CloudUpload,
  Maximize2,
  Wifi,
};
const navIcon = (name: string | null | undefined): LucideIcon =>
  (name && NAV_ICONS[name]) || Layers3;

const NAV_KIND_LABEL: Record<NavKind, string> = {
  area: "Área",
  group: "Grupo",
  page: "Página",
  tab: "Aba",
};
// As 8 páginas que Module() realmente sabe rotear hoje — mudar a rota de
// uma delas quebra a navegação até ela, então o formulário avisa antes.
const REAL_PAGE_ROUTES = new Set([
  "Visão geral",
  "Pesquisas",
  "Banco de perguntas",
  "Território & cotas",
  "Mapa de cobertura",
  "Relatórios",
  "Permissões",
  "Estrutura da Plataforma",
]);
function kindsAllowedUnder(parentKind: NavKind | null): NavKind[] {
  if (parentKind === null) return ["area", "group", "page"];
  if (parentKind === "area") return ["group", "page"];
  if (parentKind === "group") return ["group", "page"];
  if (parentKind === "page") return ["tab"];
  return [];
}
function navDepth(item: NavItem, items: NavItem[]): number {
  let depth = 0;
  let cur: NavItem | undefined = item;
  while (cur?.parentId) {
    cur = items.find((i) => i.id === cur!.parentId);
    if (!cur) break;
    depth++;
  }
  return depth;
}
function isNavDescendant(items: NavItem[], candidateId: string, ofId: string): boolean {
  let cur = items.find((i) => i.id === candidateId);
  while (cur?.parentId) {
    if (cur.parentId === ofId) return true;
    cur = items.find((i) => i.id === cur!.parentId);
  }
  return false;
}
function navParentOptions(
  kind: NavKind,
  items: NavItem[],
  excludeId?: string,
): { id: string | null; label: string }[] {
  const options: { id: string | null; label: string }[] = [];
  if (kindsAllowedUnder(null).includes(kind)) options.push({ id: null, label: "— Raiz —" });
  for (const it of items) {
    if (excludeId && (it.id === excludeId || isNavDescendant(items, it.id, excludeId))) continue;
    if (kindsAllowedUnder(it.kind).includes(kind)) {
      options.push({ id: it.id, label: "—".repeat(navDepth(it, items)) + " " + it.label });
    }
  }
  return options;
}

function Stat({
  label,
  value,
  note,
  tone = "dark",
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <article
      className={"stat " + tone + (onClick ? " statClickable" : "")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
    >
      <div className="statTop">
        <span>{label}</span>
        <ArrowUpRight size={18} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
// Cabeçalho de página/módulo padronizado — substitui os 3+ cabeçalhos
// escritos à mão (.moduleHero, .researchHeader, .coverageHeader...) que
// faziam a mesma coisa de jeitos ligeiramente diferentes.
function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pageHeader">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="pageHeaderDescription">{description}</p>}
      </div>
      {actions && <div className="pageHeaderActions">{actions}</div>}
    </div>
  );
}
// Estado vazio padronizado — reaproveita a classe .agentHint já usada em
// ~30 lugares (não muda o CSS existente nem o texto de cada chamada, só
// dá uma estrutura/ícone consistente a quem usar o componente a partir
// de agora).
function EmptyState({
  message,
  title,
  icon,
  action,
  center,
}: {
  message: string;
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={"emptyState" + (center ? " emptyStateCenter" : "")}>
      {icon && <div className="emptyStateIcon">{icon}</div>}
      {title && <b>{title}</b>}
      <p className="agentHint">{message}</p>
      {action}
    </div>
  );
}
// Abas padronizadas — reaproveita as classes já existentes (filterPills
// pro estilo "pill", modalTabs pro estilo de aba com sublinhado usado no
// modal de pesquisa) em vez de recriar o visual; só centraliza o padrão
// de marcação/clique que hoje é copiado à mão em ~5 lugares diferentes.
function Tabs<T extends string>({
  value,
  onChange,
  options,
  variant = "pills",
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  variant?: "pills" | "modal";
  className?: string;
}) {
  const base = variant === "modal" ? "modalTabs" : "filterPills";
  return (
    <div className={className ? `${base} ${className}` : base}>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={value === opt.value ? "selected" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
function Ring({ value }: { value: number }) {
  return (
    <div
      className="ring"
      style={{
        background: `conic-gradient(#0b5fc6 ${value * 3.6}deg,#eceef1 0)`,
      }}
    >
      <div>
        {value}
        <small>%</small>
      </div>
    </div>
  );
}
// Paleta analítica (série de gráficos) — alinhada aos tokens --chart-1..8
// em styles.css; usar só quando múltiplas séries exigirem distinção.
const chartPalette = [
  "#2563eb", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#dc2626", "#4f46e5", "#65a30d",
];
type ChartDatum = { label: string; value: number };
type ChartType = "barras-h" | "barras-v" | "pizza" | "rosca";
// Barras (deitadas, como já existia) ou em pé — mesmos dados, só muda a
// orientação de acordo com o tipo de gráfico escolhido na aba Gráficos.
function ChartBars({ data, vertical }: { data: ChartDatum[]; vertical?: boolean }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  if (vertical) {
    return (
      <div className="chartBarsVertical">
        {data.map((d) => (
          <div className="chartBarVCol" key={d.label}>
            <b>{d.value.toFixed(1).replace(".", ",")}%</b>
            <div className="chartBarVTrack">
              <i style={{ height: `${(d.value / max) * 100}%` }} />
            </div>
            <span>{d.label}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="reportBarList">
      {data.map((d) => (
        <div className="reportBarRow" key={d.label}>
          <span>{d.label}</span>
          <div className="reportBarTrack">
            <i style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <b>{d.value.toFixed(1).replace(".", ",")}%</b>
        </div>
      ))}
    </div>
  );
}
// Pizza (ou rosca, com donut=true) via conic-gradient — mesmo truque já
// usado no <Ring/> do dashboard, sem precisar de biblioteca de gráficos.
function ChartPie({ data, donut }: { data: ChartDatum[]; donut?: boolean }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  let acc = 0;
  const stops = data.map((d, i) => {
    const start = (acc / total) * 360;
    acc += d.value;
    const end = (acc / total) * 360;
    return `${chartPalette[i % chartPalette.length]} ${start}deg ${end}deg`;
  });
  return (
    <div className="chartPieWrap">
      <div className="chartPie" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        {donut && <div className="chartPieHole" />}
      </div>
      <div className="chartPieLegend">
        {data.map((d, i) => (
          <span key={d.label}>
            <i style={{ background: chartPalette[i % chartPalette.length] }} />
            {d.label} — {d.value.toFixed(1).replace(".", ",")}%
          </span>
        ))}
      </div>
    </div>
  );
}
function renderChart(type: ChartType, data: ChartDatum[]) {
  if (type === "barras-v") return <ChartBars data={data} vertical />;
  if (type === "pizza") return <ChartPie data={data} />;
  if (type === "rosca") return <ChartPie data={data} donut />;
  return <ChartBars data={data} />;
}
const monthNamesPt = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
// "Julho/26" a partir de uma data "AAAA-MM-DD" — rótulo de cada rodada
// (pesquisa) na comparação ao longo do tempo, igual ao exemplo do usuário.
function roundLabel(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!match) return value || "—";
  const [, year, month] = match;
  return `${monthNamesPt[Number(month) - 1]}/${year.slice(-2)}`;
}
// Barras verticais agrupadas — uma pergunta, um cluster por opção de
// resposta, uma barra colorida por rodada/pesquisa dentro do cluster, com o
// valor em cima e a legenda das rodadas embaixo (comparação ao longo do
// tempo, ex.: "Julho/26" vs "Setembro/26" lado a lado por opção).
function ChartGroupedBars({
  categories,
  series,
}: {
  categories: string[];
  series: { label: string; color: string; values: number[] }[];
}) {
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  return (
    <div className="groupedBarChart">
      <div className="groupedBarPlot">
        {categories.map((cat, ci) => (
          <div className="groupedBarCluster" key={cat}>
            <div className="groupedBarBars">
              {series.map((s, si) => (
                <div className="groupedBarCol" key={si}>
                  <b>{s.values[ci].toFixed(1).replace(".", ",")}</b>
                  <div
                    className="groupedBarTrack"
                    style={{
                      height: `${(s.values[ci] / max) * 100}%`,
                      background: s.color,
                    }}
                  />
                </div>
              ))}
            </div>
            <span>{cat}</span>
          </div>
        ))}
      </div>
      <div className="groupedBarLegend">
        {series.map((s, si) => (
          <span key={si}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
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
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme as "light" | "dark") || "light",
  );
  const [mobile, setMobile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState("Visão geral");
  const [agentMode, setAgentMode] = useState(false);
  const [entryChoice, setEntryChoice] = useState<"admin" | "agent" | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("pulso-supabase-admin-token") || "");
  const [adminLogin, setAdminLogin] = useState({ username: "", password: "" });
  const [navItems, setNavItems] = useState<NavItem[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reloadNav = () => {
    if (!adminToken) return;
    supabase.rpc("pulso_admin_list_nav_tree", { p_token: adminToken }).then(({ data }) => {
      setNavItems(Array.isArray(data) ? data : []);
    });
  };
  useEffect(reloadNav, [adminToken]);
  useEffect(() => {
    localStorage.setItem("pulso-nav", collapsed ? "1" : "0");
  }, [collapsed]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pulso-theme", theme);
  }, [theme]);
  // Ctrl+K / Cmd+K foca a busca já existente na topbar — não há Command
  // Palette nem busca funcional implementada ainda, então é só isso: focar
  // o campo que já existe, em vez de inventar um mecanismo novo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const a = () => setOnline(true),
      b = () => setOnline(false);
    addEventListener("online", a);
    addEventListener("offline", b);
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
        </div>
        <nav>
          {navItems
            .filter((i) => !i.parentId && i.status !== "inactive" && i.route !== "Estrutura da Plataforma")
            .sort((a, b) => a.position - b.position)
            .map((i) => {
              const n = i.route || i.label;
              const I = navIcon(i.icon);
              return (
                <button
                  key={i.id}
                  className={page === n ? "active" : ""}
                  title={i.label}
                  aria-current={page === n ? "page" : undefined}
                  onClick={() => {
                    setPage(n);
                    setMobile(false);
                  }}
                >
                  <I />
                  <span>{i.label}</span>
                </button>
              );
            })}
        </nav>
        <div className="sideFoot">
          <button onClick={() => setAgentMode(true)}>
            <PhoneCall />
            <span>App do agente</span>
          </button>
          <button
            className={settingsOpen ? "active" : ""}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Configurações"
            aria-expanded={settingsOpen}
          >
            <Settings />
            <span>Configurações</span>
            <ChevronDown className={"sideFootChevron" + (settingsOpen ? " sideFootChevronOpen" : "")} size={15} />
          </button>
          {settingsOpen && (
            <div className="sideFootSub">
              <button
                className={page === "Estrutura da Plataforma" ? "active" : ""}
                onClick={() => {
                  setPage("Estrutura da Plataforma");
                  setMobile(false);
                }}
              >
                <Layers3 />
                <span>Estrutura da Plataforma</span>
              </button>
            </div>
          )}
          <div className="profile">
            <div>JC</div>
            <span>
              <b>Josielton Cavalcante</b>
              <small>Administrador geral</small>
            </span>
          </div>
          <button className="logoutBtn" onClick={logoutAdmin} title="Sair">
            <LogOut />
            <span>Sair</span>
          </button>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <main>
        <header>
          <button className="menuBtn" onClick={() => setMobile(true)} title="Abrir menu">
            <Menu />
          </button>
          <button
            className="icon collapse"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
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
              <input
                ref={searchInputRef}
                placeholder="Buscar módulos e funcionalidades..."
              />
              <kbd className="kbdHint">Ctrl K</kbd>
            </label>
            <button className="icon" title="Notificações">
              <Bell />
            </button>
            <button
              className="icon"
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button
              className="fieldApp"
              onClick={() => setAgentMode(true)}
              title="Abrir o app do agente de campo"
            >
              <PhoneCall /> App do agente
            </button>
          </div>
        </header>
        {page === "Visão geral" ? (
          <Dashboard act={act} adminToken={adminToken} onNavigate={setPage} />
        ) : (
          <Module page={page} act={act} adminToken={adminToken} navItems={navItems} reloadNav={reloadNav} />
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

// Atalhos reais pro bloco "Acesso rápido" da Home — mesmas rotas do
// Sidebar, sem duplicar nada (não existe sistema de favoritos/recentes
// hoje, então isso cobre só o atalho direto já pedido).
const quickAccessItems: Array<[string, string, typeof LayoutDashboard]> = [
  ["Pesquisas", "Gerenciar rodadas, cotas e agentes", ClipboardList],
  ["Banco de perguntas", "Cadastrar e organizar perguntas", FileText],
  ["Território & cotas", "Ruas e localidades cadastradas", MapPinned],
  ["Relatórios", "Planilhas, gráficos e resultado", ChartNoAxesCombined],
  ["Mapa de cobertura", "Acompanhar cobertura em campo", Map],
];
function Dashboard({
  act,
  adminToken,
  onNavigate,
}: {
  act: (x: string) => void;
  adminToken: string;
  onNavigate: (page: string) => void;
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
        <section className="panel quickAccessPanel">
          <div className="panelTitle">
            <div>
              <span className="kicker">NAVEGAÇÃO</span>
              <h3>Acesso rápido</h3>
            </div>
          </div>
          <div className="quickAccessGrid">
            {quickAccessItems.map(([label, desc, Icon]) => (
              <button key={label} className="quickAccessItem" onClick={() => onNavigate(label)}>
                <span className="quickAccessIcon">
                  <Icon />
                </span>
                <span>
                  <b>{label}</b>
                  <small>{desc}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
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
  const dashQuotas = Object.entries(activeResearch?.quotas || {});

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
          onClick={() => onNavigate("Relatórios")}
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
          onClick={() => onNavigate("Pesquisas")}
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
          onClick={() => onNavigate("Território & cotas")}
        />
        <Stat
          label="Perguntas no questionário"
          value={String(activeResearch?.questions?.length || 0)}
          note="cadastradas nesta pesquisa"
          tone="warn"
          onClick={() => onNavigate("Banco de perguntas")}
        />
      </div>
      <section className="panel quickAccessPanel">
        <div className="panelTitle">
          <div>
            <span className="kicker">NAVEGAÇÃO</span>
            <h3>Acesso rápido</h3>
          </div>
        </div>
        <div className="quickAccessGrid">
          {quickAccessItems.map(([label, desc, Icon]) => (
            <button
              key={label}
              className="quickAccessItem"
              onClick={() => onNavigate(label)}
            >
              <span className="quickAccessIcon">
                <Icon />
              </span>
              <span>
                <b>{label}</b>
                <small>{desc}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// Gestão real de contas de administrador — a única parte do pedido de
// "Configurações" que tem dado de verdade por trás (tabela pulso_admins),
// por isso é a única construída. Substitui o card fictício "Permissões"
// que só mostrava "Administradores/Gerentes/Clientes/..." sem função.
type AdminRow = {
  username: string;
  name: string | null;
  email: string | null;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};
function formatDateTimeBR(value: string | null) {
  if (!value) return "Nunca acessou";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function AdminUsers({
  act,
  adminToken,
}: {
  act: (x: string) => void;
  adminToken: string;
}) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ username: "", password: "" });
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", email: "" });
  const [resettingUsername, setResettingUsername] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.rpc("pulso_admin_list_admins", { p_token: adminToken }),
      supabase.rpc("pulso_admin_whoami", { p_token: adminToken }),
    ]).then(([listRes, whoRes]) => {
      setAdmins(Array.isArray(listRes.data) ? listRes.data : []);
      setMe(whoRes.data?.username || "");
      setLoading(false);
    });
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);
  const createAdmin = async () => {
    if (!draft.username.trim() || !draft.password) {
      act("Informe usuário e senha");
      return;
    }
    const { error } = await supabase.rpc("pulso_admin_create_admin", {
      p_token: adminToken,
      p_username: draft.username.trim(),
      p_password: draft.password,
    });
    if (error) {
      act(
        error.message.includes("already exists")
          ? "Esse usuário já existe"
          : "Não foi possível criar o administrador",
      );
      return;
    }
    setDraft({ username: "", password: "" });
    act("Administrador criado");
    load();
  };
  const toggleActive = async (username: string, active: boolean) => {
    const { error } = await supabase.rpc("pulso_admin_set_active", {
      p_token: adminToken,
      p_username: username,
      p_active: active,
    });
    if (error) {
      act(
        active
          ? "Não foi possível reativar"
          : "Não é possível desativar o último administrador ativo",
      );
      return;
    }
    act(active ? "Administrador reativado" : "Administrador desativado");
    load();
  };
  const startEdit = (a: AdminRow) => {
    setEditingUsername(a.username);
    setEditDraft({ name: a.name || "", email: a.email || "" });
    setResettingUsername(null);
  };
  const saveEdit = async (username: string) => {
    const { error } = await supabase.rpc("pulso_admin_update_profile", {
      p_token: adminToken,
      p_username: username,
      p_name: editDraft.name,
      p_email: editDraft.email,
    });
    if (error) {
      act("Não foi possível salvar");
      return;
    }
    setEditingUsername(null);
    act("Dados atualizados");
    load();
  };
  const resetPassword = async (username: string) => {
    if (!newPassword) {
      act("Informe a nova senha");
      return;
    }
    const { error } = await supabase.rpc("pulso_admin_reset_password", {
      p_token: adminToken,
      p_username: username,
      p_new_password: newPassword,
    });
    if (error) {
      act("Não foi possível redefinir a senha");
      return;
    }
    setResettingUsername(null);
    setNewPassword("");
    act("Senha redefinida");
  };
  const deleteAdmin = async (username: string) => {
    if (!window.confirm(`Excluir definitivamente a conta "${username}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.rpc("pulso_admin_delete_admin", {
      p_token: adminToken,
      p_username: username,
    });
    if (error) {
      act(
        error.message.includes("own account")
          ? "Você não pode excluir sua própria conta"
          : "Não é possível excluir o último administrador ativo",
      );
      return;
    }
    act("Administrador excluído");
    load();
  };
  return (
    <div className="content">
      <PageHeader
        eyebrow="ACESSO ADMINISTRATIVO"
        title="Permissões"
        description="Contas com acesso ao painel administrativo do Pulso."
      />
      <section className="panel adminCreatePanel">
        <div className="panelTitle">
          <div>
            <span className="kicker">NOVO ACESSO</span>
            <h3>Adicionar administrador</h3>
          </div>
        </div>
        <div className="adminCreateForm">
          <input
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            placeholder="Usuário"
          />
          <input
            type="password"
            value={draft.password}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            placeholder="Senha"
          />
          <button className="primary" onClick={createAdmin}>
            <Plus /> Adicionar
          </button>
        </div>
      </section>
      <section className="panel adminListPanel">
        <div className="panelTitle">
          <div>
            <span className="kicker">CONTAS</span>
            <h3>Administradores cadastrados</h3>
          </div>
        </div>
        {loading ? (
          <p className="agentHint">Carregando...</p>
        ) : admins.length ? (
          <div className="adminTable">
            <div className="adminTableHead">
              <span>Nome</span>
              <span>Situação</span>
              <span>Último acesso</span>
              <span>Ações</span>
            </div>
            {admins.map((a) => (
              <Fragment key={a.username}>
                <div className="adminTableRow">
                  <span className="adminRowName">
                    <b>{a.name || a.username}</b>
                    <small>
                      {a.email || a.username}
                      {a.username === me && " · você"}
                    </small>
                  </span>
                  <span className={"badge " + (a.active ? "green" : "gray")}>
                    {a.active ? "Ativo" : "Desativado"}
                  </span>
                  <span className="adminRowLastLogin">{formatDateTimeBR(a.lastLoginAt)}</span>
                  <span className="adminRowActions">
                    <button className="icon" title="Editar nome/e-mail" onClick={() => startEdit(a)}>
                      <SlidersHorizontal />
                    </button>
                    <button
                      className="icon"
                      title="Redefinir senha"
                      onClick={() => {
                        setResettingUsername(a.username);
                        setEditingUsername(null);
                        setNewPassword("");
                      }}
                    >
                      <KeyRound />
                    </button>
                    <button
                      className="icon"
                      title={a.username === me ? "Você não pode desativar sua própria conta" : a.active ? "Desativar" : "Reativar"}
                      disabled={a.username === me}
                      onClick={() => toggleActive(a.username, !a.active)}
                    >
                      {a.active ? <Lock /> : <Unlock />}
                    </button>
                    <button
                      className="icon iconDanger"
                      title={a.username === me ? "Você não pode excluir sua própria conta" : "Excluir conta"}
                      disabled={a.username === me}
                      onClick={() => deleteAdmin(a.username)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
                {editingUsername === a.username && (
                  <div className="adminInlineForm">
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      placeholder="Nome"
                    />
                    <input
                      value={editDraft.email}
                      onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })}
                      placeholder="E-mail"
                    />
                    <button className="primary" onClick={() => saveEdit(a.username)}>
                      Salvar
                    </button>
                    <button className="secondary" onClick={() => setEditingUsername(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
                {resettingUsername === a.username && (
                  <div className="adminInlineForm">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Nova senha"
                    />
                    <button className="primary" onClick={() => resetPassword(a.username)}>
                      Redefinir
                    </button>
                    <button className="secondary" onClick={() => setResettingUsername(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        ) : (
          <EmptyState message="Nenhum administrador encontrado." />
        )}
      </section>
    </div>
  );
}

type NavDraft = {
  kind: NavKind;
  parentId: string | null;
  label: string;
  description: string;
  icon: string;
  route: string;
  status: NavStatus;
};
type NavDrawerState = { mode: "create" | "edit"; item?: NavItem };

function NavTreeNode({
  item,
  items,
  depth,
  expanded,
  forceOpen,
  toggleExpand,
  visibleIds,
  onEdit,
  onAddChild,
  onMoveSibling,
  onSetStatus,
  onDelete,
  isFirstSibling,
  isLastSibling,
}: {
  item: NavItem;
  items: NavItem[];
  depth: number;
  expanded: Set<string>;
  forceOpen: boolean;
  toggleExpand: (id: string) => void;
  visibleIds: Set<string> | null;
  onEdit: (item: NavItem) => void;
  onAddChild: (item: NavItem) => void;
  onMoveSibling: (item: NavItem, dir: -1 | 1) => void;
  onSetStatus: (item: NavItem, status: NavStatus) => void;
  onDelete: (item: NavItem) => void;
  isFirstSibling: boolean;
  isLastSibling: boolean;
}) {
  const children = items
    .filter((i) => (i.parentId || null) === item.id)
    .sort((a, b) => a.position - b.position);
  const hasChildren = children.length > 0;
  const isOpen = forceOpen || expanded.has(item.id);
  const Icon = navIcon(item.icon);
  return (
    <div className="navTreeNode">
      <div className="navTreeRow" style={{ paddingLeft: depth * 20 }}>
        <button
          className={"navTreeChevron" + (hasChildren ? "" : " navTreeChevronEmpty")}
          onClick={() => hasChildren && toggleExpand(item.id)}
          disabled={!hasChildren}
        >
          {hasChildren && (
            <ChevronRight className={isOpen ? "navTreeChevronOpen" : ""} />
          )}
        </button>
        <span className="navTreeIcon">
          <Icon />
        </span>
        <span className="navTreeLabel">{item.label}</span>
        <span className={"badge navKind-" + item.kind}>{NAV_KIND_LABEL[item.kind]}</span>
        <select
          className={"navStatusSelect navStatus-" + item.status}
          value={item.status}
          onChange={(e) => onSetStatus(item, e.target.value as NavStatus)}
        >
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
          <option value="building">Em construção</option>
        </select>
        <div className="navTreeActions">
          <button className="icon" title="Editar" onClick={() => onEdit(item)}>
            <Pencil />
          </button>
          {item.kind !== "tab" && (
            <button className="icon" title="Adicionar filho" onClick={() => onAddChild(item)}>
              <Plus />
            </button>
          )}
          <button
            className="icon"
            title="Mover para cima"
            disabled={isFirstSibling}
            onClick={() => onMoveSibling(item, -1)}
          >
            <ArrowUp />
          </button>
          <button
            className="icon"
            title="Mover para baixo"
            disabled={isLastSibling}
            onClick={() => onMoveSibling(item, 1)}
          >
            <ArrowDown />
          </button>
          <button className="icon iconDanger" title="Excluir" onClick={() => onDelete(item)}>
            <Trash2 />
          </button>
        </div>
      </div>
      {hasChildren && isOpen && (
        <div className="navTreeChildren">
          {children.map(
            (c, idx) =>
              (!visibleIds || visibleIds.has(c.id)) && (
                <NavTreeNode
                  key={c.id}
                  item={c}
                  items={items}
                  depth={depth + 1}
                  expanded={expanded}
                  forceOpen={forceOpen}
                  toggleExpand={toggleExpand}
                  visibleIds={visibleIds}
                  onEdit={onEdit}
                  onAddChild={onAddChild}
                  onMoveSibling={onMoveSibling}
                  onSetStatus={onSetStatus}
                  onDelete={onDelete}
                  isFirstSibling={idx === 0}
                  isLastSibling={idx === children.length - 1}
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}

function NavStructure({
  act,
  adminToken,
  navItems,
  reloadNav,
}: {
  act: (x: string) => void;
  adminToken: string;
  navItems: NavItem[];
  reloadNav: () => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<NavDrawerState | null>(null);
  const [draft, setDraft] = useState<NavDraft>({
    kind: "page",
    parentId: null,
    label: "",
    description: "",
    icon: "",
    route: "",
    status: "active",
  });

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const expandAll = () => {
    setExpanded(new Set(navItems.filter((i) => navItems.some((c) => c.parentId === i.id)).map((i) => i.id)));
  };
  const collapseAll = () => setExpanded(new Set());

  const matchedIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      navItems
        .filter(
          (i) =>
            i.label.toLowerCase().includes(q) ||
            NAV_KIND_LABEL[i.kind].toLowerCase().includes(q) ||
            (i.route || "").toLowerCase().includes(q),
        )
        .map((i) => i.id),
    );
  }, [search, navItems]);
  const visibleIds = useMemo(() => {
    if (!matchedIds) return null;
    const visible = new Set<string>();
    const byId = new globalThis.Map(navItems.map((i) => [i.id, i]));
    for (const id of matchedIds) {
      let cur: NavItem | undefined = byId.get(id);
      while (cur) {
        visible.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return visible;
  }, [matchedIds, navItems]);

  const counts = navItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] || 0) + 1;
    return acc;
  }, {});

  const openCreate = (parentId: string | null) => {
    const parentKind = parentId ? navItems.find((i) => i.id === parentId)?.kind ?? null : null;
    const allowed = kindsAllowedUnder(parentKind);
    setDrawer({ mode: "create" });
    setDraft({
      kind: allowed[0] || "page",
      parentId,
      label: "",
      description: "",
      icon: "",
      route: "",
      status: "active",
    });
  };
  const openEdit = (item: NavItem) => {
    setDrawer({ mode: "edit", item });
    setDraft({
      kind: item.kind,
      parentId: item.parentId,
      label: item.label,
      description: item.description || "",
      icon: item.icon || "",
      route: item.route || "",
      status: item.status,
    });
  };
  const closeDrawer = () => setDrawer(null);

  const moveSibling = async (item: NavItem, dir: -1 | 1) => {
    const sibs = navItems
      .filter((i) => (i.parentId || null) === (item.parentId || null))
      .sort((a, b) => a.position - b.position);
    const idx = sibs.findIndex((i) => i.id === item.id);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= sibs.length) return;
    const ids = sibs.map((i) => i.id);
    [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
    const { error } = await supabase.rpc("pulso_admin_reorder_nav_items", {
      p_token: adminToken,
      p_parent_id: item.parentId,
      p_ordered_ids: ids,
    });
    if (error) {
      act("Não foi possível reordenar");
      return;
    }
    reloadNav();
  };
  const setStatus = async (item: NavItem, status: NavStatus) => {
    const { error } = await supabase.rpc("pulso_admin_set_nav_status", {
      p_token: adminToken,
      p_id: item.id,
      p_status: status,
    });
    if (error) {
      act("Não foi possível atualizar o status");
      return;
    }
    reloadNav();
  };
  const deleteItem = async (item: NavItem) => {
    if (!window.confirm(`Excluir "${item.label}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.rpc("pulso_admin_delete_nav_item", {
      p_token: adminToken,
      p_id: item.id,
    });
    if (error) {
      const m = /has_children:(\d+)/.exec(error.message);
      act(
        m
          ? `Este item possui ${m[1]} item(ns) — remova ou mova os filhos antes de excluir.`
          : "Não foi possível excluir",
      );
      return;
    }
    act("Item excluído");
    reloadNav();
  };
  const saveDraft = async () => {
    if (!draft.label.trim()) {
      act("Informe o nome");
      return;
    }
    if (drawer?.mode === "create") {
      const { error } = await supabase.rpc("pulso_admin_create_nav_item", {
        p_token: adminToken,
        p_parent_id: draft.parentId,
        p_kind: draft.kind,
        p_label: draft.label.trim(),
        p_description: draft.description,
        p_icon: draft.icon,
        p_route: draft.route,
        p_status: draft.status,
      });
      if (error) {
        act(
          error.message.includes("already exists")
            ? "Já existe um item com esse nome neste nível"
            : "Não foi possível criar o item",
        );
        return;
      }
      act("Item criado");
      closeDrawer();
      reloadNav();
      return;
    }
    if (drawer?.mode === "edit" && drawer.item) {
      const original = drawer.item;
      const parentChanged = (draft.parentId || null) !== (original.parentId || null);
      const routeChanged = draft.route !== (original.route || "");
      if (original.kind === "page" && routeChanged && REAL_PAGE_ROUTES.has(original.route || "")) {
        if (
          !window.confirm(
            "Alterar esta rota pode afetar links, favoritos e referências existentes. Continuar?",
          )
        )
          return;
      }
      if (parentChanged) {
        if (!window.confirm(`Mover "${original.label}" para outro local da árvore?`)) return;
        const { error: moveError } = await supabase.rpc("pulso_admin_move_nav_item", {
          p_token: adminToken,
          p_id: original.id,
          p_new_parent_id: draft.parentId,
        });
        if (moveError) {
          act("Não foi possível mover o item");
          return;
        }
      }
      const { error } = await supabase.rpc("pulso_admin_update_nav_item", {
        p_token: adminToken,
        p_id: original.id,
        p_label: draft.label.trim(),
        p_description: draft.description,
        p_icon: draft.icon,
        p_route: draft.route,
        p_status: draft.status,
      });
      if (error) {
        act(
          error.message.includes("already exists")
            ? "Já existe um item com esse nome neste nível"
            : "Não foi possível salvar as alterações",
        );
        return;
      }
      act("Alterações salvas");
      closeDrawer();
      reloadNav();
    }
  };

  const rootItems = navItems.filter((i) => !i.parentId).sort((a, b) => a.position - b.position);
  const drawerKindOptions =
    drawer?.mode === "edit"
      ? [draft.kind]
      : kindsAllowedUnder(draft.parentId ? navItems.find((i) => i.id === draft.parentId)?.kind ?? null : null);

  return (
    <div className="content">
      <PageHeader
        eyebrow="CONFIGURAÇÕES"
        title="Estrutura da Plataforma"
        description="Organize áreas, grupos, páginas e abas da plataforma."
        actions={
          <div className="navHeaderActions">
            <span className="navCounters">
              Áreas: {counts.area || 0} · Grupos: {counts.group || 0} · Páginas: {counts.page || 0} · Abas:{" "}
              {counts.tab || 0}
            </span>
            <label className="navSearchBox">
              <Search />
              <input
                placeholder="Buscar na estrutura..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button className="secondary" onClick={expandAll}>
              Expandir tudo
            </button>
            <button className="secondary" onClick={collapseAll}>
              Recolher tudo
            </button>
            <button className="primary" onClick={() => openCreate(null)}>
              <Plus /> Novo item
            </button>
          </div>
        }
      />
      <section className="panel navTreePanel">
        {navItems.length === 0 ? (
          <EmptyState message="Carregando estrutura..." />
        ) : (
          <div className="navTree">
            {rootItems.map(
              (item, idx) =>
                (!visibleIds || visibleIds.has(item.id)) && (
                  <NavTreeNode
                    key={item.id}
                    item={item}
                    items={navItems}
                    depth={0}
                    expanded={expanded}
                    forceOpen={!!matchedIds}
                    toggleExpand={toggleExpand}
                    visibleIds={visibleIds}
                    onEdit={openEdit}
                    onAddChild={(it) => openCreate(it.id)}
                    onMoveSibling={moveSibling}
                    onSetStatus={setStatus}
                    onDelete={deleteItem}
                    isFirstSibling={idx === 0}
                    isLastSibling={idx === rootItems.length - 1}
                  />
                ),
            )}
          </div>
        )}
      </section>
      {drawer && (
        <div className="modalShade" onClick={closeDrawer}>
          <div className="navDrawer" onClick={(e) => e.stopPropagation()}>
            <div className="navDrawerHead">
              <h3>{drawer.mode === "create" ? "Novo item" : `Editar ${NAV_KIND_LABEL[draft.kind]}`}</h3>
              <button className="icon" onClick={closeDrawer}>
                <X />
              </button>
            </div>
            <div className="navDrawerBody">
              <label>
                Tipo
                <select
                  value={draft.kind}
                  disabled={drawer.mode === "edit"}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as NavKind })}
                >
                  {drawerKindOptions.map((k) => (
                    <option key={k} value={k}>
                      {NAV_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pai
                <select
                  value={draft.parentId || ""}
                  onChange={(e) => setDraft({ ...draft, parentId: e.target.value || null })}
                >
                  {navParentOptions(draft.kind, navItems, drawer.mode === "edit" ? drawer.item?.id : undefined).map(
                    (o) => (
                      <option key={o.id || "root"} value={o.id || ""}>
                        {o.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Nome *
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <label>
                Descrição
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
              <label>
                Ícone
                <select value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}>
                  <option value="">— sem ícone —</option>
                  {Object.keys(NAV_ICONS)
                    .sort()
                    .map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                </select>
              </label>
              {draft.icon && NAV_ICONS[draft.icon] && (
                <div className="navIconPreview">
                  {(() => {
                    const PreviewIcon = navIcon(draft.icon);
                    return <PreviewIcon />;
                  })()}
                  <span>{draft.label || "Nome do item"}</span>
                </div>
              )}
              {draft.kind === "page" && (
                <label>
                  Rota/identificador
                  <input value={draft.route} onChange={(e) => setDraft({ ...draft, route: e.target.value })} />
                </label>
              )}
              {draft.kind === "tab" && (
                <p className="navDrawerHint">
                  Abas administráveis aqui ainda não alteram as abas reais de nenhuma tela — este
                  cadastro só organiza a estrutura, sem efeito nas telas existentes.
                </p>
              )}
              <label>
                Status
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as NavStatus })}
                >
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                  <option value="building">Em construção</option>
                </select>
              </label>
            </div>
            <div className="navDrawerFoot">
              <button className="secondary" onClick={closeDrawer}>
                Cancelar
              </button>
              <button className="primary" onClick={saveDraft}>
                {drawer.mode === "create" ? "Criar" : "Salvar alterações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Module({
  page,
  act,
  adminToken,
  navItems,
  reloadNav,
}: {
  page: string;
  act: (x: string) => void;
  adminToken: string;
  navItems: NavItem[];
  reloadNav: () => void;
}) {
  if (page === "Pesquisas") return <Researches act={act} adminToken={adminToken} />;
  if (page === "Relatórios") return <Researches act={act} adminToken={adminToken} reportOnly />;
  if (page === "Banco de perguntas") return <QuestionBank adminToken={adminToken} act={act} />;
  if (page === "Território & cotas") return <Territory act={act} adminToken={adminToken} />;
  if (page === "Mapa de cobertura") return <CoverageMap />;
  if (page === "Permissões") return <AdminUsers act={act} adminToken={adminToken} />;
  if (page === "Estrutura da Plataforma")
    return <NavStructure act={act} adminToken={adminToken} navItems={navItems} reloadNav={reloadNav} />;
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
  };
  return (
    <div className="content module">
      <PageHeader
        eyebrow="GESTÃO DA PESQUISA"
        title={page}
        description="Estrutura preparada para configuração e conexão com dados reais."
        actions={
          <button
            className="primary"
            onClick={() => act("Novo registro criado como rascunho")}
          >
            <Plus /> Novo registro
          </button>
        }
      />
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
  // Correções manuais de grafia/exclusão das respostas de perguntas abertas
  // (ver "Revisar respostas" no Resultado da pesquisa) — chave externa é o
  // id da pergunta, interna é o texto cru (trim+minúsculas) da resposta.
  openAnswerCorrections?: Record<string, Record<string, OpenAnswerCorrection>>;
};
type Question = {
  id: string;
  block: string;
  text: string;
  type: string;
  vars: string[];
  options?: string[];
  // Lista de sugestões pra perguntas de "Texto aberto" (ex.: problemas da
  // localidade, nomes de candidato) — o agente digita e escolhe da lista, ou
  // digita manualmente se não encontrar; continua sendo resposta aberta, só
  // reduz erro de digitação. Editável no Banco de perguntas.
  suggestions?: string[];
  eliminatory?: boolean;
  identification?: boolean;
  city?: string;
  mandatory?: boolean;
};
const closedQuestionTypes = ["Escolha única", "Múltipla escolha", "Escala"];
// Percentual de cada opção de uma pergunta fechada sobre um conjunto de
// entrevistas — extraída daqui pra ser reusada tanto no relatório de uma
// pesquisa só quanto na comparação entre pesquisas diferentes (mesma conta).
function computeQuestionRow(interviews: Interview[], q: Question) {
  const withAnswer = interviews.filter((iv) => iv.answers[q.id] !== undefined);
  const total = withAnswer.length;
  const values = (q.options || []).map((option) => {
    if (!total) return 0;
    const count = withAnswer.filter((iv) => {
      const answer = iv.answers[q.id];
      return Array.isArray(answer) ? answer.includes(option) : answer === option;
    }).length;
    return Math.round((count / total) * 1000) / 10;
  });
  return { total, values };
}
type OpenAnswerCorrection = { label: string; excluded?: boolean };
// Grafia corrigida (ou undefined se sem resposta ou marcada como "outras")
// da resposta de uma entrevista pra uma pergunta aberta — aplica a correção
// manual de "Revisar respostas" quando existir.
function canonicalOpenAnswer(
  iv: Interview,
  questionId: string,
  corrections: Record<string, OpenAnswerCorrection> | undefined,
): string | undefined {
  const raw = iv.answers[questionId];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLocaleLowerCase("pt-BR");
  const correction = corrections?.[key];
  if (correction?.excluded) return undefined;
  return correction?.label?.trim() || trimmed;
}
// Mesma tabela cruzada localidade × resposta das perguntas fechadas (linhas
// = áreas, colunas = valores de resposta, célula = % sobre o total daquela
// área), só que os "valores de resposta" (equivalente a question.options)
// são descobertos a partir do que os entrevistados de fato escreveram,
// já com as correções de grafia/exclusão de "Revisar respostas" aplicadas —
// duas chaves cruas diferentes corrigidas pro mesmo label viram uma coluna
// só; uma marcada como excluded não entra em nenhuma coluna, só na nota de
// transparência "N descartadas como 'outras'".
function computeOpenAnswerTable(
  interviews: Interview[],
  areaGroups: { label: string; interviews: Interview[] }[],
  q: Question,
  corrections: Record<string, OpenAnswerCorrection> | undefined,
) {
  const rawGroups: Record<string, { label: string; count: number }> = {};
  for (const iv of interviews) {
    const raw = iv.answers[q.id];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const value = raw.trim();
    const key = value.toLocaleLowerCase("pt-BR");
    if (!rawGroups[key]) rawGroups[key] = { label: value, count: 0 };
    rawGroups[key].count++;
  }
  let excludedCount = 0;
  for (const [rawKey, group] of Object.entries(rawGroups)) {
    if (corrections?.[rawKey]?.excluded) excludedCount += group.count;
  }
  const rawGroupList = Object.entries(rawGroups)
    .map(([key, group]) => ({ key, ...group }))
    .sort((a, b) => b.count - a.count);

  const overallCounts: Record<string, number> = {};
  const labelByKey: Record<string, string> = {};
  for (const iv of interviews) {
    const label = canonicalOpenAnswer(iv, q.id, corrections);
    if (!label) continue;
    const key = label.toLocaleLowerCase("pt-BR");
    overallCounts[key] = (overallCounts[key] || 0) + 1;
    if (!labelByKey[key]) labelByKey[key] = label;
  }
  const labelKeys = Object.keys(overallCounts).sort((a, b) => overallCounts[b] - overallCounts[a]);
  const labels = labelKeys.map((key) => labelByKey[key]);

  const computeRow = (rowInterviews: Interview[]) => {
    const answered = rowInterviews
      .map((iv) => canonicalOpenAnswer(iv, q.id, corrections))
      .filter((v): v is string => !!v);
    const total = answered.length;
    const values = labelKeys.map((key) => {
      if (!total) return 0;
      const count = answered.filter((label) => label.toLocaleLowerCase("pt-BR") === key).length;
      return Math.round((count / total) * 1000) / 10;
    });
    return { total, values };
  };

  return {
    labels,
    rows: areaGroups.map((group) => ({
      area: group.label,
      ...computeRow(group.interviews),
    })),
    totalRow: computeRow(interviews),
    excludedCount,
    rawGroupList,
  };
}
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
  const [draft, setDraft] = useState({ text: "", block: "Geral", type: "Texto aberto", options: ["", ""], suggestions: [] as string[], eliminatory: false, city: "", mandatory: false });
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
    const suggestions = draft.type === "Texto aberto" ? draft.suggestions.map(x=>x.trim()).filter(Boolean) : undefined;
    if (!draft.text.trim()) return act("Digite o texto da pergunta");
    if (closedQuestionTypes.includes(draft.type) && (!options || options.length < 2)) return act("Informe pelo menos duas opções");
    const question: Question = { id: `Q${Date.now()}`, block: draft.block, text: draft.text.trim(), type: draft.type, vars: [], options, suggestions: suggestions?.length ? suggestions : undefined, eliminatory: draft.eliminatory, city: draft.city.trim() || undefined, mandatory: draft.mandatory };
    void persist([...questions, question]); setDraft({ text:"", block:"Geral", type:"Texto aberto", options:["",""], suggestions: [], eliminatory:false, city: draft.city, mandatory:false });
  };
  const saveEdit = () => {
    if (!editingQuestion) return;
    if (!editingQuestion.text.trim()) return act("O texto da pergunta não pode ficar vazio");
    const options = closedQuestionTypes.includes(editingQuestion.type)
      ? (editingQuestion.options || []).map((o) => o.trim()).filter(Boolean)
      : undefined;
    const suggestions = editingQuestion.type === "Texto aberto"
      ? (editingQuestion.suggestions || []).map((o) => o.trim()).filter(Boolean)
      : undefined;
    if (closedQuestionTypes.includes(editingQuestion.type) && (!options || options.length < 2)) return act("Informe pelo menos duas opções");
    void persist(questions.map((q) => (q.id === editingQuestion.id ? { ...editingQuestion, options, suggestions: suggestions?.length ? suggestions : undefined } : q)));
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
        {draft.type === "Texto aberto" && (
          <div className="optionRegister">
            <b>Lista de sugestões (opcional)</b>
            <p className="agentHint">
              O agente digita e escolhe da lista (ou digita manualmente se não
              encontrar) — ajuda a evitar erro de digitação. Deixe vazio para
              manter o campo de texto livre normal.
            </p>
            {draft.suggestions.map((suggestion, index) => (
              <div key={index}>
                <input
                  value={suggestion}
                  onChange={(e) => {
                    const suggestions = [...draft.suggestions];
                    suggestions[index] = e.target.value;
                    setDraft({ ...draft, suggestions });
                  }}
                  placeholder={`Sugestão ${index + 1}`}
                />
                <button onClick={() => setDraft({ ...draft, suggestions: draft.suggestions.filter((_, i) => i !== index) })}>×</button>
              </div>
            ))}
            <button className="secondary" onClick={() => setDraft({ ...draft, suggestions: [...draft.suggestions, ""] })}>
              <Plus /> Adicionar sugestão
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
          <EmptyState message="Nenhuma pergunta cadastrada." />
        ) : !filteredQuestions.length ? (
          <EmptyState message="Nenhuma pergunta neste bloco." />
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
                  {editingQuestion.type === "Texto aberto" && (
                    <div className="optionsEditor">
                      <span>
                        Lista de sugestões (opcional)
                        <small>O agente escolhe da lista ou digita manualmente se não encontrar — reduz erro de digitação.</small>
                      </span>
                      {(editingQuestion.suggestions || []).map((suggestion, i) => (
                        <div className="optionRow" key={i}>
                          <input
                            value={suggestion}
                            onChange={(e) => {
                              const suggestions = [...(editingQuestion.suggestions || [])];
                              suggestions[i] = e.target.value;
                              setEditingQuestion({ ...editingQuestion, suggestions });
                            }}
                            placeholder={`Sugestão ${i + 1}`}
                          />
                          <button
                            onClick={() =>
                              setEditingQuestion({
                                ...editingQuestion,
                                suggestions: (editingQuestion.suggestions || []).filter((_, x) => x !== i),
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
                            suggestions: [...(editingQuestion.suggestions || []), ""],
                          })
                        }
                      >
                        <Plus /> Adicionar sugestão
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

function Researches({ act, adminToken, reportOnly }: { act: (x: string) => void; adminToken: string; reportOnly?: boolean }) {
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
  const [status, setStatus] = useState(() => (reportOnly ? "Finalizada" : "Todas"));
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
    "planilha" | "graficos" | "resultado" | "comparar" | "revisar"
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
  // Tipo e dimensão do gráfico são por pergunta — cada pergunta escolhida
  // pode ter seu próprio estilo (uma em pizza, outra em barras verticais
  // por localidade etc.), não um ajuste único pra todas de uma vez.
  const [reportChartDimensionByQuestion, setReportChartDimensionByQuestion] = useState<
    Record<string, "localidade" | "candidato">
  >({});
  const [reportChartTypeByQuestion, setReportChartTypeByQuestion] = useState<
    Record<string, ChartType>
  >({});
  const chartDimensionFor = (questionId: string) =>
    reportChartDimensionByQuestion[questionId] || "localidade";
  const chartTypeFor = (questionId: string): ChartType =>
    reportChartTypeByQuestion[questionId] || "barras-h";
  // Filtro de localidades do "Resultado da pesquisa" — vazio = todas
  // (comportamento de sempre). Escolhido pra poder imprimir só um recorte
  // (ex.: só Bonito, ou só os bairros de Alto Bonito) sem mexer nos dados.
  const [resultadoAreaFilter, setResultadoAreaFilter] = useState<string[]>([]);
  // Nível de agrupamento usado no filtro de localidades, no Resultado da
  // pesquisa e nos Gráficos "Por localidade" — "bairro" mostra cada bairro
  // (Araticum, Bandinha...) na lista/tabela/gráfico; "localidade" agrupa
  // pelas 5 macrorregiões (Bonito, Alto Bonito, Bentivi, Estreito do Norte,
  // Zona Rural), tanto na marcação quanto no resultado. Mesmo nome usado
  // pelo usuário pras duas granularidades — não confundir com o sentido
  // antigo de "localidade" = bairro individual em `localityOptions`.
  const [areaGroupLevel, setAreaGroupLevel] = useState<"bairro" | "localidade">(
    "bairro",
  );
  const [openAnswerReviewOpen, setOpenAnswerReviewOpen] = useState<
    Record<string, boolean>
  >({});
  type ComparisonRow = {
    id: string;
    researchId: number | null;
    questionId: string | null;
    seriesLabel: string;
  };
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([
    { id: "c1", researchId: null, questionId: null, seriesLabel: "" },
  ]);

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
  // Corrigir a grafia (unificar variações da mesma resposta) ou marcar como
  // "outras" (excluir da contagem) uma resposta de pergunta aberta. Diferente
  // de updateEditing, salva sempre — não tem nada a ver com cota, então não
  // faz sentido depender de distributionValid.
  const saveOpenAnswerCorrection = (
    questionId: string,
    rawKey: string,
    patch: Partial<OpenAnswerCorrection>,
  ) => {
    if (!editing) return;
    const current = editing.openAnswerCorrections?.[questionId]?.[rawKey] || { label: "" };
    const updated: Research = {
      ...editing,
      openAnswerCorrections: {
        ...editing.openAnswerCorrections,
        [questionId]: {
          ...editing.openAnswerCorrections?.[questionId],
          [rawKey]: { ...current, ...patch },
        },
      },
    };
    setEditing(updated);
    save(items.map((item) => (item.id === editing.id ? updated : item)));
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
    const suggestions = questionEdit.type === "Texto aberto"
      ? (questionEdit.suggestions || []).map((o) => o.trim()).filter(Boolean)
      : undefined;
    saveQuestions(
      questions.map((question) =>
        question.id === questionEdit.id
          ? { ...questionEdit, vars, options, suggestions: suggestions?.length ? suggestions : undefined }
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
  // Áreas visíveis no Resultado da pesquisa — todas por padrão, ou só as
  // marcadas no filtro de localidade (ver resultadoAreaFilter, aba
  // Resultado). Recalcula tanto as linhas quanto os totais, não só esconde.
  const resultadoAreas = resultadoAreaFilter.length ? resultadoAreaFilter : editingQuotaAreas;
  const resultadoInterviews = editing
    ? (editing.interviews || []).filter(
        (iv) =>
          !resultadoAreaFilter.length ||
          resultadoAreaFilter.some((area) => sameLocality(iv.locality, area)),
      )
    : [];
  const isAreaChecked = (area: string) =>
    !resultadoAreaFilter.length || resultadoAreaFilter.includes(area);
  const toggleArea = (area: string) => {
    const checked = isAreaChecked(area);
    setResultadoAreaFilter((current) => {
      const base = current.length ? current : editingQuotaAreas;
      return checked ? base.filter((a) => a !== area) : [...base, area];
    });
  };
  const setSectionAreas = (areasInSection: string[], checked: boolean) => {
    setResultadoAreaFilter((current) => {
      const base = current.length ? current : editingQuotaAreas;
      const withoutSection = base.filter((a) => !areasInSection.includes(a));
      return checked ? [...withoutSection, ...areasInSection] : withoutSection;
    });
  };
  const resultadoAreasBySection = localitySections
    .map((section) => ({
      section,
      areas: editingQuotaAreas.filter((area) => editingEntityMacro(area) === section),
    }))
    .filter((group) => group.areas.length);
  // Painel "Filtrar localidades" — reusado tanto no Resultado da pesquisa
  // quanto nos Gráficos por localidade, pra escolher um recorte em vez de
  // sempre entrar tudo (uma pesquisa pode ter dezenas de localidades).
  const localityFilterPanel = !!editingQuotaAreas.length && (
    <div className="resultAreaFilter">
      <div className="sectionTitle agentAreaTitle">
        <div>
          <h3>Filtrar localidades</h3>
          <p>
            Escolha quais localidades entram no resultado/gráfico abaixo e
            na impressão — sem marcar nada, entram todas. Troque a
            marcação e imprima de novo pra gerar outro recorte.
          </p>
        </div>
        {!!resultadoAreaFilter.length && (
          <button className="secondary" onClick={() => setResultadoAreaFilter([])}>
            Todas as localidades
          </button>
        )}
      </div>
      <div className="filterPills reportDimensionPicker">
        <button
          className={areaGroupLevel === "bairro" ? "selected" : ""}
          onClick={() => setAreaGroupLevel("bairro")}
        >
          Bairros
        </button>
        <button
          className={areaGroupLevel === "localidade" ? "selected" : ""}
          onClick={() => setAreaGroupLevel("localidade")}
        >
          Localidade
        </button>
      </div>
      <p className="agentHint">
        {areaGroupLevel === "bairro"
          ? "Marcando por bairro, o resultado sai com o nome de cada bairro."
          : "Marcando por localidade, o resultado sai só com o nome de Bonito, Alto Bonito, Bentivi, Estreito do Norte ou Zona Rural."}
      </p>
      {resultadoAreasBySection.map(({ section, areas }) =>
        areaGroupLevel === "bairro" ? (
          <div className="resultAreaSection" key={section}>
            <div className="resultAreaSectionHead">
              <b>{section}</b>
              <span>
                <button className="linkBtn" onClick={() => setSectionAreas(areas, true)}>
                  Marcar todas
                </button>
                <button className="linkBtn" onClick={() => setSectionAreas(areas, false)}>
                  Limpar
                </button>
              </span>
            </div>
            <div className="questionBank reportQuestionPicker">
              {areas.map((area) => {
                const picked = isAreaChecked(area);
                return (
                  <label key={area} className={picked ? "picked" : ""}>
                    <input type="checkbox" checked={picked} onChange={() => toggleArea(area)} />
                    <span>
                      <b>{localityOptions.find((o) => o.key === area)?.label || area}</b>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null,
      )}
      {areaGroupLevel === "localidade" && (
        <div className="resultAreaSection">
          <div className="questionBank reportQuestionPicker">
            {resultadoAreasBySection.map(({ section, areas }) => {
              const picked = areas.every((a) => isAreaChecked(a));
              return (
                <label key={section} className={picked ? "picked" : ""}>
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={() => setSectionAreas(areas, !picked)}
                  />
                  <span>
                    <b>{section}</b>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
  // Linhas base (rótulo + entrevistas) pro nível de agrupamento escolhido —
  // "bairro" = uma por localidade do filtro; "localidade" = uma por
  // macrorregião (soma das localidades do filtro dentro dela). Alimenta a
  // tabela do Resultado da pesquisa, os gráficos "Por localidade" e (pela
  // mesma origem) o próprio filtro decide o que aparece marcável.
  const areaRowGroups: { label: string; interviews: Interview[] }[] =
    areaGroupLevel === "bairro"
      ? resultadoAreas.map((area) => ({
          label: localityOptions.find((o) => o.key === area)?.label || area,
          interviews: resultadoInterviews.filter((iv) => sameLocality(iv.locality, area)),
        }))
      : Array.from(new Set(resultadoAreas.map(editingEntityMacro))).map((section) => {
          const areasInSection = resultadoAreas.filter((a) => editingEntityMacro(a) === section);
          return {
            label: section,
            interviews: resultadoInterviews.filter((iv) =>
              areasInSection.some((a) => sameLocality(iv.locality, a)),
            ),
          };
        });
  const areaSeriesFor = (question: Question) =>
    areaRowGroups
      .map((group, i) => {
        const row = computeQuestionRow(group.interviews, question);
        return {
          label: group.label,
          color: chartPalette[i % chartPalette.length],
          values: row.values,
          total: row.total,
        };
      })
      .filter((s) => s.total > 0);
  const reportResultadoQuestions = (() => {
    if (!editing) return [];
    const closedQuestions = editing.questions
      .map((id) => questions.find((q) => q.id === id))
      .filter(
        (q): q is Question =>
          !!q &&
          closedQuestionTypes.includes(q.type) &&
          !!(q.options || []).length,
      );
    return closedQuestions.map((q) => ({
      question: q,
      rows: areaRowGroups.map((group) => ({
        area: group.label,
        ...computeQuestionRow(group.interviews, q),
      })),
      totalRow: computeQuestionRow(resultadoInterviews, q),
    }));
  })();
  // Perguntas abertas (Texto aberto, Número, Telefone, Endereço) ficavam de
  // fora do relatório impresso — reportResultadoQuestions só monta tabela
  // pra fechadas com opções, de propósito, pra não inventar percentual. Aqui
  // elas ganham a mesma tabela cruzada localidade × resposta das fechadas,
  // com as respostas de fato escritas virando as colunas (já passando pelas
  // correções de grafia/exclusão de "Revisar respostas").
  const reportOpenQuestions = (() => {
    if (!editing) return [];
    const openQuestions = editing.questions
      .map((id) => questions.find((q) => q.id === id))
      .filter(
        (q): q is Question => !!q && !closedQuestionTypes.includes(q.type),
      );
    return openQuestions
      .map((q) => ({
        question: q,
        ...computeOpenAnswerTable(
          resultadoInterviews,
          areaRowGroups,
          q,
          editing.openAnswerCorrections?.[q.id],
        ),
      }))
      .filter((q) => q.labels.length > 0 || q.excludedCount > 0 || q.rawGroupList.length > 0);
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
      {questionEdit.type === "Texto aberto" && (
        <div className="optionsEditor">
          <span>
            Lista de sugestões (opcional)
            <small>
              O agente escolhe da lista ou digita manualmente se não
              encontrar — reduz erro de digitação.
            </small>
          </span>
          {(questionEdit.suggestions || []).map((suggestion, i) => (
            <div className="optionRow" key={i}>
              <input
                value={suggestion}
                onChange={(e) => {
                  const suggestions = [...(questionEdit.suggestions || [])];
                  suggestions[i] = e.target.value;
                  setQuestionEdit({ ...questionEdit, suggestions });
                }}
                placeholder={`Sugestão ${i + 1}`}
              />
              <button
                onClick={() =>
                  setQuestionEdit({
                    ...questionEdit,
                    suggestions: (questionEdit.suggestions || []).filter(
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
                suggestions: [...(questionEdit.suggestions || []), ""],
              })
            }
          >
            <Plus /> Adicionar sugestão
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
          <p className="eyebrow">{reportOnly ? "RELATÓRIOS" : "GESTÃO DE COLETAS"}</p>
          <h1>{reportOnly ? "Relatórios" : "Pesquisas"}</h1>
          <p>
            {reportOnly
              ? "Escolha uma pesquisa para gerar planilhas, gráficos ou o resultado consolidado."
              : "Consulte o histórico, acompanhe o status e monte novos questionários."}
          </p>
        </div>
        {!reportOnly && (
          <button className="primary" onClick={openCreateResearch}>
            <Plus /> Criar nova pesquisa
          </button>
        )}
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
                {!reportOnly && (
                  <>
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
                  </>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing(x);
                    setModalTab(reportOnly ? "relatorio" : "questionario");
                    setExpandedDistricts([]);
                    resetAgentDraft();
                  }}
                >
                  {reportOnly ? (
                    <>
                      <BarChart3 /> Gerar relatório
                    </>
                  ) : (
                    "Gerenciar pesquisa"
                  )}
                </button>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <EmptyState
              center
              icon={<Search />}
              title="Nenhuma pesquisa encontrada"
              message="Ajuste a busca ou selecione outro status."
            />
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
            className={"questionView" + (modalTab === "relatorio" ? " questionViewWide" : "")}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <div>
                <small>PESQUISA {editing.number}</small>
                <h2>{editing.title}</h2>
              </div>
              <button onClick={() => setEditing(null)}>×</button>
            </div>
            {!reportOnly && (
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
            )}
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
                <Tabs
                  className="reportViewPicker"
                  value={reportView}
                  onChange={setReportView}
                  options={[
                    { value: "planilha", label: "Planilha", icon: <FileSpreadsheet /> },
                    { value: "graficos", label: "Gráficos", icon: <BarChart3 /> },
                    { value: "resultado", label: "Resultado da pesquisa", icon: <FileText /> },
                    { value: "comparar", label: "Comparar pesquisas", icon: <ChartNoAxesCombined /> },
                    { value: "revisar", label: "Revisar respostas", icon: <Pencil /> },
                  ]}
                />
                {reportView !== "planilha" && reportView !== "revisar" && (
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
                  <div className="graficosSplit">
                    <div className="graficosSidebar">
                      <div className="sectionTitle agentAreaTitle">
                        <div>
                          <h3>Perguntas</h3>
                          <p>
                            Escolha quais entram no gráfico — todas saem
                            juntas no mesmo arquivo pra imprimir.
                          </p>
                        </div>
                      </div>
                      {!!reportResultadoQuestions.length && (
                        <>
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
                        <p className="agentHint">
                          Cada pergunta escolhida ganha seu próprio seletor
                          de tipo na prévia ao lado — o agrupamento por
                          localidade usa o filtro abaixo.
                        </p>
                        {localityFilterPanel}
                        </>
                      )}
                    </div>
                    <div className="graficosPreview">
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
                    {!reportChartQuestionIds.length && (
                      <p className="agentHint">
                        Marque uma ou mais perguntas na lista ao lado pra
                        ver a prévia do gráfico aqui.
                      </p>
                    )}
                    {!!reportChartQuestionIds.length &&
                      reportResultadoQuestions
                        .filter(({ question }) =>
                          reportChartQuestionIds.includes(question.id),
                        )
                        .map(({ question, rows, totalRow }, index) => (
                          <div className="resultItem reportChartPage" key={question.id}>
                            <div className="resultLetterheadSmall">
                              <div className="resultLogoBox">
                                {letterhead.name ? letterhead.name.slice(0, 1) : "P"}
                              </div>
                              <div>
                                <span>{letterhead.name || "Instituto de pesquisa"}</span>
                                {letterhead.cnpj && <small>CNPJ {letterhead.cnpj}</small>}
                              </div>
                            </div>
                            <p className="reportChartPageMeta">
                              PESQUISA DE OPINIÃO PÚBLICA
                              <br />
                              LOCAL: {editing.city || "—"}
                              <br />
                              ÉPOCA: {formatDateBR(editing.start)} a{" "}
                              {formatDateBR(editing.end)}
                            </p>
                            <p className="resultItemHead">
                              <b>Item {index + 1} -</b>{" "}
                              {resolveQuestion(
                                question.text,
                                editing.variables?.[question.id],
                              )}
                            </p>
                            <div className="filterPills reportDimensionPicker chartPagePickers">
                              <button
                                className={chartDimensionFor(question.id) === "localidade" ? "selected" : ""}
                                onClick={() =>
                                  setReportChartDimensionByQuestion((current) => ({
                                    ...current,
                                    [question.id]: "localidade",
                                  }))
                                }
                              >
                                Por localidade
                              </button>
                              <button
                                className={chartDimensionFor(question.id) === "candidato" ? "selected" : ""}
                                onClick={() =>
                                  setReportChartDimensionByQuestion((current) => ({
                                    ...current,
                                    [question.id]: "candidato",
                                  }))
                                }
                              >
                                Por candidato / cargo
                              </button>
                            </div>
                            <div className="filterPills reportDimensionPicker chartPagePickers">
                              {(
                                [
                                  ["barras-h", "Barras horizontais"],
                                  ["barras-v", "Barras verticais"],
                                  ["pizza", "Pizza"],
                                  ["rosca", "Rosca"],
                                ] as [ChartType, string][]
                              ).map(([type, label]) => (
                                <button
                                  key={type}
                                  className={chartTypeFor(question.id) === type ? "selected" : ""}
                                  onClick={() =>
                                    setReportChartTypeByQuestion((current) => ({
                                      ...current,
                                      [question.id]: type,
                                    }))
                                  }
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <div className="reportChartPageBody">
                              {chartDimensionFor(question.id) === "candidato" ? (
                                totalRow.total ? (
                                  <article className="reportChartCard reportChartWide">
                                    {renderChart(
                                      chartTypeFor(question.id),
                                      question.options!.map((option, i) => ({
                                        label: option,
                                        value: totalRow.values[i],
                                      })),
                                    )}
                                  </article>
                                ) : (
                                  <p className="agentHint">
                                    Nenhuma entrevista registrada para esta
                                    pergunta.
                                  </p>
                                )
                              ) : (
                                (() => {
                                  const series = areaSeriesFor(question);
                                  return series.length ? (
                                    <article className="reportChartCard reportChartWide">
                                      <ChartGroupedBars
                                        categories={question.options || []}
                                        series={series}
                                      />
                                    </article>
                                  ) : (
                                    <p className="agentHint">
                                      Nenhuma entrevista registrada para esta
                                      pergunta nas localidades escolhidas.
                                    </p>
                                  );
                                })()
                              )}
                            </div>
                            {(letterhead.address ||
                              letterhead.phones ||
                              letterhead.email) && (
                              <div className="resultFooter">
                                {letterhead.address && <span>{letterhead.address}</span>}
                                {(letterhead.phones || letterhead.email) && (
                                  <span>
                                    {letterhead.phones}
                                    {letterhead.phones && letterhead.email ? " · " : ""}
                                    {letterhead.email}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                    </div>
                  </div>
                ) : reportView === "resultado" ? (
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
                    {localityFilterPanel}
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
                        <EmptyState message="Nenhuma entrevista registrada ainda. As tabelas aparecem aqui conforme os agentes forem salvando entrevistas pelo Pulso Campo." />
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
                      {reportOpenQuestions.map(
                        ({ question, labels, rows, totalRow, excludedCount }, index) => (
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
                              <b>
                                Item {reportResultadoQuestions.length + index + 1} -
                              </b>{" "}
                              {resolveQuestion(
                                question.text,
                                editing.variables?.[question.id],
                              )}
                              <small> (resposta aberta)</small>
                            </p>
                            {labels.length ? (
                              <table className="reportTable resultTable">
                                <thead>
                                  <tr>
                                    <th />
                                    {labels.map((label) => (
                                      <th key={label}>{label}</th>
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
                                            ? value.toFixed(1).replace(".", ",")
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
                                          ? value.toFixed(1).replace(".", ",")
                                          : "—"}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            ) : (
                              <p className="agentHint">
                                Todas as respostas coletadas foram marcadas
                                como "outras" nesta pergunta.
                              </p>
                            )}
                            {!!excludedCount && (
                              <p className="resultExcludedNote">
                                {excludedCount} resposta{excludedCount > 1 ? "s" : ""} marcada
                                {excludedCount > 1 ? "s" : ""} como "outras" — não conta
                                {excludedCount > 1 ? "m" : ""} no total acima.
                              </p>
                            )}
                          </div>
                        ),
                      )}
                    </div>,
                    document.body,
                    )}
                  </>
                ) : reportView === "comparar" ? (
                  <div className="graficosSplit">
                    <div className="graficosSidebar">
                    <p className="agentHint">
                      Escolha uma pesquisa e uma pergunta em cada linha — o
                      resultado sai ordenado por data, pra comparar a
                      evolução. Linhas com a mesma pergunta (ou perguntas
                      diferentes com as mesmas opções de resposta) viram um
                      gráfico só; dê um rótulo pra cada linha (ex.: "Sem
                      apoio"/"Com apoio") se não quiser usar o padrão
                      (mês/ano da pesquisa).
                    </p>
                    {comparisonRows.map((row) => {
                      const research = items.find((r) => r.id === row.researchId);
                      const rowQuestions = research
                        ? (research.questions
                            .map((id) => questions.find((q) => q.id === id))
                            .filter(
                              (q): q is Question =>
                                !!q &&
                                ((closedQuestionTypes.includes(q.type) && !!(q.options || []).length) ||
                                  q.type === "Texto aberto"),
                            ) as Question[])
                        : [];
                      return (
                        <div className="comparisonRow" key={row.id}>
                          <select
                            value={row.researchId ?? ""}
                            onChange={(e) => {
                              const researchId = e.target.value ? Number(e.target.value) : null;
                              setComparisonRows((current) =>
                                current.map((r) =>
                                  r.id === row.id
                                    ? { ...r, researchId, questionId: null }
                                    : r,
                                ),
                              );
                            }}
                          >
                            <option value="">Escolha a pesquisa...</option>
                            {[...items]
                              .sort((a, b) => a.start.localeCompare(b.start))
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.number} — {r.title} ({formatDateBR(r.start)})
                                </option>
                              ))}
                          </select>
                          <select
                            value={row.questionId ?? ""}
                            disabled={!research}
                            onChange={(e) => {
                              const questionId = e.target.value || null;
                              setComparisonRows((current) =>
                                current.map((r) => (r.id === row.id ? { ...r, questionId } : r)),
                              );
                            }}
                          >
                            <option value="">Escolha a pergunta...</option>
                            {rowQuestions.map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.text}
                              </option>
                            ))}
                          </select>
                          <input
                            value={row.seriesLabel}
                            onChange={(e) =>
                              setComparisonRows((current) =>
                                current.map((r) =>
                                  r.id === row.id ? { ...r, seriesLabel: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="Rótulo da série (opcional)"
                          />
                          {comparisonRows.length > 1 && (
                            <button
                              className="rowIconBtn rowIconBtnDanger"
                              onClick={() =>
                                setComparisonRows((current) => current.filter((r) => r.id !== row.id))
                              }
                            >
                              <Trash2 />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <button
                      className="secondary"
                      onClick={() =>
                        setComparisonRows((current) => [
                          ...current,
                          { id: `c${Date.now()}`, researchId: null, questionId: null, seriesLabel: "" },
                        ])
                      }
                    >
                      <Plus /> Adicionar pesquisa
                    </button>
                    </div>
                    <div className="graficosPreview">
                    {(() => {
                      const completeRows = comparisonRows
                        .map((row) => {
                          const research = items.find((r) => r.id === row.researchId);
                          const question = row.questionId
                            ? questions.find((q) => q.id === row.questionId)
                            : undefined;
                          if (!research || !question) return null;
                          // Fecha com opções vira categoria pelas próprias opções;
                          // aberta usa as respostas corrigidas em "Revisar
                          // respostas" dessa pesquisa como categorias.
                          const isClosed =
                            closedQuestionTypes.includes(question.type) &&
                            !!(question.options || []).length;
                          const values: Record<string, number> = {};
                          let categories: string[];
                          let hasData: boolean;
                          if (isClosed) {
                            const computed = computeQuestionRow(research.interviews || [], question);
                            categories = question.options || [];
                            categories.forEach((cat, i) => (values[cat] = computed.values[i]));
                            hasData = computed.total > 0;
                          } else {
                            const computed = computeOpenAnswerTable(
                              research.interviews || [],
                              [],
                              question,
                              research.openAnswerCorrections?.[question.id],
                            );
                            categories = computed.labels;
                            categories.forEach(
                              (cat, i) => (values[cat] = computed.totalRow.values[i]),
                            );
                            hasData = computed.totalRow.total > 0;
                          }
                          return { row, research, question, categories, values, hasData };
                        })
                        .filter((r): r is NonNullable<typeof r> => !!r)
                        .sort((a, b) => a.research.start.localeCompare(b.research.start));
                      if (!completeRows.length) {
                        return (
                          <p className="agentHint">
                            Escolha ao menos uma pesquisa e uma pergunta pra comparar.
                          </p>
                        );
                      }
                      // Mesma pergunta em pesquisas (rodadas) diferentes vira UM
                      // gráfico só — dá pra ver a evolução lado a lado. Perguntas
                      // DIFERENTES com o mesmo conjunto de respostas (ex.: mesma
                      // lista de candidatos com/sem uma informação extra) também
                      // se juntam automaticamente no mesmo gráfico.
                      const categoryKey = (cats: string[]) => [...cats].sort().join("␟");
                      type Group = { rows: typeof completeRows };
                      const groups: Group[] = [];
                      for (const entry of completeRows) {
                        const group =
                          groups.find((g) => g.rows.some((x) => x.question.id === entry.question.id)) ||
                          groups.find((g) => categoryKey(g.rows[0].categories) === categoryKey(entry.categories));
                        if (group) group.rows.push(entry);
                        else groups.push({ rows: [entry] });
                      }
                      return createPortal(
                        <div className="reportPrintArea">
                          <div className="reportPrintHead">
                            <b>Comparação entre pesquisas</b>
                            <span>Ao longo do tempo</span>
                          </div>
                          <div className="reportChartGrid">
                            {groups.map((group, gi) => {
                              const categories = Array.from(
                                new Set(group.rows.flatMap((r) => r.categories)),
                              );
                              const series = group.rows.map((entry, i) => ({
                                label:
                                  entry.row.seriesLabel.trim() ||
                                  `${roundLabel(entry.research.start)} (${entry.research.number})`,
                                color: chartPalette[i % chartPalette.length],
                                values: categories.map((cat) => entry.values[cat] || 0),
                              }));
                              const hasData = group.rows.some((r) => r.hasData);
                              return (
                                <article
                                  className="reportChartCard reportChartWide"
                                  key={group.rows.map((r) => r.row.id).join("-") || gi}
                                >
                                  <h4>{group.rows[0].question.text}</h4>
                                  {hasData ? (
                                    <ChartGroupedBars categories={categories} series={series} />
                                  ) : (
                                    <p className="agentHint">
                                      Nenhuma entrevista registrada para esta pergunta nas
                                      pesquisas escolhidas.
                                    </p>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        </div>,
                        document.body,
                      );
                    })()}
                    </div>
                  </div>
                ) : (
                  <>
                    {localityFilterPanel}
                    {reportOpenQuestions.length ? (
                      <div className="openAnswerReview openAnswerReviewFull">
                        <div className="sectionTitle agentAreaTitle">
                          <div>
                            <h3>Revisar respostas abertas</h3>
                            <p>
                              Corrija a grafia pra unificar variações da
                              mesma resposta (ex.: "agua" e "água" viram uma
                              linha só) ou marque como "outras" pra excluir
                              da contagem. Isso não aparece na impressão.
                            </p>
                          </div>
                        </div>
                        {reportOpenQuestions.map(({ question, rawGroupList }) => (
                          <div className="openAnswerReviewQuestion" key={question.id}>
                            <button
                              type="button"
                              className="linkBtn"
                              onClick={() =>
                                setOpenAnswerReviewOpen((current) => ({
                                  ...current,
                                  [question.id]: !current[question.id],
                                }))
                              }
                            >
                              {openAnswerReviewOpen[question.id] ? "▾" : "▸"}{" "}
                              {question.text} ({rawGroupList.length} resposta
                              {rawGroupList.length > 1 ? "s" : ""} distinta
                              {rawGroupList.length > 1 ? "s" : ""})
                            </button>
                            {openAnswerReviewOpen[question.id] && (
                              <div className="openAnswerReviewRows">
                                {rawGroupList.map((group) => {
                                  const correction =
                                    editing.openAnswerCorrections?.[question.id]?.[group.key];
                                  return (
                                    <div className="openAnswerReviewRow" key={group.key}>
                                      <span className="openAnswerReviewRaw">
                                        {group.label}
                                        <small>{group.count}×</small>
                                      </span>
                                      <input
                                        defaultValue={correction?.label || group.label}
                                        placeholder="Grafia correta..."
                                        disabled={!!correction?.excluded}
                                        onBlur={(e) => {
                                          const label = e.target.value.trim();
                                          if (label && label !== group.label) {
                                            saveOpenAnswerCorrection(question.id, group.key, { label });
                                          } else if (!label) {
                                            saveOpenAnswerCorrection(question.id, group.key, { label: "" });
                                          }
                                        }}
                                      />
                                      <label className="checkLabel">
                                        <input
                                          type="checkbox"
                                          checked={!!correction?.excluded}
                                          onChange={(e) =>
                                            saveOpenAnswerCorrection(question.id, group.key, {
                                              excluded: e.target.checked,
                                            })
                                          }
                                        />
                                        Marcar como outras
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="agentHint">
                        Nenhuma pergunta de texto aberto com respostas
                        registradas nesta pesquisa ainda.
                      </p>
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
                fillColor: visited.has(street.id) ? "#45a060" : "#0b5fc6",
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
function CoverageMap(){const mapRef=useRef<HTMLDivElement>(null);const [query,setQuery]=useState('');const [showStreets,setShowStreets]=useState(true);const [showLines,setShowLines]=useState(false);const agents=useMemo<AgentMapPoint[]>(()=>{try{return JSON.parse(localStorage.getItem('pulso-agent-locations')||'[]')}catch{return[]}},[]);const filteredStreets=streetCoordinates.filter(street=>`${street.name} ${street.neighborhood} ${street.district}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));const center=useMemo<[number,number]>(()=>{const valid=streetCoordinates.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));return [valid.reduce((s,x)=>s+x.lat,0)/valid.length,valid.reduce((s,x)=>s+x.lng,0)/valid.length]},[]);const fullscreen=()=>{if(!document.fullscreenElement)mapRef.current?.requestFullscreen();else document.exitFullscreen()};return <div className="content coveragePage"><PageHeader eyebrow="OPERAÇÃO TERRITORIAL" title="Mapa de cobertura" description="Ruas georreferenciadas, agentes em campo e andamento da coleta." actions={<div className="coverageMetrics"><span><b>{streetCoordinates.length}</b> ruas com coordenadas</span><span><b>{agents.length}</b> agentes com GPS</span></div>} /><div className="mapWorkspace"><aside className="mapSide"><label><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar rua ou bairro..."/></label><div className="mapLayerTitle"><Layers3/> Camadas do mapa</div><button className={showStreets?'on':''} onClick={()=>setShowStreets(!showStreets)}><i className="layerDot streetDot"/><span><b>Pontos centrais das ruas</b><small>{filteredStreets.length} visíveis</small></span></button><button className={showLines?'on':''} onClick={()=>setShowLines(!showLines)}><i className="layerDot lineDot"/><span><b>Traçado das ruas</b><small>Geometria importada do KML</small></span></button><button className="on"><i className="layerDot agentDot"/><span><b>Agentes em campo</b><small>{agents.length?`${agents.length} com GPS ativo`:'Aguardando check-ins reais'}</small></span></button><div className="mapStatus"><ShieldCheck/><p><b>Base geográfica vinculada</b><span>633 de 636 ruas receberam latitude e longitude. Três ficaram pendentes para revisão manual.</span></p></div>{!agents.length&&<div className="noAgentGps"><MapPin/><p><b>Nenhum agente com localização ativa</b><span>Os cartões aparecerão ao passar o mouse sobre os pontos após o primeiro check-in GPS.</span></p></div>}</aside><div className="leafletShell" ref={mapRef}><button className="expandMap" onClick={fullscreen}><Maximize2/> Expandir mapa</button><MapContainer center={center} zoom={14} className="coverageLeaflet" zoomControl={true}><MapResize/><TileLayer attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/>{showLines&&filteredStreets.map(street=><Polyline key={`line-${street.id}`} positions={street.line.map(point=>[point[1],point[0]] as [number,number])} pathOptions={{color:'#e3b341',weight:2,opacity:.78}}/>)}{showStreets&&filteredStreets.map(street=><CircleMarker key={street.id} center={[street.lat,street.lng]} radius={3} pathOptions={{color:'#201d17',fillColor:'#e7b746',fillOpacity:.9,weight:1}}><Tooltip direction="top" offset={[0,-4]} opacity={1}><div className="streetTooltip"><small>LOGRADOURO</small><b>{street.name}</b><span>{street.neighborhood||street.district} · {street.cep||'CEP não informado'}</span><em>{street.lat.toFixed(6)}, {street.lng.toFixed(6)}</em></div></Tooltip></CircleMarker>)}{agents.map(agent=><CircleMarker key={agent.id} center={[agent.lat,agent.lng]} radius={9} pathOptions={{color:'#fff',fillColor:'#45a060',fillOpacity:1,weight:3}}><Tooltip direction="top" offset={[0,-8]} opacity={1}><div className="agentTooltip"><div><i>{agent.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</i><span><small>AGENTE EM CAMPO</small><b>{agent.name}</b></span></div><p><span>Localidade <b>{agent.area}</b></span><span>Andamento <b>{agent.completed} de {agent.target}</b></span><span>Status <b>{agent.status}</b></span><span>Atualizado <b>{agent.updatedAt}</b></span></p><progress value={agent.completed} max={agent.target}/></div></Tooltip></CircleMarker>)}</MapContainer><div className="mapAttribution">Imagem de satélite · Esri World Imagery</div></div></div><div className="mapImportNote"><CheckCircle2/><span><b>Coordenadas importadas sem alterar os cadastros existentes.</b> O vínculo utilizou nome + CEP e, quando necessário, somente CEP ou nome atual.</span></div></div>}

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

// Campo de resposta aberta com lista de sugestões (mesmo padrão do
// AddressField acima) — o agente digita e filtra a lista, ou simplesmente
// digita algo que não está na lista: continua sendo texto livre, a lista só
// existe pra reduzir erro de digitação em respostas recorrentes (problema da
// localidade, nome de candidato etc.).
function SuggestionField({
  value,
  onChange,
  suggestions,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const matches = value.trim().length
    ? suggestions.filter((s) => s.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 8)
    : suggestions.slice(0, 8);
  return (
    <div className="addressField">
      <div className="addressAutocomplete">
        <input
          className="agentAnswerInput"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Digite ou escolha uma sugestão..."
        />
        {open && !!matches.length && (
          <div className="addressSuggestions">
            {matches.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
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
  // Sessão, pesquisa e banco de perguntas do agente ficam também em
  // localStorage (chaves próprias, não as usadas pelo painel admin) para que
  // o app continue funcionando depois de fechar/reabrir sem internet — antes
  // esses três estados só viviam em memória e sumiam a cada reload, mesmo com
  // a fila de entrevistas pendentes intacta.
  const [researches, setResearches] = useState<Research[]>(() => {
    try {
      const raw = localStorage.getItem("pulso-agent-cache-research");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [bank, setBank] = useState<Question[]>(() => {
    try {
      const raw = localStorage.getItem("pulso-agent-cache-bank");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [session, setSession] = useState<{
    researchId: number;
    agentId: string;
  } | null>(() => {
    try {
      const raw = localStorage.getItem("pulso-agent-session");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  // A senha fica guardada junto (diferente de antes) só assim é possível
  // reenviar entrevistas pendentes depois de um reload sem sinal — sem ela a
  // RPC de envio não autentica o agente. É o mesmo código de acesso gerado na
  // aba "Acessos" da pesquisa, não uma senha pessoal do agente.
  const [loginForm, setLoginForm] = useState(() => {
    try {
      const raw = localStorage.getItem("pulso-agent-credentials");
      return raw ? JSON.parse(raw) : { login: "", password: "" };
    } catch {
      return { login: "", password: "" };
    }
  });
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
    localStorage.setItem("pulso-agent-cache-research", JSON.stringify(next));
  };
  const login = async () => {
    const login = loginForm.login.trim();
    const { data, error } = await supabase.rpc("pulso_agent_login", { p_login: login, p_password: loginForm.password });
    if (!error && data?.research) {
      const nextResearches = [data.research];
      const nextBank = data.questions || [];
      setResearches(nextResearches); setBank(nextBank);
      localStorage.setItem("pulso-agent-cache-research", JSON.stringify(nextResearches));
      localStorage.setItem("pulso-agent-cache-bank", JSON.stringify(nextBank));
      const next = { researchId: data.research.id, agentId: data.agent.id };
      setSession(next); localStorage.setItem("pulso-agent-session", JSON.stringify(next));
      localStorage.setItem("pulso-agent-credentials", JSON.stringify({ login, password: loginForm.password }));
      notify(`Bem-vindo(a), ${data.agent.name.split(" ")[0]}`);
      flushPendingInterviews(login, loginForm.password, data.research.id, data.agent.id);
      return;
    }
    notify("Login ou senha inválidos");
  };
  const logout = () => {
    setSession(null);
    setResearches([]);
    setBank([]);
    setLoginForm({ login: "", password: "" });
    localStorage.removeItem("pulso-agent-session");
    localStorage.removeItem("pulso-agent-cache-research");
    localStorage.removeItem("pulso-agent-cache-bank");
    localStorage.removeItem("pulso-agent-credentials");
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

  const pendingCount = pendingInterviews.filter(
    (p) => p.researchId === session?.researchId && p.agentId === session?.agentId,
  ).length;
  const syncNow = () => {
    if (!session || !loginForm.password) return;
    if (!online) return notify("Sem internet no momento — tentaremos de novo quando voltar o sinal");
    flushPendingInterviews(loginForm.login.trim(), loginForm.password, session.researchId, session.agentId);
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
        <div className="agentHeaderStatus">
          {!!pendingCount && (
            <button
              type="button"
              className="pendingSyncBadge"
              onClick={syncNow}
              title="Tentar enviar agora"
            >
              <RefreshCw />
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </button>
          )}
          <span className={"connection " + (online ? "" : "off")}>
            {online ? <Wifi /> : <WifiOff />}
            {online ? "Online" : "Offline"}
          </span>
        </div>
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
              ) : currentQuestion.suggestions?.length ? (
                <SuggestionField
                  key={currentQuestion.id}
                  value={(answers[currentQuestion.id] as string) || ""}
                  onChange={setAnswer}
                  suggestions={currentQuestion.suggestions}
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
