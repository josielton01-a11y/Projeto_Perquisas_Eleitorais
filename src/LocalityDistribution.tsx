import { useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, SlidersHorizontal } from "lucide-react";
import { distributeInterviews, distributionValid, localitySections, type LocalityOption } from "./localities";

export function LocalityDistribution({ target, quotas, options, onChange }: {
  target: number;
  quotas: Record<string, number>;
  options: LocalityOption[];
  onChange: (quotas: Record<string, number>) => void;
}) {
  const [ruralName, setRuralName] = useState("");
  const [ruralCount, setRuralCount] = useState("");
  const [error, setError] = useState("");
  const total = Object.values(quotas).reduce((sum, value) => sum + value, 0);
  const valid = distributionValid(target, quotas);
  const allOptions = [...options, ...Object.keys(quotas).filter((key) => !options.some((option) => option.key === key))
    .map((key): LocalityOption => ({ key, label: key.replace(/^ZONA RURAL — /, ""), section: "Zona Rural" }))];
  const toggle = (key: string) => {
    const next = { ...quotas };
    if (key in next) delete next[key]; else next[key] = 0;
    onChange(next);
  };
  const addRural = () => {
    const name = ruralName.trim().replace(/\s+/g, " ");
    const quantity = Number(ruralCount);
    if (!name || !ruralCount || !Number.isSafeInteger(quantity) || quantity < 0) {
      setError("Informe o nome da localidade e uma quantidade inteira, igual ou maior que zero.");
      return;
    }
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR");
    if (allOptions.some((option) => option.section === "Zona Rural" && normalize(option.label) === normalize(name))) {
      setError("Esta localidade já está na lista. Ajuste a quantidade no campo correspondente.");
      return;
    }
    onChange({ ...quotas, [`ZONA RURAL — ${name.toLocaleUpperCase("pt-BR")}`]: quantity });
    setRuralName(""); setRuralCount(""); setError("");
  };
  return <section className="formSection territorySetup">
    <div className="sectionTitle"><div><h3>2. Localidades e entrevistas</h3><p>Selecione os bairros e informe quantas pessoas serão entrevistadas em cada localidade.</p></div><b>{total} de {target}</b></div>
    <div className="territoryActions">
      <button type="button" className="secondary" onClick={() => onChange(Object.fromEntries(allOptions.map(({ key }) => [key, quotas[key] || 0])))}>Selecionar todas</button>
      <button type="button" className="secondary" onClick={() => {
        const next = distributeInterviews(target, Object.keys(quotas));
        if (next) { onChange(next); setError(""); }
        else setError("Informe o total de pessoas a entrevistar e selecione pelo menos uma localidade.");
      }}><SlidersHorizontal /> Distribuir automaticamente</button>
    </div>
    {localitySections.map((section) => {
      const entries = allOptions.filter((option) => option.section === section);
      const subtotal = entries.reduce((sum, { key }) => sum + (quotas[key] || 0), 0);
      return <div className="territoryBlock localitySection" key={section}>
        <div className="localitySectionHead"><h4>{section}</h4><span>{subtotal} entrevistas</span></div>
        {!!entries.length && <div className="areaQuotaGrid">{entries.map(({ key, label }) => <article key={key} className={key in quotas ? "selected" : ""}>
          <label><input type="checkbox" checked={key in quotas} onChange={() => toggle(key)} /><span title={label}>{label}</span></label>
          {key in quotas && <input aria-label={`Entrevistas em ${label}, ${section}`} type="number" min="0" step="1" value={quotas[key] || ""} placeholder="0" onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isSafeInteger(value) && value >= 0) onChange({ ...quotas, [key]: value });
          }} />}
        </article>)}</div>}
        {section === "Zona Rural" && <div className="ruralLocalityForm">
          <p>Se necessário, adicione localidades rurais e a quantidade de entrevistas.</p>
          <div><label>Localidade rural<input value={ruralName} onChange={(event) => setRuralName(event.target.value)} placeholder="Nome da localidade" /></label>
          <label>Entrevistas<input type="number" min="0" step="1" value={ruralCount} onChange={(event) => setRuralCount(event.target.value)} placeholder="0" /></label>
          <button type="button" className="secondary" onClick={addRural}><Plus /> Adicionar localidade</button></div>
        </div>}
      </div>;
    })}
    {error && <p role="alert" className="localityError">{error}</p>}
    <div className={`quotaCheck ${valid ? "valid" : ""}`} role="status">
      {valid ? <CheckCircle2 /> : <AlertTriangle />}<span><b>Total distribuído: {total} de {target}</b><small>{valid
        ? "A soma das entrevistas por bairro está igual ao total de pessoas a entrevistar."
        : total > target ? `Retire ${total - target} entrevistas para fechar o total.`
        : target > 0 ? `Faltam distribuir ${target - total} entrevistas. A soma deve ser exatamente ${target}.`
        : "Informe o total de pessoas a entrevistar."}</small></span>
    </div>
  </section>;
}
