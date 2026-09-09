// Cadastro em massa da pesquisa eleitoral Bonito/PE nº 012/2026 (04 a 06/09/2026).
//
// O sistema não guarda pesquisas/perguntas em tabelas relacionais: tudo fica em
// public.pulso_state, em dois blobs JSON ('researches' e 'questions'), e a única
// forma de gravar é a função pulso_admin_sync_state, que SOBRESCREVE os dois arrays
// inteiros. Por isso este script sempre lê o estado atual primeiro e só acrescenta
// a pesquisa/perguntas novas ao que já existe — nunca apaga o que está lá.
//
// Uso:
//   PULSO_ADMIN_USER=admin PULSO_ADMIN_PASSWORD=xxxxx node scripts/seed-pesquisa-bonito-012-2026.mjs --dry-run
//   PULSO_ADMIN_USER=admin PULSO_ADMIN_PASSWORD=xxxxx node scripts/seed-pesquisa-bonito-012-2026.mjs
//
// --dry-run (padrão se nenhuma flag for passada): só imprime o que seria gravado,
// não chama pulso_admin_sync_state. Passe --write para gravar de verdade.

import { loginAdminAndGetState, isWriteMode, syncAdminState } from "./pulso-admin-client.mjs";

const RESEARCH_ID_PREFIX = "BON012";

// CONFIRMAR: não informado no pedido original. Preencher antes de gravar.
const CLIENT_NAME = "PREENCHER";
const SAMPLE_TARGET = 0;

const singleChoice = (block, id, text, options, extra = {}) => ({
  id: `${RESEARCH_ID_PREFIX}_${id}`,
  block,
  text,
  type: "Escolha única",
  vars: [],
  options,
  ...extra,
});

const openText = (block, id, text, extra = {}) => ({
  id: `${RESEARCH_ID_PREFIX}_${id}`,
  block,
  text,
  type: "Texto aberto",
  vars: [],
  ...extra,
});

const NAO_SABE = "Não sabe";
const NENHUM = "Nenhum";

const newQuestions = [
  // Eliminatória. ATENÇÃO: o sistema guarda a flag `eliminatory` mas não tem
  // lógica que interrompa a entrevista automaticamente — é só um rótulo hoje.
  singleChoice("Triagem", "Q00_ELEITOR", "O Sr.(a) é eleitor de Bonito?", ["Sim"], { eliminatory: true }),

  singleChoice(
    "Percepção",
    "Q01_FUTURO",
    "Quando o Sr.(a) pensa no futuro, acha que a vida vai se tornar melhor, vai piorar ou não espera mudança?",
    ["Melhor", "Vai piorar", "Não espera mudança", NAO_SABE],
  ),

  // Texto livre espontâneo. O sistema não tem "texto livre + atalho de opção":
  // o(a) entrevistador(a) digita "Não sabe" quando for o caso.
  openText(
    "Percepção",
    "Q02_PROBLEMA",
    "Na sua opinião, qual é o maior problema daqui, dessa localidade, que deveria ser resolvido com mais urgência?",
  ),

  openText(
    "Eleitoral",
    "Q03_DEPFED_ESPONTANEA",
    "Se as eleições se realizassem hoje, em quem o Sr.(a) votaria para Deputado Federal?",
  ),
  openText(
    "Eleitoral",
    "Q04_DEPEST_ESPONTANEA",
    "E para Deputado Estadual, em quem o Sr.(a) votaria?",
  ),

  singleChoice(
    "Eleitoral",
    "Q05_DEPFED_ESTIMULADA",
    "Se as eleições se realizassem hoje, e os candidatos a Deputado Federal fossem apenas Felipe Carreras, Clodoaldo Magalhães, Som Monteiro, Ricardo Teobaldo, Gabriel Porto e Anderson Ferreira, em qual o Sr.(a) votaria?",
    ["Felipe Carreras", "Clodoaldo Magalhães", "Som Monteiro", "Ricardo Teobaldo", "Gabriel Porto", "Anderson Ferreira", NENHUM, NAO_SABE],
  ),
  singleChoice(
    "Eleitoral",
    "Q06_DEPEST_ESTIMULADA",
    "E se os candidatos a Deputado Estadual fossem apenas: Cayo Albino, Joãozinho Tenório, France Hacker, Jarbas Filho, Socorrinho do Apami e Álvaro Porto, em qual o Sr.(a) votaria?",
    ["Cayo Albino", "Joãozinho Tenório", "France Hacker", "Jarbas Filho", "Socorrinho do Apami", "Álvaro Porto", NENHUM, NAO_SABE],
  ),

  singleChoice(
    "Eleitoral",
    "Q07_GOVERNADOR",
    "Se as eleições se realizassem hoje, em qual desses candidatos o Sr.(a) votaria para Governador de Pernambuco: Raquel Lyra ou João Campos?",
    ["Raquel Lyra", "João Campos", NENHUM, NAO_SABE],
  ),
  singleChoice(
    "Eleitoral",
    "Q08_GOVERNADOR_REJEICAO",
    "E em qual desses candidatos o Sr.(a) NÃO VOTARIA DE MANEIRA NENHUMA: Raquel Lyra ou João Campos?",
    ["Raquel Lyra", "João Campos", "Não rejeita nenhum", NAO_SABE],
  ),

  singleChoice(
    "Eleitoral",
    "Q09_SENADOR_1",
    "Esse ano votaremos em dois candidatos a Senador. Em qual desses candidatos o Sr.(a) pretende votar em primeiro lugar: Marília Arraes, Humberto Costa, Túlio Gadelha, Eduardo da Fonte e Mendonça Filho?",
    ["Marília Arraes", "Humberto Costa", "Túlio Gadelha", "Eduardo da Fonte", "Mendonça Filho", NENHUM, NAO_SABE],
  ),
  singleChoice(
    "Eleitoral",
    "Q10_SENADOR_2",
    "E em qual candidato pretende votar em segundo lugar para Senador: Marília Arraes, Humberto Costa, Túlio Gadelha, Eduardo da Fonte e Mendonça Filho?",
    ["Marília Arraes", "Humberto Costa", "Túlio Gadelha", "Eduardo da Fonte", "Mendonça Filho", NENHUM, NAO_SABE],
  ),

  singleChoice(
    "Eleitoral",
    "Q11_PRESIDENTE",
    "Em qual desses candidatos o Sr.(a) votaria para Presidente se as eleições se realizassem hoje: Lula, Flávio Bolsonaro, Renan Santos, Ronaldo Caiado, Romeu Zema e Augusto Cury?",
    ["Lula", "Flávio Bolsonaro", "Renan Santos", "Ronaldo Caiado", "Romeu Zema", "Augusto Cury", NENHUM, NAO_SABE],
  ),

  singleChoice(
    "Eleitoral",
    "Q12_DEPFED_APOIO_RUY",
    "Na sua opinião, qual desses candidatos a Deputado Federal é apoiado pelo prefeito Dr. Ruy: Felipe Carreras, Clodoaldo Magalhães, Som Monteiro, Ricardo Teobaldo e Gabriel Porto?",
    ["Felipe Carreras", "Clodoaldo Magalhães", "Som Monteiro", "Ricardo Teobaldo", "Gabriel Porto", NENHUM, NAO_SABE],
  ),
  singleChoice(
    "Eleitoral",
    "Q13_DEPFED_APOIO_MAROJA",
    "Qual desses candidatos é apoiado por Maroja e a Casa Vermelha: Felipe Carreras, Clodoaldo Magalhães, Som Monteiro, Ricardo Teobaldo e Gabriel Porto?",
    ["Felipe Carreras", "Clodoaldo Magalhães", "Som Monteiro", "Ricardo Teobaldo", "Gabriel Porto", NENHUM, NAO_SABE],
  ),
  singleChoice(
    "Eleitoral",
    "Q14_DEPFED_APOIO_ADEMIR",
    "E qual desses candidatos é apoiado por Dr. Ademir: Felipe Carreras, Clodoaldo Magalhães, Som Monteiro, Ricardo Teobaldo e Gabriel Porto?",
    ["Felipe Carreras", "Clodoaldo Magalhães", "Som Monteiro", "Ricardo Teobaldo", "Gabriel Porto", NENHUM, NAO_SABE],
  ),

  // ATENÇÃO: alternativas NÃO vieram claras no documento original. Foram inferidas
  // por analogia com a pergunta 16 (estrutura idêntica). CONFIRMAR antes de gravar.
  singleChoice(
    "Eleitoral",
    "Q15_DEPFED_ESTIMULADA_APOIOS",
    "Se os candidatos a Deputado Federal fossem apenas: Felipe Carreras apoiado por Dr. Ruy; Clodoaldo Magalhães apoiado por Dr. Ademir; Som Monteiro apoiado por Joãozinho Tenório; Ricardo Teobaldo apoiado por Maroja e a Casa Vermelha; e Gabriel Porto apoiado por Paulinho de Devá, em qual o Sr.(a) votaria?",
    ["Felipe Carreras", "Clodoaldo Magalhães", "Som Monteiro", "Ricardo Teobaldo", "Gabriel Porto", NENHUM, NAO_SABE],
  ),
  singleChoice(
    "Eleitoral",
    "Q16_DEPEST_ESTIMULADA_APOIOS",
    "Se os candidatos a Deputado Estadual fossem apenas: Cayo Albino apoiado pelo prefeito Dr. Ruy; Joãozinho Tenório apoiado por Som Monteiro; France Hacker apoiado por Maroja e a Casa Vermelha; Jarbas Filho apoiado por Dr. Ademir; Socorrinho do Apami apoiada por Júnior do Gado; e Álvaro Porto apoiado por Paulinho de Devá, em qual o Sr.(a) votaria?",
    ["Cayo Albino", "Joãozinho Tenório", "France Hacker", "Jarbas Filho", "Socorrinho do Apami", "Álvaro Porto", NENHUM, NAO_SABE],
  ),

  singleChoice(
    "Eleitoral",
    "Q17_GOVERNADOR_APOIOS",
    "Entre a candidata Raquel Lyra apoiada por Maroja, Som Monteiro e Dr. Ademir; e o candidato João Campos apoiado pelo prefeito Dr. Ruy, em qual o Sr.(a) votaria se as eleições para Governador se realizassem hoje?",
    ["Raquel Lyra", "João Campos", NENHUM, NAO_SABE],
  ),

  singleChoice(
    "Eleitoral",
    "Q18_CERTEZA_VOTO",
    "O Sr.(a) tem certeza desse voto, ou poderá mudar até o dia das eleições?",
    ["Tem certeza", "Poderá mudar", "Sem resposta"],
  ),

  singleChoice(
    "Eleitoral",
    "Q19_GOV_APOIO_LULA",
    "Na sua opinião, qual desses candidatos a governador de Pernambuco é apoiado pelo presidente Lula: Raquel Lyra ou João Campos?",
    ["Raquel Lyra", "João Campos", NAO_SABE],
  ),

  singleChoice(
    "Gestão",
    "Q20_AVAL_RUY",
    "Na sua opinião, o prefeito Dr. Ruy está realizando um governo ótimo, bom, regular, ruim ou péssimo?",
    ["Ótimo", "Bom", "Regular", "Ruim", "Péssimo", NAO_SABE],
  ),
  singleChoice(
    "Gestão",
    "Q21_AVAL_RAQUEL",
    "Na sua opinião, a governadora Raquel Lyra está realizando um governo ótimo, bom, regular, ruim ou péssimo?",
    ["Ótimo", "Bom", "Regular", "Ruim", "Péssimo", NAO_SABE],
  ),
  singleChoice(
    "Gestão",
    "Q22_AVAL_LULA",
    "Na sua opinião, o presidente Lula está realizando um governo ótimo, bom, regular, ruim ou péssimo?",
    ["Ótimo", "Bom", "Regular", "Ruim", "Péssimo", NAO_SABE],
  ),

  // "Outra" sem sub-campo de texto: o sistema não suporta opção com detalhamento.
  singleChoice(
    "Perfil",
    "Q23_RELIGIAO",
    "Qual a sua religião?",
    ["Católica", "Evangélica", "Espírita", "Umbandista", "Outra", "Sem religião"],
  ),
  singleChoice(
    "Perfil",
    "Q24_INSTRUCAO",
    "Qual o seu Grau de Instrução? (O Sr.(a) estuda ou estudou até que série?)",
    [
      "Analfabeto",
      "Lê e escreve",
      "Fundamental Incompleto (1º Grau)",
      "Fundamental completo (1º Grau)",
      "Ensino Médio incompleto (2º Grau)",
      "Ensino Médio completo (2º Grau)",
      "Superior incompleto",
      "Superior completo",
      "Pós-Graduação",
    ],
  ),
  singleChoice(
    "Perfil",
    "Q25_IDADE",
    "O Sr.(a) pertence à qual desses Grupos de Idade?",
    ["16 a 24 anos", "25 a 34", "35 a 44", "45 a 59", "60 anos ou mais"],
  ),
  singleChoice("Perfil", "Q26_SEXO", "Sexo:", ["Masculino", "Feminino"]),

  // Campos de identificação do entrevistado (sem conceito próprio no schema
  // atual — cadastrados como perguntas de texto livre, bloco Validação).
  openText("Validação", "Q27_NOME_ENTREVISTADO", "Nome do Entrevistado"),
  openText("Validação", "Q28_ENDERECO", "Endereço (Rua e Número)"),
  openText("Validação", "Q29_TELEFONE", "Telefone do entrevistado"),

  // "Entrevistador(a)" já é capturado automaticamente em cada entrevista
  // (agentId/agentName de quem está logado no Pulso Campo). Descomente só se
  // quiser duplicar isso como uma pergunta explícita do questionário.
  // openText("Validação", "Q30_ENTREVISTADOR", "Entrevistador(a)"),
];

const newResearch = {
  id: Date.now(),
  number: "012/2026",
  title: "Pesquisa Eleitoral Bonito/PE 012/2026",
  type: "Eleitoral",
  status: "Ativa",
  start: "04/09/2026",
  end: "06/09/2026",
  responses: 0,
  city: "Bonito/PE",
  client: CLIENT_NAME, // CONFIRMAR
  target: SAMPLE_TARGET, // CONFIRMAR
  questionTarget: newQuestions.length,
  questions: newQuestions.map((q) => q.id),
  variables: {},
  quotas: {},
};

async function main() {
  const write = isWriteMode();
  const { token, state } = await loginAdminAndGetState();

  const existingQuestions = state?.questions || [];
  const existingResearches = state?.researches || [];

  const duplicateIds = newQuestions
    .map((q) => q.id)
    .filter((id) => existingQuestions.some((q) => q.id === id));
  if (duplicateIds.length) {
    throw new Error(`IDs de pergunta já existem no banco: ${duplicateIds.join(", ")}`);
  }
  if (existingResearches.some((r) => r.number === newResearch.number)) {
    throw new Error(`Já existe uma pesquisa com o número ${newResearch.number}.`);
  }

  const nextQuestions = [...existingQuestions, ...newQuestions];
  const nextResearches = [newResearch, ...existingResearches];

  console.log(`Perguntas novas: ${newQuestions.length}`);
  console.log(`Pesquisa nova: ${newResearch.number} — ${newResearch.title}`);
  console.log(JSON.stringify({ research: newResearch, questions: newQuestions }, null, 2));

  if (!write) {
    console.log("\n--dry-run (padrão): nada foi gravado. Rode com --write para gravar de fato.");
    return;
  }

  await syncAdminState(token, nextResearches, nextQuestions);

  console.log("\nGravado com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
