// Marca as perguntas de identificação do entrevistado (Nome/Endereço/Telefone)
// com o novo flag `identification: true`, usado pelo template de impressão do
// questionário de campo para excluí-las da numeração 1..N e tratá-las à parte.
//
// Uso: PULSO_ADMIN_USER=... PULSO_ADMIN_PASSWORD=... node scripts/mark-identification-questions.mjs [--write]

import { loginAdminAndGetState, isWriteMode, syncAdminState } from "./pulso-admin-client.mjs";

const TARGET_IDS = [
  "BON012_Q27_NOME_ENTREVISTADO",
  "BON012_Q28_ENDERECO",
  "BON012_Q29_TELEFONE",
];

async function main() {
  const write = isWriteMode();
  const { token, state } = await loginAdminAndGetState();

  const missing = TARGET_IDS.filter((id) => !state.questions.some((q) => q.id === id));
  if (missing.length) throw new Error(`Perguntas não encontradas: ${missing.join(", ")}`);

  const nextQuestions = state.questions.map((q) =>
    TARGET_IDS.includes(q.id) ? { ...q, identification: true } : q,
  );

  console.log(
    "Perguntas que serão marcadas:",
    nextQuestions.filter((q) => TARGET_IDS.includes(q.id)).map((q) => ({ id: q.id, identification: q.identification })),
  );

  if (!write) {
    console.log("\n--dry-run (padrão): nada foi gravado. Rode com --write para gravar de fato.");
    return;
  }

  await syncAdminState(token, state.researches, nextQuestions);
  console.log("\nGravado com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
