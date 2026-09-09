// Cadastra um agente de campo na pesquisa 012/2026 e gera login/senha reais,
// usando o mesmo algoritmo do painel (slugifyLogin + senha aleatória de 6 chars),
// gravando diretamente via pulso_admin_sync_state.
//
// Uso: PULSO_ADMIN_USER=... PULSO_ADMIN_PASSWORD=... node scripts/create-agent-012-2026.mjs --write

import {
  loginAdminAndGetState,
  isWriteMode,
  syncAdminState,
  slugifyLogin,
  generateAgentPassword,
} from "./pulso-admin-client.mjs";

const AGENT_NAME = "Josielton Cavalcante";
const AGENT_PHONE = "";
const AGENT_AREAS = ["Cachoeira"];

async function main() {
  const write = isWriteMode();
  const { token, state } = await loginAdminAndGetState();

  const research = state.researches.find((r) => r.number === "012/2026");
  if (!research) throw new Error("Pesquisa 012/2026 não encontrada.");

  const existingAgents = research.agents || [];
  const takenLogins = new Set(existingAgents.map((a) => a.login).filter(Boolean));
  const base = slugifyLogin(AGENT_NAME);
  let agentLogin = base;
  let suffix = 1;
  while (takenLogins.has(agentLogin)) {
    agentLogin = `${base}${suffix}`;
    suffix++;
  }
  const agentPassword = generateAgentPassword();

  const newAgent = {
    id: String(Date.now()),
    name: AGENT_NAME,
    phone: AGENT_PHONE,
    areas: AGENT_AREAS,
    login: agentLogin,
    password: agentPassword,
    blocked: false,
  };

  const updatedResearch = { ...research, agents: [...existingAgents, newAgent] };
  const nextResearches = state.researches.map((r) =>
    r.number === "012/2026" ? updatedResearch : r,
  );

  console.log("Agente que será criado:", {
    name: newAgent.name,
    areas: newAgent.areas,
    login: newAgent.login,
    password: newAgent.password,
  });

  if (!write) {
    console.log("\n--dry-run (padrão): nada foi gravado. Rode com --write para gravar de fato.");
    return;
  }

  await syncAdminState(token, nextResearches, state.questions);

  console.log("\nGravado com sucesso. Use este login/senha no Pulso Campo:");
  console.log(`Login: ${newAgent.login}`);
  console.log(`Senha: ${newAgent.password}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
