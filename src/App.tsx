import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import streetsRaw from "../dados_entrada/ruas_bonito_geocodificadas.csv?raw";
import streetCoordinates from "./data/streetCoordinates.json";
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
  ["Território & cotas", MapPinned],
  ["Mapa de cobertura", Map],
  ["Equipe & rotas", Users],
  ["Auditoria", ShieldCheck],
  ["Relatórios", ChartNoAxesCombined],
  ["Simulações", SlidersHorizontal],
  ["Cadastros", Database],
  ["Permissões", UserRoundCheck],
] as const;
const localities = [
  ["Centro", 56, 70],
  ["Boa Vista / Zé Batista", 34, 40],
  ["Alto Bonito", 31, 36],
  ["Cohab", 29, 34],
  ["Cachoeira", 22, 28],
  ["Área Rural", 18, 30],
];
const agents = [
  ["Marina Silva", "Centro", "12", "Em campo"],
  ["João Henrique", "Alto Bonito", "9", "Em campo"],
  ["Carla Souza", "Cohab", "8", "Sincronizando"],
  ["Rafael Lima", "Área Rural", "6", "Offline"],
];

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
const researchAreas = Array.from(
  new Set(
    localityRows
      .map((street) => street.neighborhood || street.district)
      .filter(Boolean),
  ),
)
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, "pt-BR"));
const hasNeighborhoodWithoutDistrict = localityRows.some(
  (street) => street.neighborhood && !street.district,
);
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
const macroAreas = Array.from(
  new Set(
    localityRows
      .map((street) => street.district)
      .filter(Boolean)
      .map(districtLabel),
  ),
).concat([
  ...(localityRows.some((street) => street.neighborhood === "ZONA RURAL")
    ? ["Zona Rural"]
    : []),
  ...(hasNeighborhoodWithoutDistrict
    ? ["Sem distrito/povoado informado"]
    : []),
]);
const weightBase = Math.floor(100 / macroAreas.length);
const defaultAreaWeights = Object.fromEntries(
  macroAreas.map((area, index) => [
    area,
    weightBase + (index < 100 % macroAreas.length ? 1 : 0),
  ]),
);
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
const areaMacro = (area: string) => {
  if (area === "ZONA RURAL") return "Zona Rural";
  const street = localityRows.find(
    (item) =>
      item.neighborhood === area ||
      (!item.neighborhood && item.district === area),
  );
  if (!street?.district) return "Sem distrito/povoado informado";
  return districtLabel(street.district);
};

export function App() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("pulso-nav") === "1",
  );
  const [mobile, setMobile] = useState(false);
  const [page, setPage] = useState("Visão geral");
  const [agentMode, setAgentMode] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
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
  const completed = useMemo(
      () => localities.reduce((a, x) => a + Number(x[1]), 0),
      [],
    ),
    target = localities.reduce((a, x) => a + Number(x[2]), 0);
  const act = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2500);
  };
  if (agentMode)
    return (
      <AgentApp back={() => setAgentMode(false)} online={online} act={act} />
    );
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
            <div>JM</div>
            <span>
              <b>Josielton Melo</b>
              <small>Administrador geral</small>
            </span>
          </div>
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
          <Dashboard
            completed={completed}
            target={target}
            online={online}
            act={act}
          />
        ) : (
          <Module page={page} act={act} />
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
  completed,
  target,
  online,
  act,
}: {
  completed: number;
  target: number;
  online: boolean;
  act: (x: string) => void;
}) {
  return (
    <div className="content">
      <div className="welcome">
        <div>
          <p className="eyebrow">SEGUNDA-FEIRA, 31 DE AGOSTO</p>
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
            onClick={() => act("Nova rodada aberta em modo rascunho")}
          >
            <Plus /> Nova rodada
          </button>
        </div>
      </div>
      <section className="activeRound">
        <div>
          <span className="live">
            <i /> COLETA EM ANDAMENTO
          </span>
          <h2>Pesquisa de avaliação municipal · 004/2026</h2>
          <p>Instituto demonstrativo · 28 ago — 02 set 2026</p>
        </div>
        <button className="secondary">
          Ver detalhes <ArrowUpRight />
        </button>
      </section>
      <div className="stats">
        <Stat
          label="Entrevistas concluídas"
          value={String(completed)}
          note={`de ${target} previstas · 66%`}
        />
        <Stat
          label="Agentes em campo"
          value="8"
          note="de 10 agentes ativos"
          tone="gold"
        />
        <Stat
          label="Pendentes de envio"
          value={online ? "14" : "21"}
          note={online ? "Sincronização automática" : "Dispositivo sem conexão"}
          tone="light"
        />
        <Stat
          label="Alertas de auditoria"
          value="7"
          note="3 exigem atenção"
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
            <button className="textBtn">
              Ver todas <ArrowUpRight />
            </button>
          </div>
          <div className="progressBody">
            <Ring value={66} />
            <div className="bars">
              {localities.map((x) => (
                <div className="bar" key={x[0]}>
                  <div>
                    <span>{x[0]}</span>
                    <b>
                      {x[1]} <small>/ {x[2]}</small>
                    </b>
                  </div>
                  <i>
                    <em
                      style={{
                        width: `${(Number(x[1]) / Number(x[2])) * 100}%`,
                      }}
                    />
                  </i>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="panel mapPanel">
          <div className="panelTitle">
            <div>
              <span className="kicker">OPERAÇÃO AO VIVO</span>
              <h3>Mapa de cobertura</h3>
            </div>
            <span className={"connection " + (online ? "" : "off")}>
              {online ? <Wifi /> : <WifiOff />}
              {online ? "Ao vivo" : "Offline"}
            </span>
          </div>
          <div className="map">
            <span className="road r1" />
            <span className="road r2" />
            <span className="road r3" />
            <span className="zone z1">CENTRO</span>
            <span className="zone z2">ALTO BONITO</span>
            <span className="zone z3">COHAB</span>
            {[1, 2, 3, 4, 5, 6, 7].map((x) => (
              <MapPin key={x} className={"pin p" + x} />
            ))}
            <div className="mapLegend">
              <i /> 8 agentes ativos
            </div>
          </div>
        </section>
      </div>
      <section className="panel agents">
        <div className="panelTitle">
          <div>
            <span className="kicker">EQUIPE DE CAMPO</span>
            <h3>Atividade recente</h3>
          </div>
          <button className="textBtn">
            Gerenciar equipe <ArrowUpRight />
          </button>
        </div>
        <div className="table">
          <div className="tr th">
            <span>AGENTE</span>
            <span>LOCALIDADE ATUAL</span>
            <span>ENTREVISTAS HOJE</span>
            <span>STATUS</span>
            <span />
          </div>
          {agents.map((a, i) => (
            <div className="tr" key={a[0]}>
              <span className="person">
                <i>
                  {a[0]
                    .split(" ")
                    .map((x) => x[0])
                    .join("")
                    .slice(0, 2)}
                </i>
                <b>
                  {a[0]}
                  <small>Última atividade há {i * 3 + 2} min</small>
                </b>
              </span>
              <span>
                <MapPin /> {a[1]}
              </span>
              <strong>{a[2]}</strong>
              <span
                className={
                  "badge " +
                  (a[3] === "Offline"
                    ? "gray"
                    : a[3] === "Sincronizando"
                      ? "blue"
                      : "green")
                }
              >
                {a[3]}
              </span>
              <button className="icon">
                <MoreHorizontal />
              </button>
            </div>
          ))}
        </div>
      </section>
      <div className="disclaimer">
        <AlertTriangle />
        <div>
          <b>Ambiente demonstrativo</b>
          <p>
            Os números exibidos são dados de demonstração, não resultados reais.
            As cotas devem ser configuradas pela coordenação após a importação
            dos dados oficiais.
          </p>
        </div>
      </div>
    </div>
  );
}

function Module({ page, act }: { page: string; act: (x: string) => void }) {
  if (page === "Pesquisas") return <Researches act={act} />;
  if (page === "Território & cotas") return <Territory />;
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

function Territory() {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("Todos");
  const areas = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set(streets.map((s) => s.neighborhood).filter(Boolean)),
      ).sort(),
    ],
    [],
  );
  const filtered = streets.filter(
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
          <b>{streets.length}</b>
          <span>logradouros</span>
        </div>
      </div>
      <div className="territoryStats">
        <article>
          <MapPin />
          <span>
            <b>{streets.length}</b> nomes atuais
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
            <b>{new Set(streets.map((s) => s.district)).size}</b>{" "}
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
  interviews?: Array<{
    id: string;
    agentId: string;
    agentName: string;
    locality: string;
    answers: Record<string, string | string[]>;
    submittedAt: string;
  }>;
};
const seedResearch: Research[] = [
  {
    id: 1,
    number: "004/2026",
    title: "Avaliação municipal",
    type: "Mista",
    status: "Ativa",
    start: "28/08/2026",
    end: "02/09/2026",
    responses: 190,
    questions: ["Q01_ELEITOR", "Q02_PROBLEMA", "Q03_AVALIACAO"],
  },
  {
    id: 2,
    number: "003/2026",
    title: "Cenário eleitoral",
    type: "Eleitoral",
    status: "Finalizada",
    start: "10/03/2026",
    end: "13/03/2026",
    responses: 340,
    questions: ["Q01_ELEITOR", "Q12_GOV", "Q19_DEPFED"],
  },
  {
    id: 3,
    number: "002/2026",
    title: "Percepção da gestão",
    type: "Perfil de gestão",
    status: "Finalizada",
    start: "12/01/2026",
    end: "15/01/2026",
    responses: 320,
    questions: ["Q01_ELEITOR", "Q02_PROBLEMA", "Q03_AVALIACAO"],
  },
  {
    id: 4,
    number: "001/2026",
    title: "Teste de questionário",
    type: "Mista",
    status: "Cancelada",
    start: "05/01/2026",
    end: "—",
    responses: 18,
    questions: ["Q01_ELEITOR"],
  },
];
type Question = {
  id: string;
  block: string;
  text: string;
  type: string;
  vars: string[];
  options?: string[];
};
const closedQuestionTypes = ["Escolha única", "Múltipla escolha", "Escala"];
const seedQuestions: Question[] = [
  {
    id: "Q01_ELEITOR",
    block: "Triagem",
    text: "O(a) senhor(a) é eleitor(a) de Bonito?",
    type: "Escolha única",
    vars: [],
  },
  {
    id: "Q02_PROBLEMA",
    block: "Percepção",
    text: "Na sua opinião, qual é o principal problema de Bonito hoje?",
    type: "Texto aberto",
    vars: [],
  },
  {
    id: "Q03_AVALIACAO",
    block: "Gestão",
    text: "Como o(a) senhor(a) avalia a administração municipal?",
    type: "Escala",
    vars: [],
  },
  {
    id: "Q12_GOV",
    block: "Eleitoral",
    text: "Se a eleição para governador fosse hoje, o(a) senhor(a) votaria em {{candidato}}?",
    type: "Escolha única",
    vars: ["candidato"],
  },
  {
    id: "Q19_DEPFED",
    block: "Eleitoral",
    text: "O apoio de {{apoiador}} aumenta ou diminui sua chance de votar em {{candidato}}?",
    type: "Escolha única",
    vars: ["candidato", "apoiador"],
  },
  {
    id: "Q20_MENSAGEM",
    block: "Eleitoral",
    text: "Quando ouve “{{palavra_chave}}”, qual é a primeira opinião que vem à mente?",
    type: "Texto aberto",
    vars: ["palavra_chave"],
  },
  {
    id: "Q28_TELEFONE",
    block: "Validação",
    text: "Telefone para eventual checagem de qualidade (opcional)",
    type: "Telefone",
    vars: [],
  },
];
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

function Researches({ act }: { act: (x: string) => void }) {
  const [items, setItems] = useState<Research[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pulso-research") || "null") ||
        seedResearch
      );
    } catch {
      return seedResearch;
    }
  });
  const [questions, setQuestions] = useState<Question[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("pulso-question-bank") || "null") || seedQuestions;
    } catch {
      return seedQuestions;
    }
  });
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
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupSelection, setEditingGroupSelection] = useState<
    string[]
  >([]);
  const [expandedGroupDistricts, setExpandedGroupDistricts] = useState<
    string[]
  >([]);
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
    areaWeights: { ...defaultAreaWeights } as Record<string, number>,
    neighborhoodGroups: [] as Array<{ name: string; areas: string[]; macro: string }>,
    candidates: [] as Array<{ id: string; office: string; name: string; supporter: string }>,
    selected: ["Q01_ELEITOR"] as string[],
    variables: {} as Record<string, Record<string, string>>,
  });
  const [newQ, setNewQ] = useState({
    text: "",
    block: "Geral",
    type: "Escolha única",
  });
  const [groupName, setGroupName] = useState("");
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [candidateDraft, setCandidateDraft] = useState({ office: "", name: "", supporter: "" });
  const save = (next: Research[]) => {
    setItems(next);
    localStorage.setItem("pulso-research", JSON.stringify(next));
  };
  const saveQuestions = (next: Question[]) => {
    setQuestions(next);
    localStorage.setItem("pulso-question-bank", JSON.stringify(next));
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
    save(items.map((item) => (item.id === editing.id ? updated : item)));
    setEditing(updated);
  };
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
  const editingGroupedAreas = (editing?.neighborhoodGroups || []).flatMap(
    (group) => group.areas,
  );
  const editingUngroupedAreas = editingQuotaAreas.filter(
    (area) => !editingGroupedAreas.includes(area),
  );
  const createEditingNeighborhoodGroup = () => {
    if (!editing) return;
    if (!editingGroupName.trim() || editingGroupSelection.length < 2) {
      act("Informe um nome e selecione pelo menos dois bairros");
      return;
    }
    const macros = new Set(editingGroupSelection.map(editingEntityMacro));
    if (macros.size > 1) {
      act("Agrupe bairros pertencentes à mesma macroárea");
      return;
    }
    const key = `Grupo: ${editingGroupName.trim()}`;
    const quotas = { ...(editing.quotas || {}) };
    const mergedQuota = editingGroupSelection.reduce(
      (sum, area) => sum + Number(quotas[area] || 0),
      0,
    );
    editingGroupSelection.forEach((area) => delete quotas[area]);
    quotas[key] = mergedQuota;
    const nextAgents = (editing.agents || []).map((agent) => ({
      ...agent,
      areas: Array.from(
        new Set(
          agent.areas.map((area) =>
            editingGroupSelection.includes(area) ? key : area,
          ),
        ),
      ),
    }));
    updateEditing({
      quotas,
      neighborhoodGroups: [
        ...(editing.neighborhoodGroups || []),
        {
          name: editingGroupName.trim(),
          areas: editingGroupSelection,
          macro: editingEntityMacro(editingGroupSelection[0]),
        },
      ],
      agents: nextAgents,
    });
    setEditingGroupName("");
    setEditingGroupSelection([]);
    act("Grupo de bairros criado");
  };
  const agentCountByArea = (area: string) =>
    (editing?.agents || []).filter(
      (agent) => agent.id !== editingAgentId && agent.areas.includes(area),
    ).length;
  const agentQuotaFor = (areas: string[]) =>
    areas.reduce(
      (sum, area) => sum + Number(editing?.quotas?.[area] || 0),
      0,
    );
  const agentDraftQuota = agentQuotaFor(agentDraft.areas);
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
  const toggleGroupDistrictExpand = (district: string) =>
    setExpandedGroupDistricts((current) =>
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
  const quotaTotal = Object.values(form.quotas).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const selectedAreas = Object.keys(form.quotas);
  const groupedAreas = form.neighborhoodGroups.flatMap((group) => group.areas);
  const availableAreas = researchAreas.filter((area) => !groupedAreas.includes(area));
  const quotaEntities = [
    ...availableAreas,
    ...form.neighborhoodGroups.map((group) => `Grupo: ${group.name}`),
  ];
  const entityMacro = (entity: string) => {
    const group = form.neighborhoodGroups.find((item) => `Grupo: ${item.name}` === entity);
    return group?.macro || areaMacro(entity);
  };
  const toggleArea = (area: string) =>
    setForm((current) => {
      const quotas = { ...current.quotas };
      if (area in quotas) delete quotas[area];
      else quotas[area] = 0;
      return { ...current, quotas };
    });
  const distributeQuotas = () => {
    if (!form.target || !selectedAreas.length) {
      act("Informe a amostra total e selecione as localidades");
      return;
    }
    const activeMacros = macroAreas.filter((macro) =>
      selectedAreas.some((area) => entityMacro(area) === macro),
    );
    const weightTotal = activeMacros.reduce(
      (sum, macro) => sum + Number(form.areaWeights[macro] || 0),
      0,
    );
    if (!weightTotal) {
      act("Informe o peso das macroáreas selecionadas");
      return;
    }
    let remaining = form.target;
    const quotas: Record<string, number> = {};
    activeMacros.forEach((macro, macroIndex) => {
      const entities = selectedAreas.filter((area) => entityMacro(area) === macro);
      const macroTarget =
        macroIndex === activeMacros.length - 1
          ? remaining
          : Math.round((form.target * Number(form.areaWeights[macro] || 0)) / weightTotal);
      remaining -= macroTarget;
      const base = Math.floor(macroTarget / entities.length);
      const remainder = macroTarget % entities.length;
      entities.forEach((entity, index) => {
        quotas[entity] = base + (index < remainder ? 1 : 0);
      });
    });
    setForm((current) => ({ ...current, quotas }));
    act("Cotas distribuídas como sugestão editável");
  };
  const createNeighborhoodGroup = () => {
    if (!groupName.trim() || groupSelection.length < 2) {
      act("Informe um nome e selecione pelo menos dois bairros");
      return;
    }
    const macros = new Set(groupSelection.map(areaMacro));
    if (macros.size > 1) {
      act("Agrupe bairros pertencentes à mesma macroárea");
      return;
    }
    const key = `Grupo: ${groupName.trim()}`;
    setForm((current) => {
      const quotas = { ...current.quotas };
      groupSelection.forEach((area) => delete quotas[area]);
      quotas[key] = 0;
      return {
        ...current,
        quotas,
        neighborhoodGroups: [
          ...current.neighborhoodGroups,
          { name: groupName.trim(), areas: groupSelection, macro: areaMacro(groupSelection[0]) },
        ],
      };
    });
    setGroupName("");
    setGroupSelection([]);
    act("Grupo de bairros criado");
  };
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
      if (
        !f.selected.includes(id) &&
        f.questionTarget > 0 &&
        f.selected.length >= f.questionTarget
      ) {
        act(`O limite definido é de ${f.questionTarget} perguntas`);
        return f;
      }
      return {
        ...f,
        selected: f.selected.includes(id)
          ? f.selected.filter((x) => x !== id)
          : [...f.selected, id],
      };
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
    if (quotaTotal !== form.target) {
      act("A soma das cotas deve ser igual ao total de entrevistas");
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
        areaWeights: form.areaWeights,
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
      questionTarget: 1,
      quotas: {},
      areaWeights: { ...defaultAreaWeights },
      neighborhoodGroups: [],
      candidates: [],
      selected: ["Q01_ELEITOR"],
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
          interviews.filter((iv) => iv.locality === area),
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
            <option>Número</option><option>Telefone</option>
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
        <button className="primary" onClick={() => setCreating(true)}>
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
                          target: Math.max(0, Number(e.target.value)),
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
              <section className="formSection territorySetup">
                <div className="sectionTitle">
                  <div>
                    <h3>2. Localidades e cotas</h3>
                    <p>
                      Primeiro defina o peso das macroáreas; depois distribua
                      as entrevistas nos bairros ou grupos.
                    </p>
                  </div>
                  <b>
                    {quotaTotal} de {form.target || 0}
                  </b>
                </div>
                <div className="territoryBlock">
                  <div className="territoryBlockHead">
                    <span>1</span>
                    <div>
                      <b>Distrito, povoado e Zona Rural</b>
                      <small>Os pesos orientam a distribuição da amostra nos bairros.</small>
                    </div>
                  </div>
                  <div className="macroWeightGrid">
                    {macroAreas.map((macro) => (
                      <label key={macro}>
                        <span>{macro}</span>
                        <div>
                          <input
                            type="number"
                            min="0"
                            value={form.areaWeights[macro] || ""}
                            onChange={(e) =>
                              setForm((current) => ({
                                ...current,
                                areaWeights: {
                                  ...current.areaWeights,
                                  [macro]: Math.max(0, Number(e.target.value)),
                                },
                              }))
                            }
                          />
                          <em>%</em>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="weightTotal">
                    Peso total: <b>{Object.values(form.areaWeights).reduce((sum, value) => sum + Number(value || 0), 0)}%</b>
                  </div>
                </div>
                <div className="territoryBlock">
                  <div className="territoryBlockHead">
                    <span>2</span>
                    <div>
                      <b>Bairros e grupos de bairros</b>
                      <small>Selecione individualmente ou reúna bairros da mesma macroárea.</small>
                    </div>
                  </div>
                <div className="territoryActions">
                  <button
                    className="secondary"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        quotas: Object.fromEntries(
                          quotaEntities.map((area) => [
                            area,
                            current.quotas[area] || 0,
                          ]),
                        ),
                      }))
                    }
                  >
                    Selecionar todas
                  </button>
                  <button className="secondary" onClick={distributeQuotas}>
                    <SlidersHorizontal /> Distribuir automaticamente
                  </button>
                </div>
                <div className="areaQuotaGrid">
                  {quotaEntities.map((area) => {
                    const selected = area in form.quotas;
                    return (
                      <article key={area} className={selected ? "selected" : ""}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleArea(area)}
                          />
                          <span>{area}</span>
                          <small>{entityMacro(area)}</small>
                        </label>
                        {selected && (
                          <input
                            aria-label={`Cota de ${area}`}
                            type="number"
                            min="0"
                            value={form.quotas[area] || ""}
                            onChange={(e) =>
                              setForm((current) => ({
                                ...current,
                                quotas: {
                                  ...current.quotas,
                                  [area]: Math.max(0, Number(e.target.value)),
                                },
                              }))
                            }
                            placeholder="Cota"
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
                <div className="groupBuilder">
                  <div>
                    <b>Juntar bairros</b>
                    <small>Selecione dois ou mais bairros pertencentes à mesma macroárea.</small>
                  </div>
                  <input
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Nome do grupo, ex.: Boa Vista / Zé Batista"
                  />
                  <div className="groupAreaList">
                    {availableAreas.map((area) => (
                      <label key={area}>
                        <input
                          type="checkbox"
                          checked={groupSelection.includes(area)}
                          onChange={() =>
                            setGroupSelection((current) =>
                              current.includes(area)
                                ? current.filter((item) => item !== area)
                                : [...current, area],
                            )
                          }
                        />
                        <span>{area}<small>{areaMacro(area)}</small></span>
                      </label>
                    ))}
                  </div>
                  <button className="secondary" onClick={createNeighborhoodGroup}>
                    <Plus /> Criar grupo com {groupSelection.length} bairros
                  </button>
                  {!!form.neighborhoodGroups.length && (
                    <div className="createdGroups">
                      {form.neighborhoodGroups.map((group) => (
                        <span key={group.name}>
                          <b>{group.name}</b>
                          <small>{group.areas.join(" + ")}</small>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                </div>
                <div
                  className={`quotaCheck ${
                    quotaTotal === form.target && form.target > 0
                      ? "valid"
                      : ""
                  }`}
                >
                  {quotaTotal === form.target && form.target > 0 ? (
                    <CheckCircle2 />
                  ) : (
                    <AlertTriangle />
                  )}
                  <span>
                    <b>Soma das cotas: {quotaTotal}</b>
                    <small>
                      {quotaTotal === form.target && form.target > 0
                        ? "Distribuição compatível com a amostra total."
                        : `Ajuste as cotas para totalizar ${form.target || 0} entrevistas.`}
                    </small>
                  </span>
                </div>
              </section>
              <section className="formSection candidateSetup">
                <div className="sectionTitle">
                  <div>
                    <h3>3. Candidatos e apoios</h3>
                    <p>
                      Cadastre os nomes que serão usados na montagem das
                      perguntas desta pesquisa.
                    </p>
                  </div>
                  <b>{form.candidates.length} cadastrados</b>
                </div>
                <div className="candidateFields">
                  <label>
                    Cargo
                    <select
                      value={candidateDraft.office}
                      onChange={(e) =>
                        setCandidateDraft({
                          ...candidateDraft,
                          office: e.target.value,
                        })
                      }
                    >
                      <option value="">Selecione o cargo</option>
                      {cargos.map((cargo) => (
                        <option key={cargo}>{cargo}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Candidato ou pré-candidato
                    <input
                      value={candidateDraft.name}
                      onChange={(e) =>
                        setCandidateDraft({
                          ...candidateDraft,
                          name: e.target.value,
                        })
                      }
                      placeholder="Nome que aparecerá nas perguntas"
                    />
                  </label>
                  <label>
                    Quem apoia
                    <input
                      value={candidateDraft.supporter}
                      onChange={(e) =>
                        setCandidateDraft({
                          ...candidateDraft,
                          supporter: e.target.value,
                        })
                      }
                      placeholder="Nome da liderança ou grupo (opcional)"
                    />
                  </label>
                  <button className="secondary" onClick={addCandidate}>
                    <Plus /> Adicionar
                  </button>
                </div>
                {!!form.candidates.length && (
                  <div className="candidateList">
                    {form.candidates.map((candidate) => (
                      <article key={candidate.id}>
                        <span>
                          <small>{candidate.office}</small>
                          <b>{candidate.name}</b>
                          <em>
                            {candidate.supporter
                              ? `Apoio: ${candidate.supporter}`
                              : "Sem apoiador informado"}
                          </em>
                        </span>
                        <button
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              candidates: current.candidates.filter(
                                (item) => item.id !== candidate.id,
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
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
                <div className="questionBank">
                  {questions.map((q) => (
                    <label
                      key={q.id}
                      className={form.selected.includes(q.id) ? "picked" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={form.selected.includes(q.id)}
                        onChange={() => toggle(q.id)}
                      />
                      <span>
                        <small>
                          {q.id} · {q.block}
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
              <section className="formSection newQuestion">
                <h3>5. Adicionar nova pergunta</h3>
                <p className="markerHelp">
                  Marcadores disponíveis: <code>&#123;&#123;candidato&#125;&#125;</code>,
                  <code>&#123;&#123;apoiador&#125;&#125;</code> e
                  <code>&#123;&#123;palavra_chave&#125;&#125;</code>. Ao selecionar a
                  pergunta, o sistema solicitará esses dados.
                </p>
                <textarea
                  value={newQ.text}
                  onChange={(e) => setNewQ({ ...newQ, text: e.target.value })}
                  placeholder="Digite o texto da nova pergunta..."
                />
                <div>
                  <select
                    value={newQ.block}
                    onChange={(e) =>
                      setNewQ({ ...newQ, block: e.target.value })
                    }
                  >
                    <option>Geral</option>
                    <option>Triagem</option>
                    <option>Percepção</option>
                    <option>Gestão</option>
                    <option>Eleitoral</option>
                    <option>Perfil</option>
                    <option>Validação</option>
                  </select>
                  <select
                    value={newQ.type}
                    onChange={(e) => setNewQ({ ...newQ, type: e.target.value })}
                  >
                    <option>Escolha única</option>
                    <option>Múltipla escolha</option>
                    <option>Texto aberto</option>
                    <option>Escala</option>
                    <option>Número</option>
                  </select>
                  <button className="secondary" onClick={addQuestion}>
                    <Plus /> Adicionar ao banco
                  </button>
                </div>
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
        <div className="modalShade" onMouseDown={() => setEditing(null)}>
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
                  </div>
                </section>
                <section className="formSection">
                  <div className="sectionTitle">
                    <div>
                      <h3>2. Juntar localidades</h3>
                      <p>
                        Reúna bairros já selecionados nesta pesquisa em um
                        grupo (precisam ser da mesma macroárea).
                      </p>
                    </div>
                  </div>
                  {editingUngroupedAreas.length < 2 ? (
                    <p className="agentHint">
                      É preciso ao menos duas localidades sem grupo para
                      criar um novo grupo.
                    </p>
                  ) : (
                    <>
                      <label className="agentManualAreas">
                        Nome do grupo
                        <input
                          value={editingGroupName}
                          onChange={(e) =>
                            setEditingGroupName(e.target.value)
                          }
                          placeholder="Ex.: Boa Vista / Zé Batista"
                        />
                      </label>
                      <div className="agentAreaCascade">
                        {Array.from(
                          new Set(
                            editingUngroupedAreas.map(editingEntityMacro),
                          ),
                        ).map((district) => {
                          const areasInDistrict = editingUngroupedAreas.filter(
                            (area) => editingEntityMacro(area) === district,
                          );
                          const expanded =
                            expandedGroupDistricts.includes(district);
                          const pickedCount = areasInDistrict.filter((area) =>
                            editingGroupSelection.includes(area),
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
                                onClick={() =>
                                  toggleGroupDistrictExpand(district)
                                }
                              >
                                <ChevronDown className="cascadeChevron" />
                                <span>{district}</span>
                                <small>
                                  {pickedCount}/{areasInDistrict.length}
                                </small>
                              </button>
                              {expanded && (
                                <div className="questionBank cascadeBody">
                                  {areasInDistrict.map((area) => (
                                    <label
                                      key={area}
                                      className={
                                        editingGroupSelection.includes(area)
                                          ? "picked"
                                          : ""
                                      }
                                    >
                                      <input
                                        type="checkbox"
                                        checked={editingGroupSelection.includes(
                                          area,
                                        )}
                                        onChange={() =>
                                          setEditingGroupSelection(
                                            (current) =>
                                              current.includes(area)
                                                ? current.filter(
                                                    (a) => a !== area,
                                                  )
                                                : [...current, area],
                                          )
                                        }
                                      />
                                      <span>{area}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="agentSubmitRow">
                        <button
                          className="secondary"
                          onClick={createEditingNeighborhoodGroup}
                        >
                          <Plus /> Criar grupo
                        </button>
                      </div>
                    </>
                  )}
                  {!!(editing.neighborhoodGroups || []).length && (
                    <div className="candidateList">
                      {(editing.neighborhoodGroups || []).map((group) => (
                        <article key={group.name}>
                          <span>
                            <small>{group.macro}</small>
                            <b>{group.name}</b>
                            <em>{group.areas.join(", ")}</em>
                          </span>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="formSection">
                  <div className="sectionTitle">
                    <div>
                      <h3>3. Cargos</h3>
                      <p>
                        Cargos disponíveis para cadastro de candidatos e
                        apoios nesta e nas próximas pesquisas.
                      </p>
                    </div>
                  </div>
                  <div className="agentFields">
                    <label>
                      Novo cargo
                      <input
                        value={newCargo}
                        onChange={(e) => setNewCargo(e.target.value)}
                        placeholder="Ex.: Delegado"
                      />
                    </label>
                    <button
                      className="secondary"
                      onClick={() => {
                        if (!newCargo.trim()) return;
                        addCargo(newCargo.trim());
                        setNewCargo("");
                      }}
                    >
                      <Plus /> Adicionar
                    </button>
                  </div>
                  <div className="agentCardAreas cargoList">
                    {cargos.map((cargo) => (
                      <span key={cargo} className="agentAreaChip cargoChip">
                        {cargo}
                        <button onClick={() => removeCargo(cargo)}>×</button>
                      </span>
                    ))}
                  </div>
                </section>
              </div>
            ) : modalTab === "questionario" ? (
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
                    <div
                      key={id}
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
                  );
                })}
                {!questionnaireLocked && questionEditPanel}
              </div>
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
                            <b>{agent.password}</b>
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
                          (iv) => iv.locality === area,
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
                    </div>
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
        agent.areas.includes(street.neighborhood || street.district),
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

function AgentApp({
  back,
  online,
  act,
}: {
  back: () => void;
  online: boolean;
  act: (x: string) => void;
}) {
  const [researches, setResearches] = useState<Research[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pulso-research") || "null") ||
        seedResearch
      );
    } catch {
      return seedResearch;
    }
  });
  const [bank] = useState<Question[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("pulso-question-bank") || "null") ||
        seedQuestions
      );
    } catch {
      return seedQuestions;
    }
  });
  const [session, setSession] = useState<{
    researchId: number;
    agentId: string;
  } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("pulso-agent-session") || "null");
    } catch {
      return null;
    }
  });
  const [loginForm, setLoginForm] = useState({ login: "", password: "" });
  const [locality, setLocality] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(
    {},
  );

  const research = researches.find((r) => r.id === session?.researchId);
  const agent = research?.agents?.find((a) => a.id === session?.agentId);

  const persistResearches = (next: Research[]) => {
    setResearches(next);
    localStorage.setItem("pulso-research", JSON.stringify(next));
  };
  const login = () => {
    const match = researches
      .flatMap((r) => (r.agents || []).map((a) => ({ r, a })))
      .find(
        ({ a }) =>
          a.login &&
          a.login === loginForm.login.trim() &&
          a.password === loginForm.password,
      );
    if (!match) {
      act("Login ou senha inválidos");
      return;
    }
    if (match.a.blocked) {
      act("Este acesso está bloqueado. Fale com a coordenação.");
      return;
    }
    const next = { researchId: match.r.id, agentId: match.a.id };
    setSession(next);
    localStorage.setItem("pulso-agent-session", JSON.stringify(next));
    act(`Bem-vindo(a), ${match.a.name.split(" ")[0]}`);
  };
  const logout = () => {
    setSession(null);
    localStorage.removeItem("pulso-agent-session");
    setLocality("");
    setStepIndex(0);
    setAnswers({});
  };

  const activeQuestions = research
    ? (research.questions
        .map((id) => bank.find((q) => q.id === id))
        .filter(Boolean) as Question[])
    : [];
  const currentQuestion = activeQuestions[stepIndex];
  const quota =
    agent && research
      ? agent.areas.reduce(
          (sum, area) => sum + Number(research.quotas?.[area] || 0),
          0,
        )
      : 0;
  const completed = agent?.completed || 0;
  const pct = quota ? Math.min(100, Math.round((completed / quota) * 100)) : 0;
  const localityQuota = research?.quotas?.[locality] || 0;
  const localityCompleted = (research?.interviews || []).filter(
    (iv) => iv.agentId === agent?.id && iv.locality === locality,
  ).length;
  const localityQuotaReached =
    localityQuota > 0 && localityCompleted >= localityQuota;
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
  const submitInterview = () => {
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
    setStepIndex(0);
    setAnswers({});
    act("Entrevista salva");
  };

  return (
    <div className="agentApp">
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
        ) : !locality ? (
          <>
            <div className="agentHello">
              <p className="eyebrow">{research.title}</p>
              <h1>Olá, {agent.name.split(" ")[0]}.</h1>
              <p>Escolha a localidade onde você vai entrevistar agora.</p>
            </div>
            <section className="routeCard agentLocalityCard">
              {agent.areas.map((area) => {
                const areaQuota = research.quotas?.[area] || 0;
                const areaCompleted = (research.interviews || []).filter(
                  (iv) => iv.agentId === agent.id && iv.locality === area,
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
          <div className="agentHello">
            <p className="eyebrow">{locality}</p>
            <h1>Meta desta localidade atingida</h1>
            <p>
              Você já completou {localityCompleted} de {localityQuota}{" "}
              entrevistas nesta localidade. Escolha outra localidade para
              continuar.
            </p>
            <button
              className="changeLocality"
              onClick={() => setLocality("")}
            >
              Trocar localidade
            </button>
          </div>
        ) : (
          <>
            <div className="agentHello">
              <p className="eyebrow">
                {locality} · {quota ? `${completed} de ${quota}` : completed}{" "}
                entrevistas
              </p>
              <h1>Olá, {agent.name.split(" ")[0]}.</h1>
              <button
                className="changeLocality"
                onClick={() => setLocality("")}
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
