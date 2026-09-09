export const localitySections = ["Bonito", "Alto Bonito", "Estreito", "Bentivi", "Zona Rural"] as const;
export type LocalitySection = typeof localitySections[number];
export type LocalityOption = { key: string; label: string; section: LocalitySection };
export type LocalityRow = { district: string; neighborhood: string };

// Preserve existing identifiers; qualify the second Centro to avoid merging districts.
export function localityKey(row: LocalityRow) {
  if (row.district === "ESTREITO DO NORTE") return "ESTREITO DO NORTE";
  if (row.district === "ALTO BONITO" && row.neighborhood === "CENTRO") return "CENTRO — ALTO BONITO";
  return row.neighborhood || row.district;
}

// Localidades rurais conhecidas sem cobertura de ruas na base geocodificada;
// pré-cadastradas para não exigir inclusão manual em toda pesquisa nova. A
// chave segue o mesmo formato "ZONA RURAL — <nome>" usado ao adicionar uma
// localidade rural pelo formulário, preservando o vínculo com cotas já salvas.
const knownRuralLocalities = [
  "ENGENHO SERRA AZUL", "PENDANGA", "MOSCOU", "CARRILHO", "GUARETAMA", "BARRA AZUL",
  "ENGENHO PARÁ", "ENGENHO MILAGRES", "IMBIRIBEIRA", "MAXIXE", "QUILONGA", "VIRAÇÃO",
  "COLÔNIA", "RODEADOURO", "RIACHÃO", "ÁGUA VERMELHA", "BAIXA SECA", "BANANEIRA DO CURVELO",
  "BANANEIRA DO SUL", "BOSQUE", "BREJÃO", "DOIS BRAÇOS", "ENGENHO FLORESTA", "ENGENHO MÁGICO",
  "ENGENHO MATIAS", "ESTREITO DO SUL", "FERRÃO", "FURA BARREIRA", "GENGIBRE", "GROTA DO RÊGO",
  "LAJEDO DO BENTO", "MATA DA CHUVA", "MONTE SOMBRIO", "MONTE VIDIO", "MUCURI", "MURICÉ",
  "OLHO D'ÁGUA", "PAPAGAIO", "PÉ DE SERRA", "PRATINHA", "RIACHO ESCURO", "RIACHO SECO",
  "SERRA DOS VENTOS", "SÍTIO BOA VISTA", "SÍTIO COCHOS", "SÍTIO SARINO",
];

export function buildLocalities(rows: LocalityRow[]): LocalityOption[] {
  const options = new Map<string, LocalityOption>();
  rows.forEach((row) => {
    const key = localityKey(row);
    if (!key) return;
    const section: LocalitySection = row.district === "ESTREITO DO NORTE" ? "Estreito"
      : row.district === "BENTIVI" ? "Bentivi"
      : row.neighborhood === "ZONA RURAL" ? "Zona Rural"
      : row.district === "BONITO" ? "Bonito"
      : row.district === "ALTO BONITO" ? "Alto Bonito" : "Zona Rural";
    options.set(key, { key, label: key === "CENTRO — ALTO BONITO" ? "CENTRO" : key, section });
  });
  knownRuralLocalities.forEach((name) => {
    const key = `ZONA RURAL — ${name}`;
    if (!options.has(key)) options.set(key, { key, label: name, section: "Zona Rural" });
  });
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function distributionValid(target: number, quotas: Record<string, number>) {
  const values = Object.values(quotas);
  return Number.isSafeInteger(target) && target > 0 && values.length > 0
    && values.every((value) => Number.isSafeInteger(value) && value >= 0)
    && values.reduce((sum, value) => sum + value, 0) === target;
}

export function distributeInterviews(target: number, keys: string[]) {
  if (!Number.isSafeInteger(target) || target <= 0 || !keys.length) return null;
  const base = Math.floor(target / keys.length);
  return Object.fromEntries(keys.map((key, index) => [key, base + (index < target % keys.length ? 1 : 0)]));
}
